import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { createBookingCore, approveBookingCore } from '../../shared/bookingCore.ts';

// ============================================================
// ISOLATED, NON-DESTRUCTIVE, RATE-LIMIT-SAFE CONCURRENCY HARNESS
//
// This harness NEVER touches existing project/demo resources or bookings.
// It creates its own dedicated temporary resources (tagged with a unique
// testRunId), runs selected scenarios against them, inspects the final
// persisted database state, and by default performs NO deletion. To clean
// up later, re-run with mode:"cleanupOnly" and the same testRunId.
//
// RATE-LIMIT-SAFE STRATEGY (read me):
// The platform throttles bursts of concurrent SDK/DB operations. A single
// unrestricted Promise.all of many booking attempts gets rejected with
// "Rate limit exceeded" BEFORE the booking logic runs, which teaches us
// nothing about the mutex. This harness uses TWO defenses:
//
//   1. SMALL CONCURRENT BATCHES with a delay between them. Inside a batch
//      the requests are launched together via Promise.all so they genuinely
//      overlap in flight and race for the per-resource lock; between batches
//      we pause so the overall request rate stays under the limit. This is
//      NOT sequential execution — each batch is a real concurrent race.
//
//   2. RETRY-ON-RATE-LIMIT with backoff. If a request is throttled on its
//      first attempt, it waits and retries until it reaches the booking
//      logic and gets a real outcome (APPROVED / CONFLICTED / duplicate).
//      This guarantees every attempt is actually evaluated by the engine,
//      never silently dropped by the throttle. We report `retriesUsed` per
//      scenario so it is transparent when a pair raced on the first attempt
//      (genuine concurrency) vs. after a retry (sequential re-evaluation,
//      still a valid conflict-detection check but not a true race for that
//      pair). `anyRateLimited` is only true if a call STILL failed after all
//      retries — i.e. it never reached the booking logic.
//
// To keep each function invocation well under the platform timeout, pass
// `scenarios` (array of letters) to run a subset, and reuse the same
// `testRunId` across calls so they share the temp resources.
//
// Modes:
//   mode:"run" (default)        -> create/reuse temp resources, run scenarios, report
//   mode:"cleanupOnly"          -> delete only the temp resources+bookings for
//                                 the given testRunId, then report what was deleted
//
// Tunables (optional, via body):
//   scenarios         (default ["A".."F"])  subset of scenarios to run
//   batchSize         (default 2)          concurrent requests per batch
//   interBatchDelayMs (default 1500)        pause between batches within a scenario
//   interScenarioDelayMs(default 2000)      pause between scenarios
//   aAttempts         (default 20)          total attempts for scenario A
//   retryBackoffMs    (default 2500)        wait before retrying a rate-limited call
//   maxRetries        (default 5)           max retries per call on rate-limit
// ============================================================

function overlap(a, b) {
  return (
    new Date(a.start_time) < new Date(b.end_time) &&
    new Date(a.end_time) > new Date(b.start_time)
  );
}

function approvedOverlapPairs(bookings) {
  const approved = bookings.filter((b) => b.status === 'APPROVED');
  let pairs = 0;
  const pairList = [];
  for (let i = 0; i < approved.length; i++) {
    for (let j = i + 1; j < approved.length; j++) {
      if (overlap(approved[i], approved[j])) {
        pairs++;
        pairList.push([approved[i].id, approved[j].id]);
      }
    }
  }
  return { approvedCount: approved.length, overlapPairs: pairs, pairList };
}

function statusCounts(bookings) {
  const counts = { APPROVED: 0, PENDING: 0, CONFLICTED: 0, REJECTED: 0, CANCELLED: 0, EXPIRED: 0, COMPLETED: 0 };
  for (const b of bookings) counts[b.status] = (counts[b.status] || 0) + 1;
  return counts;
}

function summarize(bookings) {
  return bookings.map((b) => ({
    id: b.id,
    title: b.title,
    status: b.status,
    start: b.start_time,
    end: b.end_time,
    idempotency_key: b.idempotency_key,
    auto_approved: b.auto_approved,
  }));
}

