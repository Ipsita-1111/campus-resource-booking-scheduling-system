# Campus Resource Booking & Scheduling System

**Live Demo:** https://campus-resource-booking-schedulin-6f5fec6e.base44.app/

A full-stack web application designed to simplify the management of campus facilities by providing a centralized platform for booking classrooms, laboratories, seminar halls, and other university resources. The system combines resource availability checking, timetable integration, approval workflows, conflict detection, recurring bookings, and utilization analytics to make campus resource management more efficient and transparent.

## Table of Contents

- [Overview](#overview)
- [Problem Statement](#problem-statement)
- [Objectives](#objectives)
- [Key Features](#key-features)
- [Resource Availability and Conflict Detection](#resource-availability-and-conflict-detection)
- [Booking and Approval Workflow](#booking-and-approval-workflow)
- [Resource-Specific Constraints](#resource-specific-constraints)
- [Timetable Integration](#timetable-integration)
- [Recurring Bookings](#recurring-bookings)
- [Utilization Analytics](#utilization-analytics)
- [System Architecture](#system-architecture)
- [Database Design](#database-design)
- [Concurrency Control](#concurrency-control)
- [Technology Overview](#technology-overview)
- [Testing and Validation](#testing-and-validation)
- [Getting Started](#getting-started)
- [Future Enhancements](#future-enhancements)
- [Project Status](#project-status)

## Overview

Universities manage a wide range of shared resources, including classrooms, computer laboratories, specialized labs, seminar halls, and conference spaces. Without a centralized booking system, resource allocation can become difficult to coordinate, resulting in scheduling conflicts, inefficient utilization, and manual approval overhead.

The **Campus Resource Booking & Scheduling System** addresses these challenges through a centralized web application where users can discover resources, check availability, submit booking requests, track their requests, and manage approvals according to defined rules.

The system treats resource availability as a centralized process that considers bookings, timetable events, maintenance blocks, operating hours, capacity limits, and resource-specific requirements. This helps ensure that availability decisions are consistent across the application.

## Problem Statement

Traditional campus resource management often relies on manual requests, spreadsheets, emails, or disconnected scheduling tools. These approaches can lead to:

- Double-booking of classrooms and other facilities.
- Conflicts between academic timetables and event reservations.
- Delays in approving student requests.
- Inadequate enforcement of laboratory safety and supervision requirements.
- Limited visibility into resource usage and availability.
- Difficulty managing recurring reservations.
- Inefficient identification of underutilized campus facilities.

This project provides a centralized solution to coordinate reservations, enforce scheduling constraints, and improve visibility into campus resource usage.

## Objectives

- Centralize campus resource booking and scheduling.
- Provide consistent, real-time availability checks.
- Prevent overlapping approved bookings through concurrency-aware booking operations.
- Support role-based access and approval workflows.
- Integrate academic timetable events into resource availability.
- Enforce capacity, supervision, qualification, and certification constraints.
- Support recurring booking requests and conflict handling.
- Provide utilization analytics to assist administrative decision-making.
- Maintain audit records and notifications for important booking activities.

## Key Features

### 1. Resource Management

The system supports different categories of campus facilities, including:

- Classrooms
- Laboratories
- Seminar halls
- Conference and lecture spaces
- Other configurable campus resources

Resource records can include names, resource types, buildings, floors, capacities, and additional constraints relevant to the facility.

### 2. Resource Discovery and Availability Checking

Users can search for suitable resources and check whether a resource is available during a requested time interval.

Availability checks consider relevant scheduling information, including:

- Approved bookings.
- Pending booking requests according to the configured booking policy.
- Academic timetable events.
- Maintenance and administrative blocks.
- Resource operating hours.
- Capacity requirements.
- Resource-specific constraints.

The centralized availability engine returns structured conflict information to help explain why a resource may be unavailable.

### 3. Booking Management

Users can submit booking requests by providing details such as the resource, date, start time, end time, purpose, and expected attendance.

The system supports booking lifecycle states such as:

- `PENDING`
- `APPROVED`
- `REJECTED`
- `CONFLICTED`
- `CANCELLED`

The application can recheck availability during critical booking operations so that changes occurring after the initial availability check are considered.

### 4. Role-Based Access and Approval Workflows

The system is designed around different campus user roles:

- **Students:** Discover resources, submit requests, track booking status, and manage eligible bookings.
- **Faculty:** Manage eligible requests and approve bookings when their role and the applicable approval rules permit it.
- **Administrators:** Manage resources, timetables, approval rules, maintenance blocks, and utilization information.

Authorization checks are enforced in the relevant backend operations rather than relying solely on hiding or displaying frontend controls.

Approval decisions can trigger booking status changes, notifications, and audit records. The system also handles approval-time conflicts when multiple requests compete for the same resource and time slot.

### 5. Timetable Integration

Academic timetable events are treated as a source of resource occupancy.

The availability engine considers scheduled classes and other timetable events alongside booking records. This allows the system to identify conflicts between academic schedules and proposed reservations.

The application includes timetable management operations for creating, updating, and cancelling timetable events.

### 6. Resource-Specific Constraints

Different resources have different requirements. The system supports constraints such as:

- **Capacity validation:** Prevents requests from exceeding a resource's configured capacity.
- **Laboratory supervision:** Requires an eligible supervising faculty member for applicable laboratory bookings.
- **Supervisor availability:** Checks whether the supervising faculty member is occupied during the requested interval.
- **Faculty qualifications:** Validates required qualifications for applicable supervised activities.
- **Certification requirements:** Supports certification checks for activities requiring specific credentials.

These rules help ensure that a resource is not considered suitable merely because its room calendar is otherwise free.

### 7. Recurring Bookings

The system supports recurring booking requests for repeated scheduling needs, such as weekly sessions or regular academic activities.

Recurring booking processing evaluates individual occurrences against the availability rules and can identify conflicts affecting particular dates. This makes it possible to handle partially conflicting series instead of treating every recurring request as an indivisible reservation.

### 8. Maintenance and Administrative Blocks

Resources may be unavailable due to maintenance, inspections, safety work, or other administrative restrictions.

These blocks are included in availability checks so that users do not receive misleading results when a facility cannot be used.

### 9. Utilization Analytics

The administrative utilization dashboard provides an overview of resource usage and booking activity.

Depending on the selected filters and available records, analytics can include:

- Total resources.
- Booked hours and available hours.
- Resource utilization percentages.
- Utilization by resource type or building.
- Most and least utilized resources.
- Peak usage periods.
- Booking statuses and scheduling conflicts.
- Cancellation information.

These insights can help administrators identify demand patterns and improve campus resource allocation.

### 10. Notifications and Audit Logs

The system includes notification and audit-log functionality for relevant booking and administrative activities.

Notifications can inform users about booking outcomes and workflow updates. Audit records provide a history of important actions, supporting traceability and administrative review.

## Resource Availability and Conflict Detection

A central design principle is that availability logic should be consistent across the application.

Instead of implementing separate conflict rules on each page, booking and resource-discovery operations use a shared availability engine.

A simplified availability evaluation follows these steps:

1. Receive the requested resource, time interval, and relevant booking details.
2. Validate the requested interval and applicable resource constraints.
3. Retrieve overlapping approved bookings.
4. Check pending requests according to the configured booking policy.
5. Check academic timetable events.
6. Check maintenance and administrative blocks.
7. Validate operating hours, capacity, supervision, qualifications, and certifications where applicable.
8. Return an availability result with relevant conflict information.

For two intervals, an overlap exists when:

`requested_start < existing_end AND requested_end > existing_start`

This allows adjacent bookings to be accepted when one booking ends exactly as another begins, provided no other rule prohibits the reservation.

## Booking and Approval Workflow

A typical booking lifecycle is:

1. A user selects a resource and requested time interval.
2. The system evaluates availability and applicable constraints.
3. The user submits a booking request.
4. The request is approved automatically or placed into the appropriate approval workflow according to the configured rules.
5. An authorized faculty member or administrator reviews requests requiring approval.
6. Availability is rechecked when the booking is approved.
7. The system records the resulting status and relevant audit information.
8. Notifications communicate important changes to the requester.

Under the configured pending-request policy, pending requests do not automatically reserve the slot. Multiple requests may therefore remain pending for the same interval, while the approval process determines which request can be approved successfully.

## Concurrency Control

A booking system must handle situations where multiple users attempt to reserve the same resource simultaneously.

For example, two users may both observe that a seminar hall is available and submit requests for the same time interval. Checking availability before writing a booking is not sufficient by itself, because both requests could pass the initial check.

The application implements a shared booking lock mechanism using an atomic conditional database write against the resource record, coordinated through shared booking operations. Booking creation and approval use this mechanism to reduce race conditions when competing requests are processed.

The project also includes a concurrency test harness covering scenarios such as:

- Multiple simultaneous booking attempts.
- Exact time-slot conflicts.
- Partial interval overlaps.
- Adjacent bookings.
- Duplicate idempotency keys.
- Simultaneous approval attempts.

The implemented mechanism is an application-level atomic conditional-write lock. It should not be confused with a database-native row lock such as `SELECT ... FOR UPDATE`, or with a database exclusion constraint. Its guarantees depend on the underlying platform's atomic-write behavior and the consistency of all booking write paths.

## System Architecture

The project follows a layered full-stack architecture with a separation between the user interface, application operations, shared business logic, and persisted data.

### Presentation Layer

The frontend provides user-facing pages and interactions for resource discovery, booking requests, approval management, timetable administration, and utilization analytics.

### Application and API Layer

Backend functions handle operations such as:

- Booking creation.
- Booking approval, rejection, and cancellation.
- Availability checking.
- Timetable event management.
- Recurring booking processing.
- Resource utilization calculations.
- Concurrency and workflow testing.

These operations apply authorization, validation, and business rules before changing persisted records.

### Shared Business Logic

Shared modules centralize important rules, including:

- Availability evaluation.
- Booking lifecycle transitions.
- Concurrency-aware booking operations.
- Timetable conflict handling.
- Resource-specific constraint validation.

This separation reduces duplicated business logic and helps keep results consistent across frontend features and backend operations.

### Data Layer

The database stores resource records, bookings, timetable events, approval rules, faculty certifications, equipment information, maintenance blocks, notifications, and audit logs.

**Architecture note:** The application uses Base44's platform capabilities. The exact underlying infrastructure, database engine, and deployment architecture depend on the platform and project configuration.

## Database Design

The application uses structured data entities to represent campus resources, reservations, scheduling information, and administrative workflows.

| Entity | Purpose |
|---|---|
| `Resource` | Stores campus facilities and their attributes. |
| `Booking` | Stores booking requests, time intervals, purposes, attendance, and lifecycle states. |
| `TimetableEvent` | Stores scheduled academic and other timetable occupancy. |
| `ApprovalRule` | Defines conditions governing booking approvals. |
| `FacultyCertification` | Stores faculty certification information. |
| `Equipment` | Tracks equipment associated with campus resources. |
| `MaintenanceBlock` | Represents intervals when resources are unavailable for maintenance or administrative reasons. |
| `RecurringSeries` | Represents recurring booking series and their configuration. |
| `Notification` | Stores booking and workflow notifications. |
| `AuditLog` | Records relevant booking and administrative actions. |

Records may reference other entities through identifiers. Valid references are important when importing data, particularly for bookings, timetable events, equipment, and maintenance blocks.

## Technology Overview

The project was developed and deployed using Base44, with exported source code available for local development and Git-based version control.

The application uses:

- **Frontend:** Web-based user interface and reusable interface components.
- **Backend:** Server-side functions for booking, approvals, availability, scheduling, and analytics.
- **Database:** Base44-managed structured data entities.
- **Business logic:** Shared modules for availability, booking lifecycle, and concurrency-aware operations.
- **Version control:** Git and GitHub.
- **Deployment:** Base44-hosted live application.

The exact framework versions and additional dependencies should be taken from the project's exported source files and package configuration.

## Testing and Validation

The project includes test workflows for validating critical scheduling behavior.

Areas covered include:

- Availability checks for free and occupied time slots.
- Timetable overlap detection.
- Booking creation and approval-time validation.
- Exact and partial booking conflicts.
- Adjacent booking intervals.
- Concurrent booking and approval attempts.
- Idempotency for duplicate requests.
- Role-based authorization.
- Resource capacity constraints.
- Laboratory supervision and faculty qualification checks.
- Certification requirements.
- Recurring booking conflicts.
- Utilization calculations.

The project also underwent a production build verification, with the final build reported as successful.

Test results should be interpreted in the context of the platform's test environment and the specific scenarios executed. They do not, by themselves, establish production-scale load performance or comprehensive security assurance.

## Getting Started

### Live Application

Visit the deployed application:

https://campus-resource-booking-schedulin-6f5fec6e.base44.app/

### Source Code

The project source is maintained in a GitHub repository:

https://github.com/Ipsita-1111/Campus-Resource-Booking-Scheduling-System

### Local Setup

The exported project can be explored and developed locally using the following general process:

1. Install Node.js and Git.
2. Clone the repository.
3. Open the project directory.
4. Inspect `package.json` and the project documentation to identify the required runtime and dependencies.
5. Install dependencies using the package manager specified by the project.
6. Configure any required environment variables using a local environment file.
7. Start the application using the scripts defined in `package.json`.

Because Base44 projects may depend on platform-specific services, functions, authentication, or database capabilities, a successful local frontend build does not necessarily mean every hosted feature will work locally without additional configuration.

**Security:** Never commit API keys, passwords, private tokens, or production secrets to GitHub. Use environment variables and keep local secret files out of version control.

## Future Enhancements

Potential future improvements include:

- Database-native locking or exclusion constraints where supported.
- More comprehensive multi-user concurrency testing.
- Integration with university authentication systems.
- Calendar synchronization and timetable imports.
- Automated reminders for upcoming bookings.
- Recurring booking exception management.
- Advanced utilization reports and forecasting.
- Additional accessibility and usability improvements.
- Automated integration tests and continuous deployment.
- Production monitoring, backups, and operational alerts.

## Project Status

**Status: Implemented and deployed; source code exported for version control.**

The current project brings together centralized resource availability, booking lifecycle management, role-based approval workflows, timetable integration, resource-specific constraints, recurring bookings, concurrency-aware booking operations, and utilization analytics.

The live application and repository provide a foundation for further testing, demonstration, and development.

---

*Developed as a full-stack university project focused on campus resource booking, scheduling, and utilization management.*
