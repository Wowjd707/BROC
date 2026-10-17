# CLAUDE.md — ESG Platform

Project conventions and guardrails. This file is the short, always-on rulebook;
`README.md` carries the full document map.

> Runtime strings resolve from `lib/branding.ts`, which is env-overridable so a
> deploying organization can white-label without forking; never hardcode a
> product name.

## Start here in a new session

**Read `docs/DECISIONS.md` first.** It carries what is built, migration status,
known limitations and — most importantly — the **standing decisions** that were
made deliberately and should not be quietly reversed (no fabricated emission
factors or regulatory content, Scope 3 never folded into the Scope 1+2 total,
empty filter scopes showing zeros rather than org-wide totals, metrics reporting
"missing" rather than 0, deactivation removing access, and others). Reversing
one of those silently reintroduces a reporting misstatement or a security hole.

`docs/INSTALL.md` is the clean-install path — the ordered migration sequence, the
verification script, and an explicit statement of what has and has not been
proven. Read it before changing anything about migrations or schema setup, and
keep its "what has actually been verified" section honest.

`docs/CUSTOMISING.md` maps which changes are data and which are code. The skills
in `.claude/skills/` walk through the common changes step by step — use the one
that matches the task.

Then `docs/ARCHITECTURE.md` for how it fits together and `docs/DATA_MODEL.md`
for the schema and data lineage.

## What this is

A self-hosted ESG / sustainability platform. The deploying organization hosts it
and its own team owns and changes the running software. Every architectural
decision should reduce vendor lock-in and keep the code readable, ownable, and
debuggable by a competent internal team. Documentation is part of the code, not
an afterthought.

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind v4
  - **Two bundlers, deliberately noted:** `npm run dev` runs `next dev --webpack`;
    `next build` uses Turbopack. They have diverged before (one CSS outage). If
    something renders in one and not the other, this is why. See `DECISIONS.md` §
    Environment notes.
- Supabase (Postgres + Auth + RLS + Edge Functions) — self-hostable; keep it that way
- shadcn-style UI in `components/ui` (Radix primitives) · `recharts` for charts · `resend` for email
- `lucide-react` icons · `date-fns` · `clsx` + `tailwind-merge` via `lib/utils.ts` `cn()`

## Architecture & file layout

- Routes live in `app/`. Route groups: `(auth)`, `(dashboard)`, plus public `survey/`.
- Pages are **Server Components** that fetch data; interactive UI lives in a sibling `*Client.tsx` Client Component. Follow this split — don't make whole pages client components.
- Business logic and pure functions go in `lib/` (`calculations.ts`, `conversions.ts`, `emission-factors.ts`, `cbam-data.ts`, `regulations/`). Keep calculation logic out of components.
- Reusable primitives in `components/ui`; shared layout in `components/layout`.

## Supabase & data rules

- Server-side data access uses `createServerClient()` from `lib/supabase/server.ts` (marked `server-only`). Browser uses `lib/supabase/client.ts`. Admin/Edge work uses `createServiceClient()` — **never** expose the service-role key to the client.
- **Every schema change is a new numbered migration** in `supabase/migrations/` (`00N_description.sql`). Never edit an applied migration. After schema changes, regenerate `lib/supabase/types.ts` and keep it in sync.
- **RLS is mandatory** on every tenant table. This is multi-tenant (`organization_id` scoping) — see `002_rls_policies.sql`. New tables ship with policies in the same PR.
- Postgres is `snake_case`; TypeScript is `camelCase`. UUID PKs (`gen_random_uuid()`), `TIMESTAMPTZ` timestamps, `is_active` soft-delete flags — match existing table style.

`docs/CUSTOMISING.md` is the map for an adopting team: which changes are data
(factors, regulatory content, business metrics) and which are code (fuels, waste
streams, units), with a worked example. This platform is meant to be forked and
owned rather than configured through a settings screen, so keep that document
accurate when you move an edit point.

## Regulatory content (non-negotiable)

`docs/REGULATORY_CONTENT.md` governs the tracker in `/regulations`. The short
version: every claim needs a cited source, a confidence rating and a
last-verified date, all enforced in the schema rather than by convention. Never
add or edit a tracked regime from model memory or from a single secondary
source — research it and cite the primary text. Regulatory status in this field
moved several times in 2026 alone, and a tracker that is confidently wrong is
worse for a user than no tracker at all.

## ESG domain rules (non-negotiable)

- **Auditability first.** Every reported number must trace to its source input, emission factor, and calculation. Never lose data lineage. Assume an external assurance provider will inspect it.
- **Never fabricate factors or regulatory rules.** Emission factors, GWP values, and framework requirements must carry a cited `factor_source` and `data_year` (see `scope1_emission_factors`). If unsure, mark it clearly and ask — don't invent numbers.
- **Config over hardcoding.** Factors, framework definitions, units, and regulatory rules should be data/config-driven so a deploying organization can update them without code changes.
- Use correct methodologies: GHG Protocol (Scope 1/2/3), and the actual requirements of TCFD, IFRS S1/S2, CSRD/ESRS, GRI, SASB, CDP, CBAM. The same underlying data should map to multiple framework outputs.

## Optional AI layer

Any embedded AI guidance must sit behind a **provider-agnostic interface**, be fully optional, and let the deploying organization wire its own model/keys. Never make core features hard-depend on a specific AI provider.

## Working style

- Explore before changing; propose a plan for large or cross-cutting work before building.
- Build in vertical slices: migration + data layer + API + UI + docs together, each slice complete.
- Keep type safety strict — no `any` escapes without justification. Don't break existing modules.
- Update the relevant docs/README when you add a module.

## Commands

- `npm run dev` — dev server (webpack, port 3000) · `npm run build` — prod build (Turbopack)
- `npm run lint` — eslint · `npm test` — Vitest (1,100+ tests, including RLS tests against an in-process Postgres) · `npm run test:watch` — watch mode
