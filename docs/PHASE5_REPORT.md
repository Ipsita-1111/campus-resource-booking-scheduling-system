# Phase 5 — Approval Workflow & Request Lifecycle: Implementation & Verification Report

## A. Approval workflow

Phase 5 turns the booking system from a CRUD app into a role-aware approval system. The flow reuses the Phase 4 protected write path (`bookingCore.ts` + `bookingLock.ts`) and the Phase 3 availability engine; it adds lifecycle, authorization, audit, and notifications on top.

1. **Request submission** (`createBookingCore`): the caller's campus role is normalized; the applicable `ApprovalRule` is resolved by `(resource_type, user_role)`. If the rule auto-approves, the booking is created `APPROVED` inside the per-resource lock and competing `PENDING` requests are displaced. Otherwise it is created `PENDING`, the requester is notified (`BOOKING_SUBMITTED`), and the supervising faculty (if any) is notified (`APPROVAL_REQUIRED`). The `required_approver_role` from the rule is stored on the booking so the approver can be authorized later without re-deriving the requester's role.
2. **Approval** (`approveBookingCore`): authorization is checked; the per-resource lock is acquired; availability is re-checked authoritatively (ignoring pending occupancy); the booking is set `APPROVED` and competing `PENDING` requests are set `CONFLICTED`, audited, and notified.
3. **Rejection** (`rejectBookingCore`): authorization checked; `PENDING → REJECTED` under lock; audited; requester notified.
4. **Cancellation** (`cancelBookingCore`): the requester or an admin may cancel a `PENDING`/`APPROVED` request; `PENDING/APPROVED → CANCELLED` under lock; audited; requester notified.
5. **Admin override**: an administrator may approve, reject, or cancel any request, including their own. Every admin override is recorded in the audit log with `metadata.override = true`.

All four actions are exposed as HTTP endpoints (`createBooking`, `approveBooking`, `rejectBooking`, `cancelBooking`) that delegate to the shared core. The test harness calls the core functions directly with the same code path.

## B. Role permissions (enforced in the backend)

| Action | STUDENT | FACULTY | ADMINISTRATOR |
|---|---|---|---|
| Submit request | Yes | Yes | Yes |
| Auto-approve (per rule) | Per rule | Per rule | Per rule |
| Approve / Reject | **No** | Only if `required_approver_role === FACULTY` AND in scope, and not own request | Yes (override, incl. own) |
| Cancel own | Yes (PENDING/APPROVED) | Yes (PENDING/APPROVED) | Yes (any) |
| Cancel others | No | No | Yes (override) |

**Faculty scope** (in `checkApproverAuthorization`): a faculty member is authorized to approve a `PENDING` booking only when `booking.required_approver_role === 'FACULTY'` and either (a) they are the supervising faculty of the resource (`resource.supervising_faculty_id === user.id`), or (b) no supervising faculty is assigned (any faculty). A faculty member may never approve their own request. Students are never authorized to approve or reject. Self-approval is blocked for everyone except the administrator (override).

Authorization is enforced inside the core functions (server-side), not by hiding UI buttons. The UI additionally hides actions for usability, but a direct call to `approveBooking`/`rejectBooking` from a student or out-of-scope faculty returns `403` with a clear `reason`.

## C. Request lifecycle (state transitions)

```
                 ┌──> APPROVED ──> COMPLETED
                 │      └──> CANCELLED
PENDING ─────────┼──> REJECTED
                 ├──> CONFLICTED
                 ├──> CANCELLED
                 └──> EXPIRED
```

Valid transitions (enforced by `canTransition` / `assertCanTransition` in `bookingLifecycle.ts`):
- `PENDING → {APPROVED, REJECTED, CONFLICTED, CANCELLED, EXPIRED}`
- `APPROVED → {CANCELLED, COMPLETED}`
- `REJECTED, CONFLICTED, CANCELLED, EXPIRED, COMPLETED →` (terminal — no transitions)

`APPROVED → PENDING` is **not** allowed. Any invalid transition attempt returns a non-success result (`reason: "Booking is X, not pending"` or `"A X request cannot be cancelled"`), verified by TEST 10.

## D. Pending-request policy

**Policy B — Compete without holding the slot.** A `PENDING` request does **not** provisionally reserve the slot. Multiple `PENDING` requests for the same resource and overlapping interval may coexist. This is implemented by passing `bookingContext.treatPendingAsOccupancy: false` to the availability engine during request creation (and during approval). The availability engine still blocks against `APPROVED` bookings, timetable events, administrative blocks, operating hours, and capacity — only `PENDING`-vs-`PENDING` is allowed to compete.

Rationale: this matches the realistic campus scenario where several students independently request the same seminar hall for the same slot; each is a legitimate candidate until an approver resolves one. Approval of one request displaces the competing `PENDING` requests to `CONFLICTED` (via `conflictOverlappingPending`), so the system never produces two overlapping `APPROVED` bookings. The trade-off is that a `PENDING` request does not block others from also becoming `PENDING`; this is acceptable because approval is the single point that grants the slot.

## E. Approval-race handling

