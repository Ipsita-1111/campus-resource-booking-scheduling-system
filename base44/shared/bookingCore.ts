// ============================================================
// BOOKING CORE — reusable booking + approval + rejection + cancel logic.
//
// The HTTP handlers (createBooking, approveBooking, rejectBooking,
// cancelBooking) and the test harnesses all call these functions directly, so
// the protected write path is identical everywhere. The Phase 3 availability
// engine is the authoritative business-rule evaluator; these functions wrap it
// in the Phase 4 per-resource mutex (bookingLock.ts) so the final check + state
// change is serialized, and in the Phase 5 lifecycle (bookingLifecycle.ts) for
// transitions, authorization, audit and notifications.
// ============================================================

import {
  checkResourceAvailability,
  intervalsOverlap,
} from './availability.ts';
import { withResourceLock } from './bookingLock.ts';
import {
  normalizeRole,
  canTransition,
  assertCanTransition,
  checkApproverAuthorization,
  recordAudit,
  notifyUser,
} from './bookingLifecycle.ts';

export { normalizeRole };

export async function determineWorkflow(base44, resource, role) {
  const rules = await base44.entities.ApprovalRule.filter({
    resource_type: resource.resource_type,
    user_role: role,
    is_active: true,
  });
  if (rules.length) {
    const r = rules[0];
    return {
      autoApprove: !!r.auto_approve,
      requiresApproval: !!r.requires_approval,
      approverRole: r.approver_role,
      requiresSupervisingFaculty: !!r.requires_supervising_faculty,
    };
  }
  return {
    autoApprove: false,
    requiresApproval: true,
    approverRole: 'ADMINISTRATOR',
    requiresSupervisingFaculty: false,
  };
}

// Conflict every other PENDING request overlapping the approved window on the
// same resource: mark CONFLICTED, audit, and notify the requester.
async function conflictOverlappingPending(base44, approvedBooking, actor) {
  const pendings = await base44.entities.Booking.filter({
    resource_id: approvedBooking.resource_id,
    status: 'PENDING',
  });
  const bs = new Date(approvedBooking.start_time).getTime();
  const be = new Date(approvedBooking.end_time).getTime();
  for (const p of pendings) {
    if (p.id === approvedBooking.id) continue;
    const ps = new Date(p.start_time).getTime();
    const pe = new Date(p.end_time).getTime();
    if (intervalsOverlap(ps, pe, bs, be)) {
      await base44.entities.Booking.update(p.id, {
        status: 'CONFLICTED',
        conflict_reason: 'Another request was approved for this time slot',
        conflicted_booking_id: approvedBooking.id,
      });
      await recordAudit(base44, {
        user: actor,
        action: 'BOOKING_CONFLICTED',
        bookingId: p.id,
        resourceId: p.resource_id,
        previousStatus: 'PENDING',
        newStatus: 'CONFLICTED',
        reason: 'Overlapping request approved',
        metadata: { conflicted_by: approvedBooking.id },
      });
      await notifyUser(base44, {
        userId: p.user_id,
        bookingId: p.id,
        resourceId: p.resource_id,
        type: 'BOOKING_CONFLICTED',
        title: 'Request conflicted',
        message: `Your request "${p.title}" was conflicted by an approved booking.`,
      });
    }
  }
}

/**
 * Create a booking request safely. Availability re-check and insert both happen
 * inside the per-resource lock. PENDING requests do NOT hold the slot (Policy B),
 * so competing PENDING requests are allowed; approval resolves them.
 */