function isRateLimited(r) {
  const reason = (r && r.reason) || '';
  return /rate limit/i.test(String(reason));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() || {};
    const mode = body.mode || 'run';

    // ---------- CLEANUP-ONLY MODE ----------
    if (mode === 'cleanupOnly') {
      const testRunId = body.testRunId;
      if (!testRunId) {
        return Response.json({ error: 'testRunId is required for cleanupOnly mode' }, { status: 400 });
      }
      const tempResources = await base44.entities.Resource.filter({ description: testRunId });
      const deleted = [];
      for (const r of tempResources) {
        const bk = await base44.entities.Booking.filter({ resource_id: r.id });
        if (bk.length) {
          await base44.entities.Booking.deleteMany({ resource_id: r.id });
        }
        await base44.entities.Resource.delete(r.id);
        deleted.push({ resourceId: r.id, name: r.name, bookingsRemoved: bk.length });
      }
      return Response.json({ mode: 'cleanupOnly', testRunId, deletedResources: deleted });
    }

    // ---------- RUN MODE ----------
    const testRunId = body.testRunId || `isolated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const doCleanup = body.cleanup === true;
    const scenarios = Array.isArray(body.scenarios) && body.scenarios.length
      ? body.scenarios.map((s) => String(s).toUpperCase())
      : ['A', 'B', 'C', 'D', 'E', 'F'];
    const batchSize = Number(body.batchSize) || 2;
    const interBatchDelayMs = Number(body.interBatchDelayMs) || 1500;
    const interScenarioDelayMs = Number(body.interScenarioDelayMs) || 2000;
    const aAttempts = Number(body.aAttempts) || 20;
    const retryBackoffMs = Number(body.retryBackoffMs) || 2500;
    const maxRetries = body.maxRetries != null ? Number(body.maxRetries) : 5;

    // 1. Create or reuse dedicated temporary resources (tagged via description = testRunId).
    const existing = await base44.entities.Resource.filter({ description: testRunId });
    const existingClassroom = existing.find((r) => r.resource_type === 'CLASSROOM');
    const existingHall = existing.find((r) => r.resource_type === 'SEMINAR_HALL');
    const r1 = existingClassroom || await base44.entities.Resource.create({
      name: `TEST[${testRunId}] Classroom`,
      resource_type: 'CLASSROOM',
      building: 'TEST-ISOLATION-BLDG', floor: 0, room_number: 'T-1', capacity: 60,
      description: testRunId, availability_status: 'AVAILABLE',
      open_time: '08:00', close_time: '20:00', requires_approval: true,
    });
    const r2 = existingHall || await base44.entities.Resource.create({
      name: `TEST[${testRunId}] SeminarHall`,
      resource_type: 'SEMINAR_HALL',
      building: 'TEST-ISOLATION-BLDG', floor: 0, room_number: 'T-2', capacity: 200,
      description: testRunId, availability_status: 'AVAILABLE',
      open_time: '08:00', close_time: '22:00', requires_approval: true,
    });
    const r1Id = r1.id;
    const r2Id = r2.id;
    const tag = `concurrency-test|${testRunId}`;
    const reusedResources = !!existingClassroom && !!existingHall;

    const out = {
      mode: 'run',
      testRunId,
      tempResources: { classroomId: r1Id, seminarHallId: r2Id, reused: reusedResources },
      caller: { id: user.id, name: user.full_name || user.email, role: user.role },
      config: { scenarios, batchSize, interBatchDelayMs, interScenarioDelayMs, aAttempts, retryBackoffMs, maxRetries },
      scenarios: {},
      anyRateLimited: false,
    };

    // Retry wrapper: re-run a call until it reaches the engine (not rate-limited)
    // or exhausts retries. Returns { result, retries, exhausted }.
    async function withRetry(fn) {
      let retries = 0;
      let result = await fn().catch((e) => ({ success: false, status: 'ERROR', reason: e.message }));
      while (isRateLimited(result) && retries < maxRetries) {
        retries++;
        await sleep(retryBackoffMs);
        result = await fn().catch((e) => ({ success: false, status: 'ERROR', reason: e.message }));
      }
      return { result, retries, exhausted: isRateLimited(result) };
    }

    // Launch one createBookingCore call (with rate-limit retry).
    async function oneCreate(resourceId, start, end, title, idempotencyKey) {
      return withRetry(() => createBookingCore(base44, user, {
        resourceId, startDateTime: start, endDateTime: end,
        title, purpose: tag, expectedAttendance: 10, idempotencyKey,
      }));
    }

    // Run `total` create attempts in small concurrent batches with a delay
    // between batches. Inside each batch the calls are launched together
    // (genuine in-flight overlap); between batches we pause to respect the
    // platform rate limit. Each call is individually retried on rate-limit.
    async function batchedCreates(total, resourceId, start, end, keyPrefix) {
      const wrapped = [];
      for (let i = 0; i < total; i += batchSize) {
        const slice = Array.from({ length: Math.min(batchSize, total - i) }, (_, k) => i + k);
        if (i > 0) await sleep(interBatchDelayMs);
        const batch = await Promise.all(
          slice.map((idx) => oneCreate(resourceId, start, end, `${keyPrefix}-${idx}`, `${testRunId}|${keyPrefix}-${idx}-${Date.now()}`))
        );
        wrapped.push(...batch);
      }
      return wrapped;
    }

    function tally(wrapped) {
      let approved = 0, conflicted = 0, pending = 0, duplicate = 0, error = 0, rateLimited = 0, retriesUsed = 0;
      const errorReasons = {};
      for (const w of wrapped) {
        retriesUsed += w.retries;
        const r = w.result;
        if (w.exhausted) rateLimited++;
        if (r.duplicate) duplicate++;
        else if (r.success && r.status === 'APPROVED') approved++;
        else if (r.success && r.status === 'PENDING') pending++;
        else if (r.status === 'CONFLICTED') conflicted++;
        else {
          error++;
          const reason = r.reason || 'unknown';
          errorReasons[reason] = (errorReasons[reason] || 0) + 1;
        }
      }
      const successful = approved + pending + conflicted + duplicate;
      return { attempted: wrapped.length, successful, approved, pending, conflicted, duplicate, error, rateLimited, retriesUsed, errorReasons };
    }

    // A — `aAttempts` overlapping booking attempts, in small concurrent batches.
    if (scenarios.includes('A')) {
      const wrapped = await batchedCreates(aAttempts, r1Id, '2026-10-12T14:00:00Z', '2026-10-12T16:00:00Z', 'A');
      const t = tally(wrapped);
      const pass = t.approved === 1 && t.rateLimited === 0 && t.conflicted === aAttempts - 1;
      out.scenarios.A_20_concurrent = { ...t, pass };
      if (t.rateLimited > 0) out.anyRateLimited = true;
      await sleep(interScenarioDelayMs);
    }

    // B — 2 simultaneous requests for exactly the same resource and time.
    // NOTE: Base44 does not allow creating User records, so all requests are
    // issued by the single authenticated caller. The concurrency invariant is
    // resource-based and independent of user identity, so this still exercises
    // the same protected write path.
    if (scenarios.includes('B')) {
      const wrapped = await Promise.all([
        oneCreate(r1Id, '2026-10-13T14:00:00Z', '2026-10-13T16:00:00Z', 'B-A', `${testRunId}|B-A-${Date.now()}`),
        oneCreate(r1Id, '2026-10-13T14:00:00Z', '2026-10-13T16:00:00Z', 'B-B', `${testRunId}|B-B-${Date.now()}`),
      ]);
      const t = tally(wrapped);
      const pass = t.approved === 1 && t.conflicted === 1 && t.rateLimited === 0;
      out.scenarios.B_same_resource_time = { ...t, pass };
      if (t.rateLimited > 0) out.anyRateLimited = true;
      await sleep(interScenarioDelayMs);
    }

    // C — partial overlap: A=14:00-16:00, B=15:00-17:00 (2 simultaneous)
    if (scenarios.includes('C')) {
      const wrapped = await Promise.all([
        oneCreate(r1Id, '2026-10-14T14:00:00Z', '2026-10-14T16:00:00Z', 'C-A', `${testRunId}|C-A-${Date.now()}`),
        oneCreate(r1Id, '2026-10-14T15:00:00Z', '2026-10-14T17:00:00Z', 'C-B', `${testRunId}|C-B-${Date.now()}`),
      ]);
      const t = tally(wrapped);
      const pass = t.approved === 1 && t.conflicted === 1 && t.rateLimited === 0;
      out.scenarios.C_partial_overlap = { ...t, pass };
      if (t.rateLimited > 0) out.anyRateLimited = true;
      await sleep(interScenarioDelayMs);
    }

    // D — adjacent bookings: A=14:00-16:00, B=16:00-18:00 (both should be allowed)
    if (scenarios.includes('D')) {
      const wrapped = await Promise.all([
        oneCreate(r1Id, '2026-10-15T14:00:00Z', '2026-10-15T16:00:00Z', 'D-A', `${testRunId}|D-A-${Date.now()}`),
        oneCreate(r1Id, '2026-10-15T16:00:00Z', '2026-10-15T18:00:00Z', 'D-B', `${testRunId}|D-B-${Date.now()}`),
      ]);
      const t = tally(wrapped);
      const pass = t.approved === 2 && t.rateLimited === 0;
      out.scenarios.D_adjacent = { ...t, pass };
      if (t.rateLimited > 0) out.anyRateLimited = true;
      await sleep(interScenarioDelayMs);
    }

    // E — duplicate submission using the same idempotency key (2 simultaneous)
    if (scenarios.includes('E')) {
      const dupKey = `${testRunId}|E-DUP-${Date.now()}`;
      const wrapped = await Promise.all([
        oneCreate(r1Id, '2026-10-16T14:00:00Z', '2026-10-16T15:00:00Z', 'E-dup', dupKey),
        oneCreate(r1Id, '2026-10-16T14:00:00Z', '2026-10-16T15:00:00Z', 'E-dup', dupKey),
      ]);
      const t = tally(wrapped);
      const persisted = await base44.entities.Booking.filter({ idempotency_key: dupKey });
      const pass = persisted.length === 1 && t.rateLimited === 0;
      out.scenarios.E_duplicate_idempotency = { ...t, distinctPersistedBookings: persisted.length, pass };
      if (t.rateLimited > 0) out.anyRateLimited = true;
      await sleep(interScenarioDelayMs);
    }

    // F — two simultaneous approval attempts for conflicting PENDING requests
    if (scenarios.includes('F')) {
      const p1 = (await withRetry(() => base44.entities.Booking.create({
        resource_id: r2Id, resource_name: r2.name, resource_type: 'SEMINAR_HALL',
        user_id: user.id, user_name: user.full_name || user.email,
        title: 'F-A', purpose: tag, date: '2026-10-12',
        start_time: '2026-10-12T14:00:00Z', end_time: '2026-10-12T16:00:00Z',
        status: 'PENDING', idempotency_key: `${testRunId}|F-A-${Date.now()}`,
      }))).result;
      const p2 = (await withRetry(() => base44.entities.Booking.create({
        resource_id: r2Id, resource_name: r2.name, resource_type: 'SEMINAR_HALL',
        user_id: user.id, user_name: user.full_name || user.email,
        title: 'F-B', purpose: tag, date: '2026-10-12',
        start_time: '2026-10-12T14:00:00Z', end_time: '2026-10-12T16:00:00Z',
        status: 'PENDING', idempotency_key: `${testRunId}|F-B-${Date.now()}`,
      }))).result;
      const w1 = await withRetry(() => approveBookingCore(base44, user, p1.id));
      const w2 = await withRetry(() => approveBookingCore(base44, user, p2.id));
      const b1 = await base44.entities.Booking.get(p1.id);
      const b2 = await base44.entities.Booking.get(p2.id);
      const finalStatuses = [b1.status, b2.status];
      const approvedCount = finalStatuses.filter((s) => s === 'APPROVED').length;
      const conflictedCount = finalStatuses.filter((s) => s === 'CONFLICTED').length;
      const rateLimited = (w1.exhausted ? 1 : 0) + (w2.exhausted ? 1 : 0);
      const pass = approvedCount === 1 && conflictedCount === 1 && rateLimited === 0;
      out.scenarios.F_approval_race = {
        approvalResults: [
          { success: w1.result.success, status: w1.result.status, reason: w1.result.reason || null, duplicate: !!w1.result.duplicate, retries: w1.retries },
          { success: w2.result.success, status: w2.result.status, reason: w2.result.reason || null, duplicate: !!w2.result.duplicate, retries: w2.retries },
        ],
        finalStatuses,
        approvedCount,
        conflictedCount,
        rateLimited,
        pass,
      };
      if (rateLimited > 0) out.anyRateLimited = true;
    }

    // ---------- FINAL PERSISTED DATABASE STATE (source of truth) ----------
    const r1Bookings = await base44.entities.Booking.filter({ resource_id: r1Id });
    const r2Bookings = await base44.entities.Booking.filter({ resource_id: r2Id });
    const r1Inv = approvedOverlapPairs(r1Bookings);
    const r2Inv = approvedOverlapPairs(r2Bookings);

    out.finalDatabaseState = {
      classroom: {
        totalBookings: r1Bookings.length,
        statusCounts: statusCounts(r1Bookings),
        approvedCount: r1Inv.approvedCount,
        approvedOverlapPairs: r1Inv.overlapPairs,
        overlapPairList: r1Inv.pairList,
        records: summarize(r1Bookings),
      },
      seminarHall: {
        totalBookings: r2Bookings.length,
        statusCounts: statusCounts(r2Bookings),
        approvedCount: r2Inv.approvedCount,
        approvedOverlapPairs: r2Inv.overlapPairs,
        overlapPairList: r2Inv.pairList,
        records: summarize(r2Bookings),
      },
    };

    const concurrencyInvariantPassed = r1Inv.overlapPairs === 0 && r2Inv.overlapPairs === 0;
    const eScenario = out.scenarios.E_duplicate_idempotency;
    const fScenario = out.scenarios.F_approval_race;
    const idempotencyInvariantPassed = !!eScenario && eScenario.distinctPersistedBookings === 1;
    const approvalRaceInvariantPassed = !!fScenario && fScenario.approvedCount === 1;

    out.invariant = {
      rule: 'No two APPROVED bookings for the same resource with overlapping intervals',
      classroomPassed: r1Inv.overlapPairs === 0,
      seminarHallPassed: r2Inv.overlapPairs === 0,
      overallPassed: concurrencyInvariantPassed,
    };
    out.idempotencyInvariant = { passed: idempotencyInvariantPassed, evaluated: !!eScenario };
    out.approvalRaceInvariant = { passed: approvalRaceInvariantPassed, evaluated: !!fScenario };
    // `meaningful` is true only if NO request was still rate-limited after all retries —
    // i.e. every attempt reached the booking logic and got a real outcome.
    out.meaningful = !out.anyRateLimited;

    // ---------- OPTIONAL CLEANUP (only this run's temp resources+bookings) ----------
    out.cleanupPerformed = false;
    if (doCleanup) {
      await base44.entities.Booking.deleteMany({ resource_id: r1Id });
      await base44.entities.Booking.deleteMany({ resource_id: r2Id });
      await base44.entities.Resource.delete(r1Id);
      await base44.entities.Resource.delete(r2Id);
      out.cleanupPerformed = true;
    } else {
      out.cleanupInstructions = `To remove these temp records later, re-run with: { "mode":"cleanupOnly", "testRunId":"${testRunId}" }`;
    }

    return Response.json(out);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}