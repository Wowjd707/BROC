# Security Policy

## Reporting a vulnerability

**Do not open a public issue.** Report it privately through the repository's
**Security → Report a vulnerability** form (GitHub private vulnerability
reporting).

Include what you found, how to reproduce it, and what an attacker gets. A proof
of concept helps but is not required — a clear description of the flaw is
enough.

Please give a reasonable window before public disclosure. If a flaw is serious
and a fix is not yet available, an advisory with a workaround will be published
so deployers can protect themselves in the meantime.

If you run your own fork, you are its maintainer: apply fixes from upstream, and
treat reports about your deployment under your own organization's process.

Anything touching the following should be treated as high severity:

- **Cross-organization data access.** One organization reading or writing
  another's rows, by any route.
- **Service-role key exposure.** Any path that puts it in a browser bundle, a
  client component, a log, or an error response.
- **Survey token scope.** A supplier survey token reaching anything beyond its
  own survey.
- **Evidence storage.** Unsigned or over-scoped reads of attachments.

## Supported versions

BROC has no release train yet. The `main` branch is what is supported. If you
are running a fork or an older commit, pull before reporting.

## Threat model

What BROC assumes, so you know where it is load-bearing and where it is not.

### Tenancy isolation is enforced in the database

Every tenant table carries `organization_id` and has row-level security on.
`SELECT` policies gate on `organization_id = auth_org_id()` and nothing else;
write policies additionally allowlist roles. The database will not return
another organization's rows regardless of what the application asks for.

This is deliberate and it is the property to protect. Application-layer
filtering is a defence in depth, not the boundary. **A pull request that adds a
tenant table without RLS is a security bug, not a style issue.**

Two specific rules that have caused real problems:

- Never put a role check in a `SELECT` policy. It breaks legitimate access in
  ways that take a day to diagnose, and it tempts the next person to work
  around RLS rather than fix the policy.
- Never reach for the service-role client to "just make this query work". That
  client bypasses RLS entirely. If a query needs it, the policy is wrong.

### The service-role key is the crown jewel

It bypasses row-level security completely. It must appear only in server-side
code, never in a `NEXT_PUBLIC_*` variable, a client component, or anything the
browser can reach.

`deploy/preflight.sh` fails a deployment where a `NEXT_PUBLIC_` variable holds
something named `SERVICE`, `SECRET`, or `PRIVATE`. That check is cheap and the
failure it prevents is total, so leave it in.

### Calculation happens server-side — in the application

Through the application, a client cannot submit an arbitrary emission factor.
Activity data goes in, `lib/entries.ts` is the single authoritative write path,
and the factor and its source are resolved and recorded server-side.

Be precise about what that does and does not cover. RLS lets an `editor` insert
and update entry rows, because `lib/entries.ts` writes with the user's own
session. So an editor who calls the Supabase API directly with their own token
*can* write a row whose `co2e_kg` was not calculated by BROC. What stops that
from being silent is the audit log: every insert and update on an entry table
is recorded by a database trigger, with the user and the before/after row,
whatever client made it. Treat editors as trusted to enter data, and the audit
log — plus the `auditor` role for your assurance provider — as the control on
what they entered.

### Public surveys are tokenized and narrow

Supplier surveys are reachable without an account at `/survey/[token]`. A token
grants access to one survey and nothing else. Treat any widening of that scope
as a serious finding.

The save and submit endpoints are the only unauthenticated writes in the
application, and they use the service role (no RLS policy can admit someone
holding a token rather than a session). Their input control is therefore
entirely in code: answers are accepted only for question ids that belong to
that survey, only as bounded-length text, and a submission must answer every
required question that is visible. See `lib/survey-answers-core.ts`.

### Sign-up closes after the first organization

`/signup` creates an organization and makes its creator the admin. By default
it does that exactly once — for the first account on the deployment — and then
refuses; everyone else joins by invitation from Settings → Team.

`ALLOW_PUBLIC_SIGNUP=true` reopens it for deployments that intentionally host
several unrelated organizations. Understand what that grants before setting
it. Tenant *data* stays isolated by RLS, but two things are deployment-wide:

