// ============================================================
// BOOKING LIFECYCLE — status transitions, authorization, audit, notifications.
//
// Pure helpers shared by bookingCore.ts and the HTTP handlers. This module
// does NOT import bookingCore (no cycle). It owns:
//   - role normalization
//   - the valid state-transition table for a booking request
//   - approver authorization (role + scope + self-approval rules)
//   - best-effort audit logging and user notifications
// ============================================================

export function normalizeRole(user) {
  if (!user) return 'STUDENT';
  if (user.role === 'admin') return 'ADMINISTRATOR';
  return user.campus_role || 'STUDENT';
}

// ------------------------------------------------------------
// State transitions. Terminal states (REJECTED, CONFLICTED,
// CANCELLED, EXPIRED, COMPLETED) cannot transition anywhere.
// Notably: APPROVED -> PENDING is NOT allowed.
// ------------------------------------------------------------
const TRANSITIONS = {
  PENDING: ['APPROVED', 'REJECTED', 'CONFLICTED', 'CANCELLED', 'EXPIRED'],
  APPROVED: ['CANCELLED', 'COMPLETED'],
  REJECTED: [],
  CONFLICTED: [],
  CANCELLED: [],
  EXPIRED: [],
  COMPLETED: [],
};

export function canTransition(from, to) {
  const allowed = TRANSITIONS[from] || [];
  return allowed.includes(to);
}

export function assertCanTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid status transition: ${from} -> ${to}`);
  }
}

// ------------------------------------------------------------
// Approver authorization.
// Rules:
//   - STUDENT: never authorized to approve/reject.
//   - Self-approval: blocked for everyone except ADMINISTRATOR (admin override,
//     audited).
//   - FACULTY: authorized only when the booking's required_approver_role is
//     FACULTY AND the faculty is in scope — i.e. they are the supervising
//     faculty of the resource, or (no supervisor assigned) any faculty.
//   - ADMINISTRATOR: always authorized (override).
// Returns { authorized, reason, role, override }.
// ------------------------------------------------------------
export function checkApproverAuthorization(user, booking, resource) {
  const role = normalizeRole(user);
  if (role === 'STUDENT') {
    return { authorized: false, reason: 'Students are not authorized to approve requests', role };
  }
  if (booking.user_id === user.id && role !== 'ADMINISTRATOR') {
    return { authorized: false, reason: 'You cannot approve your own request', role };
  }
  if (role === 'ADMINISTRATOR') {
    return { authorized: true, reason: null, role, override: true };
  }
  // role === FACULTY
  const requiredApprover = booking.required_approver_role || 'ADMINISTRATOR';
  if (requiredApprover === 'ADMINISTRATOR') {
    return { authorized: false, reason: 'This request requires an administrator to approve', role };
  }
  // requiredApprover === FACULTY
  if (resource && resource.supervising_faculty_id) {
    if (resource.supervising_faculty_id === user.id) {
      return { authorized: true, reason: null, role };
    }
    return { authorized: false, reason: 'You are not the supervising faculty for this resource', role };
  }
  // No supervising faculty assigned — any faculty may approve.
  return { authorized: true, reason: null, role };
}

// ------------------------------------------------------------
// Audit + notifications (best-effort; never fail the workflow).
// ------------------------------------------------------------
export async function recordAudit(base44, params) {
  const { user, action, bookingId, resourceId, previousStatus, newStatus, reason, metadata } = params;
  try {
    await base44.entities.AuditLog.create({
      user_id: user?.id || null,
      user_name: user?.full_name || user?.email || null,
      action,
      booking_id: bookingId || null,
      resource_id: resourceId || null,
      previous_status: previousStatus || null,
      new_status: newStatus || null,
      reason: reason || null,
      metadata: metadata || null,
    });
  } catch (e) {
    // best-effort
  }
}

export async function notifyUser(base44, params) {
  const { userId, bookingId, resourceId, type, title, message } = params;
  if (!userId) return;
  try {
    await base44.entities.Notification.create({
      user_id: userId,
      booking_id: bookingId || null,
      resource_id: resourceId || null,
      type,
      title,
      message,
      is_read: false,
    });
  } catch (e) {
    // best-effort
  }
}