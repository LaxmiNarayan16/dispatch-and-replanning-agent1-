# Database Design

## Source of truth

PostgreSQL is the only source of durable business state. Prisma's schema is in `prisma/schema.prisma`; Neon is the intended managed PostgreSQL provider.

## Main entities

| Entity | Purpose | Key integrity rule |
| --- | --- | --- |
| `Technician` | Identity, skills, regions, capacity, status | Status blocks new work when unavailable/cancelled |
| `TechnicianWorkingHours` | Recurring local-hours definition | One record per technician/weekday |
| `TechnicianAvailability` | UTC exception/availability interval | Indexed by technician and time |
| `ServiceRequest` | Service demand and operational status | Priority and duration are explicit |
| `ScheduleVersion` | Immutable proposal/approval snapshot | Unique date/version; lineage via parent version; `changes` JSON stores the before/after diff |
| `AssignmentSnapshot` | Assignments belonging to one version | One request once per version |
| `AuditEvent` | Approval, rejection, override, replan events | Append-only audit trail |
| `MockNotification` | Post-approval simulated technician messages | Created only in approval transaction |

## Versioning and transactions

Each proposal inserts a new `ScheduleVersion` plus assignment snapshots. A historical version is never overwritten. `changes` is nullable for the initial plan and stores the dispatcher-facing diff for replans and overrides. Approval/rejection is a compare-and-set update from `PROPOSED`, inside a PostgreSQL transaction with its audit events and, for approval, notifications. A zero-row compare-and-set result becomes a conflict response. The service also rejects proposals that double-book a technician, even if a client bypasses the planner.

## Time storage

All actual timestamp columns use PostgreSQL timestamps in UTC. `planningDate` is a database `DATE`; `operationalTimezone` records the IANA zone used to interpret dispatcher-facing windows. Working-hour minute ranges model recurring local workday rules; availability and assignments are concrete UTC intervals.

## Migration policy

Generate Prisma client and execute reviewed migrations in CI/deployment, never at server request time. Backups and Neon branch checks should precede destructive schema changes.
