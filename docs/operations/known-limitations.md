# Known Limitations

- The React live workbench is connected to persistent API flows for first-admin setup/login, technicians, requests, deterministic plan generation, validated manual overrides, AI plan proposals, replan change summaries, approval, and an in-app notification feed with acknowledgement. It does not yet expose full version-history browsing or audit-log browsing.
- Prisma schema validation, client generation, and API loopback integration tests pass locally. A real Neon database is still required before persistence endpoints can be exercised against PostgreSQL; schedule-version change sets use an additive migration.
- Authentication and role checks are implemented for all mutation endpoints. Deployment still requires a strong `AUTH_SECRET` and TLS.
- AI output is advisory. A configured provider can time out or return invalid data; the agent then falls back to the validated deterministic plan.
- The planner is deliberately bounded; it reports `BEST_KNOWN` if its configured search cap is reached and does not claim unconditional global optimality.
- Route travel time, maps, live GPS, actual messaging, payroll, and multi-day optimization remain out of scope.
