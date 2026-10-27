# Architecture

This document explains how the platform is put together and why, so that a
competent internal team — and the AI assistant they work with — can read it and
own the codebase.

## Guiding principles

1. **Self-hostable, low lock-in.** The whole stack (Next.js + Postgres via
   Supabase) can run on infrastructure the deploying organization controls. Anything
   cloud-specific must be swappable and documented.
2. **Auditability first.** Every reported number traces to its source input,
   emission factor, and calculation. Data lineage is a schema-level concern, not
   a feature — see [`DATA_MODEL.md`](DATA_MODEL.md).
3. **Config over hardcoding.** Emission factors, framework rules, and units are
   data/config-driven where reasonable so deploying organizations can update them without code
   changes.
4. **Readable and ownable.** Clear module boundaries, strong typing, no clever
   magic.

## High-level shape

```
Browser (React 19 Client Components)
      │  supabase-js (anon key, RLS-enforced)
      ▼
Next.js 16 App Router  ──────────────────────────────┐
  • Server Components fetch data (server Supabase)    │
  • Route Handlers (/api/*) for privileged writes     │
  • Middleware refreshes the auth session             │
      │                        │                       │
      │ anon key + user JWT     │ service-role key      │
      ▼                        ▼                       │
Supabase Postgres  ◄── Row Level Security ──┐          │
  • tenant tables scoped by organization_id  │          │
  • reference tables (emission factors)      │          │
  • Edge Functions (Deno) for email  ◄───────┼──────────┘
                                             │
Resend (transactional email) ◄───────────────┘
```

## Rendering model

Pages are **Server Components** that run on the server, authenticate the user,
and fetch the data they need. Interactive UI lives in a sibling
`*Client.tsx` **Client Component** that receives the fetched data as props.

```
app/(dashboard)/goals/
  page.tsx          ← Server Component: auth + data fetch
  GoalsClient.tsx   ← Client Component: forms, charts, interactivity
  loading.tsx       ← Suspense fallback
```

Do not turn a whole page into a Client Component. Keep the server/client split —
it keeps secrets on the server, minimizes the JS shipped to the browser, and
makes data-fetching auditable.

## Supabase clients — three roles

All three live under `lib/supabase/`. Choosing the right one is a security
decision.

| Client | File | Key | Runs as | Use for |
| --- | --- | --- | --- | --- |
| Browser | `client.ts` | anon | the signed-in user (RLS enforced) | Client Component reads/writes |
| Server | `server.ts` → `createServerClient()` | anon + user cookie | the signed-in user (RLS enforced) | Server Component data fetch, `/api` reads |
| Service | `server.ts` → `createServiceClient()` | **service role** | superuser (RLS **bypassed**) | privileged server-only writes, public-survey access |

`server.ts` is marked `server-only`, so importing it into a Client Component is a
build error. **The service-role key must never reach the browser.** Because the
service client bypasses RLS, any route that uses it must do its own
authorization (see `/api/signup`, which verifies the caller before writing).

## Authentication & multi-tenancy

- Supabase Auth handles sign-up/sign-in. `proxy.ts` (the Next.js 16 rename of
  the `middleware` file convention) refreshes the session
  on every request and redirects unauthenticated users to `/login` (public
  routes: `/login`, `/signup`, `/survey/*`, `/invite/*`, `/auth/callback`,
  `/api/signup`, `/api/survey/*`). The two survey prefixes are what make the
  supplier survey work for someone holding a token rather than a session.
- Every application row belongs to an `organization`. **Row Level Security**
  scopes reads/writes to the caller's org via the `auth_org_id()` SQL helper,
  which resolves the current user's active organization — and resolves to
  nothing for a deactivated user (migration 037), which is what makes
  deactivation remove access rather than relabel it. Role checks
  (`admin`/`editor`/`viewer`) use `auth_user_role()`.
- This is the core tenant-isolation mechanism. New tenant tables **must** ship
  with RLS policies in the same migration (see
  [`DATA_MODEL.md`](DATA_MODEL.md) and `supabase/migrations/002_rls_policies.sql`).

