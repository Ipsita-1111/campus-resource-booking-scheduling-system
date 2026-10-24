# Campus Resource Booking & Scheduling System — Final Project Report

## Overview

A professional, conflict-aware campus resource booking and scheduling system built on the Base44 platform. The system serves three user roles — students, faculty, and administrators — with role-based access control, centralized availability checking, approval workflows, recurring bookings, and real-time utilization analytics.

---

## Architecture

### Backend (Base44 Native Stack)

**Entities (10):**
| Entity | Purpose |
|--------|---------|
| Resource | Campus spaces (classrooms, labs, seminar halls) with constraints |
| Booking | Individual booking requests with full lifecycle status |
| TimetableEvent | Academic schedule events (weekly recurring or one-time) |
| ApprovalRule | Role × resource-type approval routing configuration |
| FacultyCertification | Faculty qualifications for lab supervision |
| RecurringSeries | Weekly semester booking series with per-occurrence conflict tracking |
| ResourceBlock | Administrative blocks (maintenance, holidays) |
| Notification | User-facing in-app notifications |
| AuditLog | System-wide audit trail of all state changes |
| Equipment | Inventory of equipment available in resources |

**Shared Logic (`base44/shared/`):**
| Module | Responsibility |
|--------|---------------|
| `availability.ts` | Centralized availability engine — checks bookings, timetable, blocks, hours, capacity, lab constraints |
| `bookingCore.ts` | Booking creation with atomic resource-level locking and conflict resolution |
| `bookingLifecycle.ts` | Status transitions, approver authorization, audit logging, notifications |
| `bookingLock.ts` | Per-resource mutex via conditional document writes |
| `timetableCore.ts` | Academic scheduling source of truth, integrated with availability engine |
| `recurringCore.ts` | Weekly semester series with per-occurrence availability checks |
| `testHarness.ts` | Shared utilities for backend stress and correctness testing |

**Backend Functions (13):**
| Function | Endpoint |
|----------|----------|
| `createBooking` | One-time booking creation with conflict detection |
| `createRecurringBooking` | Weekly semester series creation |
| `checkAvailability` | Public availability query endpoint |
| `approveBooking` | Approve a pending booking (with authorization) |
| `rejectBooking` | Reject a pending booking with reason |
| `cancelBooking` | Cancel an existing booking (owner or admin) |
| `createTimetableEvent` | Add academic schedule event |
| `updateTimetableEvent` | Modify existing timetable event |
| `cancelTimetableEvent` | Cancel a timetable event |
| `getUtilization` | Real-time utilization analytics for administrators |
| `runConcurrencyTest` | Concurrency stress test harness |
| `runApprovalWorkflowTest` | Approval workflow correctness test |
| `runTimetableConflictTest` | Timetable conflict detection test |
| `runResourceConstraintsTest` | Resource constraint validation test (13 cases) |

### Frontend (React + Tailwind + shadcn/ui)

**Pages:**
| Page | Route | Access |
|------|-------|--------|
| Landing | `/` | Public |
| Login / Register / Forgot / Reset | `/login`, `/register`, `/forgot-password`, `/reset-password` | Public |
| Dashboard | `/dashboard` | Authenticated |
| Find Space | `/resources` | Authenticated |
| Resource Detail | `/resources/:id` | Authenticated |
| My Requests | `/my-requests` | Authenticated |
| Approvals | `/approvals` | Faculty + Admin |
| Request Detail | `/approvals/:id` | Faculty + Admin |
| Timetable Management | `/timetable` | Faculty + Admin |
| Utilization | `/utilization` | Administrator |

**Components:**
- `AppShell` — role-aware responsive navigation shell
- `AvailabilityChecker` — real-time availability check with attendance validation
- `BookingRequestDialog` — one-time booking form with supervisor selection
- `RecurringBookingDialog` — weekly semester series form
- `TimetableEventForm` — academic event creation/editing

---

## Key Features

### 1. Centralized Availability Engine
All availability checks (search, booking creation, recurring series) route through a single authoritative engine that evaluates:
- Existing approved bookings (time-overlap detection)
- Active timetable events (weekly recurrence + one-time)
- Administrative resource blocks (maintenance, holidays)
- Operating hours (open_time / close_time)
- Capacity constraints (expected attendance vs. resource capacity)
- Laboratory-specific constraints (supervising faculty, certifications)

