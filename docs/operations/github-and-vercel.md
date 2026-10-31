# GitHub and Vercel deployment

This guide prepares a repository you own. It does not create a GitHub, Neon, or Vercel account and it does not upload credentials.

## 1. Verify locally

Use Node.js 22 or newer. From the repository root:

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm check:serverless
pnpm test
pnpm prisma:validate
pnpm build:web
```

The GitHub workflow runs the same verification sequence for pushes to `main` and pull requests.

## 2. Create and push a GitHub repository

Create an empty repository on GitHub without adding a README, `.gitignore`, or license. Then run the following from this repository root, replacing the placeholder URL:

```powershell
git init
git add .
git status
git commit -m "Initial FieldOps Dispatch release"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
git push -u origin main
```

Before `git add .`, confirm `git status` does not show `.env`, a database URL, API keys, or Vercel local state. The supplied `.gitignore` excludes these sensitive files.

## 3. Provision Neon PostgreSQL

1. Create a Neon PostgreSQL project.
2. Copy a pooled PostgreSQL connection string and keep it private.
3. Copy `.env.example` to `.env` locally and set the values below.
4. Apply the reviewed migrations once against the target database:

```powershell
pnpm prisma:generate
pnpm prisma:migrate:deploy
```

Use `prisma migrate deploy` for the deployed database. Do not run `prisma migrate dev` against production.

## 4. Import into Vercel

1. Go to [Vercel New Project](https://vercel.com/new) and import the GitHub repository.
2. Leave the Root Directory at the repository root.
3. Vercel reads `vercel.json`. It installs with pnpm, runs `pnpm build:vercel`, publishes `dist/web`, and maps `/api/*` to the serverless Express handler.
4. In **Project Settings → Environment Variables**, add the variables below for **Production**. Add separate values for **Preview** only if preview deployments should access a non-production database.
5. Deploy after all required variables are saved.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Private Neon pooled PostgreSQL connection string with TLS enabled. |
| `AUTH_SECRET` | Yes | Unique, unpredictable value of at least 32 characters. Rotating it invalidates sessions. |
| `OPERATIONAL_TIMEZONE` | Yes | IANA timezone, for example `Asia/Kolkata`. |
| `GEMINI_API_KEY` | No | Optional advisory AI provider credential. |
| `GEMINI_MODEL` | No | Optional configured Gemini model name. |

Environment-variable changes apply only to newly created deployments, so redeploy after any change. See Vercel’s [environment-variable guide](https://vercel.com/docs/environment-variables/managing-environment-variables) and [Git deployment guide](https://vercel.com/docs/git).

## 5. Verify production

After the deployment completes, verify:

```text
https://YOUR-DEPLOYMENT.vercel.app/
https://YOUR-DEPLOYMENT.vercel.app/api/v1/health
```

The health endpoint should return a successful response with database readiness. Then complete this smoke test:

1. Create the first admin account.
2. Sign in and create a technician and service request.
3. Generate a proposed schedule.
4. Review and approve it.
5. Confirm the audit entry and in-app notification feed update.

If health is degraded, check the Vercel function logs, `DATABASE_URL`, and whether the Prisma migration was applied to the same database.

## Release safety

- Keep production and preview databases separate.
- Never use a `VITE_` prefix for server secrets; Vite exposes those values to the browser bundle.
- Limit access to GitHub, Neon, and Vercel project settings.
- Review the release checklist in [deployment.md](deployment.md) and the security controls in [security design](../architecture/security-design.md).
