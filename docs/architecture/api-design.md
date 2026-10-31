# API Design

## Conventions

- API root: `/api/v1`.
- JSON request/response bodies.
- Every response includes an `x-request-id` header. Clients may supply one; otherwise the API creates a UUID.
- Invalid input returns HTTP 400 with `VALIDATION_ERROR`, a safe message, normalized Zod field details, and the request ID.
- Invalid manual assignments return HTTP 422 with `INVALID_MANUAL_OVERRIDE` and machine-readable rejection reasons.
- Unknown endpoints return HTTP 404. Unexpected errors return HTTP 500 without a stack trace.

## Authentication

- `POST /auth/bootstrap` creates the initial `ADMIN` only when no user exists.
- `POST /auth/login` returns a signed 12-hour bearer token.
- `GET /auth/me` validates the session.

Persistent API calls require `Authorization: Bearer <token>`. Technician/request mutation, schedule generation, overrides, AI proposals, and version approval/rejection require `ADMIN` or `DISPATCHER`; a `VIEWER` may read the workbench only.

## Planning

### `GET /api/v1/health`

Returns process and database readiness. HTTP `503` with `{ "status": "degraded", "database": false }` means the API is running but not dispatch-ready.

### `POST /api/v1/schedules/preview`

Validates a normalized scheduling snapshot and invokes the pure deterministic engine. It does not create a schedule version, mutate a request, or approve work. Optional fields: `protectedAssignments`, `slotIntervalMinutes`, `maxSearchNodes`.

### `GET /api/v1/workbench?planningDate=YYYY-MM-DD`

Returns technicians, requests, protected assignments, and the latest version (including its trigger, reason, and persisted change set).

### `POST /api/v1/schedules/generate`

Loads persisted data and creates a new `PROPOSED` version. The first call creates `INITIAL_PLAN`; later calls create a child replan with the supplied trigger (default `MANUAL_OVERRIDE`). The dispatcher ID comes only from the session. Generating never approves.

## Manual overrides

### `POST /api/v1/schedule-overrides`

Body: `planningDate`, `operationalTimezone`, `technicianId`, `serviceRequestId`, `start`, `end`, `reason`.

Re-validates skill, region, working hours, availability, duration, workload, overlap, duplicate request, and protected work. Creates a child `MANUAL_OVERRIDE` proposal plus an `ASSIGNMENT_OVERRIDDEN` audit row. The change is not confirmed until the new version is approved.

## AI agent

### `POST /api/v1/ai/plan`

Body: `planningDate`, `operationalTimezone`. Returns an advisory plan with validated assignments, rejected suggestions, trade-offs, risky/unassigned work, missing information, dispatcher questions, warnings, `requiresApproval: true`, and `persisted: false`.

### `POST /api/v1/ai/plan/propose`

Re-runs the agent and stores the validated result as a new `PROPOSED` version. It does not approve anything; the normal approval endpoint is still required.

## Version workflow

- `POST /schedule-versions` creates an immutable proposed version from a deterministic result.
- `POST /schedule-versions/{versionId}/approve` executes transactional approval, audit writing, and mock notification creation for confirmed changes.
- `POST /schedule-versions/{versionId}/reject` rejects a proposed version with a dispatcher ID and mandatory reason.

The server returns `503 PERSISTENCE_UNAVAILABLE` if no durable database is configured. It returns `409 VERSION_CONFLICT` for stale approval/parent-version conflicts and `422 INVALID_VERSION_STATE` for invalid lifecycle changes or double-booked proposals.

## Dispatch data

- `GET`/`POST /technicians`
- `PATCH /technicians/{technicianId}`
- `GET`/`POST /service-requests`
- `PATCH /service-requests/{requestId}`