### 2. Conflict-Aware Booking with Atomic Locking
Booking creation uses a per-resource mutex via conditional document writes on the Resource entity, ensuring serialized access under concurrent requests. Policy B is applied: pending requests are displaced to CONFLICTED status when another request is approved for the same slot.

### 3. Role-Based Approval Workflow
Approval rules route requests by user role × resource type:
- **Students → Classrooms**: Faculty approval required
- **Students → Labs**: Faculty approval + supervising faculty required
- **Students → Seminar Halls**: Administrator approval required
- **Faculty → Classrooms**: Auto-approved
- **Faculty → Labs**: Administrator approval + supervisor required
- **Faculty → Seminar Halls**: Administrator approval required
- **Administrators → Any**: Auto-approved

### 4. Resource Constraints
- **Capacity validation**: Expected attendance must not exceed resource capacity
- **Lab supervision**: Labs requiring a supervising faculty member enforce selection
- **Certification requirements**: Labs can require specific certifications from the booker
- **Operating hours**: Bookings must fall within resource open/close times

### 5. Recurring Bookings
Weekly semester series with per-occurrence availability checking. Each occurrence is independently evaluated — non-conflicting dates are approved, conflicting dates are flagged. Conflict policy supports `APPROVE_NON_CONFLICTING` (default) or `REJECT_ALL_ON_CONFLICT`.

### 6. Timetable Integration
Academic schedule events serve as a primary occupancy source. Weekly recurring events block resource availability during scheduled class times, preventing booking conflicts with academic activities.

### 7. Utilization Analytics
Real-time dashboard for administrators showing:
- Total booked hours vs. available capacity hours
- Utilization percentage by resource and building
- Most/least utilized resources
- Booking status breakdown (approved, pending, conflicts, cancellations)
- Configurable time ranges (week, month, semester)

### 8. Audit Trail & Notifications
Every state change (booking created, approved, rejected, conflicted, cancelled, completed; resource blocked; timetable updated) is recorded in the audit log. Users receive in-app notifications for booking status changes and approval requirements.

---

## Design System

- **Primary color**: Indigo (`hsl(231 76% 40%)`)
- **Typography**: Plus Jakarta Sans (headings/display), Inter (body)
- **Component library**: shadcn/ui with Radix primitives
- **Responsive**: Mobile-first with adaptive sidebar navigation
- **Accessibility**: ARIA-compliant dialog, select, and form components

---

## Demo Data

The system is seeded with:
- **9 resources** across 3 buildings (Block A, B, C)
  - 3 classrooms (A-101, A-204, A-305)
  - 3 laboratories (B-110 Physics, B-205 Chemistry, B-301 Computer)
  - 3 seminar halls (C-301, C-302, C-105 Auditorium — under maintenance)
- **7 timetable events** (Mathematics, Physics, Data Structures, Physics Lab, Programming Lab, Guest Lecture, Faculty Office Hours)
- **10 approval rules** covering all role × resource-type combinations
- **3 faculty certifications** (Chemical Handling, Physics Safety, Network Security)
- **3 resource blocks** (HVAC maintenance, safety inspection, exam setup)
- **9 demo bookings** in varied states (pending, approved, rejected, cancelled, completed)
- **5 notifications** and **4 audit log entries**

---

## Testing

The system includes four backend test harnesses:
1. **Concurrency Test** — Validates atomic locking under parallel booking requests
2. **Approval Workflow Test** — Validates role-based authorization and status transitions
3. **Timetable Conflict Test** — Validates timetable event conflict detection
4. **Resource Constraints Test** — 13 test cases covering capacity, supervision, certification, and operating hours

All test harnesses have been executed and passed. Test artifacts have been cleaned from the production dataset.

---

## Conclusion

The Campus Resource Booking & Scheduling System is a complete, production-ready application with centralized availability logic, atomic booking operations, role-based approval workflows, resource constraint enforcement, recurring booking support, and real-time utilization analytics. The codebase is frozen following this report.