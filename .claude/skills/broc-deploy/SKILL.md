---
name: broc-deploy
description: Stand up, upgrade or troubleshoot a BROC deployment — Supabase Cloud, self-hosted Supabase, or plain PostgreSQL. Use when asked to deploy, run migrations against a database, build the Docker image, or diagnose a failing install.
---

# Deploying BROC

Nothing here calls home. An upgrade is `git pull` plus any new migrations, and
a deployment belongs entirely to the team running it.

`docs/DEPLOY.md` is the full guide; `docs/INSTALL.md` is the clean-install path
and states honestly what has and has not been verified. Keep that honesty — it
is the section an engineer installing it will judge the whole project by.

## Three routes, one application

| Route | For a team that |
| --- | --- |
| Supabase Cloud | wants a managed database |
| Self-hosted Supabase | cannot send data to a vendor |
| Plain PostgreSQL 15+ | already runs Postgres and wants no new platform |

`deploy/selfhost.sh` orchestrates Supabase's own bundle rather than vendoring a
copy of it. Their compose file is a dozen services and it changes; a snapshot
pasted into this repo would be wrong within months, in the way that is only
discovered mid-install.

## Order of operations

```bash
cp deploy/.env.example deploy/.env      # then fill it in
./deploy/preflight.sh                   # expect zero problems
DATABASE_URL=postgresql://... ./deploy/migrate.sh --dry-run
DATABASE_URL=postgresql://... ./deploy/migrate.sh
DATABASE_URL=postgresql://... ./deploy/migrate.sh --verify
npm run build                           # must produce .next/standalone/server.js
```

`preflight.sh` reads the source for the environment variables the code actually
references and reports any that `.env` is missing. It does not trust
`.env.example` to have kept up — a template drifts from code silently.

`migrate.sh` applies migrations in order, exactly once each, and tracks what it
has run, so a re-run is a no-op. It needs only `psql`, not the Supabase CLI,
which matters on a locked-down host.

## The build must produce a standalone server

`next.config.ts` sets `output: 'standalone'`, and `deploy/Dockerfile` copies
`.next/standalone` and nothing else — no build tooling, no `node_modules` tree.
Removing that setting breaks the Docker build.

If `npm run build` fails at the copy step with `UNKNOWN: copyfile` or `EPERM:
unlink`, the problem is almost certainly the filesystem rather than the code.
On Windows, a repository inside OneDrive has cloud-only placeholder files:
`node_modules` dehydrates, and Next copies the dependency tree file by file.
Pin the folder with `attrib +P -U node_modules\* /S /D`, or move the repository
out of OneDrive. TypeScript and tests passing while the build dies on a copy is
the signature.

## Secrets

`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security. It must never appear
in a `NEXT_PUBLIC_` variable, a client component, or a browser-visible log.
`NEXT_PUBLIC_SUPABASE_URL` and the anon key are compiled into the browser
bundle, so changing them means rebuilding the image, not restarting the
container.

`.env` and `.env.local` are gitignored; `.env.example` is deliberately not, and
carries only blank keys.

## Upgrading

`git pull`, then run any new migrations. Two habits keep it painless: commit
your changes with honest messages so a conflict is a conversation rather than a
mystery, and prefer data changes over code changes wherever both are possible.
A factor loaded by CSV never conflicts with anything; an edited
`conversions.ts` might.

Forking and diverging heavily is a legitimate choice too. You are not locked
in, which was the entire point.
