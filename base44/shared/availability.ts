// ============================================================
// CENTRALIZED AVAILABILITY ENGINE
// Single source of truth for "Is resource X available between START and END?"
//
// CONCURRENCY NOTE (read me):
// This engine performs a point-in-time business-rule evaluation. It is NOT a
// concurrency guarantee. A "check availability, then insert" sequence is racy:
// two simultaneous requests can both pass the check. Booking creation and
// approval (Phase 4+) MUST call this engine AND then commit the state change
// through an atomic backend operation that re-verifies availability immediately
// before the write. Do not rely on this function alone to prevent double booking.
// ============================================================

export const CONFLICT_TYPES = {
  APPROVED_BOOKING: 'APPROVED_BOOKING',
  PENDING_REQUEST: 'PENDING_REQUEST',
  TIMETABLE: 'TIMETABLE',
  ADMIN_BLOCK: 'ADMIN_BLOCK',
  OPERATING_HOURS: 'OPERATING_HOURS',
  CAPACITY: 'CAPACITY',
  LAB_SUPERVISOR: 'LAB_SUPERVISOR',
  // Phase 7 — resource-specific constraints
  LAB_SUPERVISOR_REQUIRED: 'LAB_SUPERVISOR_REQUIRED',
  SUPERVISOR_UNAVAILABLE: 'SUPERVISOR_UNAVAILABLE',
  SUPERVISOR_NOT_QUALIFIED: 'SUPERVISOR_NOT_QUALIFIED',
  CERTIFICATION_REQUIRED: 'CERTIFICATION_REQUIRED',
};

// Half-open interval overlap [es, ee) vs [rs, re). Adjacent bookings are allowed.
export function intervalsOverlap(es, ee, rs, re) {
  return es < re && ee > rs;
}

