# Implementation Plan

## Delivery checklist

| Phase | Scope | Status | Verification |
| --- | --- | --- | --- |
| 1 | Requirements, architecture, domain rules | Complete | Empty repository inspected; documents reviewed for constraint coverage |
| 2 | Workspace scaffold, Prisma schema, domain models | Complete | Type-check passes; Prisma schema validates |
| 3 | Pure deterministic scheduling engine | Complete | Hard-constraint and deterministic-ordering tests pass |
| 4 | Engine workflow/replanning tests | Complete | Protected-work, cancellation, emergency, and change-set tests pass |
| 5 | Express API, validation, repositories, OpenAPI | Complete | API type-check and Supertest suite pass; live PostgreSQL smoke test remains deployment work |
| 6 | Initial planning and AI explanation adapter | Complete | Structured output, fallback, and invalid-reference tests pass |
| 7 | Dispatch console and accessible editing | Complete | React/Vite type-check and production build pass; live API wiring present |
| 8 | Approval, immutable versioning, audit, notifications | Complete | Transaction workflow tests pass; approval sends diff-driven mock notifications |
| 9 | Replanning console and version comparison | Complete | Persisted `changes` entries drive the replan UI |
| 10 | Observability, security, deployment documentation | Complete | Auth/role checks, request IDs, health, structured docs, 56 passing tests, production build |
| 11 | AI planning agent and validated proposals | Complete | Suggestion validation, double-booking rejection, AI proposal approval gate, and fallback tests pass |

## Phase 1 decisions

- The product is intentionally bounded to a single operational day; the solver favors explainability and deterministic bounded search over unproven global optimization claims.
- Time is stored in UTC and interpreted with an explicit IANA operational timezone. Half-open intervals define overlap behavior.
- Preferred windows are soft preferences. Future hard windows must be a distinct field.
- PostgreSQL transactions and optimistic concurrency protect approval. Schedule versions are immutable snapshots.
- Gemini is strictly an optional structured planning/explanation provider; the deterministic engine and dispatcher approval are authoritative.

## Next phase: data and domain foundation

1. Initialize the TypeScript workspace and package scripts.
2. Create a Prisma schema covering technician, request, schedule version, assignment snapshot, audit event, and mock notification entities.
3. Implement pure TypeScript domain types, interval helpers, validation codes, and typed application errors.
4. Add seed-free test fixtures that create explicit test data rather than driving the system from static core data.
5. Run type-check and schema validation before moving to the scheduling engine.

### Phase 2 implementation record

- Added a strict NodeNext TypeScript workspace and pnpm scripts.
- Modeled technicians, working hours, UTC availability windows, service requests, immutable schedule versions, assignment snapshots, audit events, and mock notifications in Prisma.
- Added pure half-open interval helpers, IANA timezone validation, typed domain validation errors, and API-facing Zod input schemas.
- Added initial tests covering adjacent intervals, overlap detection, containment, duration, invalid intervals, and timezone validation.
- The TypeScript/Vitest dependencies are installed sufficiently for direct tool execution. Type-check and unit tests now pass. Prisma CLI schema validation, generated client output, migration, and database operations have not been claimed as successful because the local Prisma CLI package link is interrupted by environment-level registry/sandbox behavior.

### Phase 3 implementation record

- Implemented a pure bounded deterministic backtracking planner with stable request and candidate ordering.
- Implemented hard filtering for technician status, skill, region, availability, working hours, duration, workload, overlap, and duplicate requests.
- Protected assignments are included as immutable planning context and block conflicting proposed work.
- The result includes unassigned explanations, score components, explored-node count, search-limit warning, and honest optimality metadata.
- Verified with `node node_modules\\typescript\\bin\\tsc --noEmit --project tsconfig.json` and `node node_modules\\vitest\\vitest.mjs run`: 12 tests passed.
- Prisma CLI schema validation remains pending because the package link is interrupted by registry/sandbox behavior; no database migration has been attempted.

### Phase 4 implementation record

- Added a pure replanning workflow that preserves completed and in-progress assignments, while reconsidering future work in a new draft.
- Added deterministic change comparison: preserved, added, removed, reassigned, and rescheduled work are reported explicitly.
- Added disruption tests for technician cancellation, emergency work, cancelled requests, completed preservation, and in-progress preservation.
- Verified with TypeScript type-check and Vitest: 17 tests passed.

