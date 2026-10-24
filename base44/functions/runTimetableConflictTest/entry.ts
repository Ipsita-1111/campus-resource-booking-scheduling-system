import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createBookingCore, approveBookingCore, normalizeRole } from '../../shared/bookingCore.ts';
import { checkResourceAvailability, CONFLICT_TYPES } from '../../shared/availability.ts';
import { createTimetableEventCore, cancelTimetableEventCore } from '../../shared/timetableCore.ts';
import { sleep, mkStudent, mkFaculty, makeRecorder } from '../../shared/testHarness.ts';

// ============================================================
// PHASE 6 TIMETABLE-CONFLICT-INTEGRATION TEST HARNESS
//
// Verifies that the central availability engine treats scheduled classes
// (TimetableEvent) as a first-class occupancy source, that booking/approval
// cannot bypass a timetable conflict, that Find-a-Space and Resource-Detail
// data flows use the SAME engine, and that admin timetable mutations are
// authorized + validated.
//
// Tests run sequentially with small pauses (rate-limit-safe). Datetimes are
// LOCAL (no 'Z') so day-of-week is consistent with the engine's getDay().
//
// Modes:
//   mode:"run" (default)   -> setup + run selected tests + report
//   mode:"cleanupOnly"    -> delete temp resources/events/bookings for testRunId
//
// Body:
//   testRunId  unique tag (default generated)
//   tests      array of 1..10 to run a subset (default all)
//   cleanup    true to delete temp data at the end (default false)
// ============================================================

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    if (!admin) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() || {};
    const mode = body.mode || 'run';

    if (mode === 'cleanupOnly') {
      const testRunId = body.testRunId;
      if (!testRunId) return Response.json({ error: 'testRunId required' }, { status: 400 });
      const resources = await base44.entities.Resource.filter({ description: testRunId });
      const deleted = { resources: [] };
      for (const r of resources) {
        const ev = await base44.entities.TimetableEvent.filter({ resource_id: r.id });
        if (ev.length) await base44.entities.TimetableEvent.deleteMany({ resource_id: r.id });
        const bk = await base44.entities.Booking.filter({ resource_id: r.id });
        if (bk.length) await base44.entities.Booking.deleteMany({ resource_id: r.id });
        await base44.entities.Resource.delete(r.id);
        deleted.resources.push(r.id);
      }
      return Response.json({ mode: 'cleanupOnly', testRunId, deleted });
    }

    const testRunId = body.testRunId || `p6-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const wanted = Array.isArray(body.tests) && body.tests.length
      ? body.tests.map((t) => Number(t))
      : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const cleanup = body.cleanup === true;

    // ---------- SETUP: two isolated classrooms ----------
    const existing = await base44.entities.Resource.filter({ description: testRunId });
    const findR = (n) => existing.find((r) => r.room_number === n);
    let roomA = findR('P6A');
    let roomB = findR('P6B');
    if (!roomA) roomA = await base44.entities.Resource.create({
      name: `P6[${testRunId}] Classroom A`, resource_type: 'CLASSROOM',
      building: 'P6-ISOLATION', floor: 1, room_number: 'P6A', capacity: 50,
      description: testRunId, availability_status: 'AVAILABLE',
      open_time: '08:00', close_time: '20:00', requires_approval: true,
    });
    if (!roomB) roomB = await base44.entities.Resource.create({
      name: `P6[${testRunId}] Classroom B`, resource_type: 'CLASSROOM',
      building: 'P6-ISOLATION', floor: 1, room_number: 'P6B', capacity: 40,
      description: testRunId, availability_status: 'AVAILABLE',
      open_time: '08:00', close_time: '20:00', requires_approval: true,
    });

    // An approval rule: classroom-student requires admin approval (no auto-approve).
    const existingRules = await base44.entities.ApprovalRule.filter({ description: testRunId });
    if (!existingRules.length) {
      await base44.entities.ApprovalRule.create({
        name: 'P6 classroom-student', resource_type: 'CLASSROOM', user_role: 'STUDENT',
        requires_approval: true, auto_approve: false, approver_role: 'ADMINISTRATOR',
        description: testRunId, is_active: true,
      });
    }

    const student = mkStudent('p6-student-1', 'P6 Student');
    const faculty = mkFaculty('p6-faculty-1', 'P6 Faculty');

    const { results, summary, record } = makeRecorder();

    // Local-time helpers (consistent with availability engine's getDay()).
    const D = (n) => `2026-11-${String(n).padStart(2, '0')}`; // 2026-11-03 is a Tuesday
    const iso = (day, hhmm) => `${D(day)}T${hhmm}:00`;
    const dow = (day) => new Date(D(day) + 'T00:00:00').getDay();

    // Quick timetable creator for the harness.
    const addTT = async (resourceId, opts) => {
      const r = await createTimetableEventCore(base44, admin, {
        resource_id: resourceId,
        course_name: opts.course,
        course_code: opts.code || null,
        start_time: opts.start,
        end_time: opts.end,
        recurrence: opts.recurrence || 'WEEKLY',
        day_of_week: opts.day_of_week != null ? opts.day_of_week : dow(opts.day),
        specific_date: opts.recurrence === 'ONE_TIME' ? D(opts.day) : null,
        semester: 'FALL', academic_year: '2026-2027',
      });
      return r;
    };

    // T1 — timetable event blocks an overlapping booking request
    if (wanted.includes(1)) {
      try {
        await addTT(roomA.id, { course: 'T1-DB Systems', start: '10:00', end: '12:00', day: 3 });
        await sleep(200);
        const r = await createBookingCore(base44, student, {
          resourceId: roomA.id, startDateTime: iso(3, '11:00'), endDateTime: iso(3, '13:00'),
          title: 'T1-booking', purpose: 'p6', expectedAttendance: 20, idempotencyKey: `${testRunId}|T1`,
        });
        const blocked = !r.success && r.status === 'CONFLICTED';
        const ttConflict = (r.conflicts || []).some((c) => c.type === CONFLICT_TYPES.TIMETABLE);
        record(1, blocked && ttConflict, { status: r.status, reason: r.reason, conflictType: r.conflicts?.[0]?.type });
      } catch (e) { record(1, false, { error: e.message }); }
      await sleep(300);
    }

    // T2 — exact overlap blocks booking
    if (wanted.includes(2)) {
      try {
        await addTT(roomB.id, { course: 'T2-Networks', start: '14:00', end: '16:00', day: 4 });
        await sleep(200);
        const r = await createBookingCore(base44, student, {
          resourceId: roomB.id, startDateTime: iso(4, '14:00'), endDateTime: iso(4, '16:00'),
          title: 'T2-booking', purpose: 'p6', expectedAttendance: 10, idempotencyKey: `${testRunId}|T2`,
        });
        record(2, !r.success && r.status === 'CONFLICTED', { status: r.status, reason: r.reason });
      } catch (e) { record(2, false, { error: e.message }); }
      await sleep(300);
    }

    // T3 — partial overlap blocks booking (both directions)
    if (wanted.includes(3)) {
      try {
        await addTT(roomA.id, { course: 'T3-Algorithms', start: '14:00', end: '16:00', day: 5 });
        await sleep(200);
        const r1 = await createBookingCore(base44, student, {
          resourceId: roomA.id, startDateTime: iso(5, '15:00'), endDateTime: iso(5, '17:00'),
          title: 'T3a-booking', purpose: 'p6', expectedAttendance: 10, idempotencyKey: `${testRunId}|T3a`,
        });
        const r2 = await createBookingCore(base44, student, {
          resourceId: roomA.id, startDateTime: iso(5, '13:00'), endDateTime: iso(5, '15:00'),
          title: 'T3b-booking', purpose: 'p6', expectedAttendance: 10, idempotencyKey: `${testRunId}|T3b`,
        });
        record(3, !r1.success && !r2.success && r1.status === 'CONFLICTED' && r2.status === 'CONFLICTED', {
          forward: r1.status, reverse: r2.status,
        });
      } catch (e) { record(3, false, { error: e.message }); }
      await sleep(300);
    }

    // T4 — adjacent booking is allowed (both directions)
    if (wanted.includes(4)) {
      try {
        await addTT(roomB.id, { course: 'T4-OS', start: '10:00', end: '12:00', day: 6 });
        await sleep(200);
        const r1 = await createBookingCore(base44, student, {
          resourceId: roomB.id, startDateTime: iso(6, '12:00'), endDateTime: iso(6, '14:00'),
          title: 'T4a-adjacent', purpose: 'p6', expectedAttendance: 10, idempotencyKey: `${testRunId}|T4a`,
        });
        // reverse: booking 10:00-12:00, timetable 12:00-14:00 (use roomA for a clean room)
        await addTT(roomA.id, { course: 'T4-Compilers', start: '12:00', end: '14:00', day: 6 });
        await sleep(200);
        const r2 = await createBookingCore(base44, student, {
          resourceId: roomA.id, startDateTime: iso(6, '10:00'), endDateTime: iso(6, '12:00'),
          title: 'T4b-adjacent', purpose: 'p6', expectedAttendance: 10, idempotencyKey: `${testRunId}|T4b`,
        });
        record(4, r1.success && r2.success, { forward: r1.status, reverse: r2.status });
      } catch (e) { record(4, false, { error: e.message }); }
      await sleep(300);
    }

    // T5 — timetable conflict remains blocked during approval
    if (wanted.includes(5)) {
      try {
        // Create a PENDING booking on a slot with NO timetable, then add a timetable
        // over it, then approve -> the approval re-check must CONFLICT it.
        const created = await createBookingCore(base44, student, {
          resourceId: roomA.id, startDateTime: iso(10, '14:00'), endDateTime: iso(10, '16:00'),
          title: 'T5-pending', purpose: 'p6', expectedAttendance: 10, idempotencyKey: `${testRunId}|T5`,
        });
        // day 10 is a Tuesday (2026-11-10); add a weekly Tuesday class 14:00-16:00
        await addTT(roomA.id, { course: 'T5-LateClass', start: '14:00', end: '16:00', day: 10 });
        await sleep(200);
        const ap = await approveBookingCore(base44, admin, created.booking.id);
        const booking = await base44.entities.Booking.get(created.booking.id);
        record(5, !ap.success && ap.status === 'CONFLICTED' && booking.status === 'CONFLICTED', {
          approvalResult: ap.status, finalStatus: booking.status, reason: ap.reason,
        });
      } catch (e) { record(5, false, { error: e.message }); }
      await sleep(300);
    }

    // T6 — Find a Space uses timetable occupancy (backend: checkAvailability returns TIMETABLE)
    if (wanted.includes(6)) {
      try {
        // Self-contained: create a fresh class on roomB (day 7), then query it.
        await addTT(roomB.id, { course: 'T6-Physics', start: '14:00', end: '16:00', day: 7 });
        await sleep(200);
        const avail = await checkResourceAvailability(base44, {
          resourceId: roomB.id, startDateTime: iso(7, '14:30'), endDateTime: iso(7, '15:30'),
          requestedBy: admin.id,
        });
        const ttConflict = !avail.available && avail.conflictType === CONFLICT_TYPES.TIMETABLE;
        // roomA at the same slot has no class -> available.
        const availA = await checkResourceAvailability(base44, {
          resourceId: roomA.id, startDateTime: iso(7, '14:30'), endDateTime: iso(7, '15:30'),
          requestedBy: admin.id,
        });
        record(6, ttConflict && availA.available, {
          roomB: { available: avail.available, conflictType: avail.conflictType, reason: avail.conflictReason },
          roomA: { available: availA.available },
        });
      } catch (e) { record(6, false, { error: e.message }); }
      await sleep(300);
    }

    // T7 — Resource Detail reflects timetable occupancy (data the page renders)
    if (wanted.includes(7)) {
      try {
        // Self-contained: create a fresh class on roomA (day 8), then verify it is retrievable.
        const created = await addTT(roomA.id, { course: 'T7-Chemistry', start: '09:00', end: '11:00', day: 8 });
        await sleep(200);
        const tt = await base44.entities.TimetableEvent.filter({ resource_id: roomA.id });
        const active = tt.filter((t) => t.status === 'ACTIVE');
        const found = active.some((t) => t.course_name === 'T7-Chemistry' && t.start_time === '09:00' && t.end_time === '11:00');
        record(7, created.success && found, {
          created: created.success,
          activeEvents: active.length,
          sample: active.slice(0, 3).map((t) => ({ course: t.course_name, day: t.day_of_week, start: t.start_time, end: t.end_time })),
        });
      } catch (e) { record(7, false, { error: e.message }); }
      await sleep(300);
    }

    // T8 — invalid timetable event rejected (end before start; missing resource)
    if (wanted.includes(8)) {
      try {
        const r1 = await createTimetableEventCore(base44, admin, {
          resource_id: roomA.id, course_name: 'T8-bad', start_time: '16:00', end_time: '14:00',
          recurrence: 'WEEKLY', day_of_week: 2,
        });
        const r2 = await createTimetableEventCore(base44, admin, {
          resource_id: 'nonexistent-resource-id', course_name: 'T8-bad2', start_time: '10:00', end_time: '12:00',
          recurrence: 'WEEKLY', day_of_week: 2,
        });
        const r3 = await createTimetableEventCore(base44, admin, {
          resource_id: roomA.id, course_name: 'T8-outside', start_time: '06:00', end_time: '07:00',
          recurrence: 'WEEKLY', day_of_week: 2,
        });
        const allRejected = !r1.success && r1.validationError && !r2.success && !r3.success;
        record(8, allRejected, {
          endBeforeStart: { success: r1.success, reason: r1.reason },
          missingResource: { success: r2.success, reason: r2.reason },
          outsideHours: { success: r3.success, reason: r3.reason },
        });
      } catch (e) { record(8, false, { error: e.message }); }
      await sleep(300);
    }

    // T9 — unauthorized timetable modification rejected (student)
    if (wanted.includes(9)) {
      try {
        const r = await createTimetableEventCore(base44, student, {
          resource_id: roomA.id, course_name: 'T9-student-attempt', start_time: '10:00', end_time: '12:00',
          recurrence: 'WEEKLY', day_of_week: 2,
        });
        record(9, !r.success && !!r.notAuthorized, { success: r.success, reason: r.reason, notAuthorized: r.notAuthorized });
      } catch (e) { record(9, false, { error: e.message }); }
      await sleep(300);
    }

    // T10 — recurring timetable event produces expected occupied intervals
    if (wanted.includes(10)) {
      try {
        // Weekly Tuesday 14:00-16:00 on roomB (fresh, use a new course to avoid overlap).
        // Use a slot that roomB doesn't already occupy: 16:00-18:00 on Tuesdays.
        const tt = await addTT(roomB.id, { course: 'T10-RecurringDB', start: '16:00', end: '18:00', day: 3 });
        await sleep(200);
        // Tuesday 17:00-17:30 -> should conflict
        const tueConflict = await checkResourceAvailability(base44, {
          resourceId: roomB.id, startDateTime: iso(3, '17:00'), endDateTime: iso(3, '17:30'), requestedBy: admin.id,
        });
        // Wednesday 17:00-17:30 -> should be available (no Wednesday class)
        const wedAvail = await checkResourceAvailability(base44, {
          resourceId: roomB.id, startDateTime: iso(4, '17:00'), endDateTime: iso(4, '17:30'), requestedBy: admin.id,
        });
        // Next Tuesday (day 10) 17:00-17:30 -> should also conflict (recurrence)
        const nextTueConflict = await checkResourceAvailability(base44, {
          resourceId: roomB.id, startDateTime: iso(10, '17:00'), endDateTime: iso(10, '17:30'), requestedBy: admin.id,
        });
        record(10, tt.success && !tueConflict.available && wedAvail.available && !nextTueConflict.available, {
          created: tt.success,
          tuesday: { available: tueConflict.available, conflictType: tueConflict.conflictType },
          wednesday: { available: wedAvail.available },
          nextTuesday: { available: nextTueConflict.available, conflictType: nextTueConflict.conflictType },
        });
      } catch (e) { record(10, false, { error: e.message }); }
      await sleep(300);
    }

    const out = {
      mode: 'run',
      testRunId,
      caller: { id: admin.id, name: admin.full_name || admin.email, role: normalizeRole(admin) },
      tempResources: { roomA: roomA.id, roomB: roomB.id },
      syntheticUsers: { student: student.id, faculty: faculty.id },
      summary,
      results,
      cleanupInstructions: `Re-run with { "mode":"cleanupOnly", "testRunId":"${testRunId}" } to remove temp data.`,
      cleanupPerformed: false,
    };

    if (cleanup) {
      for (const rid of [roomA.id, roomB.id]) {
        const ev = await base44.entities.TimetableEvent.filter({ resource_id: rid });
        if (ev.length) await base44.entities.TimetableEvent.deleteMany({ resource_id: rid });
        const bk = await base44.entities.Booking.filter({ resource_id: rid });
        if (bk.length) await base44.entities.Booking.deleteMany({ resource_id: rid });
        await base44.entities.Resource.delete(rid);
      }
      await base44.entities.ApprovalRule.deleteMany({ description: testRunId });
      out.cleanupPerformed = true;
    }

    return Response.json(out);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}