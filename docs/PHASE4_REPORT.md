# Phase 4 — Booking Creation & Approval: Concurrency-Safe Implementation & Verification Report

## 1. What Phase 4 implements

Phase 4 adds the transactional booking layer on top of the Phase 3 availability engine. The deliverables are:

- **`base44/functions/createBooking/entry.ts`** — authenticated HTTP endpoint that validates input (`resourceId`, `startDateTime`, `endDateTime`) and delegates to the shared core. Returns `200` on success, `409` on a business conflict, `503` on lock contention (`RESOURCE_LOCK_BUSY`), `400` on other errors.
- **`base44/functions/approveBooking/entry.ts`** — authenticated HTTP endpoint that validates `bookingId` and delegates approval to the shared core. Same status-code contract.
- **`base44/shared/bookingCore.ts`** — the reusable, lock-protected booking and approval logic. Both HTTP handlers and the test harness call the same functions, so the protected write path is identical everywhere. It:
  - normalizes the caller's campus role,
  - resolves the approval workflow from active `ApprovalRule` records (auto-approve vs. requires-approval vs. approver role),
  - enforces **idempotency** (returns the existing booking if the caller already created one with the same `idempotency_key`),
  - performs an **authoritative availability re-check inside the per-resource lock** (never a stale pre-lock check),
  - inserts the booking as `APPROVED` (auto-approve) or `PENDING`, and
  - on approval, re-checks availability under lock and **conflicts every overlapping `PENDING` request** for the same slot.
- **`base44/shared/bookingLock.ts`** — the per-resource mutex (see §2).
- **Idempotency protection** — keyed on `(user_id, idempotency_key)`; a repeated submission returns the original record instead of creating a second one.
- **Atomic re-check before commit** — the availability check and the booking insert/update both execute inside the held lock, so the state the engine validated is the state the write is applied to.

## 2. Concurrency mechanism (and its limitation)

`bookingLock.ts` implements an **application-level per-resource mutex backed by an atomic single-document conditional update (compare-and-swap) on the existing `Resource` record.**

- The lock is stored **on the existing resource row** (`lock_held_by`, `lock_held_until`), never on the not-yet-existing booking row.
- Acquisition is one atomic conditional update: `Resource.updateMany({ id, $or: [{ lock_held_by: null }, { lock_held_by: '' }, { lock_held_until: { $lt: now } }] }, { $set: { lock_held_by: lockId, lock_held_until: exp } })`. Two concurrent acquisitions for the same resource are serialized by the database engine at the document level — only one conditional update matches. The winner runs the availability re-check + insert/update inside the critical section; the loser retries with backoff until the lock is released, then re-checks and sees the winner's booking as a conflict.
- Release is a conditional update that clears the lock only if the caller still owns it (so an expired-then-reacquired lock is not clobbered). A TTL (`LOCK_TTL_MS = 30000`) guarantees a crashed holder cannot hold the lock forever.

**Limitation — stated explicitly:** This is an **application-level distributed/CAS-style lock**, not a relational constraint. It is **not** `SELECT ... FOR UPDATE`, not a PostgreSQL `EXCLUDE USING GIST` exclusion constraint, not a multi-document transaction, and not `SERIALIZABLE` isolation. Base44's database is a document store and does not expose those primitives to the app builder; the strongest atomic primitive it exposes is a single-document conditional update, which is what this lock uses. The consequence is that correctness depends on every write path going through `withResourceLock`; a path that bypasses it (e.g., a raw `Booking.create` outside `bookingCore`) would not be serialized. All production booking/approval writes in this system go through `bookingCore.ts`.

## 3. Test verification (clean run)

**testRunId = `rlsafeA-1789914400000`** — two dedicated temporary resources (classroom `6aafee1bd102b857d34c0d9a`, seminar hall `6aafee1b180b496afc18d753`, building `TEST-ISOLATION-BLDG`). No existing/demo resources were touched.

| Scenario | Attempted | Reached logic | APPROVED | CONFLICTED | Duplicate | Rate-limited | Pass |
|---|---|---|---|---|---|---|---|
| **A** — 20 overlapping attempts | 20 | 20 | 1 | 19 | 0 | 0 | ✅ |
| **B** — 2 simultaneous, same resource & time | 2 | 2 | 1 | 1 | 0 | 0 | ✅ |
| **C** — 2 simultaneous, partial overlap | 2 | 2 | 1 | 1 | 0 | 0 | ✅ |
| **D** — 2 adjacent intervals | 2 | 2 | 2 | 0 | 0 | 0 | ✅ |
| **E** — 2 concurrent, same idempotency key | 2 | 2 | 1 | 0 | 1 | 0 | ✅ |
| **F** — 2 simultaneous approval attempts | 2 | 2 | 1 | 1 | 0 | 0 | ✅ |

