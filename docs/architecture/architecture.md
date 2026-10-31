# Architecture

## Architectural style

The application is a modular monolith with independently testable domain modules. It has a React client and a serverless-compatible Express API backed by PostgreSQL through Prisma. Domain rules and the scheduling engine do not depend on Express, Prisma, React, or Gemini.

```
React dispatch console
        | HTTPS / JSON
Express API (request id, auth boundary, Zod, error mapping)
        |                         \
Application services               AI plan/explanation adapter (optional Gemini)
        |                                   |
Domain: validation, scheduling, versioning, audit   structured Zod result
        |
Prisma repositories / transactions
        |
PostgreSQL (Neon in production)
```

## Module boundaries

| Module | Responsibility | Must not do |
| --- | --- | --- |
| `domain` | Entities, interval operations, validation codes, domain errors | Read HTTP or database state |
| `scheduling` | Candidate generation, deterministic search, scoring, plan validation | Call AI or persist data |
| `application` | Initial-plan, replan, override, approval orchestration | Reimplement constraints |
| `infrastructure` | Prisma repositories, transactions, Pino, Gemini adapter | Decide feasibility |
| `api` | Authentication boundary, Zod request parsing, response mapping, OpenAPI | Contain business rules |
| `web` | Display and accessible dispatcher interaction | Treat API results as valid without server validation |

## Scheduling engine contract

The engine accepts a normalized snapshot: planning timezone/date, technicians, requests, existing protected assignments, optional assignments to preserve, and configurable objective weights and search limits. It returns assignments, unassigned requests with reasons, validation results, objective score components, warnings, and deterministic algorithm metadata.

Candidate generation checks every hard constraint. The solver orders requests by priority then candidate scarcity, explores a bounded deterministic branch-and-bound search, and applies stable ID/time ordering when scores tie. It is allowed to return the best known feasible plan if a configured search limit is reached; its metadata will clearly state whether the bounded search proved optimal.

## Persistence and concurrency

PostgreSQL owns all durable state: technicians, skills/regions, requests, schedule versions, versioned assignment snapshots, audit events, and mock notifications. Schedule versions are append-only. Approval will use a Prisma transaction with a compare-and-set condition on the version status/current pointer; a zero-row update produces a stale/conflict response. No in-memory lock is part of correctness.

The Technician Schedule is a client-side presentation of persisted assignment snapshots. It renders ten 08:00–18:00 hourly slots; every availability or assignment bar uses the same stored-timestamp scale as the header. Its current-time guide and card styling do not perform schedule calculation or persist assignment changes.

## AI boundary

The AI adapter receives a compact, factual DTO (technicians, windows, requests, protected assignments, and the deterministic result). It may propose assignments and commentary, but its output is constrained by Zod and every suggested row is re-checked by the deterministic hard-constraint validator before it can appear in a proposal. It may reference only provided IDs. A validated agent plan can be stored only as a new `PROPOSED` version; approval remains an explicit dispatcher action. Failure, timeout, invalid references, or rejected suggestions fall back to the validated deterministic plan.

## Security and operations

Configuration enters through validated environment variables; secrets are never sent to clients or logged. API errors expose a request ID and safe code only. Pino logs structured lifecycle events. A health endpoint differentiates process health from database readiness. OpenAPI documents external API behavior, not internal implementation.

## Deployment model

The API is packaged so an Express handler can be invoked by Vercel serverless functions. The frontend is Vite-built static content. Neon provides PostgreSQL; Prisma migrations are run as an explicit deployment step. Deployment and paid provider activation require separate user approval.