export async function createBookingCore(base44, user, params) {
  const {
    resourceId,
    startDateTime,
    endDateTime,
    title,
    purpose,
    expectedAttendance,
    supervisingFacultyId,
    supervisingFacultyName,
    idempotencyKey,
  } = params;

  if (!resourceId || !startDateTime || !endDateTime) {
    throw new Error('resourceId, startDateTime and endDateTime are required');
  }
  const rs = new Date(startDateTime).getTime();
  const re = new Date(endDateTime).getTime();
  if (!(rs < re)) throw new Error('startDateTime must be before endDateTime');

  const resource = await base44.entities.Resource.get(resourceId);
  if (!resource) throw new Error('Resource not found');

  const role = normalizeRole(user);
  const wf = await determineWorkflow(base44, resource, role);

  const lockId = crypto.randomUUID();
  return await withResourceLock(base44, resourceId, lockId, async () => {
    // Idempotency: return the existing booking if this user already used this key.
    if (idempotencyKey) {
      const existing = await base44.entities.Booking.filter({
        user_id: user.id,
        idempotency_key: idempotencyKey,
      });
      if (existing.length) {
        return {
          success: true,
          booking: existing[0],
          status: existing[0].status,
          duplicate: true,
        };
      }
    }

    // Authoritative availability re-check — inside the lock, never stale.
    // Policy B: PENDING requests do NOT provisionally hold the slot, so a new
    // request is not blocked by another PENDING request (competing PENDING allowed).
    const avail = await checkResourceAvailability(base44, {
      resourceId,
      startDateTime,
      endDateTime,
      requestedBy: user.id,
      requestedCapacity: expectedAttendance,
      supervisingFacultyId,
      bookingContext: { treatPendingAsOccupancy: false },
    });
    if (!avail.available) {
      return {
        success: false,
        status: 'CONFLICTED',
        reason: avail.conflictReason,
        conflicts: avail.conflicts,
      };
    }

    const status = wf.autoApprove ? 'APPROVED' : 'PENDING';
    const booking = await base44.entities.Booking.create({
      resource_id: resourceId,
      resource_name: resource.name,
      resource_type: resource.resource_type,
      user_id: user.id,
      user_name: user.full_name || user.email,
      title: title || 'Booking',
      purpose: purpose || '',
      date: startDateTime.slice(0, 10),
      start_time: startDateTime,
      end_time: endDateTime,
      expected_attendance: expectedAttendance ?? null,
      supervising_faculty_id: supervisingFacultyId || resource.supervising_faculty_id || null,
      supervising_faculty_name: supervisingFacultyName || resource.supervising_faculty_name || null,
      status,
      auto_approved: wf.autoApprove,
      idempotency_key: idempotencyKey || null,
      required_approver_role: wf.approverRole || 'ADMINISTRATOR',
      approved_by_id: wf.autoApprove ? user.id : null,
      approved_by_name: wf.autoApprove ? user.full_name || user.email : null,
      approved_date: wf.autoApprove ? new Date().toISOString() : null,
    });

    await recordAudit(base44, {
      user,
      action: 'BOOKING_CREATED',
      bookingId: booking.id,
      resourceId,
      previousStatus: null,
      newStatus: status,
      metadata: {
        auto_approved: wf.autoApprove,
        required_approver_role: wf.approverRole,
      },
    });
    await notifyUser(base44, {
      userId: user.id,
      bookingId: booking.id,
      resourceId,
      type: 'BOOKING_SUBMITTED',
      title: 'Request submitted',
      message: `Your request "${booking.title}" for ${resource.name} was submitted (${status}).`,
    });

    if (wf.autoApprove) {
      // Auto-approval may have displaced competing PENDING requests.
      await conflictOverlappingPending(base44, booking, user);
    } else if (resource.supervising_faculty_id) {
      await notifyUser(base44, {
        userId: resource.supervising_faculty_id,
        bookingId: booking.id,
        resourceId,
        type: 'APPROVAL_REQUIRED',
        title: 'Approval required',
        message: `A new request "${booking.title}" for ${resource.name} needs your approval.`,
      });
    }

    return { success: true, booking, status };
  });
}

/**
 * Approve a PENDING booking safely. Re-checks availability inside the resource
 * lock (ignoring pending occupancy), approves at most one conflicting request,
 * and conflicts the rest. Authorization is enforced here, not in the UI.
 */
export async function approveBookingCore(base44, user, bookingId) {
  const booking = await base44.entities.Booking.get(bookingId);
  if (!booking) throw new Error('Booking not found');
  if (booking.status !== 'PENDING') {
    return {
      success: false,
      status: booking.status,
      reason: `Booking is ${booking.status}, not pending`,
    };
  }

  const resource = await base44.entities.Resource.get(booking.resource_id);
  const authz = checkApproverAuthorization(user, booking, resource);
  if (!authz.authorized) {
    return {
      success: false,
      status: booking.status,
      reason: authz.reason,
      notAuthorized: true,
    };
  }

  const lockId = crypto.randomUUID();
  return await withResourceLock(base44, booking.resource_id, lockId, async () => {
    const avail = await checkResourceAvailability(base44, {
      resourceId: booking.resource_id,
      startDateTime: booking.start_time,
      endDateTime: booking.end_time,
      requestedBy: booking.user_id,
      requestedCapacity: booking.expected_attendance,
      supervisingFacultyId: booking.supervising_faculty_id,
      bookingContext: {
        excludeBookingId: booking.id,
        treatPendingAsOccupancy: false,
      },
    });

    if (!avail.available) {
      assertCanTransition(booking.status, 'CONFLICTED');
      await base44.entities.Booking.update(booking.id, {
        status: 'CONFLICTED',
        conflict_reason: avail.conflictReason,
        conflicted_booking_id: avail.conflicts[0]?.sourceId || null,
      });
      await recordAudit(base44, {
        user,
        action: 'BOOKING_CONFLICTED',
        bookingId: booking.id,
        resourceId: booking.resource_id,
        previousStatus: 'PENDING',
        newStatus: 'CONFLICTED',
        reason: avail.conflictReason,
        metadata: { override: !!authz.override },
      });
      await notifyUser(base44, {
        userId: booking.user_id,
        bookingId: booking.id,
        resourceId: booking.resource_id,
        type: 'BOOKING_CONFLICTED',
        title: 'Request conflicted',
        message: `Your request "${booking.title}" could not be approved: ${avail.conflictReason}`,
      });
      return {
        success: false,
        status: 'CONFLICTED',
        reason: avail.conflictReason,
        conflicts: avail.conflicts,
      };
    }

    assertCanTransition(booking.status, 'APPROVED');
    await base44.entities.Booking.update(booking.id, {
      status: 'APPROVED',
      approved_by_id: user.id,
      approved_by_name: user.full_name || user.email,
      approved_date: new Date().toISOString(),
    });
    await recordAudit(base44, {
      user,
      action: 'BOOKING_APPROVED',
      bookingId: booking.id,
      resourceId: booking.resource_id,
      previousStatus: 'PENDING',
      newStatus: 'APPROVED',
      metadata: { override: !!authz.override },
    });
    await notifyUser(base44, {
      userId: booking.user_id,
      bookingId: booking.id,
      resourceId: booking.resource_id,
      type: 'BOOKING_APPROVED',
      title: 'Request approved',
      message: `Your request "${booking.title}" for ${booking.resource_name} has been approved.`,
    });
    // Displace competing pending requests now that this slot is taken.
    await conflictOverlappingPending(base44, booking, user);
    return { success: true, status: 'APPROVED', bookingId: booking.id };
  });
}