## The calculation layer

All numeric business logic is pure functions in `lib/`, kept out of components
so it is unit-testable and auditable:

- `conversions.ts` — normalize raw activity data to base units (electricity →
  kWh, combustion → MMBtu, waste → kg, water → gallons). Nothing is stored
  without both the raw and normalized values.
- `calculations.ts` — the CO₂e engine (`calculateEmissionCO2e`), project savings
  estimators, and SBTi 1.5 °C target pathways.
- `emission-factors.ts` — server-side factor lookups against the reference
  tables (Scope 1 by fuel, Scope 2 by ZIP → eGRID → national for US sites or by
  country elsewhere, residual mix by country, refrigerant GWP). No built-in
  fallback numbers: a missing factor returns null and the entry is refused.
- `water-core.ts` — water withdrawal, discharge and consumption.
- `cbam-data.ts` — the CBAM goods catalogue (no default values) and the CBAM
  calculator.

These are covered by Vitest (`lib/*.test.ts`); run `npm test`.

### Where calculation happens (single authoritative path)

Emission and EHS entries are created **on the server**. The browser collects
raw activity data and POSTs it to `/api/entries/emission` or `/api/entries/ehs`;
the route calls `lib/entries.ts`, which performs the emission-factor lookup and
CO₂e calculation server-side and inserts the row under the caller's RLS session.
A client therefore cannot submit an arbitrary factor or CO₂e figure — only raw
activity data. The drawer still shows a client-side *preview* for UX, but the
stored value always comes from the server calculation.

### Bulk import

`/api/entries/import` accepts CSV text; `lib/import.ts` resolves site names to
ids and runs each row through the same `createEmissionEntry` path as manual
entry, so factor lookup, CO₂e calculation, RLS, and audit logging apply
identically. Import is best-effort per row: invalid rows are reported with their
line number and skipped, so a mostly-good file still lands with a precise error
list. CSV parsing (`lib/csv.ts`) and row mapping/validation (`lib/import-core.ts`)
are pure and unit-tested; a downloadable template comes from
`emissionImportTemplate()`.

### Custom emission factors

Org-scoped overrides of the built-in reference factors are entered one at a time
on **Environmental Data Entry → Emission Factors** (`/data/factors`), or loaded in bulk from
CSV (`lib/custom-factor-import.ts`,
pure mapping in `custom-factor-import-core.ts`). The importer derives the unit
from the factor category rather than trusting the file, and refuses any
`factor_key` that does not resolve to a known fuel, refrigerant or site — the two
ways a bulk load can otherwise produce a factor that is silently wrong or
silently never applied. See [`DATA_MODEL.md`](DATA_MODEL.md) for the effective-
dating rules and the uniqueness guarantee behind them.

### Scope 3 factor libraries

The platform deliberately ships **no** Scope 3 factor data. Those sets (EPA
Supply Chain / USEEIO, DEFRA, EPA WARM, ecoinvent) are large, revised annually,
and licensed on differing terms — bundling them would create both a licensing
problem and a staleness problem the deploying organization cannot fix without a code change.

Instead the deploying organization loads the library they are licensed for through
**Scope 3 → Factor library → Import factor library** (`/api/factors/scope3/import`).
Import is **all-or-nothing**: every row is validated first and nothing is written
unless all rows pass, because a half-loaded library silently produces entries
calculated against an incomplete reference. A cited `factor_source` and
`data_year` are mandatory on every row.

To load a set: export it to CSV with the columns in the downloadable template
(`category_number, method, activity_key, label, factor_value, activity_unit,
region, factor_source, data_year, effective_from, effective_to, notes`), set
`factor_source` to the published name and version of the set, and import.
Superseding a year's factors is done by importing the new vintage with a later
`effective_from` — historical entries keep the factor they were calculated with.

### Report assembly

`lib/report-builder.ts` assembles a submission-ready report from the disclosure
data and renders it as a **single self-contained HTML file** — no external
stylesheets, fonts, scripts, or images. That is a deliberate no-lock-in choice:
the file opens in any browser, prints to PDF natively, and can be archived as a
standalone artifact with no dependency on this application still existing. A
Word/PDF binary would mean a heavyweight dependency and a format the deploying organization
cannot diff or grep. (A test asserts the output contains no external references.)

