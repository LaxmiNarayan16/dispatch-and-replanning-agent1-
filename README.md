# FieldOps Dispatch

FieldOps Dispatch is a production-oriented, single-day field-service dispatch application. It manages technicians and service requests, generates deterministic schedule proposals, supports validated manual changes and replanning, and requires dispatcher approval before a plan becomes current.

## What is included

- First-admin bootstrap, login, signed sessions, and role checks.
- PostgreSQL-backed technicians, service requests, immutable schedule versions, audit events, and in-app mock notifications.
- Deterministic scheduling with skill, region, availability, working-hours, duration, workload, overlap, and protected-work validation.
- Replanning and validated manual overrides that always create approval-required proposals.
- Optional advisory AI planning; AI output is validated and can never approve or bypass the scheduling engine.
- Technician Schedule UI with ten operational one-hour slots from 08:00–18:00. Bar position and duration are derived from stored assignment timestamps.

## Scope

This release supports a single operational day and dispatcher-reviewed schedules. It is designed for small field-service teams that need reliable technician/request management, constraint-based schedule proposals, approved schedule snapshots, and auditable manual changes.

It intentionally does not provide route optimisation, map/GPS tracking, real outbound SMS/email, payroll, multi-day optimisation, or automatic AI approval of work. See [known limitations](docs/operations/known-limitations.md) for the full list.

## Repository layout

```text
api/                 Vercel serverless API entry points
docs/                Product, architecture, operations, quality, and API documentation
prisma/              Prisma schema and reviewed PostgreSQL migrations
src/
  ai/                Advisory AI provider and validation
  api/               Express application and local API server
  application/       Dispatch, authentication, versioning, and override workflows
  domain/            Types, interval helpers, schemas, and domain errors
  infrastructure/    Prisma repositories and database client
  scheduling/        Deterministic planning and replanning engine
  web/               React/Vite dispatch console
.github/workflows/   GitHub Actions verification
```

## Documentation

Start with the [documentation index](docs/README.md).

- [GitHub and Vercel deployment guide](docs/operations/github-and-vercel.md)
- [Architecture](docs/architecture/architecture.md)
- [Requirements](docs/product/requirements.md)
- [API design](docs/architecture/api-design.md)
- [Security design](docs/architecture/security-design.md)
- [Test strategy](docs/quality/test-strategy.md)

## Local development

Prerequisite: Node.js 22 or newer. The project uses pnpm through Corepack.

```powershell
corepack enable
pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

Set `DATABASE_URL` and `AUTH_SECRET` in the private `.env` file. Then run:

```powershell
pnpm prisma:generate
pnpm prisma:migrate:deploy
pnpm dev:api
pnpm dev:web
```

In a second terminal, open `http://localhost:5173`.

## Verification

```powershell
pnpm check
pnpm check:serverless
pnpm test
pnpm prisma:validate
pnpm build:web
```

Do not commit `.env`, database URLs, or API keys. Use Vercel Project Settings for production environment variables.

The current verification suite contains 58 automated tests covering the domain, scheduler, replanning, authentication, API, AI fallback/retry behaviour, and persistence adapters. GitHub Actions runs the same checks for every pull request and push to `main`.

## Deployment

Deploy the repository to Vercel using the included `vercel.json`. Configure `DATABASE_URL`, `AUTH_SECRET`, and `OPERATIONAL_TIMEZONE`; `GEMINI_API_KEY` and `GEMINI_MODEL` are optional. Apply the Prisma migration to the target PostgreSQL database before the first production use.

Follow the complete [GitHub and Vercel deployment guide](docs/operations/github-and-vercel.md), including the production smoke test and environment-variable setup.

## Test accounts

No test or default user account is included. On a fresh database, use the first-admin bootstrap screen to create the initial administrator. Do not publish account credentials in this repository, GitHub issues, or deployment remarks.

## Limitations

- AI planning is advisory. The deterministic scheduler always validates assignments and remains available when a provider is disabled, rate-limited, or unavailable.
- AI providers can enforce quotas or temporary capacity limits. The Gemini adapter retries transient `429`, `408`, and `5xx` errors a bounded number of times before falling back safely.
- A PostgreSQL database and Prisma migration are required for durable production use.
