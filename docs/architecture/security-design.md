# Security Design

## Current controls

- Inputs are parsed with Zod before the scheduling engine runs.
- Express limits JSON bodies to 1 MB, disables `X-Powered-By`, assigns request IDs, and returns safe error responses without stack traces.
- Configuration values belong in environment variables; `.env*` files are ignored except the checked-in `.env.example` template.
- The AI boundary accepts only validated structured data and treats provider output as untrusted.
- Approval depends on transactions and database compare-and-set updates, never in-memory locks.
- Passwords use Node.js `scrypt` with a random per-password salt; only the derived value is persisted.
- Authentication uses signed, expiring 12-hour bearer tokens. Persistent dispatch and approval endpoints require authentication; schedule creation/approval requires `ADMIN` or `DISPATCHER`.
- First-account bootstrap creates one `ADMIN` only while the users table is empty. It closes immediately after setup.

## Production controls to configure

- Put `DATABASE_URL` and `GEMINI_API_KEY` only in Vercel/Neon environment configuration.
- Enforce a production account-management policy and review dispatcher roles regularly. Dispatcher identity is already derived from verified signed sessions rather than client request bodies.
- Enforce TLS, restrictive CORS, rate limiting at the edge, and production log redaction.
- Use separate least-privilege Neon credentials for runtime and migrations.
- Review audit retention, backups, access controls, and incident procedures with the deploying organization.