A report for a framework whose requirements are linked to material topics
(CSRD, ESRS E1) also carries a **scope statement**: the assessment that scoped
it, the conclusion per topic, and every disclosure requirement omitted on
materiality grounds, named in full. ESRS 2 IRO-2 requires the undertaking to
state what it concluded is not material, and an omission the reader cannot see
is indistinguishable from a gap — so excluded requirements are listed, never
silently dropped. Report content is assembled from the underlying data rather
than from the on-screen list, so a UI filter can never change what a report
contains. Frameworks with no topic links (TCFD, IFRS S2, GRI, the California
statutes) get no scope statement and say explicitly that nothing was omitted.

Every report includes a generated **basis of preparation** appendix: reporting
boundary and standards applied, every distinct emission-factor source that fed
the figures, the Scope 3 data-quality mix, and a traceability statement. A
report whose numbers cannot be traced to their factors is not assurable, so this
is always generated rather than optional.

Narratives are user-authored, so all interpolated content is HTML-escaped.

### Audit trail

A generic `record_audit()` trigger writes every insert/update/delete on
`emission_entries`, `ehs_entries`, `goals`, and `projects` into `audit_log`,
capturing the acting user (`auth.uid()`), timestamp, and before/after row image.
Because it is a database trigger, it records changes regardless of code path —
even a direct SQL edit by an authenticated role. The log is append-only from the
application (read-only RLS policy, no update/delete), and exportable as CSV from
the Reports page for assurance review.

### Data-quality review

`/data/review` looks for the errors that do not announce themselves. A wrong
number looks wrong; a site that quietly stopped reporting in March just makes
the total look lower, and a "reduction" that is really a reporting gap is a
misstatement nobody catches until assurance.

`lib/anomaly-core.ts` is pure and tested; `lib/anomaly.ts` fetches a 24-month
window (so year-on-year has something to compare against) and runs the analysis
**server-side**, shipping only the findings. It needs no schema of its own — it
reads the entry tables that already exist.

Findings are review prompts, never verdicts. Each carries the numbers behind it
in `basis`, because the reviewer knows whether a 300% jump was a new production
line or a units error and the platform does not. Three choices matter:

- **Median and MAD, not mean and standard deviation.** One bad entry inflates a
  standard deviation enough to push its own z-score under the threshold — the
  masking problem, where the outlier hides behind the bar it raised.
- **`deviationFrom` handles MAD = 0.** MAD is zero whenever half the values are
  identical, which is common (a site metering the same figure monthly, a group
  of like-for-like warehouses). A plain robust z returns nothing there, so the
  extreme member of such a set would be silently passed over. It falls back to
  distance from the common value.
- **Too little history means silence, not a guess.** Below the minimum the
  answer is "not enough history" — the same principle as metrics reporting
  "missing" rather than 0. Likewise a cadence is inferred per stream, so a
  quarterly reporter is not flagged as late in month two.

What could *not* be checked is reported too: cross-site intensity needs a floor
area, and sites lacking one are listed as uncompared rather than passing
silently.

### Evidence attachments

Source documents attach to a record through `components/evidence/EvidencePanel.tsx`,
backed by a private Supabase Storage bucket that migration 019 creates — bucket,
limits and policies are all SQL, so a fresh deployment is reproducible from the
migrations alone with nothing to configure by hand.

Files go **browser → Storage directly**, under storage RLS, rather than through
a route handler. Proxying 25 MB scans through the application would burn memory
for nothing and breaks outright on hosts that cap request bodies well below
that. `/api/evidence` records the metadata afterwards and is where the check the
database cannot express is made: that the attachment points at a record which
actually exists in the caller's organization. If that call fails, the client
removes the object it just uploaded rather than leaving an unreferenced orphan.

Reads use a 60-second signed URL. Path building and file-name sanitization are
pure and unit-tested in `lib/evidence-core.ts` — the file name is
attacker-influenced input that becomes part of an object key, so it is treated
as such. See [`DATA_MODEL.md`](DATA_MODEL.md) for the immutability and audit
guarantees.

