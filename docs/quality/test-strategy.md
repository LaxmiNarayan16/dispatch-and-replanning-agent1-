# Test Strategy

## Test layers

1. **Domain unit tests**: half-open intervals, containment, duration and timezone behavior.
2. **Scheduling unit tests**: hard constraints, deterministic ordering, partial plans, and protected assignments.
3. **Replanning workflow tests**: preserved completed/in-progress work, technician cancellation, emergency trade-offs, cancellation behavior, and change comparison.
4. **Versioning transaction tests**: proposal validation, stale approval prevention, rejection persistence, audit entries, and post-approval notifications.
5. **AI agent tests**: valid structured proposal, unknown technician/time-window rejection, double-booking rejection, protected-work preservation, risky/unassigned analysis, missing-information questions, and provider fallback.
6. **Override and persistence tests**: manual-override audit rows, persistence-level double-booking rejection, and replan change-set entries.
7. **API integration tests**: request IDs, authentication, validation, safe errors, notification acknowledgement, and persisted workflow wiring.

## Current verified result

The complete local suite contains 56 passing tests, including API request-ID, payload-validation, malformed-JSON handling, notification acknowledgement, deterministic-preview, ready-health, degraded-health, AI-plan authentication, manual-override validation, and agent fallback cases. Strict TypeScript checking (server and web) and the Vite production build pass. PostgreSQL integration tests await an isolated Neon/test database.

## Required before release

Run the complete unit and integration suite with a clean dependency tree, Prisma schema validation and migrations against an isolated database, production build, smoke tests for deployment, and manual accessibility verification for the dispatch board.
