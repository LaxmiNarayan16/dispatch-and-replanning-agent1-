# Business Rules

## Time and interval model

- Each planning run has a `planningDate` and an explicitly configured IANA `operationalTimezone`.
- User-entered local business times are converted to UTC before persistence and comparison. API responses include UTC instants and the operational timezone used for display.
- All assignment and availability intervals are half-open: `[start, end)`. Thus an assignment ending at 10:00 and another starting at 10:00 do not overlap.
- `end` must be strictly later than `start`; assignment end is `start + estimatedDuration`.
- A preferred window is a soft objective only. A future hard customer commitment would be represented separately as `requiredWindow`, not by changing the meaning of `preferredWindow`.

## Hard scheduling constraints

An assignment is valid only if every condition below is true:

1. The technician exists and is eligible to receive new work.
2. The request exists and is eligible for scheduling.
3. The technician has the request's required skill.
4. The technician is eligible for the request's region.
5. The complete interval lies within working hours and within at least one availability window.
6. The duration equals the request's effective estimated duration.
7. Total assigned duration does not exceed maximum daily workload.
8. The interval does not overlap another assignment for that technician in the same version.
9. A technician with status `CANCELLED` or `UNAVAILABLE` receives no new work.
10. Completed and in-progress assignments are preserved during replanning.
11. Each assignment references valid IDs and each request is assigned at most once per version.

Any failure is returned as a stable, machine-readable rejection code plus a safe human explanation. Soft scoring can never compensate for a failed hard constraint.

## Scheduling status rules

- A schedule version begins as `PROPOSED`; it may become `APPROVED` or `REJECTED` but is never overwritten.
- Approval requires an authorized dispatcher and the version must still be the current pending proposal for its planning context.
- `COMPLETED` and `IN_PROGRESS` assignments are immutable across replanning; their historical snapshots remain visible.
- Manual changes are proposed changes. They are validated first, recorded as an override, and require approval if they change a schedule version.
- Manual assignment validation runs the same skill, region, time-window, workload, overlap, and duplicate-request constraints used by the scheduling engine.
- A schedule cannot auto-confirm.

## Replanning rules

- Replanning starts from the current approved version and always creates a child proposal.
- Future work for a cancelled/unavailable technician is affected. Unaffected future assignments should remain unchanged when this does not reduce the objective according to configurable change-penalty weights.
- A request cancellation retains its history; it does not erase an earlier assignment or schedule version.
- Emergency work participates in the same hard validation and may leave lower-priority work unassigned only in the *new proposed version*.

## Audit and notification rules

- Every approval, rejection, manual override, and system-triggered replanning event is audited with actor (where applicable), version, timestamp, reason, and before/after payload.
- Mock notifications are created only after a successful approval transaction and only for technicians with an affected assignment.
