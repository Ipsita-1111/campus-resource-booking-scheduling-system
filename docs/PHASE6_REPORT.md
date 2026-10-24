# Phase 6 Report — Timetable Integration & Unified Conflict Management

## Objective
Integrate academic timetable events as a **primary, first-class source of resource occupancy** in the central availability engine, so that scheduled classes conflict with booking requests on exactly the same terms as existing bookings, administrative blocks, operating-hours, and capacity limits. Provide an admin/faculty management interface, surface real-time availability in Find a Space and Resource Detail, and validate the whole pipeline with a dedicated backend test harness.

## Design Principle
A single authoritative engine — `base44/shared/availability.ts` (built in Phase 3) — already aggregates bookings, timetable events, administrative blocks, operating hours, capacity, and lab-supervisor commitments. Phase 6 **does not re-implement availability**; it adds the *write path* for timetable occupancy (authorized, validated, audited) and the *UI surfaces* that consume the same engine the booking flow uses. This keeps the conflict model unified: there is one place that decides whether a slot is free, and every consumer (booking creation, approval, Find a Space, Resource Detail) reads from it.

## What Was Built

### Backend
| File | Purpose |
|------|---------|
| `base44/shared/timetableCore.ts` | Authorization (faculty/admin only — students blocked), validation (end>start, resource exists, operating hours, no overlapping active classes), create/update/cancel logic, audit emission. |
| `base44/functions/createTimetableEvent/entry.ts` | HTTP endpoint → `createTimetableEventCore`. 403 for students, 400 for validation errors. |
| `base44/functions/updateTimetableEvent/entry.ts` | HTTP endpoint → `updateTimetableEventCore`. |
| `base44/functions/cancelTimetableEvent/entry.ts` | HTTP endpoint → `cancelTimetableEventCore` (soft-delete → `CANCELLED`). |
| `base44/functions/runTimetableConflictTest/entry.ts` | 10-test harness (T1–T10) with cleanup mode. |
| `base44/shared/testHarness.ts` | Shared `sleep` / `mkStudent` / `mkFaculty` / `makeRecorder` extracted from the Phase 4 & 5 harnesses to remove duplication. |

**Validation rules enforced server-side:**
- `end_time > start_time`
- Resource must exist
- Class time within resource operating hours (when defined)
- No overlap with another `ACTIVE` timetable event on the same resource (weekly↔weekly by `day_of_week`, one-time↔one-time by `specific_date`, weekly↔one-time by matching weekday) — adjacent slots allowed (half-open intervals)

**Authorization:** `checkTimetableAuthorization` rejects any user whose campus role is `STUDENT`. Faculty and administrators may create, update, and cancel classes.

### Frontend
| File | Purpose |
|------|---------|
| `src/pages/TimetableManagement.jsx` | Admin/faculty CRUD page: searchable/filterable table of all classes, add/edit dialog, cancel action. Students see a restricted-access notice. |
| `src/components/TimetableEventForm.jsx` | Reusable create/edit dialog (weekly + one-time recurrence, day/date, time, course, faculty, semester). Calls `createTimetableEvent` / `updateTimetableEvent`. |
| `src/components/AvailabilityChecker.jsx` | Reusable single-resource checker card calling `checkAvailability` — embedded on Resource Detail. |
| `src/pages/FindSpace.jsx` *(modified)* | Date/time inputs + “Check availability” runs the engine for every filtered resource in parallel; each card shows Available / Unavailable with the conflict reason. |
| `src/pages/ResourceDetail.jsx` *(modified)* | Embedded `AvailabilityChecker` so users can test a specific slot against the same engine; existing weekly timetable retained. |
| `src/components/AppShell.jsx` *(modified)* | “Timetable” nav item for faculty/administrators. |
| `src/App.jsx` *(modified)* | `/timetable` route under `ProtectedRoute` + `AppShell`. |

## Conflict Semantics (Policy B retained)
Pending booking requests do **not** count as occupancy. When a booking is *approved*, the engine re-checks against all occupancy sources (including timetable). If a timetable event now overlaps, the approval resolves the booking to `CONFLICTED` and the pending request is displaced — exactly as Phase 5 specified for booking-vs-booking conflicts. This keeps timetable and booking conflicts symmetric.

## Test Harness — `runTimetableConflictTest` (T1–T10)
All tests use isolated temp resources tagged with a unique `testRunId` and local datetimes (consistent with the engine's `getDay()`). Each test is self-contained so the suite can be run in any subset.

| # | Scenario | Result |
|---|----------|--------|
| T1 | Timetable event blocks an overlapping booking request | ✅ `CONFLICTED`, conflictType `TIMETABLE` |
| T2 | Exact overlap blocks booking | ✅ `CONFLICTED` |
| T3 | Partial overlap blocks booking (both directions) | ✅ both `CONFLICTED` |
| T4 | Adjacent booking is allowed (both directions) | ✅ both `PENDING` (success) |
| T5 | Timetable conflict remains blocked during approval | ✅ approval → `CONFLICTED`, final status `CONFLICTED` |
| T6 | Find a Space uses timetable occupancy (engine returns `TIMETABLE`) | ✅ roomB unavailable/TIMETABLE, roomA available |
| T7 | Resource Detail reflects timetable occupancy (data retrievable) | ✅ active event found with correct fields |
| T8 | Invalid timetable event rejected (end<start, missing resource, outside hours) | ✅ all three rejected with correct reasons |
| T9 | Unauthorized (student) timetable modification rejected | ✅ `notAuthorized` |
| T10 | Recurring weekly event produces expected occupied intervals | ✅ Tuesday & next-Tuesday conflict, Wednesday available |

**Run results:** 10/10 passed (verified in two batches: T1–T5, then T6–T10). Temp data cleaned via `cleanupOnly` mode after each run.

## Files Touched
- **New:** `base44/shared/timetableCore.ts`, `base44/shared/testHarness.ts`, `base44/functions/{createTimetableEvent,updateTimetableEvent,cancelTimetableEvent,runTimetableConflictTest}/entry.ts`, `src/pages/TimetableManagement.jsx`, `src/components/TimetableEventForm.jsx`, `src/components/AvailabilityChecker.jsx`, `docs/PHASE6_REPORT.md`
- **Modified:** `base44/functions/runApprovalWorkflowTest/entry.ts` (uses shared testHarness), `src/pages/FindSpace.jsx`, `src/pages/ResourceDetail.jsx`, `src/components/AppShell.jsx`, `src/App.jsx`

## Status
Phase 6 complete and verified. The availability engine now treats timetable events as a peer occupancy source to bookings, with a single unified conflict model, authorized admin management, and real-time availability surfaced across Find a Space and Resource Detail.