## Supplier surveys (public, unauthenticated flow)

Suppliers are external and have no account. The flow:

1. An internal user creates a survey (question set chosen from
   `lib/regulations/`) and invites a supplier. An invitation row gets a random
   `token`.
2. The `send-survey-email` Edge Function (Deno) looks the invitation up with the
   service role and emails a tokenized link via Resend.
3. The supplier opens `/survey/[token]` — a public page that reads the
   invitation **with the service client** (bypassing RLS, since the supplier is
   unauthenticated) and renders the question set.
4. Answers are saved/submitted through `/api/survey/save` and
   `/api/survey/submit`, again via the service client, keyed by the token.

Because unauthenticated access goes exclusively through the service role, there
are **no** permissive "anyone can read invitations" RLS policies — those were
removed in migration 006. The token is the capability.

## The optional AI layer

Fully optional and off by default. `AI_PROVIDER` unset means `getAiProvider()`
returns null, every affordance disappears, and nothing else changes — no core
feature has a code path through it.

**Provider-agnostic by a deliberately small interface** (`lib/ai/types.ts`):
system prompt, messages, token ceiling, text back. Adapters exist for Anthropic
Messages and OpenAI Chat Completions, the latter also covering Ollama, vLLM,
LM Studio, Azure and OpenRouter — so an organization who will not send sustainability
data to a third party points `AI_BASE_URL` at their own hardware and uses the
identical path. Raw `fetch`, no SDKs: each API is one JSON POST, and two vendor
SDKs would be supply-chain surface for no capability.

Two omissions in that interface are load-bearing:

- **No sampling parameters.** `temperature`/`top_p`/`top_k` are rejected with a
  400 by current Claude models while every OpenAI-shaped API accepts them. An
  interface carrying `temperature` would work against one provider and hard-fail
  against the other — precisely the divergence this layer exists to prevent.
- **No free-text prompt endpoint.** Callers name a task from a fixed catalogue
  (`lib/ai/tasks.ts`) and pass typed input; system prompts are constants. An
  endpoint forwarding arbitrary prompts on the deployment's key is a different
  product with a different risk profile.

**The model is never asked to recall a number.** The platform computes the
figures, passes them in, and asks for prose about them. And because a prompt is
not a guarantee, `lib/ai/grounding.ts` independently checks every draft: figures
in the output that do not appear in the supplied data are surfaced for review.
That check is honest about its limits — it cannot distinguish an invented figure
from a correctly derived one, so it says "verify", never "wrong".

Output is always a draft in an editor the user must review and save through the
normal path. The model cannot write to a reported figure.

## Two kinds of output

The distinction matters when reading the code, because the two are produced by
different paths:

| | **Data exports** | **Framework reports** |
| --- | --- | --- |
| Where | Reports page (`ReportsClient.tsx`) | Disclosures → `lib/report-builder.ts` |
| Format | CSV | Single self-contained HTML |
| Generated | Client-side from RLS-scoped queries | Server-side from disclosure data |
| Covers | GHG inventory, Scope 3 inventory, EHS performance, supplier responses, audit trail | TCFD, IFRS S2, ESRS E1, GRI 305, CSRD (full ESRS set), CA SB 253, CA SB 261 |

Both apply the same reporting scope as the screen that launched them — a CSV
that quietly contained every site would be worse than no export.

See [Report assembly](#report-assembly) above for how the HTML reports are built
and why they are self-contained, and [The optional AI layer](#the-optional-ai-layer)
for the AI interface constraints.

## Conventions that keep it ownable

- **Migrations are the source of truth for the schema.** Every change is a new
  numbered file in `supabase/migrations/`; never edit an applied migration.
  Regenerate `lib/supabase/types.ts` after each change.
- **Postgres is `snake_case`; TypeScript is `camelCase`.**
- **Strict typing**, no `any` escapes without justification.
- **Documentation is part of the code** — update these docs and per-module notes
  as modules are added or changed.
