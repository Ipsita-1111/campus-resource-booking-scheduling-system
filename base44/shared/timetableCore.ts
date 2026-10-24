// ============================================================
// TIMETABLE CORE — create / update / cancel logic for scheduled
// academic classes (TimetableEvent), the second authoritative source
// of resource occupancy consumed by the central availability engine.
//
// This module mirrors bookingCore.ts: authorization is enforced here
// (not in the UI), validation is backend-side, and every mutation is
// audited. It does NOT re-implement availability — it only writes
// TimetableEvent records; the Phase 3 availability engine reads them.
// ============================================================

import { intervalsOverlap } from './availability.ts';
import { normalizeRole, recordAudit } from './bookingLifecycle.ts';

export { normalizeRole };

function hhmmToMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function sameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// Do two timetable events share at least one calendar day of occurrence?
function sharesDay(a, b) {
  if (a.recurrence === 'ONE_TIME' && b.recurrence === 'ONE_TIME') {
    return !!(a.specific_date && b.specific_date && sameDay(a.specific_date, b.specific_date));
  }
  if (a.recurrence === 'WEEKLY' && b.recurrence === 'WEEKLY') {
    return Number(a.day_of_week) === Number(b.day_of_week);
  }
  const weekly = a.recurrence === 'WEEKLY' ? a : b;
  const oneTime = a.recurrence === 'ONE_TIME' ? a : b;
  if (!oneTime.specific_date) return false;
  return new Date(oneTime.specific_date + 'T00:00:00').getDay() === Number(weekly.day_of_week);
}

function timesOverlap(aStart, aEnd, bStart, bEnd) {
  const as = hhmmToMin(aStart);
  const ae = hhmmToMin(aEnd);
  const bs = hhmmToMin(bStart);
  const be = hhmmToMin(bEnd);
  return as < be && ae > bs; // half-open, adjacent allowed
}

export function timetableEventsOverlap(a, b) {
  return sharesDay(a, b) && timesOverlap(a.start_time, a.end_time, b.start_time, b.end_time);
}

// Authorization: only faculty and administrators may mutate timetable occupancy.
export function checkTimetableAuthorization(user) {
  const role = normalizeRole(user);
  if (role === 'STUDENT') {
    return { authorized: false, reason: 'Students are not authorized to modify timetable occupancy', role };
  }
  return { authorized: true, reason: null, role };
}

// Validate a timetable event payload against the resource and existing events.
// Returns { valid: true } or { valid: false, error }.
export async function validateTimetableEvent(base44, payload, { excludeId = null } = {}) {
  const { resource_id, course_name, start_time, end_time, recurrence, day_of_week, specific_date } = payload;

  if (!resource_id) return { valid: false, error: 'resource_id is required' };
  if (!course_name) return { valid: false, error: 'course_name is required' };
  if (!start_time || !end_time) return { valid: false, error: 'start_time and end_time are required' };

  const sMin = hhmmToMin(start_time);
  const eMin = hhmmToMin(end_time);
  if (Number.isNaN(sMin) || Number.isNaN(eMin)) {
    return { valid: false, error: 'start_time and end_time must be HH:MM' };
  }
  if (!(sMin < eMin)) {
    return { valid: false, error: 'end_time must be after start_time' };
  }

  let resource;
  try {
    resource = await base44.entities.Resource.get(resource_id);
  } catch (_e) {
    return { valid: false, error: 'Resource not found' };
  }
  if (!resource) return { valid: false, error: 'Resource not found' };

  if (recurrence === 'WEEKLY') {
    if (day_of_week == null || Number(day_of_week) < 0 || Number(day_of_week) > 6) {
      return { valid: false, error: 'WEEKLY recurrence requires day_of_week (0-6)' };
    }
  } else if (recurrence === 'ONE_TIME') {
    if (!specific_date) {
      return { valid: false, error: 'ONE_TIME recurrence requires specific_date' };
    }
  } else {
    return { valid: false, error: 'recurrence must be WEEKLY or ONE_TIME' };
  }

  // Operating hours (when the resource defines them)
  if (resource.open_time && resource.close_time) {
    const openMin = hhmmToMin(resource.open_time);
    const closeMin = hhmmToMin(resource.close_time);
    if (sMin < openMin || eMin > closeMin) {
      return {
        valid: false,
        error: `Class time is outside operating hours (${resource.open_time}–${resource.close_time})`,
      };
    }
  }

  // Overlap with existing ACTIVE timetable events on the same resource
  const existing = await base44.entities.TimetableEvent.filter({ resource_id });
  for (const ev of existing) {
    if (ev.status !== 'ACTIVE') continue;
    if (excludeId && ev.id === excludeId) continue;
    if (timetableEventsOverlap(payload, ev)) {
      return {
        valid: false,
        error: `Overlaps existing class "${ev.course_name}" (${ev.start_time}–${ev.end_time})`,
        conflictId: ev.id,
      };
    }
  }

  return { valid: true, resource };
}

