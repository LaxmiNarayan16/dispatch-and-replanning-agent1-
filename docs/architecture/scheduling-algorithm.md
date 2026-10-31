# Scheduling Algorithm

## Current implementation

The planner is a pure TypeScript bounded deterministic backtracking engine at `src/scheduling/engine.ts`. It receives a normalized in-memory snapshot and does not read from the database, call AI, or mutate persisted state.

### Candidate generation

For each schedulable request, candidates are generated at a configurable slot interval inside each eligible technician's intersection of working hours and availability. A candidate is filtered by:

1. Active technician status.
2. Required skill and eligible region.
3. Complete containment in working hours and an availability window.
4. Exact request duration.
5. Maximum workload.
6. Absence of technician overlap.
7. Absence of a duplicate request assignment.

Intervals are half-open (`[start, end)`), so adjacent work is valid. Completed and in-progress assignments enter the input as protected assignments and participate in workload/overlap checks.

### Search and scoring

Requests are ordered by descending priority, then ascending candidate scarcity, then stable request ID. For every request, the engine explores feasible candidates followed by an explicit unassigned branch. Candidate order is technician ID then start/end time. These stable sort keys make identical input produce identical output.

The current score weights are deliberately explicit:

- 10,000 points for each proposed assignment.
- 100 points per request-priority point.
- 10 points for a preferred-window match.
- A workload-imbalance penalty based on absolute distance from average workload.

The search is capped at a configurable node count (default 25,000). Results report `PROVEN` only when the search completed before the cap; otherwise they report `BEST_KNOWN`. No result claims global optimality unconditionally.

### Output

The engine returns assignments, unassigned requests with stable rejection reasons, validation errors for invalid planning context, objective components, and search metadata. A feasible partial plan is returned when not all requests can be scheduled.

## Verified behavior

The unit suite currently verifies determinism, skill and region rejection, availability rejection, workload enforcement, no-overlap with adjacent-assignment acceptance, and protected completed-work preservation. Replanning-specific preservation, manual override validation, and engine/API integration tests belong to subsequent phases.

The replanning workflow is now implemented and tested for protected completed/in-progress work, technician cancellation, emergency priority trade-offs, and cancelled-request non-resurrection. Manual override and API/persistence coverage remain subsequent phases.
