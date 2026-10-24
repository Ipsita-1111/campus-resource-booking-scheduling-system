import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import {
  createBookingCore,
  approveBookingCore,
  rejectBookingCore,
  cancelBookingCore,
  normalizeRole,
} from '../../shared/bookingCore.ts';
import { canTransition } from '../../shared/bookingLifecycle.ts';
import { sleep, mkStudent, mkFaculty, makeRecorder } from '../../shared/testHarness.ts';

// ============================================================
// PHASE 5 APPROVAL-WORKFLOW TEST HARNESS
//
// Runs the 10 required tests against isolated temporary resources + approval
// rules. Authorization is exercised with SYNTHETIC user objects (different
// campus_role values) passed straight into the core functions — Base44 cannot
// create User records, so real student/faculty accounts are unavailable. The
// synthetic user only affects in-function role checks and the booking's
// user_id field; DB operations run under the authenticated caller. This tests
// the authorization LOGIC, not real multi-user sessions (stated limitation).
//
// Rate-limit-safe: tests run sequentially with small pauses (these are authz
// tests, not concurrency tests — except TEST 7, whose two approvals are fired
// together via Promise.all to race for the lock).
//
// Modes:
//   mode:"run" (default)         -> setup + run selected tests + report
//   mode:"cleanupOnly"           -> delete temp resources/rules/bookings for testRunId
//
// Body:
//   testRunId  unique tag (default generated)
//   tests      array of 1..10 to run a subset (default all)
//   cleanup     true to delete temp data at the end (default false)
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
      const rules = await base44.entities.ApprovalRule.filter({ description: testRunId });
      const deleted = { resources: [], rules: 0 };
      for (const r of resources) {
        const bk = await base44.entities.Booking.filter({ resource_id: r.id });
        if (bk.length) await base44.entities.Booking.deleteMany({ resource_id: r.id });
        await base44.entities.Resource.delete(r.id);
        deleted.resources.push(r.id);
      }
      if (rules.length) await base44.entities.ApprovalRule.deleteMany({ description: testRunId });
      deleted.rules = rules.length;
      return Response.json({ mode: 'cleanupOnly', testRunId, deleted });
    }

    const testRunId = body.testRunId || `p5-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const wanted = Array.isArray(body.tests) && body.tests.length
      ? body.tests.map((t) => Number(t))
      : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const cleanup = body.cleanup === true;
    const tag = `p5-test|${testRunId}`;

    // ---------- SETUP: temp resources + approval rules ----------
    const existing = await base44.entities.Resource.filter({ description: testRunId });
    const findR = (type) => existing.find((r) => r.resource_type === type);
    let classroom = findR('CLASSROOM');
    let lab = findR('LABORATORY');
    let hall = findR('SEMINAR_HALL');
    if (!classroom) classroom = await base44.entities.Resource.create({
      name: `P5[${testRunId}] Classroom`, resource_type: 'CLASSROOM',
      building: 'P5-ISOLATION', floor: 0, room_number: 'C1', capacity: 50,
      description: testRunId, availability_status: 'AVAILABLE',
      open_time: '08:00', close_time: '20:00', requires_approval: true,
    });
    if (!lab) lab = await base44.entities.Resource.create({
      name: `P5[${testRunId}] Lab`, resource_type: 'LABORATORY',
      building: 'P5-ISOLATION', floor: 0, room_number: 'L1', capacity: 30,
      description: testRunId, availability_status: 'AVAILABLE',
      open_time: '08:00', close_time: '20:00', requires_approval: true,
      supervising_faculty_id: 'sim-faculty-1', supervising_faculty_name: 'Sim Faculty',
    });
    if (!hall) hall = await base44.entities.Resource.create({
      name: `P5[${testRunId}] Hall`, resource_type: 'SEMINAR_HALL',
      building: 'P5-ISOLATION', floor: 0, room_number: 'H1', capacity: 200,
      description: testRunId, availability_status: 'AVAILABLE',
      open_time: '08:00', close_time: '22:00', requires_approval: true,
    });

    const existingRules = await base44.entities.ApprovalRule.filter({ description: testRunId });
    if (!existingRules.length) {
      await base44.entities.ApprovalRule.bulkCreate([
        { name: 'P5 classroom-student', resource_type: 'CLASSROOM', user_role: 'STUDENT', requires_approval: true, auto_approve: false, approver_role: 'ADMINISTRATOR', description: testRunId, is_active: true },
        { name: 'P5 classroom-faculty', resource_type: 'CLASSROOM', user_role: 'FACULTY', requires_approval: false, auto_approve: true, approver_role: 'ADMINISTRATOR', description: testRunId, is_active: true },
        { name: 'P5 hall-student', resource_type: 'SEMINAR_HALL', user_role: 'STUDENT', requires_approval: true, auto_approve: false, approver_role: 'FACULTY', description: testRunId, is_active: true },
        { name: 'P5 lab-student', resource_type: 'LABORATORY', user_role: 'STUDENT', requires_approval: true, auto_approve: false, approver_role: 'FACULTY', requires_supervising_faculty: true, description: testRunId, is_active: true },
      ]);
    }

    const student = mkStudent('sim-student-1', 'Sim Student');
    const student2 = mkStudent('sim-student-2', 'Sim Student 2');
    const faculty = mkFaculty('sim-faculty-1', 'Sim Faculty');
    const facultyOther = mkFaculty('sim-faculty-2', 'Sim Faculty Other');

    const { results, summary, record } = makeRecorder();

    const D = (n) => `2026-11-${String(n).padStart(2, '0')}`;
    const S = (n, a, b) => `${D(n)}T${a}:00Z`;
    const E = (n, a, b) => `${D(n)}T${b}:00Z`;

    // TEST 1 — student submits a request requiring approval -> PENDING
    if (wanted.includes(1)) {
      try {
        const r = await createBookingCore(base44, student, {
          resourceId: classroom.id, startDateTime: S(1, '10', '12'), endDateTime: E(1, '10', '12'),
          title: 'T1-student', purpose: tag, expectedAttendance: 20, idempotencyKey: `${testRunId}|T1`,
        });
        record(1, r.success && r.status === 'PENDING', { status: r.status, reason: r.reason || null });
      } catch (e) { record(1, false, { error: e.message }); }
      await sleep(300);
    }

    // TEST 2 — faculty request satisfying auto-approval rules -> APPROVED
    if (wanted.includes(2)) {
      try {
        const r = await createBookingCore(base44, faculty, {
          resourceId: classroom.id, startDateTime: S(2, '10', '12'), endDateTime: E(2, '10', '12'),
          title: 'T2-faculty', purpose: tag, expectedAttendance: 20, idempotencyKey: `${testRunId}|T2`,
        });
        record(2, r.success && r.status === 'APPROVED', { status: r.status, autoApproved: r.booking?.auto_approved });
      } catch (e) { record(2, false, { error: e.message }); }
      await sleep(300);
    }

    // TEST 3 — unauthorized user (faculty not in scope) attempts approval -> rejected
    if (wanted.includes(3)) {
      try {
        const created = await createBookingCore(base44, student, {
          resourceId: lab.id, startDateTime: S(3, '10', '12'), endDateTime: E(3, '10', '12'),
          title: 'T3-lab', purpose: tag, expectedAttendance: 10, idempotencyKey: `${testRunId}|T3`,
        });
        const r = await approveBookingCore(base44, facultyOther, created.booking.id);
        record(3, !r.success && !!r.notAuthorized, { status: r.status, reason: r.reason, notAuthorized: r.notAuthorized });
      } catch (e) { record(3, false, { error: e.message }); }
      await sleep(300);
    }

    // TEST 4 — student attempts to approve their own request -> rejected
    if (wanted.includes(4)) {
      try {
        const created = await createBookingCore(base44, student, {
          resourceId: hall.id, startDateTime: S(4, '10', '12'), endDateTime: E(4, '10', '12'),
          title: 'T4-own', purpose: tag, expectedAttendance: 30, idempotencyKey: `${testRunId}|T4`,
        });
        const r = await approveBookingCore(base44, student, created.booking.id);
        record(4, !r.success && !!r.notAuthorized, { status: r.status, reason: r.reason, notAuthorized: r.notAuthorized });
      } catch (e) { record(4, false, { error: e.message }); }
      await sleep(300);
    }

    // TEST 5 — approver (admin) approves an available request -> APPROVED
    if (wanted.includes(5)) {
      try {
        const created = await createBookingCore(base44, student, {
          resourceId: hall.id, startDateTime: S(5, '10', '12'), endDateTime: E(5, '10', '12'),
          title: 'T5-approve', purpose: tag, expectedAttendance: 30, idempotencyKey: `${testRunId}|T5`,
        });
        const r = await approveBookingCore(base44, admin, created.booking.id);
        record(5, r.success && r.status === 'APPROVED', { status: r.status, reason: r.reason || null });
      } catch (e) { record(5, false, { error: e.message }); }
      await sleep(300);
    }

    // TEST 6 — approver approves a request that has become conflicting -> CONFLICTED
    if (wanted.includes(6)) {
      try {
        const created = await createBookingCore(base44, student, {
          resourceId: hall.id, startDateTime: S(6, '10', '12'), endDateTime: E(6, '10', '12'),
          title: 'T6-pending', purpose: tag, expectedAttendance: 30, idempotencyKey: `${testRunId}|T6`,
        });
        // Make the slot occupied by an approved booking (admin auto-approve via a faculty rule? use classroom auto-approve).
        // Create an approved booking on the same hall slot directly through core as admin won't auto-approve (admin rule default).
        // Instead, approve a second pending on the same slot first to occupy it.
        const created2 = await createBookingCore(base44, student2, {
          resourceId: hall.id, startDateTime: S(6, '10', '12'), endDateTime: E(6, '10', '12'),
          title: 'T6-other', purpose: tag, expectedAttendance: 30, idempotencyKey: `${testRunId}|T6b`,
        });
        // Approve created2 first (faculty is supervising? hall has no supervising faculty; rule approver_role=FACULTY -> any faculty).
        const ap = await approveBookingCore(base44, faculty, created2.booking.id);
        // Now approve created -> should be CONFLICTED (slot taken by created2).
        const r = await approveBookingCore(base44, faculty, created.booking.id);
        record(6, !r.success && r.status === 'CONFLICTED', {
          status: r.status, reason: r.reason || null,
          firstApproval: ap.status,
        });
      } catch (e) { record(6, false, { error: e.message }); }
      await sleep(300);
    }

    // TEST 7 — two approvers simultaneously approve conflicting requests -> 1 APPROVED + 1 CONFLICTED
    if (wanted.includes(7)) {
      try {
        const c1 = await createBookingCore(base44, student, {
          resourceId: hall.id, startDateTime: S(7, '10', '12'), endDateTime: E(7, '10', '12'),
          title: 'T7-A', purpose: tag, expectedAttendance: 30, idempotencyKey: `${testRunId}|T7a`,
        });
        const c2 = await createBookingCore(base44, student2, {
          resourceId: hall.id, startDateTime: S(7, '10', '12'), endDateTime: E(7, '10', '12'),
          title: 'T7-B', purpose: tag, expectedAttendance: 30, idempotencyKey: `${testRunId}|T7b`,
        });
        const [a, b] = await Promise.all([
          approveBookingCore(base44, faculty, c1.booking.id),
          approveBookingCore(base44, faculty, c2.booking.id),
        ]);
        const b1 = await base44.entities.Booking.get(c1.booking.id);
        const b2 = await base44.entities.Booking.get(c2.booking.id);
        const approved = [b1.status, b2.status].filter((s) => s === 'APPROVED').length;
        const conflicted = [b1.status, b2.status].filter((s) => s === 'CONFLICTED').length;
        record(7, approved === 1 && conflicted === 1, {
          finalStatuses: [b1.status, b2.status], approved, conflicted,
          r1: a.status, r2: b.status,
        });
      } catch (e) { record(7, false, { error: e.message }); }
      await sleep(300);
    }

    // TEST 8 — rejected request appears in audit trail
    if (wanted.includes(8)) {
      try {
        const created = await createBookingCore(base44, student, {
          resourceId: hall.id, startDateTime: S(8, '10', '12'), endDateTime: E(8, '10', '12'),
          title: 'T8-reject', purpose: tag, expectedAttendance: 30, idempotencyKey: `${testRunId}|T8`,
        });
        const r = await rejectBookingCore(base44, faculty, created.booking.id, 'Not a valid academic use');
        const audits = await base44.entities.AuditLog.filter({ booking_id: created.booking.id, action: 'BOOKING_REJECTED' });
        const booking = await base44.entities.Booking.get(created.booking.id);
        record(8, r.success && booking.status === 'REJECTED' && audits.length >= 1, {
          status: booking.status, auditRecords: audits.length,
        });
      } catch (e) { record(8, false, { error: e.message }); }
      await sleep(300);
    }

    // TEST 9 — approved request generates a notification for the requester
    if (wanted.includes(9)) {
      try {
        const created = await createBookingCore(base44, student, {
          resourceId: hall.id, startDateTime: S(9, '10', '12'), endDateTime: E(9, '10', '12'),
          title: 'T9-notify', purpose: tag, expectedAttendance: 30, idempotencyKey: `${testRunId}|T9`,
        });
        await approveBookingCore(base44, faculty, created.booking.id);
        const notifs = await base44.entities.Notification.filter({
          user_id: student.id, booking_id: created.booking.id, type: 'BOOKING_APPROVED',
        });
        record(9, notifs.length >= 1, { notifications: notifs.length, type: 'BOOKING_APPROVED' });
      } catch (e) { record(9, false, { error: e.message }); }
      await sleep(300);
    }

    // TEST 10 — invalid status transition is rejected
    if (wanted.includes(10)) {
      try {
        // Create + approve, then attempt to approve again (APPROVED -> APPROVED is invalid) and reject a non-pending.
        const created = await createBookingCore(base44, student, {
          resourceId: hall.id, startDateTime: S(10, '10', '12'), endDateTime: E(10, '10', '12'),
          title: 'T10-transition', purpose: tag, expectedAttendance: 30, idempotencyKey: `${testRunId}|T10`,
        });
        await approveBookingCore(base44, faculty, created.booking.id);
        const approved = await base44.entities.Booking.get(created.booking.id);
        // approve again -> should be rejected (not pending)
        const again = await approveBookingCore(base44, faculty, created.booking.id);
        // reject the already-approved -> should be rejected (not pending)
        const rej = await rejectBookingCore(base44, faculty, created.booking.id, 'x');
        // cancel an already-cancelled: cancel once, then cancel again
        const cancel1 = await cancelBookingCore(base44, student, created.booking.id, 'done');
        const cancel2 = await cancelBookingCore(base44, student, created.booking.id, 'again');
        const transitionGuardWorks =
          !again.success && !rej.success && !cancel2.success && again.reason?.includes('not pending');
        record(10, transitionGuardWorks, {
          approvedStatus: approved.status,
          approveAgain: { success: again.success, reason: again.reason },
          rejectApproved: { success: rej.success, reason: rej.reason },
          cancelTwice: { first: cancel1.status, second: cancel2.success, reason: cancel2.reason },
        });
      } catch (e) { record(10, false, { error: e.message }); }
      await sleep(300);
    }

    const out = {
      mode: 'run',
      testRunId,
      caller: { id: admin.id, name: admin.full_name || admin.email, role: normalizeRole(admin) },
      tempResources: { classroom: classroom.id, lab: lab.id, hall: hall.id },
      syntheticUsers: { student: student.id, student2: student2.id, faculty: faculty.id, facultyOther: facultyOther.id },
      summary,
      results,
      cleanupInstructions: `Re-run with { "mode":"cleanupOnly", "testRunId":"${testRunId}" } to remove temp data.`,
      cleanupPerformed: false,
    };

    if (cleanup) {
      const bk = await base44.entities.Booking.filter({ resource_id: { $in: [classroom.id, lab.id, hall.id] } });
      if (bk.length) await base44.entities.Booking.deleteMany({ resource_id: { $in: [classroom.id, lab.id, hall.id] } });
      await base44.entities.Resource.delete(classroom.id);
      await base44.entities.Resource.delete(lab.id);
      await base44.entities.Resource.delete(hall.id);
      await base44.entities.ApprovalRule.deleteMany({ description: testRunId });
      out.cleanupPerformed = true;
    }

    return Response.json(out);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}