export async function createTimetableEventCore(base44, user, payload) {
  const authz = checkTimetableAuthorization(user);
  if (!authz.authorized) {
    return { success: false, notAuthorized: true, reason: authz.reason };
  }

  const v = await validateTimetableEvent(base44, payload);
  if (!v.valid) {
    return { success: false, validationError: true, reason: v.error };
  }

  const event = await base44.entities.TimetableEvent.create({
    resource_id: payload.resource_id,
    resource_name: v.resource.name,
    course_name: payload.course_name,
    course_code: payload.course_code || null,
    faculty_id: payload.faculty_id || null,
    faculty_name: payload.faculty_name || null,
    day_of_week: payload.recurrence === 'WEEKLY' ? Number(payload.day_of_week) : null,
    start_time: payload.start_time,
    end_time: payload.end_time,
    specific_date: payload.recurrence === 'ONE_TIME' ? payload.specific_date : null,
    semester: payload.semester || null,
    academic_year: payload.academic_year || null,
    recurrence: payload.recurrence || 'WEEKLY',
    status: 'ACTIVE',
  });

  await recordAudit(base44, {
    user,
    action: 'TIMETABLE_CREATED',
    resourceId: event.resource_id,
    previousStatus: null,
    newStatus: 'ACTIVE',
    reason: `Created class ${event.course_name}`,
    metadata: { timetable_event_id: event.id, recurrence: event.recurrence },
  });

  return { success: true, event };
}

export async function updateTimetableEventCore(base44, user, eventId, updates) {
  const authz = checkTimetableAuthorization(user);
  if (!authz.authorized) {
    return { success: false, notAuthorized: true, reason: authz.reason };
  }

  const event = await base44.entities.TimetableEvent.get(eventId);
  if (!event) return { success: false, reason: 'Timetable event not found' };

  const merged = {
    resource_id: updates.resource_id ?? event.resource_id,
    course_name: updates.course_name ?? event.course_name,
    course_code: updates.course_code ?? event.course_code,
    faculty_id: updates.faculty_id ?? event.faculty_id,
    faculty_name: updates.faculty_name ?? event.faculty_name,
    start_time: updates.start_time ?? event.start_time,
    end_time: updates.end_time ?? event.end_time,
    recurrence: updates.recurrence ?? event.recurrence,
    day_of_week: updates.day_of_week ?? event.day_of_week,
    specific_date: updates.specific_date ?? event.specific_date,
    semester: updates.semester ?? event.semester,
    academic_year: updates.academic_year ?? event.academic_year,
  };

  const v = await validateTimetableEvent(base44, merged, { excludeId: eventId });
  if (!v.valid) {
    return { success: false, validationError: true, reason: v.error };
  }

  const updated = await base44.entities.TimetableEvent.update(eventId, {
    resource_id: merged.resource_id,
    resource_name: v.resource.name,
    course_name: merged.course_name,
    course_code: merged.course_code,
    faculty_id: merged.faculty_id,
    faculty_name: merged.faculty_name,
    day_of_week: merged.recurrence === 'WEEKLY' ? Number(merged.day_of_week) : null,
    start_time: merged.start_time,
    end_time: merged.end_time,
    specific_date: merged.recurrence === 'ONE_TIME' ? merged.specific_date : null,
    semester: merged.semester,
    academic_year: merged.academic_year,
    recurrence: merged.recurrence,
  });

  await recordAudit(base44, {
    user,
    action: 'TIMETABLE_UPDATED',
    resourceId: updated.resource_id,
    previousStatus: event.status,
    newStatus: event.status,
    reason: `Updated class ${updated.course_name}`,
    metadata: { timetable_event_id: eventId },
  });

  return { success: true, event: updated };
}

export async function cancelTimetableEventCore(base44, user, eventId) {
  const authz = checkTimetableAuthorization(user);
  if (!authz.authorized) {
    return { success: false, notAuthorized: true, reason: authz.reason };
  }

  const event = await base44.entities.TimetableEvent.get(eventId);
  if (!event) return { success: false, reason: 'Timetable event not found' };
  if (event.status === 'CANCELLED') {
    return { success: false, reason: 'Timetable event is already cancelled' };
  }

  const updated = await base44.entities.TimetableEvent.update(eventId, { status: 'CANCELLED' });

  await recordAudit(base44, {
    user,
    action: 'TIMETABLE_UPDATED',
    resourceId: event.resource_id,
    previousStatus: event.status,
    newStatus: 'CANCELLED',
    reason: `Cancelled class ${event.course_name}`,
    metadata: { timetable_event_id: eventId, cancelled: true },
  });

  return { success: true, event: updated };
}