- **Scenario A:** 20 attempts, all 20 reached the booking logic, exactly 1 `APPROVED` and 19 `CONFLICTED`, 0 rate-limited.
- **Scenario B:** 2 attempts, 1 `APPROVED`, 1 `CONFLICTED`.
- **Scenario C:** 2 attempts, 1 `APPROVED`, 1 `CONFLICTED` (partial overlap correctly rejected).
- **Scenario D:** 2 attempts, 2 `APPROVED` — adjacent intervals (14:00–16:00 and 16:00–18:00) correctly allowed; the half-open overlap rule treats touching boundaries as non-overlapping.
- **Scenario E:** 2 concurrent submissions with the same idempotency key → exactly **1 persisted booking** and **1 duplicate response** (the second call returned the first's record).
- **Scenario F:** 2 simultaneous approval attempts for two `PENDING` bookings on the same slot → 1 `APPROVED`, 1 `CONFLICTED` (the loser was already conflicted by the winner's approval sweep, so its approval attempt saw it as `CONFLICTED, not pending`).

## 4. Final database verification (source of truth)

Read directly from the persisted database after the clean run:

- **Classroom** — 6 bookings, all `APPROVED`, **0 overlapping APPROVED pairs** (A-1 10-12, B-B 10-13, C-A 10-14, D-A 10-15 14-16, D-B 10-15 16-18 adjacent, E-dup 10-16).
- **Seminar hall** — 2 bookings (F-A `APPROVED`, F-B `CONFLICTED`), **0 overlapping APPROVED pairs**.

Invariants:
- **Concurrency invariant** (no two `APPROVED` bookings for the same resource with overlapping intervals): **passed** — 0 overlap pairs on both resources.
- **Idempotency invariant** (duplicate key → exactly 1 persisted booking): **passed** — `distinctPersistedBookings = 1`.
- **Approval-race invariant** (at most 1 `APPROVED` for a conflicting slot): **passed** — `approvedCount = 1`, `conflictedCount = 1`.
- **No rate-limited requests** occurred in the clean run (`anyRateLimited = false`, `meaningful = true`).
- **All counted attempts reached the booking/approval logic** and got a real outcome.

## 5. Precision on Scenario A (how the 20 attempts were executed)

The 20 clean attempts were **not** fired simultaneously in one `Promise.all`. The platform enforces a DB-operation rate limit, and a single unrestricted burst of 20 booking attempts (each running the full availability engine ≈ 8 DB ops) is rejected with "Rate limit exceeded" *before* the booking logic runs — which would teach nothing about the mutex.

The 20 attempts were therefore executed as **multiple small concurrent batches across separate function invocations** (4 invocations of 5 attempts each), with pauses between invocations to reset the rate-limit window. **Within each batch the requests were launched together via `Promise.all`**, so they genuinely overlapped in flight and raced for the per-resource lock; between batches the overall request rate was kept under the limit. Each call was individually retried on rate-limit as a safety net, but in the clean run no retry was needed (`retriesUsed = 0`, `rateLimited = 0`).

This is a genuine concurrency test of the mutex within each batch, not a sequential re-evaluation: the requests in a batch are in flight at the same time and contend for the same atomic conditional update on the resource row.

## 6. Platform rate-limit limitation

The platform throttles bursts of concurrent DB operations. This limits how many booking attempts can be launched in a single function invocation and forced the batched, multi-invocation strategy for Scenario A. The final clean run **avoided** the rate limit entirely (every attempt reached the booking logic, 0 rate-limited) while **retaining genuine concurrent overlap within each small batch**. The concurrency guarantee is therefore exercised and verified, not bypassed.

## 7. Supplementary evidence (not the primary test)

An earlier **manual cross-run** (`testRunId = cross-1789796693794-8ekhu`) issued separate `createBooking`/`approveBooking` HTTP calls with natural latency between them (not the harness). It created one temp classroom and produced 8 persisted bookings (7 `APPROVED`, 1 `CONFLICTED`) with 0 overlap pairs, `invariantPassed = true`, covering B, C, D, E, F at 2-way concurrency. This is consistent with the clean harness run and is included only as supplementary evidence; the primary verification is the clean `rlsafeA-1789914400000` run above.

## 8. Caller-identity limitation (stated accurately)

The harness used **concurrent requests from the single authenticated caller**, not 20 different users. Base44 does not allow creating `User` records, so all requests were issued by the one signed-in administrator. The concurrency invariant being tested is **resource-based** (at most one `APPROVED` booking per resource per overlapping interval) and is independent of user identity, so single-caller concurrency still exercises the protected write path. The limitation is that this does not test per-user authorization under concurrent multi-user load — only the resource mutex.

## 9. Test data

Test data has **not** been cleaned up. The temp resources and bookings for `rlsafeA-1789914400000` (and earlier isolated runs) remain in the database for inspection. To remove them later: `runConcurrencyTest` with `{ "mode": "cleanupOnly", "testRunId": "rlsafeA-1789914400000" }`.

## 10. Phase 4 status

**Implementation and verification satisfy the concurrency requirement.** The per-resource CAS mutex serializes the check-then-write critical section so that, under concurrent attempts for the same resource and overlapping interval, exactly one booking becomes `APPROVED` and the rest are `CONFLICTED`; adjacent intervals are both allowed; duplicate idempotency submissions produce exactly one record; and a simultaneous approval race yields exactly one `APPROVED`. All three invariants hold in the persisted database state, and the clean run had zero rate-limited requests with every attempt reaching the booking logic.

**Remaining limitations:**
1. The lock is an **application-level CAS lock on the resource document**, not a relational range-exclusion constraint (`EXCLUDE USING GIST`) or a multi-document transaction. Correctness depends on all booking/approval writes going through `bookingCore.ts`.
2. Scenario A was run as **small concurrent batches across multiple invocations**, not a single 20-way `Promise.all`, because of the platform DB-operation rate limit. Genuine concurrency was preserved within each batch.
3. The harness used a **single authenticated caller**, not multiple distinct users, so per-user authorization under concurrent multi-user load is not exercised here.
4. Test data is **still present** (not yet cleaned up).