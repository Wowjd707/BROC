# Installing from a clean database

This is the whole install. Follow it top to bottom and you end with a working
database and a report that tells you so. It assumes no prior knowledge of the
project and needs nothing beyond this document.

Budget about 30 minutes.

---

## What you need first

| Requirement | Notes |
| --- | --- |
| A Supabase project | Cloud or self-hosted. Self-hosted is fully supported — nothing here depends on Supabase's managed platform. |
| PostgreSQL 15 or later | Supabase's default. Verified against 16. |
| Node.js 20+ and npm | For the application itself. |
| Access to the SQL editor | Or `psql` against the database. Both work; the SQL editor is the assumed path. |

You do **not** need the Supabase CLI. Migrations are applied by hand, which is
deliberate — see *Why there is no migration tool* at the end.

---

## Step 1 — Apply the migrations, in order

Open the SQL editor. For each file in `supabase/migrations/`, in **numeric
order**, paste the whole file and run it. Do not skip any, and do not reorder.

```
001_initial_schema.sql                 013_reference_table_rls.sql
002_rls_policies.sql                   014_csrd_california_frameworks.sql
003_seed_reference_data.sql            015_business_units_and_groups.sql
004_survey_responses_per_question.sql  016_materiality.sql
005_cbam_calculator.sql                017_requirement_topics.sql
006_survey_schema_reconciliation.sql   018_custom_factor_window_uniqueness.sql
007_goals_projects_reconciliation.sql  019_evidence_attachments.sql
008_audit_log.sql                      020_site_profile_and_equipment.sql
009_custom_emission_factors.sql        021_goal_metrics_and_project_savings.sql
010_scope3.sql                         022_custom_survey_questions.sql
011_disclosure_frameworks.sql          023_social_governance_metrics.sql
012_scope1_categories.sql              024_regulatory_tracker.sql
                                       025_regulatory_watch.sql
                                       026_regulatory_capabilities.sql
                                       027_business_metrics.sql
                                       028_consolidation_boundary.sql
                                       029_entry_data_quality.sql
                                       030_auditor_role.sql
                                       031_sso.sql
                                       032_sandbox.sql
                                       033_regulatory_frameworks.sql
                                       035_staged_imports.sql
                                       036_custom_regulation_name.sql
                                       037_release_hardening.sql
                                       038_reference_factor_corrections.sql
                                       039_scope2_hierarchy_and_outside_scopes.sql
```

There is no 034; the numbering gap is intentional.

### The one thing that matters here

**001–007 run exactly once.** They are not re-runnable. 006 renames and drops
columns, so a second run fails or does damage. If one of them errors halfway,
do not re-run it — go to *If something fails* below.

**008–039 are re-runnable, with one exception.** They use `IF NOT EXISTS`,
`DROP … IF EXISTS` and `ON CONFLICT`, so re-running one is safe and is the
correct fix for a script that half-applied. This has been verified, not just
intended — see *What has actually been verified* below.

**The exception is 024, once 033 has been applied.** 033 re-categorised the
regulatory tracker (category now means domain, not geography) and tightened the
CHECK constraint to match; 024's upsert would write the old categories back, so
the constraint refuses it. Nothing is damaged — the whole of 024 rolls back —
but you will see an `ERROR`. If you need to re-seed the tracker on a database
that already has 033, re-run 033 instead, then reload your content pack.

A `NOTICE: … does not exist, skipping` is normal and expected on a first run.
It is not an error. Only `ERROR` matters.

---

## Step 2 — Verify the install

Run `supabase/verify_install.sql` in the SQL editor.

It is read-only and safe to run at any time. You get one row per check, failures
first. **All thirty must read PASS before you go any further.** Each failure
names the migration to re-apply.

The checks worth understanding:

- **RLS enabled with no policy.** The most dangerous state this database can be
  in, and the reason this script exists. A table with row-level security on and
  no policy returns *zero rows with no error and nothing in the logs*. The
  application renders empty pages and there is no way to diagnose it from the
  front end. Supabase's own security advisor will offer to enable RLS on a table
  for you — accepting that prompt without adding a policy is how you get here.
- **Every tenant table has RLS enabled.** The inverse failure, and worse: a
  table carrying `organization_id` without RLS leaks one organization's data to
  another. If this fails, stop and re-apply `002` before doing anything else.
- **Reference data seeded.** Emission factors, the fifteen Scope 3 categories,
  the disclosure framework catalog, and the sustainability metric catalog. A
  zero here means the app will load but no calculation can resolve a factor.

