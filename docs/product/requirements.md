# Requirements

## Product scope

The system schedules a single operational day for a deliberately small, bounded set of technicians and service requests. It supports initial planning, dispatcher-reviewed changes, approval, and disruption-driven replanning. It is not a routing, GPS, payroll, messaging, or multi-day optimization product.

## Functional requirements

### Dispatch data

- Dispatchers can create and edit technicians, their skills, assigned regions, working hours, availability windows, capacity, and operational status.
- Dispatchers can create and edit service requests with title, region, required skill, priority, duration, preferred window, status, and optional notes.
- The system validates domain input at the API boundary and before schedule persistence.

### Planning and review

- The system produces a deterministic proposed schedule for a supplied planning date and operational timezone.
- It displays a single-day Technician Schedule with ten aligned 08:00–18:00 operational slots, technician identity/status, compact availability ranges, duration-accurate assigned work, and a current-time guide. These are presentation features only and never alter scheduling output.
- A dispatcher can make individual proposed changes only if the deterministic validator accepts them.
- A proposed version cannot become approved without authorization by a dispatcher.

### Replanning

- A technician cancellation/unavailability, emergency request, request cancellation, duration change, or availability change can create a new proposed version.
- Completed and in-progress assignments remain in place; affected future work is considered for reassignment.
- The new version records its parent and exposes a comparison with the prior version.

### Audit and notifications

- Approvals, rejections, and manual overrides are persisted with actor, prior value, new value, reason, time, and schedule version.
- Approval creates persisted mock notifications for technicians affected by the approved change.

### AI decision support

- When configured and available, an AI provider creates structured explanations of actual engine output, risks, unassigned work, trade-offs, missing data, and replanning impacts.
- AI never persists or confirms assignments. If unavailable or invalid, planning continues without it.

## Non-functional requirements

- PostgreSQL is the source of truth; no local-file or in-memory persistence is used for business state.
- Timestamps are stored as UTC. A configured IANA operational timezone interprets local planning windows.
- APIs use Zod validation, request IDs, structured Pino logs, typed errors, safe client responses, health checks, and OpenAPI documentation.
- Approval uses database transactions and version checks rather than process-local locking.
- All critical constraint and workflow behavior is covered by automated tests.

## Out of scope

Live GPS, maps, route/travel-time APIs, payroll, actual SMS/email/push delivery, unconstrained global optimization, multi-day routing, and automatic schedule confirmation.

## Acceptance criteria

The final system must meet the Definition of Done in the source brief: managed dispatch data; deterministic, validated schedules; review and approval; immutable versions; replanning that preserves protected work; audit records; post-approval mock notifications; passing automated tests; and a successful production build. Live deployment is a separately authorized activity because it requires external account configuration.
