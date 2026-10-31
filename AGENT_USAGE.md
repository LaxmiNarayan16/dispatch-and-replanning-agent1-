# Agent Usage Record

This document records how coding-agent assistance was used to prepare and verify this repository. It is operational documentation, not application runtime behaviour.

## Tools used

| Tool category | Purpose | Guardrail |
| --- | --- | --- |
| PowerShell and Git | Inspect repository state, run package scripts, create commits, and publish only after explicit approval. | Never print or stage `.env` values. |
| pnpm / TypeScript / Vitest | Install-independent validation, type checks, and automated tests. | Treat a sandbox networking error as an environment issue, then rerun only with approved loopback access. |
| Prisma CLI | Validate schema and generate the client during deployment builds. | Never run destructive database commands without explicit direction. |
| Web documentation lookup | Confirm current Gemini and Vercel behaviour. | Prefer vendor documentation; do not expose API keys in requests or reports. |

## Representative prompts and outcomes

| Prompt intent | Outcome |
| --- | --- |
| “Make the schedule bars match their actual start and end times.” | The UI timeline was updated so the visual width derives from persisted assignment intervals while preserving scheduler rules. |
| “Why is Gemini returning 503/429?” | Confirmed the configured provider could return structured JSON, documented upstream rate/capacity behaviour, and added bounded transient-error retry before the deterministic fallback. |
| “Prepare for GitHub and Vercel.” | Added deployment documentation, Vercel build configuration, a CI workflow, repository layout documentation, and secret-handling guidance. |

## Delegated work

No work was delegated to sub-agents while preparing this repository version. All changes and validation described here were performed in the primary workspace.

## Mistakes, mitigations, and lessons

| Situation | Mitigation / lesson |
| --- | --- |
| A local Prisma client generation could fail with a Windows file-lock (`EPERM`) in a synced workspace. | Do not delete generated binaries blindly. A clean Vercel Linux build is the deployment source of truth; rerun locally after the lock is released. |
| Initial Gemini calls can receive temporary `503` or quota `429` responses. | The AI provider is optional and now uses bounded retry for transient failures. The validated deterministic scheduler remains the safe fallback. |
| API integration tests require opening loopback ports, which a restricted execution sandbox can block. | The complete suite was rerun with approved loopback access and passed. |
| Credentials can accidentally be staged during a first commit. | `.gitignore` excludes `.env` and `.env.*` while retaining only `.env.example`; confirm `git status` before each push. |

## Verification record

The current repository was verified with:

```powershell
pnpm check
pnpm check:serverless
pnpm prisma:validate
pnpm test
pnpm build:web
```

The most recent full Vitest run passed **13 test files and 58 tests**. Before a release, repeat the commands above and complete the production smoke test in [docs/operations/github-and-vercel.md](docs/operations/github-and-vercel.md).

## Deployment and account remarks

- No production deployment URL has been created by this repository preparation step.
- No test credentials are included. Create the first administrator only on the deployed, secured environment.
- Keep `DATABASE_URL`, `AUTH_SECRET`, `GEMINI_API_KEY`, and any provider keys exclusively in Vercel/hosting environment settings or a local ignored `.env` file.
