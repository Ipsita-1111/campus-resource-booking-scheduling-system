import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createBookingCore, approveBookingCore, normalizeRole } from '../../shared/bookingCore.ts';
import { checkResourceAvailability, CONFLICT_TYPES } from '../../shared/availability.ts';
import { sleep, mkStudent, mkFaculty, makeRecorder } from '../../shared/testHarness.ts';

// ============================================================
// PHASE 7 RESOURCE-SPECIFIC CONSTRAINTS TEST HARNESS
//
// Verifies that the central availability engine enforces resource-specific
// constraints (capacity, lab supervision, supervisor eligibility, booker
// certification) on the authoritative booking + approval path, and that
// Find-a-Space / Resource-Detail consume the SAME engine. All checks inspect
// actual backend behavior through the shared cores.
//
// Modes:
//   mode:"run" (default)   -> setup + run selected tests + report
//   mode:"cleanupOnly"    -> delete temp data for testRunId
//
// Body:
//   testRunId  unique tag (default generated)
//   tests      array of 1..13 to run a subset (default all)
//   cleanup    true to delete temp data at the end (default false)
// ============================================================

const SYNTH_USERS = ['p7-student1', 'p7-student2', 'p7-faculty1', 'p7-faculty2'];

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
      await base44.entities.ApprovalRule.deleteMany({ description: testRunId });
      for (const uid of SYNTH_USERS) {
        await base44.entities.FacultyCertification.deleteMany({ user_id: uid });
      }
      return Response.json({ mode: 'cleanupOnly', testRunId, deleted });
    }

    const testRunId = body.testRunId || `p7-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const wanted = Array.isArray(body.tests) && body.tests.length
      ? body.tests.map((t) => Number(t))
      : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    const cleanup = body.cleanup === true;

    // ---------- SETUP: isolated resources ----------
    const existing = await base44.entities.Resource.filter({ description: testRunId });
    const findR = (n) => existing.find((r) => r.room_number === n);
    const mkResource = async (n, opts) => {
      let r = findR(n);
      if (!r) r = await base44.entities.Resource.create({ ...opts, room_number: n, description: testRunId });
      return r;
    };
    const seminarA = await mkResource('P7-SA', {
      name: `P7[${testRunId}] Seminar Hall A`, resource_type: 'SEMINAR_HALL',
      building: 'P7-ISOLATION', floor: 1, capacity: 150, availability_status: 'AVAILABLE',
      open_time: '08:00', close_time: '20:00', requires_approval: true,
    });
    const seminarB = await mkResource('P7-SB', {
      name: `P7[${testRunId}] Seminar Hall B`, resource_type: 'SEMINAR_HALL',
      building: 'P7-ISOLATION', floor: 1, capacity: 200, availability_status: 'AVAILABLE',
      open_time: '08:00', close_time: '20:00', requires_approval: true,
    });
    const labX = await mkResource('P7-LX', {
      name: `P7[${testRunId}] Chemistry Lab`, resource_type: 'LABORATORY',
      building: 'P7-ISOLATION', floor: 2, capacity: 60, availability_status: 'AVAILABLE',
      open_time: '08:00', close_time: '20:00', requires_approval: true,
      requires_supervising_faculty: true, required_supervisor_qualification: 'CHEMISTRY',
      required_certification_ids: ['NETWORK_SECURITY'],
    });
    const classroom = await mkResource('P7-CR', {
      name: `P7[${testRunId}] Classroom`, resource_type: 'CLASSROOM',
      building: 'P7-ISOLATION', floor: 1, capacity: 50, availability_status: 'AVAILABLE',
      open_time: '08:00', close_time: '20:00', requires_approval: true,
    });

    // Approval rules: all student bookings require admin approval (no auto-approve).
    const existingRules = await base44.entities.ApprovalRule.filter({ description: testRunId });
    if (!existingRules.length) {
      for (const rt of ['CLASSROOM', 'LABORATORY', 'SEMINAR_HALL']) {
        await base44.entities.ApprovalRule.create({
          name: `P7 ${rt}-student`, resource_type: rt, user_role: 'STUDENT',
          requires_approval: true, auto_approve: false, approver_role: 'ADMINISTRATOR',
          description: testRunId, is_active: true,
        });
      }
    }

    // Synthetic users + certifications.
    const student1 = mkStudent('p7-student1', 'P7 Student One');   // no certifications
    const student2 = mkStudent('p7-student2', 'P7 Student Two');   // holds NETWORK_SECURITY
    const faculty1 = mkFaculty('p7-faculty1', 'Dr. X');           // holds CHEMISTRY (qualified supervisor)
    const faculty2 = mkFaculty('p7-faculty2', 'Dr. Y');           // no CHEMISTRY (unqualified)
    const ensureCert = async (uid, name) => {
      const c = await base44.entities.FacultyCertification.filter({ user_id: uid, certification_name: name });
      if (!c.length) await base44.entities.FacultyCertification.create({ user_id: uid, certification_name: name });
    };
    await ensureCert('p7-student2', 'NETWORK_SECURITY');
    await ensureCert('p7-faculty1', 'CHEMISTRY');

    const { results, summary, record } = makeRecorder();

    // Local-time helpers (consistent with availability engine's getDay()).
    const D = (n) => `2026-11-${String(n).padStart(2, '0')}`; // 2026-11-03 is a Tuesday
    const iso = (day, hhmm) => `${D(day)}T${hhmm}:00`;

    // Create a ONE_TIME timetable event for a supervisor (blocks their availability).
    const addSupTT = async (facultyId, day, start, end) => {
      await base44.entities.TimetableEvent.create({
        resource_id: classroom.id, resource_name: classroom.name,
        course_name: `P7-sup-${facultyId}`, course_code: 'P7',
        faculty_id: facultyId, faculty_name: facultyId,
        start_time: start, end_time: end,
        specific_date: D(day), recurrence: 'ONE_TIME', status: 'ACTIVE',
        semester: 'FALL', academic_year: '2026-2027',
      });
    };

    // T1 — seminar hall capacity exceeded (180 > 150)
    if (wanted.includes(1)) {
      try {
        const r = await createBookingCore(base44, student1, {
          resourceId: seminarA.id, startDateTime: iso(3, '10:00'), endDateTime: iso(3, '12:00'),
          title: 'T1-seminar', purpose: 'p7', expectedAttendance: 180, idempotencyKey: `${testRunId}|T1`,
        });
        const cap = !r.success && r.status === 'CONFLICTED' && (r.conflicts || []).some((c) => c.type === CONFLICT_TYPES.CAPACITY);
        record(1, cap, { status: r.status, reason: r.reason, conflictType: r.conflicts?.[0]?.type });
      } catch (e) { record(1, false, { error: e.message }); }
      await sleep(300);
    }

    // T2 — seminar hall capacity satisfied (100 <= 150)
    if (wanted.includes(2)) {
      try {
        const r = await createBookingCore(base44, student1, {
          resourceId: seminarA.id, startDateTime: iso(4, '10:00'), endDateTime: iso(4, '12:00'),
          title: 'T2-seminar', purpose: 'p7', expectedAttendance: 100, idempotencyKey: `${testRunId}|T2`,
        });
        record(2, r.success && r.status === 'PENDING', { status: r.status, reason: r.reason });
      } catch (e) { record(2, false, { error: e.message }); }
      await sleep(300);
    }

    // T3 — lab requires supervisor but none provided
    if (wanted.includes(3)) {
      try {
        const r = await createBookingCore(base44, student2, {
          resourceId: labX.id, startDateTime: iso(3, '10:00'), endDateTime: iso(3, '12:00'),
          title: 'T3-lab', purpose: 'p7', expectedAttendance: 20, idempotencyKey: `${testRunId}|T3`,
        });
        const rej = !r.success && r.status === 'CONFLICTED' && r.conflicts?.[0]?.type === CONFLICT_TYPES.LAB_SUPERVISOR_REQUIRED;
        record(3, rej, { status: r.status, reason: r.reason, conflictType: r.conflicts?.[0]?.type });
      } catch (e) { record(3, false, { error: e.message }); }
      await sleep(300);
    }

    // T4 — supervisor unavailable due to a scheduled class (timetable)
    if (wanted.includes(4)) {
      try {
        await addSupTT(faculty1.id, 4, '14:30', '15:30');
        await sleep(200);
        const r = await createBookingCore(base44, student2, {
          resourceId: labX.id, startDateTime: iso(4, '14:00'), endDateTime: iso(4, '16:00'),
          title: 'T4-lab', purpose: 'p7', expectedAttendance: 20,
          supervisingFacultyId: faculty1.id, supervisingFacultyName: 'Dr. X',
          idempotencyKey: `${testRunId}|T4`,
        });
        const rej = !r.success && r.status === 'CONFLICTED' && r.conflicts?.[0]?.type === CONFLICT_TYPES.SUPERVISOR_UNAVAILABLE;
        record(4, rej, { status: r.status, reason: r.reason, conflictType: r.conflicts?.[0]?.type });
      } catch (e) { record(4, false, { error: e.message }); }
      await sleep(300);
    }

    // T5 — supervisor available (clean slot)
    if (wanted.includes(5)) {
      try {
        const r = await createBookingCore(base44, student2, {
          resourceId: labX.id, startDateTime: iso(5, '14:00'), endDateTime: iso(5, '16:00'),
          title: 'T5-lab', purpose: 'p7', expectedAttendance: 20,
          supervisingFacultyId: faculty1.id, supervisingFacultyName: 'Dr. X',
          idempotencyKey: `${testRunId}|T5`,
        });
        record(5, r.success && r.status === 'PENDING', { status: r.status, reason: r.reason });
      } catch (e) { record(5, false, { error: e.message }); }
      await sleep(300);
    }

    // T6 — unauthorized/unqualified supervisor (no CHEMISTRY qualification)
    if (wanted.includes(6)) {
      try {
        const r = await createBookingCore(base44, student2, {
          resourceId: labX.id, startDateTime: iso(6, '10:00'), endDateTime: iso(6, '12:00'),
          title: 'T6-lab', purpose: 'p7', expectedAttendance: 20,
          supervisingFacultyId: faculty2.id, supervisingFacultyName: 'Dr. Y',
          idempotencyKey: `${testRunId}|T6`,
        });
        const rej = !r.success && r.status === 'CONFLICTED' && r.conflicts?.[0]?.type === CONFLICT_TYPES.SUPERVISOR_NOT_QUALIFIED;
        record(6, rej, { status: r.status, reason: r.reason, conflictType: r.conflicts?.[0]?.type });
      } catch (e) { record(6, false, { error: e.message }); }
      await sleep(300);
    }

    // T7 — certification required but user lacks certification
    if (wanted.includes(7)) {
      try {
        const r = await createBookingCore(base44, student1, {
          resourceId: labX.id, startDateTime: iso(7, '10:00'), endDateTime: iso(7, '12:00'),
          title: 'T7-lab', purpose: 'p7', expectedAttendance: 20,
          supervisingFacultyId: faculty1.id, supervisingFacultyName: 'Dr. X',
          idempotencyKey: `${testRunId}|T7`,
        });
        const rej = !r.success && r.status === 'CONFLICTED' && r.conflicts?.[0]?.type === CONFLICT_TYPES.CERTIFICATION_REQUIRED;
        record(7, rej, { status: r.status, reason: r.reason, conflictType: r.conflicts?.[0]?.type });
      } catch (e) { record(7, false, { error: e.message }); }
      await sleep(300);
    }

    // T8 — certification requirement satisfied
    if (wanted.includes(8)) {
      try {
        const r = await createBookingCore(base44, student2, {
          resourceId: labX.id, startDateTime: iso(10, '10:00'), endDateTime: iso(10, '12:00'),
          title: 'T8-lab', purpose: 'p7', expectedAttendance: 20,
          supervisingFacultyId: faculty1.id, supervisingFacultyName: 'Dr. X',
          idempotencyKey: `${testRunId}|T8`,
        });
        record(8, r.success && r.status === 'PENDING', { status: r.status, reason: r.reason });
      } catch (e) { record(8, false, { error: e.message }); }
      await sleep(300);
    }

    // T9 — resource-specific constraint blocks booking creation (cannot become APPROVED)
    if (wanted.includes(9)) {
      try {
        const r = await createBookingCore(base44, student1, {
          resourceId: seminarA.id, startDateTime: iso(8, '10:00'), endDateTime: iso(8, '12:00'),
          title: 'T9-seminar', purpose: 'p7', expectedAttendance: 180, idempotencyKey: `${testRunId}|T9`,
        });
        // Booking must not be created; nothing to approve.
        const notCreated = !r.success && r.status === 'CONFLICTED';
        record(9, notCreated, { status: r.status, reason: r.reason, conflictType: r.conflicts?.[0]?.type });
      } catch (e) { record(9, false, { error: e.message }); }
      await sleep(300);
    }

    // T10 — resource-specific constraint becomes invalid before approval
    if (wanted.includes(10)) {
      try {
        // Create a PENDING lab booking with an available supervisor (day 12, clean).
        const created = await createBookingCore(base44, student2, {
          resourceId: labX.id, startDateTime: iso(12, '14:00'), endDateTime: iso(12, '16:00'),
          title: 'T10-lab', purpose: 'p7', expectedAttendance: 20,
          supervisingFacultyId: faculty1.id, supervisingFacultyName: 'Dr. X',
          idempotencyKey: `${testRunId}|T10`,
        });
        const pendingOk = created.success && created.status === 'PENDING';
        // Supervisor becomes unavailable (a class scheduled over the slot).
        await addSupTT(faculty1.id, 12, '14:30', '15:30');
        await sleep(200);
        const ap = await approveBookingCore(base44, admin, created.booking.id);
        const booking = await base44.entities.Booking.get(created.booking.id);
        const safe = !ap.success && ap.status === 'CONFLICTED' && booking.status === 'CONFLICTED';
        record(10, pendingOk && safe, {
          created: created.status, approvalResult: ap.status, finalStatus: booking.status, reason: ap.reason,
        });
      } catch (e) { record(10, false, { error: e.message }); }
      await sleep(300);
    }

    // T11 — Find a Space reflects capacity/constraint conflicts (SEARCH mode)
    if (wanted.includes(11)) {
      try {
        const a = await checkResourceAvailability(base44, {
          resourceId: seminarA.id, startDateTime: iso(9, '10:00'), endDateTime: iso(9, '12:00'),
          requestedBy: admin.id, requestedCapacity: 180, bookingContext: { mode: 'SEARCH' },
        });
        const b = await checkResourceAvailability(base44, {
          resourceId: seminarB.id, startDateTime: iso(9, '10:00'), endDateTime: iso(9, '12:00'),
          requestedBy: admin.id, requestedCapacity: 180, bookingContext: { mode: 'SEARCH' },
        });
        // SEARCH mode must NOT raise lab-supervisor-required for the lab (no supervisor in search).
        const lab = await checkResourceAvailability(base44, {
          resourceId: labX.id, startDateTime: iso(9, '10:00'), endDateTime: iso(9, '12:00'),
          requestedBy: admin.id, bookingContext: { mode: 'SEARCH' },
        });
        const ok = !a.available && a.conflictType === CONFLICT_TYPES.CAPACITY && b.available && lab.available;
        record(11, ok, {
          seminarA: { available: a.available, conflictType: a.conflictType, reason: a.conflictReason },
          seminarB: { available: b.available },
          labX_search: { available: lab.available, conflictType: lab.conflictType },
        });
      } catch (e) { record(11, false, { error: e.message }); }
      await sleep(300);
    }

    // T12 — Resource Detail displays the applicable constraints (fields retrievable)
    if (wanted.includes(12)) {
      try {
        const lab = await base44.entities.Resource.get(labX.id);
        const sem = await base44.entities.Resource.get(seminarA.id);
        const labOk = lab.requires_supervising_faculty === true &&
          lab.required_supervisor_qualification === 'CHEMISTRY' &&
          Array.isArray(lab.required_certification_ids) &&
          lab.required_certification_ids.includes('NETWORK_SECURITY');
        const semOk = sem.capacity === 150;
        record(12, labOk && semOk, {
          lab: {
            requires_supervising_faculty: lab.requires_supervising_faculty,
            required_supervisor_qualification: lab.required_supervisor_qualification,
            required_certification_ids: lab.required_certification_ids,
          },
          seminarCapacity: sem.capacity,
        });
      } catch (e) { record(12, false, { error: e.message }); }
      await sleep(300);
    }

    // T13 — different resource types invoke their appropriate rules
    if (wanted.includes(13)) {
      try {
        // Classroom booking with NO supervisor -> passes (classrooms don't require supervision).
        const cr = await createBookingCore(base44, student1, {
          resourceId: classroom.id, startDateTime: iso(13, '10:00'), endDateTime: iso(13, '12:00'),
          title: 'T13-classroom', purpose: 'p7', expectedAttendance: 20, idempotencyKey: `${testRunId}|T13cr`,
        });
        // Lab booking with NO supervisor -> blocked (LAB_SUPERVISOR_REQUIRED).
        const lab = await createBookingCore(base44, student1, {
          resourceId: labX.id, startDateTime: iso(13, '10:00'), endDateTime: iso(13, '12:00'),
          title: 'T13-lab', purpose: 'p7', expectedAttendance: 20, idempotencyKey: `${testRunId}|T13lab`,
        });
        const ok = cr.success && cr.status === 'PENDING' && !lab.success &&
          lab.conflicts?.[0]?.type === CONFLICT_TYPES.LAB_SUPERVISOR_REQUIRED;
        record(13, ok, {
          classroom: { success: cr.success, status: cr.status },
          lab: { success: lab.success, status: lab.status, conflictType: lab.conflicts?.[0]?.type },
        });
      } catch (e) { record(13, false, { error: e.message }); }
      await sleep(300);
    }

    const out = {
      mode: 'run',
      testRunId,
      caller: { id: admin.id, name: admin.full_name || admin.email, role: normalizeRole(admin) },
      tempResources: { seminarA: seminarA.id, seminarB: seminarB.id, labX: labX.id, classroom: classroom.id },
      syntheticUsers: { student1: student1.id, student2: student2.id, faculty1: faculty1.id, faculty2: faculty2.id },
      summary,
      results,
      cleanupInstructions: `Re-run with { "mode":"cleanupOnly", "testRunId":"${testRunId}" } to remove temp data.`,
      cleanupPerformed: false,
    };

    if (cleanup) {
      for (const rid of [seminarA.id, seminarB.id, labX.id, classroom.id]) {
        const ev = await base44.entities.TimetableEvent.filter({ resource_id: rid });
        if (ev.length) await base44.entities.TimetableEvent.deleteMany({ resource_id: rid });
        const bk = await base44.entities.Booking.filter({ resource_id: rid });
        if (bk.length) await base44.entities.Booking.deleteMany({ resource_id: rid });
        await base44.entities.Resource.delete(rid);
      }
      await base44.entities.ApprovalRule.deleteMany({ description: testRunId });
      for (const uid of SYNTH_USERS) {
        await base44.entities.FacultyCertification.deleteMany({ user_id: uid });
      }
      out.cleanupPerformed = true;
    }

    return Response.json(out);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}