---

## Step 3 — Configure and run the application

```bash
cp .env.example .env.local         # then fill in the values below
npm install
npm run dev                        # http://localhost:3000
```

From your Supabase project settings:

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project settings → API → anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Project settings → API → service_role key |

The service-role key is server-side only. It bypasses RLS entirely, so it must
never reach the browser — it has no `NEXT_PUBLIC_` prefix for that reason, and
adding one would expose every tenant's data to every visitor.

`.env.example` documents the optional settings (sign-up policy, branding, SSO,
the AI layer). All of them are optional; the app runs without any of them.

**Sign-up closes after the first account.** The first person to sign up
creates the organization and becomes its admin; from then on `/signup` is
closed and colleagues join by invitation from Settings → Team. Set
`ALLOW_PUBLIC_SIGNUP=true` only for a deployment meant to host several
unrelated organizations — see `SECURITY.md` for what that exposes.

---

## Step 4 — Create the first organization and user

1. Go to `/signup` and create an account. The first signup creates the
   organization and makes that user its admin, and closes sign-up behind it.
   Invite everyone else from Settings → Team.
2. Add at least one site under Settings. Nothing can be entered without a site.
3. Enter one Scope 1 or Scope 2 record under Environmental Data Entry.
4. Open Reports and generate the inventory report.

If a number appears in that report and traces back to your entry, the install is
good. That is the acceptance test.

---

## If something fails

**An `ERROR` in 008 or later.** Read it, fix the cause, re-run the whole file. These
are re-runnable by design; a partially applied script is expected to be able to
finish on a second run.

**An `ERROR` in 001–007.** These are single-shot, so a half-applied one leaves
the database in a state no script expects. On a database with no data worth
keeping, the fastest and safest fix is to reset the project and start from 001.
On a database with real data, stop and get help rather than improvising — this
is the one situation in the install where guessing is expensive.

**018 refuses to apply.** This is legitimate, not a bug. It adds a uniqueness
guarantee to custom emission factors, so it will refuse if the database already
holds two factors claiming overlapping effective windows — which is genuinely
ambiguous data that must be resolved by a human, not by a script picking one.
Its error message contains the diagnostic query that finds the offending rows.

**Empty pages, no errors, everything looks installed.** Almost always RLS on
with no policy. Run `verify_install.sql`; check 2 finds it.

---

## What has actually been verified, and what has not

Stated precisely, because an install guide that overstates its testing is worse
than one that admits a gap.

**Verified offline.** Migrations 001–037 (there is no 034) apply in order to a
virgin **PostgreSQL 17.5** database with `supabase/pg_harness.sql` loaded first,
and 008–037 then re-apply cleanly, with the single exception of 024 described
under *The one thing that matters here*. Migrations 038 and 039 were then
verified on **PostgreSQL 16.15**: 001–039 apply in order through
`deploy/migrate.sh`, 038 and 039 re-apply cleanly, 039's backfill of rows saved
before it behaves as documented, and all thirty-two checks in
`verify_install.sql` pass.

`supabase/pg_harness.sql` stands in for the Supabase platform objects the
migrations touch — `auth.uid()`, `auth.users`, `storage.buckets`,
`storage.objects`, and the `anon` / `authenticated` / `service_role` roles — so
you can reproduce that verification on any machine without a Supabase account.

`npm test` also applies 001–039 to an empty in-process Postgres (PGlite) on
every run and exercises the RLS policies against it: tenancy, practice mode,
deactivation, the audit trail and evidence record types (`tests/*.test.ts`).

**Not verified offline.** Because auth and storage are stand-ins in both of
those, the DDL, ordering, re-runnability, seed data and RLS logic are proven,
but **Supabase-specific runtime behaviour is not** — in particular storage
bucket policies, real JWTs, the invite email flow and SSO. Run section 7 of
`docs/TESTING.md` on your own Supabase project to cover those.

---

## Why there is no migration tool

You apply these by hand, and there is no bookkeeping table tracking which have
run. That is a choice, not an omission.

You own this database. A migration runner would put a tool between you and your
own schema, and when it disagreed with reality you would be debugging the tool
instead of the database. Every migration from 008 on is written so that running
it again is safe, which is the property a bookkeeping table would have been
protecting — obtained here without the tool.

The cost is that you must apply them in order and know where you are. This
document and `verify_install.sql` are how you know.
