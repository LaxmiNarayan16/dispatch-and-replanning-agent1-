# Deployment

## Target topology

- **Vercel** hosts the React static application and serverless API handler.
- **Neon PostgreSQL** stores operational data, versions, audits, and mock notifications.
- **Gemini** is optional and used only for advisory AI plan proposals and explanations. Its output is re-validated and never auto-approved.

## Required environment variables

```text
DATABASE_URL=<Neon pooled PostgreSQL URL with sslmode=require>
OPERATIONAL_TIMEZONE=Asia/Kolkata
AUTH_SECRET=<at least 32 unpredictable characters>
GEMINI_API_KEY=<optional>
GEMINI_MODEL=<optional configured model>
```

## Release sequence

1. Install dependencies from the lockfile in a clean CI environment.
2. Run TypeScript, tests, Prisma validation, and `prisma generate`.
3. Apply the checked-in reviewed Prisma migrations (`pnpm prisma:migrate:deploy`) to the target Neon environment.
4. Configure Vercel environment variables; never commit secrets.
5. Deploy, then verify process/database health, preview scheduling, proposal/approval, audit events, and mock notifications.

For the user-operated, copy-paste workflow, see [GitHub and Vercel deployment](github-and-vercel.md).

## Current limitation

Deployment configuration is documented but no provider account, database URL, Git remote, or Vercel project has been supplied. No external resource has been created or modified.
