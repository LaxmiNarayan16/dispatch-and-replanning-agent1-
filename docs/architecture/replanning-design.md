# Replanning Design

## Current workflow implementation

`replanSchedule` is a pure application-domain workflow. It accepts current assignment snapshots, normalized technicians and requests, a replan trigger, and the ordinary planner limits. `DispatchWorkflow.generateAndPropose` persists the result as a new immutable `PROPOSED` version linked to the current parent.

### Protected work

Assignments with `COMPLETED` or `IN_PROGRESS` status are copied into the new draft unchanged. They reserve technician capacity and prevent overlap. Future `PROPOSED` and `CONFIRMED` work is reconsidered; it is never mutated in place.

### Disruption handling

- A cancelled or unavailable technician has no viable new candidates. Its future work becomes eligible for reassignment to active technicians.
- An emergency request is considered by the same deterministic engine, with its priority influencing the bounded search.
- Cancelled/completed requests are not scheduled.
- Availability and duration changes are modeled by supplying the changed technician/request snapshot and a corresponding trigger.

### Change set

`diffAssignments` compares the prior snapshot with the new draft by service-request ID. It returns both ID lists (preserved, added, removed, reassigned, rescheduled) and dispatcher-facing `entries` with before/after technician and time. The change set is stored on the schedule version and returned by the workbench, so the UI can show what changed and why (trigger plus trigger reason).

### Manual overrides

`applyManualOverride` validates one dispatcher edit with the same hard validators, then `DispatchWorkflow.createManualOverride` creates a child `MANUAL_OVERRIDE` proposal. The proposal transaction writes `ASSIGNMENT_OVERRIDDEN` with actor, before/after payload, and reason. Completed/in-progress work cannot be edited.

### Double-booking defence

The planner avoids overlaps. `ScheduleVersionService` also rejects any proposal containing overlapping active assignments for the same technician. This protects the persistence boundary even if a client submits hand-built assignments.

## Approval and notifications

Approval is transactional and only works while the version is still the current proposal. On approval, the service compares it with its parent and creates mocked `ASSIGNMENT_CHANGED` and `ASSIGNMENT_REMOVED` notifications in addition to `SCHEDULE_APPROVED`. No notification is created before approval.

## Verified scenarios

The tests cover completed/in-progress preservation, technician-cancellation reassignment, emergency prioritisation under constrained capacity, cancellation non-resurrection, change-set reporting, persistence-level double-booking rejection, manual-override audit rows, AI suggestion rejection, and approval notification counts.
