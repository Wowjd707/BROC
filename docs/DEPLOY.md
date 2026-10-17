# Deploying BROC

BROC is a Next.js application over a PostgreSQL database. Row-level security
is enforced in the database itself, not in application code — the database will
not return another organization's rows regardless of what the app asks for,
which is the property that matters when an assurance provider asks how tenancy
is separated.

There are three sensible ways to run it. Pick by who is doing the running.

| | Who it's for | What you operate | Time |
|---|---|---|---|
| **A. Managed** | A sustainability team with a corporate card and no IT involvement | Nothing | ~30 min |
| **B. Single VM** | IT will host it, data must stay in your boundary | One VM | ~2 hours |
| **C. Existing Postgres** | You already run Postgres and want BROC to use it | One container | ~1 hour |

All three use the same image and the same migrations. You can move between them
later; the database is portable.

---

## Before anything

```bash
# 1. Next must emit a standalone server for the container to be small and
#    self-contained. In next.config.ts:
#
#      const nextConfig: NextConfig = {
#        output: 'standalone',
#        // ...whatever else is already there
#      };

cp deploy/.env.example deploy/.env
$EDITOR deploy/.env

./deploy/preflight.sh
```

`preflight.sh` reads the source for every `process.env` variable the code
actually uses and checks your `.env` against that, rather than against a
template that drifts. It also refuses a deployment where a secret has been put
in a `NEXT_PUBLIC_` variable, which would compile it into the browser bundle.

Run it again after any change. It exits non-zero on a real problem.

**Build-time settings.** Every `NEXT_PUBLIC_*` value — the Supabase URL and anon
key, the invitation-link URL, white-label branding and the SSO buttons — is
compiled into the app when the image is built. `docker-compose.yml` passes them
from `deploy/.env` to the build, and a blank one means "use the default". After
changing any of them, rebuild with `docker compose up -d --build`; a restart
alone keeps the old values. Server-side settings (`SUPABASE_SERVICE_ROLE_KEY`,
`ALLOW_PUBLIC_SIGNUP`, the `AI_*` variables) are read at run time, so a restart
is enough for those.

---

## A. Managed — Supabase Cloud

The fastest path, and the right one for a pilot.

1. Create a project at supabase.com. Choose a region in the jurisdiction your
   data needs to stay in — this is the decision that is annoying to reverse.
2. Project Settings → API: copy the project URL and the anon key into
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the
   service role key into `SUPABASE_SERVICE_ROLE_KEY`.
3. Project Settings → Database → Connection string → URI: copy into
   `DATABASE_URL`.
4. Apply the schema:

   ```bash
   set -a; source deploy/.env; set +a
   ./deploy/migrate.sh
   ```

5. Run the app anywhere that runs a container — or `npm run build && npm start`
   on any Node 22 host:

   ```bash
   cd deploy && docker compose up -d --build
   ```

**What you are accepting:** your ESG data lives in a third-party SaaS. For many
companies that is fine and already true of everything else they use. For a
legal or sustainability function that has been told data stays inside the
company, it is the thing that will end the conversation — go to B.

---

## B. Single VM — everything in your boundary

One Linux VM, 4 vCPU / 8 GB / 100 GB is comfortable for a mid-sized company.
Docker and Docker Compose v2 installed. Nothing leaves the network.

```bash
./deploy/selfhost.sh /opt/broc-supabase
```

That fetches a pinned release of Supabase's own self-hosting bundle, generates
the secrets, and prints the two steps it will not guess for you: the public
URLs, and the API keys (Supabase generates those with its own tooling, which
has changed across releases — the script points you at the right page for the
pinned version rather than inventing values that will be wrong).

Then:

```bash
cd /opt/broc-supabase && docker compose pull && sh run.sh start

# back in the BROC repo, once Postgres is accepting connections
DATABASE_URL='postgresql://postgres:<password>@localhost:5432/postgres' ./deploy/migrate.sh

cd deploy && ./preflight.sh && docker compose up -d --build
```

**Operational reality, stated plainly.** This is about a dozen containers. That
is Supabase's architecture, not BROC's, and it is the honest cost of the
managed conveniences — hosted auth, an auto-generated REST layer, a database UI.
Someone has to own:

- **Backups.** `pg_dump` on a schedule to somewhere off the VM. Untested
  backups are not backups; restore one into a scratch database quarterly.
- **TLS.** Put Caddy or nginx in front. Do not expose port 8000 to anything
  untrusted — it is the API gateway.
- **The secrets file.** `/opt/broc-supabase/.env` holds keys that encrypt
  stored data. Losing it loses the data.
- **Updates.** Pin, then move deliberately. `docker compose pull` against a
  floating tag at the wrong moment is how a Monday gets ruined.

If nobody owns those, choose A and accept the hosting instead. An unmaintained
self-hosted stack is worse than a managed one on every axis including privacy.

---

## C. Existing PostgreSQL

If you already run Postgres — RDS, Azure Database for PostgreSQL, Cloud SQL,
on-prem — you can point the schema at it:

```bash
DATABASE_URL='postgresql://...' ./deploy/migrate.sh
```

BROC still needs Supabase's auth and REST services in front of that database,
so you run the self-host bundle from B with its Postgres pointed at yours. The
migrations require PostgreSQL 15 or later and the `pgcrypto` and `uuid-ossp`
extensions.

This is also the path if you want to get rid of Supabase entirely later. The
schema, the RLS policies, and the migrations are plain PostgreSQL and carry
over unchanged; what would need rewriting is the query layer and auth.

---

## Migrations

`deploy/migrate.sh` applies each file in `supabase/migrations/` once, in
filename order, recording what it applied in a `schema_migrations` table.

```bash
./deploy/migrate.sh --dry-run   # what would run; writes nothing at all
./deploy/migrate.sh             # apply, then verify
./deploy/migrate.sh --verify    # re-run the verification only
```

Each migration runs in its own transaction together with its ledger row, so a
failure leaves the database exactly as it was — fix the cause and re-run;
what already applied is skipped. Verification is `supabase/verify_install.sql`,
which asserts the schema is actually shaped the way the application expects
rather than just that the migrations returned success.

---

## Users and sites

BROC is one deployment serving every location. Plants do not get their own
install — they get a URL and an account, and their data is scoped by the site
and business-unit structure you configure in Settings.

Consequently the per-location work is *provisioning*, not deployment. Today
that means creating users in Supabase Auth. Single sign-on against your
identity provider is the obvious next step and the thing to ask for if you are
rolling this out past a couple of dozen people.

---

## Air-gapped installs

BROC functions with no outbound network access. Two features degrade:

- **The AI regulatory watch** will not run. Leave `ANTHROPIC_API_KEY` and
  `OPENAI_API_KEY` unset and the regulatory tracker still works as a reference —
  it simply will not propose its own updates.
- **Supplier survey email** will not send. Leave `RESEND_API_KEY` unset and
  BROC shows the invitation text for sending by hand.

Nothing else calls out. Build the image on a connected machine, export it with
`docker save`, and load it on the target.