function parseTimeToDate(date, hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
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

function fmt(ms) {
  return new Date(ms).toISOString();
}

function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

// Collect overlapping weekly occurrences of a timetable event within [rs, re).
function weeklyOccurrences(event, rs, re) {
  const DAY = 86400000;
  const WEEK = 7 * DAY;
  const out = [];
  let base = new Date(rs);
  base.setHours(0, 0, 0, 0);
  const diff = (event.day_of_week - base.getDay() + 7) % 7;
  base = new Date(base.getTime() + diff * DAY);
  // Start one week earlier to catch occurrences that begin before rs but end after rs.
  for (let occ = new Date(base.getTime() - WEEK); occ.getTime() <= re; occ = new Date(occ.getTime() + WEEK)) {
    const es = parseTimeToDate(occ, event.start_time).getTime();
    const ee = parseTimeToDate(occ, event.end_time).getTime();
    if (intervalsOverlap(es, ee, rs, re)) out.push([es, ee]);
  }
  return out;
}

function timetableOccurrences(event, rs, re) {
  if (event.recurrence === 'ONE_TIME' && event.specific_date) {
    const es = parseTimeToDate(event.specific_date, event.start_time).getTime();
    const ee = parseTimeToDate(event.specific_date, event.end_time).getTime();
    return intervalsOverlap(es, ee, rs, re) ? [[es, ee]] : [];
  }
  return weeklyOccurrences(event, rs, re);
}

/**
 * Evaluate resource availability for a requested time range.
 *
 * @param base44 - a Base44 SDK client (user-scoped or service-role) used for reads
 * @param {object} params
 * @param {string} params.resourceId
 * @param {string} params.startDateTime - ISO datetime
 * @param {string} params.endDateTime - ISO datetime
 * @param {string} [params.requestedBy]
 * @param {number} [params.requestedCapacity]
 * @param {string} [params.supervisingFacultyId] - requested supervisor (booking); falls back to resource default
 * @param {object} [params.bookingContext] - { excludeBookingId, excludeBookingIds, mode }
 *   mode: 'SEARCH' (Find a Space) skips booking-only constraints (supervisor-required,
 *         supervisor eligibility, booker certification). Default = booking mode.
 * @returns {Promise<{available:boolean, conflicts:Array, conflictType:string|null, conflictReason:string|null}>}
 */
export async function checkResourceAvailability(base44, params) {
  const {
    resourceId,
    startDateTime,
    endDateTime,
    requestedBy,
    requestedCapacity,
    supervisingFacultyId,
    bookingContext = {},
  } = params;
  const isSearch = bookingContext.mode === 'SEARCH';

  const excludeBookingIds = new Set(
    Array.isArray(bookingContext.excludeBookingIds)
      ? bookingContext.excludeBookingIds
      : bookingContext.excludeBookingId
      ? [bookingContext.excludeBookingId]
      : []
  );

  const conflicts = [];

  if (!resourceId) {
    return fail('INVALID', 'Missing resourceId', conflicts);
  }

  const rs = new Date(startDateTime).getTime();
  const re = new Date(endDateTime).getTime();
  if (Number.isNaN(rs) || Number.isNaN(re) || !(rs < re)) {
    return fail('INVALID', 'startDateTime must be before endDateTime', conflicts);
  }

  // Load resource
  const resource = await base44.entities.Resource.get(resourceId);
  if (!resource) {
    return fail('NOT_FOUND', 'Resource not found', conflicts);
  }

  // 1 & 2 — Approved bookings + pending requests (provisional occupancy)
  const bookings = await base44.entities.Booking.filter({ resource_id: resourceId });
  for (const b of bookings) {
    if (excludeBookingIds.has(b.id)) continue;
    if (b.status !== 'APPROVED' && b.status !== 'PENDING') continue;
    // Approval resolution ignores pending occupancy (approving one conflicts the others).
    if (bookingContext.treatPendingAsOccupancy === false && b.status === 'PENDING') continue;
    const bs = new Date(b.start_time).getTime();
    const be = new Date(b.end_time).getTime();
    if (Number.isNaN(bs) || Number.isNaN(be)) continue;
    if (intervalsOverlap(bs, be, rs, re)) {
      const type =
        b.status === 'APPROVED'
          ? CONFLICT_TYPES.APPROVED_BOOKING
          : CONFLICT_TYPES.PENDING_REQUEST;
      conflicts.push({
        type,
        reason:
          type === CONFLICT_TYPES.APPROVED_BOOKING
            ? `Occupied by approved booking "${b.title || 'Untitled'}" from ${fmt(bs)} to ${fmt(be)}`
            : `Pending request "${b.title || 'Untitled'}" provisionally holds ${fmt(bs)} to ${fmt(be)}`,
        start: fmt(bs),
        end: fmt(be),
        sourceId: b.id,
        sourceName: b.title || b.resource_name || 'Booking',
      });
    }
  }

  // 3 — Timetable events (scheduled academic classes)
  const timetable = await base44.entities.TimetableEvent.filter({ resource_id: resourceId });
  for (const t of timetable) {
    if (t.status !== 'ACTIVE') continue;
    const occurrences = timetableOccurrences(t, rs, re);
    for (const [es, ee] of occurrences) {
      conflicts.push({
        type: CONFLICT_TYPES.TIMETABLE,
        reason: `Scheduled class "${t.course_name}"${t.course_code ? ' (' + t.course_code + ')' : ''} from ${fmt(es)} to ${fmt(ee)}`,
        start: fmt(es),
        end: fmt(ee),
        sourceId: t.id,
        sourceName: t.course_name,
      });
    }
  }

  // 4 — Administrative blocks
  const blocks = await base44.entities.ResourceBlock.filter({ resource_id: resourceId });
  for (const bl of blocks) {
    const bs = new Date(bl.start_time).getTime();
    const be = new Date(bl.end_time).getTime();
    if (Number.isNaN(bs) || Number.isNaN(be)) continue;
    if (intervalsOverlap(bs, be, rs, re)) {
      conflicts.push({
        type: CONFLICT_TYPES.ADMIN_BLOCK,
        reason: `Administrative block (${bl.block_type || 'block'}): ${bl.reason} from ${fmt(bs)} to ${fmt(be)}`,
        start: fmt(bs),
        end: fmt(be),
        sourceId: bl.id,
        sourceName: bl.reason,
      });
    }
  }
  // Resource-level unavailability status (maintenance/unavailable) is an admin-level block.
  if (resource.availability_status && resource.availability_status !== 'AVAILABLE') {
    conflicts.push({
      type: CONFLICT_TYPES.ADMIN_BLOCK,
      reason: `Resource is currently marked ${resource.availability_status.toLowerCase()}`,
      start: fmt(rs),
      end: fmt(re),
      sourceId: resource.id,
      sourceName: resource.name,
    });
  }

  // 5 — Operating hours (per day; campus resources do not operate overnight)
  if (resource.open_time && resource.close_time) {
    if (!sameDay(rs, re)) {
      conflicts.push({
        type: CONFLICT_TYPES.OPERATING_HOURS,
        reason: `Booking spans multiple days; ${resource.name} operates ${resource.open_time}–${resource.close_time} within a single day.`,
        start: fmt(rs),
        end: fmt(re),
        sourceId: resource.id,
        sourceName: resource.name,
      });
    } else {
      const openMin = hhmmToMinutes(resource.open_time);
      const closeMin = hhmmToMinutes(resource.close_time);
      const rsMin = new Date(rs).getHours() * 60 + new Date(rs).getMinutes();
      const reMin = new Date(re).getHours() * 60 + new Date(re).getMinutes();
      if (rsMin < openMin || reMin > closeMin) {
        conflicts.push({
          type: CONFLICT_TYPES.OPERATING_HOURS,
          reason: `Requested time is outside operating hours (${resource.open_time}–${resource.close_time}).`,
          start: fmt(rs),
          end: fmt(re),
          sourceId: resource.id,
          sourceName: resource.name,
        });
      }
    }
  }

  // 6 — Capacity (resource constraint, not a time conflict). Applies in all modes.
  if (
    requestedCapacity != null &&
    resource.capacity != null &&
    Number(requestedCapacity) > Number(resource.capacity)
  ) {
    conflicts.push({
      type: CONFLICT_TYPES.CAPACITY,
      reason: `Requested attendance (${requestedCapacity}) exceeds the room capacity (${resource.capacity}).`,
      start: fmt(rs),
      end: fmt(re),
      sourceId: resource.id,
      sourceName: resource.name,
    });
  }

  // 7 — Laboratory supervising-faculty constraints (resource-specific).
  //   The supervisor evaluated is the one requested in the booking, falling back
  //   to the resource's assigned supervisor. Supervisor *availability* (timetable
  //   + existing supervision commitments) is checked whenever a supervisor can be
  //   determined. The hard "supervisor required" rule and eligibility/qualification
  //   checks are booking-only (skipped in SEARCH mode).
  if (resource.resource_type === 'LABORATORY') {
    const supId = supervisingFacultyId || resource.supervising_faculty_id;

    if (resource.requires_supervising_faculty && !supId && !isSearch) {
      conflicts.push({
        type: CONFLICT_TYPES.LAB_SUPERVISOR_REQUIRED,
        reason: 'A supervising faculty member is required for this laboratory.',
        start: fmt(rs),
        end: fmt(re),
        sourceId: resource.id,
        sourceName: resource.name,
      });
    }

    if (supId) {
      // 7a — Eligibility: supervisor must hold the required qualification, if configured.
      if (!isSearch && resource.required_supervisor_qualification) {
        const supCerts = await base44.entities.FacultyCertification.filter({ user_id: supId });
        const holds = supCerts.some(
          (c) => c.certification_name === resource.required_supervisor_qualification
        );
        if (!holds) {
          conflicts.push({
            type: CONFLICT_TYPES.SUPERVISOR_NOT_QUALIFIED,
            reason: `Supervising faculty does not hold the required qualification (${resource.required_supervisor_qualification}).`,
            start: fmt(rs),
            end: fmt(re),
            sourceId: resource.id,
            sourceName: resource.name,
          });
        }
      }

      // 7b — Availability: faculty teaching a class anywhere during the window.
      const supTT = await base44.entities.TimetableEvent.filter({ faculty_id: supId });
      for (const t of supTT) {
        if (t.status !== 'ACTIVE') continue;
        const occurrences = timetableOccurrences(t, rs, re);
        for (const [es, ee] of occurrences) {
          conflicts.push({
            type: CONFLICT_TYPES.SUPERVISOR_UNAVAILABLE,
            reason: `Supervising faculty is teaching "${t.course_name}" from ${fmt(es)} to ${fmt(ee)}.`,
            start: fmt(es),
            end: fmt(ee),
            sourceId: t.id,
            sourceName: t.course_name,
          });
        }
      }
      // 7c — Availability: faculty already committed to supervising another booking.
      const supBookings = await base44.entities.Booking.filter({ supervising_faculty_id: supId });
      for (const b of supBookings) {
        if (excludeBookingIds.has(b.id)) continue;
        if (b.status !== 'APPROVED' && b.status !== 'PENDING') continue;
        const bs = new Date(b.start_time).getTime();
        const be = new Date(b.end_time).getTime();
        if (Number.isNaN(bs) || Number.isNaN(be)) continue;
        if (intervalsOverlap(bs, be, rs, re)) {
          conflicts.push({
            type: CONFLICT_TYPES.SUPERVISOR_UNAVAILABLE,
            reason: `Supervising faculty is already committed to another booking from ${fmt(bs)} to ${fmt(be)}.`,
            start: fmt(bs),
            end: fmt(be),
            sourceId: b.id,
            sourceName: b.title || 'Lab supervision',
          });
        }
      }
    }
  }

  // 8 — Booker certification (resource-specific). The requesting user must hold
  //   every certification listed on the resource. Booking-only (skipped in SEARCH).
  if (!isSearch && Array.isArray(resource.required_certification_ids) && resource.required_certification_ids.length && requestedBy) {
    const userCerts = await base44.entities.FacultyCertification.filter({ user_id: requestedBy });
    const held = new Set(userCerts.map((c) => c.certification_name));
    const missing = resource.required_certification_ids.filter((id) => !held.has(id));
    if (missing.length) {
      conflicts.push({
        type: CONFLICT_TYPES.CERTIFICATION_REQUIRED,
        reason: `Booking this resource requires certification: ${missing.join(', ')}.`,
        start: fmt(rs),
        end: fmt(re),
        sourceId: resource.id,
        sourceName: resource.name,
      });
    }
  }

  const available = conflicts.length === 0;
  const first = conflicts[0] || null;
  return {
    available,
    conflicts,
    conflictType: first ? first.type : null,
    conflictReason: first ? first.reason : null,
  };
}

function fail(type, reason, conflicts) {
  conflicts.push({ type, reason, start: null, end: null, sourceId: null, sourceName: null });
  return {
    available: false,
    conflicts,
    conflictType: type,
    conflictReason: reason,
  };
}