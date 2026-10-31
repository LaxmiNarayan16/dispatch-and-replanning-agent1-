# Operations Guide

## Health and diagnostics

Use `GET /api/v1/health` for process and database readiness. Capture the `x-request-id` from every response when investigating an issue. A degraded response means the function can run but its configured database is unavailable or incorrectly configured.

## Safe incident handling

- Do not edit historical schedule versions to correct a dispatch issue; create a new replan proposal.
- Do not manually create notifications; they must follow a successful approval transaction.
- If the AI provider is unhealthy or unconfigured, keep dispatch running with the deterministic validated plan and fallback explanations.
- For stale approval conflicts, reload current version history and ask the dispatcher to review the newest proposal.

## Routine release checks

Run strict server and serverless type-checks, the full test suite, Prisma validation, migration review, and a production build before deployment. Confirm production log redaction and secret configuration before enabling dispatcher access.