- **Shared reference content.** Disclosure requirements and the regulatory
  tracker are the same rows for every organization. An admin of *any*
  organization can import requirements and approve regulatory-watch proposals,
  so on an open deployment a stranger's admin edits what your users read.
- **Your AI key and outbound requests.** Disclosure drafting and the
  regulatory watch run on the deployment's configured provider and network.

### Deactivating a user removes their access

Settings → Team → Deactivate sets `users.is_active = false`. Since migration
037 the RLS helpers resolve an inactive profile to no organization, so a
deactivated user can still authenticate with Supabase but reads and writes
nothing. Only an administrator can change `is_active`, and never on their own
row. (Before 037 the flag was not read anywhere — deactivation was cosmetic.
If you run an older build, also block the user in Supabase Auth.)

### Evidence attachments are private

Attachments live in private storage and are served through signed, expiring
reads. There is no public bucket.

### The AI layer cannot reach data on its own

The optional AI layer is off by default, provider-agnostic, and has a fixed
task catalogue with no free-text prompt endpoint. It is handed data by the
server; it does not fetch its own. No core feature has a code path through it,
and the regulatory watch may only *propose* changes — it cannot set confidence
ratings, verification dates, or sources, and every proposal requires human
review before it lands.

If you turn it on, you are sending the data in those tasks to whichever
provider you configured. That is your decision to make and your DPA to hold.

### Response headers

`next.config.ts` sets `X-Frame-Options: DENY`, a `frame-ancestors 'none'`
policy, `X-Content-Type-Options: nosniff`, a `Referrer-Policy` that never sends
a survey URL (and its token) to another site, and drops `X-Powered-By`. There
is no script-src Content-Security-Policy; add one at your reverse proxy if you
need it.

### What BROC does not defend against

Stated so nobody assumes otherwise:

- **A compromised Supabase project or host.** BROC's controls sit above the
  database. Someone with the database or the host has everything.
- **A malicious or careless administrator.** An `admin` can change the
  consolidation boundary, emission factors, and org structure. The audit log
  records it; nothing prevents it.
- **Denial of service.** No rate limiting beyond what your host and Supabase
  provide. Put a reverse proxy in front of an internet-facing deployment.
- **Correctness of what you enter.** The data-review tools surface anomalies as
  review prompts, never verdicts. BROC cannot tell you a meter was misread.

## Hardening a self-hosted deployment

Beyond `docs/DEPLOY.md`:

- **Terminate TLS in front of it.** Caddy or nginx. Never expose the Supabase
  API gateway (port 8000) to an untrusted network.
- **Protect the secrets file.** `/opt/broc-supabase/.env` holds keys that
  encrypt stored data. Mode 600, backed up somewhere real, and losing
  `VAULT_ENC_KEY` or `SECRET_KEY_BASE` means losing the data they protected.
- **Lock down Studio.** It is a full database client. Restrict it by network,
  not only by its dashboard password.
- **Back up, and test a restore.** An untested backup is not a backup. Restore
  into a scratch database quarterly.
- **Use the `auditor` role for assurance providers.** Migration 030 added it
  precisely so you do not hand an external auditor an `admin` account.
- **Rotate the service-role key** if it has ever been in a shell history, a
  chat message, a screenshot, or a CI log.

## Dependencies

BROC pins its dependencies in `package-lock.json`. There is no automated
scanning configured yet; running `npm audit --omit=dev` before a deployment is
worth the thirty seconds. If you find a vulnerable transitive dependency that
actually reaches exploitable code here, that is a valid report under this
policy.

Current state: `npm audit --omit=dev` reports no vulnerabilities. Next.js is
on 16.4.2, which closes the published 16.2.x advisories (several were
middleware/proxy bypasses, which matter here because `proxy.ts` is the login
redirect), and `package.json` overrides `exceljs`'s `uuid` dependency to a
patched release.

The full `npm audit` still reports one development-only chain:
`eslint-config-next` → `fast-glob` → `micromatch` → `braces`. No patched
`braces` release exists yet, and `npm audit fix --force` would "fix" it by
downgrading to a years-old eslint-config-next, so leave it. It runs only when
you lint your own source files, and nothing from it ships in the built
application or the Docker image.
