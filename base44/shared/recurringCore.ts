// ============================================================
// RECURRING BOOKING CORE — weekly semester booking series.
//
// Generates every weekly occurrence in [startDate, endDate] for the
// selected weekdays, checks each through the existing centralized
// availability engine (Phase 3–7 rules), and creates individual Booking
// records for available occurrences — all under the existing per-resource
// mutex (bookingLock.ts) so the check-then-write is serialized. Conflicting
// occurrences are reported with exact dates and reasons. A RecurringSeries
// record summarizes the outcome.
// ============================================================

import { checkResourceAvailability } from './availability.ts';
import { withResourceLock } from './bookingLock.ts';
import { normalizeRole, recordAudit, notifyUser } from './bookingLifecycle.ts';
import { determineWorkflow } from './bookingCore.ts';

/**
 * Generate every occurrence date in [startDate, endDate] that falls on one of
 * the selected weekdays, each with its start/end ISO datetimes.
 */
export function generateOccurrences(startDate, endDate, weekdays, startTime, endTime) {
  const out = [];
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T23:59:59');
  for (let d = new Date(start); d.getTime() <= end.getTime(); d = new Date(d.getTime() + 86400000)) {
    if (weekdays.includes(d.getDay())) {
      const dateStr = d.toISOString().slice(0, 10);
      out.push({
        date: dateStr,
        startDateTime: `${dateStr}T${startTime}:00`,
        endDateTime: `${dateStr}T${endTime}:00`,
      });
    }
  }
  return out;
}

/**
 * Create a recurring booking series. Checks every occurrence through the
 * availability engine and creates individual Booking records for the
 * available ones, all under the per-resource lock.
 *
 * @returns { success, seriesId, summary, occurrences }
 */
export async function createRecurringSeriesCore(base44, user, params) {
  const {
    resourceId,
    startDate,
    endDate,
    weekdays,
    startTime,
    endTime,
    title,
    purpose,
    expectedAttendance,
    supervisingFacultyId,
    supervisingFacultyName,
    conflictPolicy = 'APPROVE_NON_CONFLICTING',
  } = params;

  if (!resourceId || !startDate || !endDate || !weekdays?.length || !startTime || !endTime) {
    throw new Error('resourceId, startDate, endDate, weekdays, startTime and endTime are required');
  }
  if (startTime >= endTime) throw new Error('startTime must be before endTime');
  if (new Date(startDate) > new Date(endDate)) throw new Error('startDate must be before endDate');

  const resource = await base44.entities.Resource.get(resourceId);
  if (!resource) throw new Error('Resource not found');

  const role = normalizeRole(user);
  const wf = await determineWorkflow(base44, resource, role);

  const occurrences = generateOccurrences(startDate, endDate, weekdays, startTime, endTime);
  if (occurrences.length === 0) {
    return { success: false, reason: 'No occurrences fall within the selected date range.' };
  }
  if (occurrences.length > 60) {
    return { success: false, reason: 'A recurring series may have at most 60 occurrences. Please narrow your date range.' };
  }

  const lockId = crypto.randomUUID();
  return await withResourceLock(base44, resourceId, lockId, async () => {
    const seriesId = crypto.randomUUID();
    const results = [];

    for (const occ of occurrences) {
      const avail = await checkResourceAvailability(base44, {
        resourceId,
        startDateTime: occ.startDateTime,
        endDateTime: occ.endDateTime,
        requestedBy: user.id,
        requestedCapacity: expectedAttendance,
        supervisingFacultyId,
        bookingContext: { treatPendingAsOccupancy: false },
      });

      if (avail.available) {
        const status = wf.autoApprove ? 'APPROVED' : 'PENDING';
        const booking = await base44.entities.Booking.create({
          resource_id: resourceId,
          resource_name: resource.name,
          resource_type: resource.resource_type,
          user_id: user.id,
          user_name: user.full_name || user.email,
          title: title || 'Recurring booking',
          purpose: purpose || '',
          date: occ.date,
          start_time: occ.startDateTime,
          end_time: occ.endDateTime,
          expected_attendance: expectedAttendance ?? null,
          supervising_faculty_id: supervisingFacultyId || resource.supervising_faculty_id || null,
          supervising_faculty_name: supervisingFacultyName || resource.supervising_faculty_name || null,
          status,
          auto_approved: wf.autoApprove,
          recurring_series_id: seriesId,
          required_approver_role: wf.approverRole || 'ADMINISTRATOR',
          approved_by_id: wf.autoApprove ? user.id : null,
          approved_by_name: wf.autoApprove ? user.full_name || user.email : null,
          approved_date: wf.autoApprove ? new Date().toISOString() : null,
        });
        results.push({ date: occ.date, available: true, status, bookingId: booking.id });
      } else {
        results.push({
          date: occ.date,
          available: false,
          conflictType: avail.conflictType,
          conflictReason: avail.conflictReason,
        });
      }
    }

    const approvedCount = results.filter((r) => r.available).length;
    const conflictedCount = results.filter((r) => !r.available).length;
    const conflictedDates = results.filter((r) => !r.available).map((r) => r.date);

    let seriesStatus;
    if (conflictedCount === 0) {
      seriesStatus = wf.autoApprove ? 'APPROVED' : 'PENDING';
    } else if (approvedCount === 0) {
      seriesStatus = 'CONFLICTED';
    } else {
      seriesStatus = 'PARTIALLY_APPROVED';
    }

    const series = await base44.entities.RecurringSeries.create({
      resource_id: resourceId,
      resource_name: resource.name,
      user_id: user.id,
      user_name: user.full_name || user.email,
      title: title || 'Recurring booking',
      purpose: purpose || '',
      start_date: startDate,
      end_date: endDate,
      day_of_week: weekdays[0],
      start_time: startTime,
      end_time: endTime,
      expected_attendance: expectedAttendance ?? null,
      supervising_faculty_id: supervisingFacultyId || null,
      status: seriesStatus,
      total_occurrences: occurrences.length,
      approved_occurrences: approvedCount,
      conflicted_occurrences: conflictedCount,
      conflict_policy: conflictPolicy,
      conflicted_dates: conflictedDates,
    });

    await recordAudit(base44, {
      user,
      action: 'BOOKING_CREATED',
      resourceId,
      newStatus: seriesStatus,
      metadata: {
        recurring: true,
        seriesId,
        total: occurrences.length,
        approved: approvedCount,
        conflicted: conflictedCount,
      },
    });

    await notifyUser(base44, {
      userId: user.id,
      resourceId,
      type: 'BOOKING_SUBMITTED',
      title: 'Recurring series submitted',
      message: `"${title || 'Recurring booking'}" series: ${approvedCount} of ${occurrences.length} occurrences available, ${conflictedCount} conflicted.`,
    });

    return {
      success: true,
      seriesId,
      series,
      summary: {
        total: occurrences.length,
        available: approvedCount,
        conflicts: conflictedCount,
      },
      occurrences: results,
    };
  });
}