### Phase 5 implementation record

- Added an Express API with request IDs, JSON size limits, safe centralized errors, `GET /api/v1/health`, and `POST /api/v1/schedules/preview`.
- The preview endpoint validates a normalized scheduling snapshot with Zod and invokes only the deterministic engine; it does not persist or approve a plan.
- TypeScript check passes after the API addition.
- The new Supertest integration suite cannot currently execute because the environment's partially linked dependency tree is missing `side-channel-weakmap`. This is documented as an environment issue, not a passing test.

### Phase 6 implementation record

- Added strict, schema-validated AI explanations with actual engine-result reference validation and deterministic fallback.
- Verified valid response, provider failure fallback, and invalid AI assignment references. AI tests are included in the 24 passing focused tests.

### Phase 8 implementation record

- Added schedule proposal, approval, and rejection application service with immutable version semantics, stale approval detection, audit writes, and post-approval mock notification creation.
- Added Prisma transaction adapter with compare-and-set approval/rejection updates. It is source-checked; its PostgreSQL execution awaits successful Prisma client generation and a configured database.

### Manual override implementation record

- Added manual assignment/change validation that reuses the deterministic scheduling constraints instead of trusting dispatcher input.
- Completed and in-progress assignments are rejected as protected work. Valid changes become a new draft snapshot and must still pass the version approval workflow.
- Verified valid manual assignment, invalid working-hours rejection, and protected-work rejection. The focused core suite now has 27 passing tests.

### Phase 7 implementation record

- Added React/Vite/Lucide dispatch-console shell with schedule timeline, status metrics, workload bars, unassigned-work reasons, selection/detail panel, pending approval state, and navigation.
- The screen uses a clearly labelled design-time fixture until API version endpoints are available; browser code does not schedule or validate assignments.
- Verified with web TypeScript check and Vite production build.

### Persistence and deployment preparation record

- Prisma schema validation and client generation were executed successfully without touching a database.
- Added a reviewable baseline PostgreSQL migration generated from the Prisma schema, Vercel serverless API entrypoint, environment validation, database readiness behavior, OpenAPI contract, and persisted version workflow endpoints.
- Prisma schema validation and generated client execution now pass. The complete suite has 34 passing tests, including Supertest loopback API integration checks. Vite production build and strict TypeScript checks pass.

### Authentication and live-workbench implementation record

- Added persistent users, first-admin bootstrap, salted `scrypt` password storage, signed expiring bearer sessions, and role-based dispatcher authorization.
- Protected every persistent dispatch/version endpoint and derive dispatcher identity only from a verified session.
- Replaced the fixture-driven primary React experience with login, technician/request creation, persisted workbench loading, deterministic plan generation, and approval actions.
- Verified: 38 tests pass, Prisma validates/generates, server/web/serverless TypeScript checks pass, and the Vite production build passes.

### Replanning, override, notification, and AI-agent completion record

- Added persisted replan change sets (`ScheduleVersion.changes`), trigger/reason audit rows, and dispatcher-facing before/after entries.
- Added `POST /schedule-overrides` with the same hard-constraint validation as the planner, an `ASSIGNMENT_OVERRIDDEN` audit row, and an approval-required child proposal.
- Added persistence-level double-booking rejection and blocked cancelled/completed requests in manual validation.
- Added diff-driven `ASSIGNMENT_CHANGED` and `ASSIGNMENT_REMOVED` mock notifications inside the approval transaction.
- Added the validated AI planning agent (`proposeDispatchPlan`), optional Gemini adapter, `/ai/plan` advisory endpoint, and `/ai/plan/propose` approval-gated endpoint. Reviewed assignments are re-validated server-side.
- Updated the live console with AI plan review, replan trigger selection, change summaries, technician status editing, and validated override forms.
- Verified: 56 tests pass, Prisma validates/generates, the additive migration is applied, all TypeScript projects check, and the Vite production build passes.

## Risks to control

- Date-time conversions can produce subtle boundary errors; all interval helpers must be unit-tested around adjacent boundaries and timezone conversion.
- A greedy scheduler alone may miss feasible higher-value plans; use bounded backtracking/branch-and-bound for this small problem size.
- Replanning can accidentally rewrite history; persistence interfaces must make version insertion append-only.
- AI narrative drift must remain harmless through DTO minimization and schema/reference validation.