The approval action reuses the Phase 4 per-resource CAS mutex. When two approvers approve two conflicting `PENDING` requests at the same time:
1. Each call acquires the per-resource lock (atomic conditional update on the resource document); only one proceeds at a time.
2. The winner re-checks availability under the lock (ignoring pending occupancy), sets its booking `APPROVED`, and displaces the overlapping `PENDING` (the loser's booking) to `CONFLICTED`.
3. The loser then acquires the lock, re-checks availability, and sees its booking is already `CONFLICTED` (or sees the new `APPROVED` as a conflict) — it never becomes `APPROVED`.

The availability shown on the approval page is informational only; the backend re-checks independently under the lock. Verified by TEST 7 (1 `APPROVED` + 1 `CONFLICTED`).

## F. Backend authorization

Implemented in `base44/shared/bookingLifecycle.ts` (`checkApproverAuthorization`) and applied inside `approveBookingCore` / `rejectBookingCore` / `cancelBookingCore`. Returns `{ authorized, reason, notAuthorized }`; the HTTP endpoints map `notAuthorized` to HTTP `403`. Examples:
- Student calls `approveBooking` → `403`, reason "Students are not authorized to approve requests" (TEST 4).
- Out-of-scope faculty calls `approveBooking` on a lab requiring its supervising faculty → `403`, reason "You are not the supervising faculty for this resource" (TEST 3).
- A requester approving their own request (non-admin) → `403`, reason "You cannot approve your own request".

## G. Notifications

Integrated with the existing `Notification` entity (no new architecture). Events generated by the core functions:
- `BOOKING_SUBMITTED` — to the requester on creation.
- `APPROVAL_REQUIRED` — to the supervising faculty when a pending request is created on their resource.
- `BOOKING_APPROVED` — to the requester on approval (TEST 9).
- `BOOKING_REJECTED` — to the requester on rejection.
- `BOOKING_CONFLICTED` — to the requester when their pending request is displaced by an approval, or when their own approval fails availability.
- `BOOKING_CANCELLED` — to the requester on cancellation.

Notifications are best-effort (a failure to write a notification never fails the workflow).

## H. Audit trail

Every decision writes an `AuditLog` record via `recordAudit` with: `user_id`, `user_name`, `action`, `booking_id`, `resource_id`, `previous_status`, `new_status`, `reason`, and `metadata` (including `override: true` for admin overrides and `conflicted_by` for displaced requests). Actions used: `BOOKING_CREATED`, `BOOKING_APPROVED`, `BOOKING_REJECTED`, `BOOKING_CONFLICTED`, `BOOKING_CANCELLED`. Audit records are append-only creates; they are never overwritten. TEST 8 verifies a `BOOKING_REJECTED` audit record exists after rejection. The request detail page renders this history as a timeline.

## I. Test results

All 10 tests pass (`runApprovalWorkflowTest`, `testRunId = p5main-1789916000000`, run in small batches to respect the platform rate limit):

| Test | Scenario | Result |
|---|---|---|
| 1 | Student submits request requiring approval | `PENDING` ✅ |
| 2 | Faculty request satisfying auto-approval rule | `APPROVED` (auto) ✅ |
| 3 | Out-of-scope faculty attempts approval | `403` "You are not the supervising faculty for this resource" ✅ |
| 4 | Student attempts to approve own request | `403` "Students are not authorized to approve requests" ✅ |
| 5 | Approver approves an available request | `APPROVED` ✅ |
| 6 | Approver approves a request that became conflicting | `CONFLICTED` ✅ |
| 7 | Two approvers simultaneously approve conflicting requests | 1 `APPROVED` + 1 `CONFLICTED` ✅ |
| 8 | Rejected request appears in audit trail | `REJECTED` + 1 `BOOKING_REJECTED` audit record ✅ |
| 9 | Approved request generates a notification | 1 `BOOKING_APPROVED` notification ✅ |
| 10 | Invalid status transitions rejected | approve-again, reject-approved, cancel-twice all rejected ✅ |

Tests were run in small batches (1–5, then 6, 7, 8, 9, 10 individually) because the platform throttles bursts of DB operations; TEST 7's two approvals were fired together via `Promise.all` to genuinely race for the lock. Authorization was exercised with **synthetic user objects** (different `campus_role` values) passed into the core functions — see Limitations.

## J. Limitations

1. **Synthetic users, not real multi-user sessions.** Base44 cannot create `User` records, so the 10 tests use synthetic user objects (`{ id, campus_role, full_name }`) passed directly into the core functions. This exercises the authorization *logic* and the booking's `user_id` field, but DB operations run under the single authenticated admin caller. Real multi-user session-level authorization (distinct logged-in students/faculty) is not tested end-to-end.
2. **No row-level security.** The approval queue and request lists are fetched client-side; access control on *actions* is backend-enforced, but a determined client could read bookings they should not see. RLS was not in scope for this phase.
3. **Admin self-approval is permitted as an override.** A non-admin may never approve their own request; an administrator may (audited with `override: true`). This keeps the Phase 4 concurrency test harness (admin-created test bookings) working and reflects administrative override authority.
4. **Policy B trade-off.** Competing `PENDING` requests do not block each other at creation, so many `PENDING` requests can accumulate for a popular slot. They are resolved (one approved, rest conflicted) only when an approver acts. There is no automatic expiry of stale `PENDING` requests in this phase (`EXPIRED` is a valid status but no scheduled task sets it).
5. **Rate limit.** Tests were batched to avoid platform DB-operation throttling; TEST 7 is the only true concurrent race (2-way), consistent with Phase 4's approach.
6. **No "ADMIN_OVERRIDE" audit enum value.** The `AuditLog.action` enum has no dedicated override value; admin overrides are recorded using the standard action (`BOOKING_APPROVED`/`REJECTED`/`CANCELLED`) with `metadata.override = true`.
7. **Test data not cleaned up.** Temp resources, rules, bookings, notifications, and audit records for `p5main-1789916000000` remain. Remove with `runApprovalWorkflowTest` `{ "mode":"cleanupOnly", "testRunId":"p5main-1789916000000" }`.