/**
 * Reject a PENDING booking. Authorization enforced here.
 */
export async function rejectBookingCore(base44, user, bookingId, reason) {
  const booking = await base44.entities.Booking.get(bookingId);
  if (!booking) throw new Error('Booking not found');
  if (booking.status !== 'PENDING') {
    return {
      success: false,
      status: booking.status,
      reason: `Booking is ${booking.status}, not pending`,
    };
  }

  const resource = await base44.entities.Resource.get(booking.resource_id);
  const authz = checkApproverAuthorization(user, booking, resource);
  if (!authz.authorized) {
    return {
      success: false,
      status: booking.status,
      reason: authz.reason,
      notAuthorized: true,
    };
  }

  const lockId = crypto.randomUUID();
  return await withResourceLock(base44, booking.resource_id, lockId, async () => {
    assertCanTransition(booking.status, 'REJECTED');
    await base44.entities.Booking.update(booking.id, {
      status: 'REJECTED',
      rejection_reason: reason || null,
      approved_by_id: user.id,
      approved_by_name: user.full_name || user.email,
      approved_date: new Date().toISOString(),
    });
    await recordAudit(base44, {
      user,
      action: 'BOOKING_REJECTED',
      bookingId: booking.id,
      resourceId: booking.resource_id,
      previousStatus: 'PENDING',
      newStatus: 'REJECTED',
      reason: reason || null,
      metadata: { override: !!authz.override },
    });
    await notifyUser(base44, {
      userId: booking.user_id,
      bookingId: booking.id,
      resourceId: booking.resource_id,
      type: 'BOOKING_REJECTED',
      title: 'Request rejected',
      message: `Your request "${booking.title}" was rejected.${reason ? ' Reason: ' + reason : ''}`,
    });
    return { success: true, status: 'REJECTED', bookingId: booking.id };
  });
}

/**
 * Cancel a booking. The requester may cancel their own PENDING/APPROVED request;
 * an admin may cancel any PENDING/APPROVED request (override). Invalid transitions
 * (e.g. CANCELLED -> CANCELLED, REJECTED -> CANCELLED) are rejected.
 */
export async function cancelBookingCore(base44, user, bookingId, reason) {
  const booking = await base44.entities.Booking.get(bookingId);
  if (!booking) throw new Error('Booking not found');

  const role = normalizeRole(user);
  const isOwner = booking.user_id === user.id;
  if (!isOwner && role !== 'ADMINISTRATOR') {
    return {
      success: false,
      status: booking.status,
      reason: 'Not authorized to cancel this request',
      notAuthorized: true,
    };
  }
  if (!canTransition(booking.status, 'CANCELLED')) {
    return {
      success: false,
      status: booking.status,
      reason: `A ${booking.status} request cannot be cancelled`,
    };
  }

  const lockId = crypto.randomUUID();
  return await withResourceLock(base44, booking.resource_id, lockId, async () => {
    assertCanTransition(booking.status, 'CANCELLED');
    await base44.entities.Booking.update(booking.id, {
      status: 'CANCELLED',
      rejection_reason: reason || null,
    });
    await recordAudit(base44, {
      user,
      action: 'BOOKING_CANCELLED',
      bookingId: booking.id,
      resourceId: booking.resource_id,
      previousStatus: booking.status,
      newStatus: 'CANCELLED',
      reason: reason || null,
      metadata: { override: role === 'ADMINISTRATOR' && !isOwner },
    });
    await notifyUser(base44, {
      userId: booking.user_id,
      bookingId: booking.id,
      resourceId: booking.resource_id,
      type: 'BOOKING_CANCELLED',
      title: 'Request cancelled',
      message: `Your request "${booking.title}" was cancelled.${reason ? ' Reason: ' + reason : ''}`,
    });
    return { success: true, status: 'CANCELLED', bookingId: booking.id };
  });
}