# Data Model

The database is the system of record and the backbone of auditability. This
document describes the schema, the multi-tenant security model, and — most
importantly — how every reported number traces back to its source.

**Source of truth:** the numbered SQL files in `supabase/migrations/`. The
generated `lib/supabase/types.ts` mirrors them for TypeScript. This doc explains
intent; the migrations are authoritative.

## Conventions

- UUID primary keys (`gen_random_uuid()`), `TIMESTAMPTZ` timestamps.
- `snake_case` in Postgres, `camelCase` in TypeScript.
- Soft deletes via `deleted_at` (entries) or `is_active` (master data).
- Every tenant table carries `organization_id` and is protected by RLS.

## Tenancy & Row Level Security

Every application row belongs to an `organization`. RLS policies
(`002_rls_policies.sql`) restrict every read and write to the caller's own org
using two `SECURITY DEFINER` helpers:

- `auth_org_id()` → the current user's `organization_id`
- `auth_user_role()` → the current user's role (`admin` / `editor` / `viewer`)

Typical policy shape:

```sql
-- read: same org
USING (organization_id = auth_org_id())
-- write: same org AND sufficient role
WITH CHECK (organization_id = auth_org_id() AND auth_user_role() IN ('admin','editor'))
```

Roles: **admin** manages the org, team, and sites and can delete; **editor** can
create/update data; **viewer** is read-only.

### Reference tables

Global reference data — emission factors, Scope 3 categories, the disclosure
framework catalog — is readable by every tenant and writable by none through the
API. Since migration 013 this is **stated explicitly**: RLS enabled, with a
`FOR SELECT TO authenticated USING (true)` policy and no write policies.

Do not leave a public-schema table with RLS disabled and rely on grants alone.
Supabase raises a security warning for such tables, and enabling RLS from that
prompt leaves the table with RLS on and **no policies** — which makes reads
return **zero rows with no error**. The application renders an empty page and
nothing in the logs explains why. Migration 013 exists because exactly that
happened to the disclosure catalog.

Since migration 007, tenant tables the browser inserts into default
`organization_id` to `auth_org_id()` (and `created_by` to `auth.uid()`), so
client inserts satisfy both the NOT NULL constraint and the RLS `WITH CHECK`
without the form having to thread the org id through.

## Entity map

```
organizations ─┬─ users (admin/editor/viewer)
               ├─ sites ─────────────── site_equipment
               ├─ emission_entries ──── site
               ├─ ehs_entries ───────── site        (water / waste)
               ├─ goals ─────────────── projects    (ghg / water / waste)
               ├─ suppliers
               ├─ supplier_surveys ─┬── supplier_survey_invitations ─┬─ supplier_survey_question_responses
               │                     │                                └─ supplier_survey_responses (legacy JSONB)
               │                     └── supplier_survey_questions (bespoke question set)
               ├─ cbam_supplier_factors
               └─ cbam_calculations

reference (global, read-only):
  scope1_emission_factors · scope2_emission_factors · refrigerant_factors
```

## Core tables

### `organizations`
Tenant root. Holds `reporting_year_start` (fiscal-year start month, drives all
reporting-period math in `lib/utils.ts`) and `base_year` for targets.

### `users`
App profile linked 1:1 to a Supabase auth user by `id`. Carries
`organization_id` and `role`.

### `sites`
Physical locations (office, manufacturing, warehouse, data center). `zip_code`
drives Scope 2 electricity factor selection; `floor_area_sqft` drives intensity
KPIs.

Migration 020 added a **sustainability profile**: `water_source` and
`wastewater_discharge` (withdrawal-by-source is required by CDP Water, ESRS E3
and GRI 303), `uses_natural_gas`, `electric_utility` / `natural_gas_utility`,
`employee_count` and `operating_hours_per_week` (per-FTE intensity
denominators), and the backup-generator group (`has_backup_generators`,
`backup_generator_count` / `_fuel` / `_kw` — standby generation is Scope 1
stationary combustion).

**Every profile column is nullable with no default, and that is load-bearing.**
`NULL` means *not recorded*; only an explicit `FALSE` asserts an absence. A site
defaulted to `uses_natural_gas = FALSE` would look deliberately excluded from
stationary combustion when in fact nobody had looked, and data review could not
tell the two apart.

### `site_equipment`
Basic asset register of what consumes energy at a site — chillers, boilers,
compressors, CNC machines, gensets. Deliberately shallow: this is not a CMMS.

`rated_power_kw` is the normalised electrical draw and the only column any load
calculation should read. `rated_capacity` / `capacity_unit` hold the domain
nameplate (tons of refrigeration, HP, BTU/hr) and are **never converted** —
a chiller's "tons" and a press's "tons" are different physical quantities.
`connectedLoadKw()` in `lib/site-equipment.ts` sums only equipment with a stated
kW and reports how many items lacked one, rather than estimating from nameplate
capacity: that conversion needs an efficiency assumption, and inventing one
would put a fabricated number on a sustainability dashboard.

`refrigerant_code` / `refrigerant_charge_kg` feed fugitive-emission screening.
The code is matched against `refrigerant_factors` by the application with no FK —
an organization may hold a blend the reference table does not carry yet, and losing
the record is worse than an unmatched code.

Soft-deleted via `is_active`, like sites: equipment that was on the floor during
a reported year stays retrievable for assurance.

## Carbon accounting & lineage

### `emission_entries` — the auditability centerpiece

Every Scope 1/2 entry stores **the full derivation**, not just the result, so an
external assurance provider can reconstruct the number:

| Column | Role in the lineage |
| --- | --- |
| `quantity`, `unit` | the **raw** activity data as entered |
| `quantity_normalized`, `unit_normalized` | normalized to a base unit (kWh / MMBtu / kg) |
| `emission_factor_used` | the exact factor applied |
| `emission_factor_source` | provenance of that factor (e.g. `EPA_2024`, `eGRID2023`, `IPCC_AR6`) |
| `co2e_kg` | the reported figure (market-based when applicable) |
| `co2e_kg_location_based` | always populated, for GHG Protocol dual reporting |
| `accounting_method`, `instrument_type`, `supplier_emission_factor` | Scope 2 market-based detail (REC/PPA/green tariff) |
| `created_by`, `created_at` | who and when |

The chain is: **raw input → normalized quantity → factor (with source) → CO₂e**,
all persisted on the row. `deleted_at` soft-deletes; reports exclude
soft-deleted rows.

### `ehs_entries`
Water and waste, same raw + normalized pattern (`metric_type` in
`water`/`waste`). Waste hazard class and disposal method are encoded in
`source_type` (e.g. `hazardous_incinerated`, `non_hazardous_recycled`).

### Reference factor tables (global, cited)

Factors are **data, not code**, and every row cites its source and year —
never fabricated:

- `scope1_emission_factors` — kg CO₂e per MMBtu by fuel (EPA 2024).
- `scope2_emission_factors` — kg CO₂e per kWh. `factor_type` electricity
  (location-based) or residual_mix (market-based); `geographic_scope` ZIP →
  eGRID subregion → country → national. Lookup priority lives in
  `emission-factors.ts`.
- `refrigerant_factors` — 100-year GWP per refrigerant (IPCC AR6).

### `custom_emission_factors` (org overrides)
Lets an org replace a global reference factor with its own measured or
supplier-specific value without a code change. Keyed by `factor_category`
(`scope1` → fuel_type, `scope2_location` → site_id, `refrigerant` →
refrigerant_code) and versioned by `[effective_from, effective_to)` so a
historical entry uses the factor in force on its activity date. Every row
requires a cited `factor_source` and `data_year`, same as the reference tables,
and changes are captured in `audit_log`. Resolution: `lib/custom-factors.ts`
(`getCustomFactor`) is checked before the global tables in `lib/entries.ts`; the
date-window selection is the pure, tested `pickEffectiveFactor` in
`lib/custom-factors-core.ts`.

**Bulk loading.** A whole vintage is loaded through **Emission Factors → Import
factors** (`/api/factors/custom/import`), all-or-nothing, same as the Scope 3
library import. Two guards are specific to this table:

- **The unit is derived from the category, never read from the file.** MMBtu and
  kWh differ by ~293×, so a Scope 1 factor labelled kWh is not a cosmetic error.
  A stated unit is accepted only as confirmation; a contradiction fails the row.
- **`factor_key` must resolve.** Fuel types and refrigerant codes are matched
  against the reference tables and `scope2_location` takes a **site name**
  (the stored key is the site id — nobody types UUIDs into a CSV). Matching
  folds case and separators, so `Natural Gas` finds `natural_gas`, but the
  canonical value always comes back from the database and an unresolvable key is
  a hard error: a factor keyed to something the platform does not recognise sits
  in the table looking applied while every entry silently uses the reference
  factor.

Superseding a vintage is an import with a later `effective_from`; existing rows
are never modified, so entries already calculated keep their factors. Migration
018 adds a partial unique index on `(organization_id, factor_category,
factor_key, effective_from) WHERE is_active`, because two active windows opening
on the *same* date make `pickEffectiveFactor`'s tie-break fall out of row order —
the same database could then report different numbers on different days.
Overlapping windows with *different* start dates stay legal; that is the
supersession workflow.

### `evidence_attachments` — the source documents

Lineage answers *how* a figure was derived; evidence answers *what it came
from*. This table holds the utility bill, meter reading or supplier certificate
behind a record, so an assurance provider asking to see the invoice has an
answer inside the platform.

Attached polymorphically by `(record_type, record_id)` with no foreign key — the
same shape `audit_log` uses — so one mechanism serves every record type instead
of eleven near-identical tables. The database cannot enforce a polymorphic
reference, so `/api/evidence` verifies the target exists in the caller's
organization before writing a row.

The record types (CHECK constraint `evidence_attachments_record_type_allowed`,
mirrored by `EVIDENCE_RECORD_TYPES` in `lib/evidence-core.ts`, and pinned
against each other by a test):

| `record_type` | Table | Where it is attached in the UI |
| --- | --- | --- |
| `emission_entry` | `emission_entries` | Environmental Data Entry |
| `ehs_entry` | `ehs_entries` | Environmental Data Entry (water, waste) and Social & Governance |
| `scope3_entry` | `scope3_entries` | Scope 3 |
| `custom_emission_factor` | `custom_emission_factors` | Emission Factors |
| `disclosure_response` | `disclosure_responses` | Disclosures |
| `supplier` | `suppliers` | Suppliers |
| `site` | `sites` | Settings → Sites (ownership, floor area and ZIP change reported figures) |
| `goal` | `goals` | Goal detail page (count shown on the Goals list) |
| `project` | `projects` | Projects, board and list views |
| `business_metric_value` | `business_metric_values` | Business Metrics |
| `materiality_assessment` | `materiality_assessments` | Materiality, on the assessment summary |

The last five were added by migration 037.

**Deleting a record removes its documents.** Because there is no foreign key,
a hard delete (a project, a supplier, a custom factor) cannot cascade. The UI
calls `POST /api/evidence/orphans` with the record after it is deleted, which
removes the attachment rows (each removal lands in `audit_log`) and then their
files; it refuses while the record still exists, so it cannot strip evidence
from a live figure. Anything left behind — a delete made directly in SQL, say —
is caught by `verify_install.sql` check 30 and removed by Settings →
Organization → **Remove unlinked documents** (admin only). Soft-deleted entries
keep their documents, since the record still exists. Resetting the practice
workspace removes its files before the sandbox organization is deleted.

The upload path is built from the **active** organization id (see
`evidenceOrganizationId` in `lib/evidence.ts`), because storage RLS compares the
first path segment against `auth_org_id()`. Building it from the home
organization made every upload fail in practice mode until October 2026.

Bytes live in a **private** `evidence` storage bucket created by migration 019,
laid out as `{organization_id}/{record_type}/{record_id}/{uuid}-{file}`. The
organization id leads deliberately: storage RLS enforces tenant isolation as a
prefix comparison, exactly as `auth_org_id()` scopes every other table. Reads go
through a 60-second signed URL rather than a public object.

Three properties are deliberate:

- **No UPDATE policy on `storage.objects`.** Overwriting an object in place
  would leave the attachment row — name, size, uploader, timestamp — describing
  bytes that are no longer there, with nothing recording the substitution.
  Replacing evidence means delete + re-upload, and both events land in the audit
  log.
- **An attachment's identity is immutable.** A column-level grant allows only
  `description` to be updated; an UPDATE touching `storage_path`, `file_name`,
  `size_bytes` or `uploaded_by` fails outright rather than quietly rewriting
  what a filed report cited.
- **Deletion is audited, not soft.** Removing evidence is the act that most
  needs a trace, so the full row image goes to `audit_log` on delete. The file
  itself is removed — someone who uploaded the wrong document needs it gone —
  but the record that it existed and was removed, by whom, survives.

File names are attacker-influenced input that becomes part of an object key, so
`lib/evidence-core.ts` sanitizes them: directory components are dropped
structurally (only the last path segment survives, which is what defeats
traversal), and control characters and bidirectional overrides — the trick that
makes `invoice<U+202E>fdp.exe` render as `invoice exe.pdf` — are stripped. Unicode
letters are kept, since mangling accented filenames would be a daily annoyance
in the European market this is built for. The sanitized name is what gets stored
*and* displayed, so the name in the UI always denotes the bytes in the path.

### `audit_log`
Append-only change history. A generic `record_audit()` trigger records every
insert/update/delete on `emission_entries`, `ehs_entries`, `goals`, and
`projects`, storing `user_id` (`auth.uid()`), `table_name`, `record_id`,
`action`, and a `changes` JSON (the row for insert/delete; `{old, new}` for
update). Org members can read their org's history (RLS); nothing may update or
delete it. Exportable as CSV from Reports. Because it is enforced by a database
trigger, it captures changes made by any client — or directly in SQL.

### `import_batches` / `import_batch_rows` / `import_row_adjustments`
Staged imports (035). An upload lands in a **batch** that nobody has committed:
each CSV line becomes a **row** holding both `raw` (the file as received, never
updated) and `resolved` (what it currently says), and every change between the
two is an **adjustment** carrying the field, the old and new value, why, and who
made it.

`origin` separates `auto` (proposed by `lib/import-cascade-core.ts`, not yet
judged by a person) from `user` (a named human chose it), and a `user`
adjustment must name its user — a `CHECK` enforces it. That distinction is the
reason the table exists: a scope the machine set and nobody confirmed is a
different kind of number from one a person approved.

This does not duplicate `audit_log`. That records the resulting INSERT once a
row is committed; by then the file's value, the system's proposal and the
reviewer's decision have collapsed into one number. These tables keep the three
apart, which is what an assurance provider asks about.

Adjustments are append-only, enforced the same way `audit_log` is: SELECT and
INSERT policies exist and UPDATE and DELETE deliberately do not. `raw` never
changes after insert, so `resolved` minus `raw` is always explained by the
adjustment rows — that invariant is the whole design.

`created_entry_table` names where a committed row landed (`emission_entries` or
`ehs_entries`). It is deliberately not a foreign key: emissions and the
non-carbon families live in different tables and one column cannot reference
both, so `verify_install.sql` checks it instead.

## Scope 3 (value chain)

### `scope3_categories`
The 15 categories of the GHG Protocol Corporate Value Chain (Scope 3) Standard,
seeded as definitional reference data (1–8 upstream, 9–15 downstream) with each
category's typical calculation methods for UI guidance.

### `scope3_factors` — the factor library
**Ships empty, by design.** Scope 3 factor sets (EPA Supply Chain / USEEIO
spend-based factors, DEFRA travel and freight factors, EPA WARM waste factors,
ecoinvent) are large, revised annually, and carry differing licence terms, so
the platform does not bundle them. Each organization loads the library it is
licensed for, via CSV import. Rows are org-scoped and effective-dated, and a
cited `factor_source` and `data_year` are **required** — the same rule as the
Scope 1/2 reference tables, so no reported number traces back to an uncited
value. Keyed by `category_number` + `method` + `activity_key` (a NAICS code,
travel mode, waste type, material — whatever the chosen library keys on) with
an `activity_unit` denominator.

### `scope3_entries`
Activity data plus full lineage. The factor actually applied is **denormalized
onto the entry** (`factor_value`, `factor_unit`, `factor_source`,
`factor_data_year`) as well as referenced by `factor_id`: a library row can be
superseded later, but a reported figure must stay reproducible exactly as
filed. `data_quality` (`primary` / `secondary` / `estimated`) records whether
the number rests on supplier-specific, industry-average, or spend-based data —
required for assurance and for prioritising supplier engagement. Soft-deleted
via `deleted_at`; changes captured in `audit_log`.

The engine (`lib/scope3.ts`) is pure and tested. Its central guard is
**unit-family compatibility**: applying a per-USD factor to a mass, or a
per-tonne factor to a distance, is a hard error rather than a silently wrong
number.

## Disclosure frameworks

Frameworks and their requirements are **data, not code**, so an organization can
amend them as standards are revised without touching the application.

- `disclosure_frameworks` — the standards, each with issuer and a `source_ref`
  citation for its requirement structure.
- `disclosure_requirements` — individual disclosures, grouped by `section`
  (pillar/topic), with a `response_type` (narrative / metric / both) and an
  optional `metric_key` naming the platform metric that can satisfy it.
- `disclosure_responses` — the org's narrative and status per requirement per
  reporting year (`not_started` / `in_progress` / `complete` / `not_material`),
  RLS-scoped and audit-logged.

**Seeded:** TCFD (11 recommended disclosures across 4 pillars), IFRS S2 (core
content areas), ESRS E1 (E1-1…E1-9), GRI 305 (305-1…305-7), CSRD (all ESRS
standards plus full ESRS 2 detail), California SB 253 and SB 261 — published,
definitional structures, each cited to its issuing standard or statute.

**Seeded only to standard level:** CSRD topics E2–E5, S1–S4 and G1. ESRS runs
to roughly a thousand datapoints; asserting them from memory in a compliance
tool is worse than leaving them to be loaded deliberately. Use the requirement
import to add DR-level detail.

**Deliberately not seeded:** SASB (industry-specific) and CDP (questionnaire
revised annually). Their content is industry- or year-dependent; inventing it
would be worse than leaving it to be loaded.

**No filing deadlines are stored.** The California frameworks in particular are
in flux — SB 253's first-year deadline has been re-noticed by CARB and SB 261 is
subject to a Ninth Circuit injunction. The catalog records *what* must be
disclosed; *when* must be confirmed against current rulemaking.

### Extending the catalog

`/api/frameworks/requirements/import` takes a CSV of requirements
(`framework_code, requirement_code, section, title, description, response_type,
metric_key, sort_order, topic_codes`) and upserts on framework + requirement code, so
re-importing a corrected file amends in place rather than duplicating — the
normal way to apply a standard's revision. Validation is all-or-nothing, and a
`metric_key` must name a metric the resolver actually computes; a requirement
typed `metric` with no key is rejected, since it could never be answered from
data. `topic_codes` (semicolon-separated, since commas are the CSV delimiter)
sets the materiality links: **blank leaves existing links untouched** — so a
file written before the column existed cannot un-scope a framework — and the
literal `none` clears them. Every referenced topic must exist, since a link to a
topic nobody assesses would strand the requirement as permanently undetermined.
Catalog writes are **admin-only** and go through the service role, because
these tables are shared reference data with no tenant scoping to fall back on.

### Materiality → disclosure linkage

`requirement_topics` (migration 017) maps a disclosure requirement to the
material topic(s) it belongs to, which is what lets a CSRD report demand only
the topics the undertaking assessed as material. Global reference data, seeded
by resolving the requirements' natural key (framework + requirement code)
rather than hard-coded ids.

The gate is deliberately conservative in every direction that could otherwise
delete an obligation:

- **A requirement with no link is unconditional.** ESRS 2 (BP-*/GOV-*/SBM-*/
  IRO-*) applies whatever the assessment concludes, and TCFD, IFRS S2, GRI and
  the California statutes are not scoped by an ESRS assessment at all — none of
  them is linked, so none is gated.
- **No assessment for the reporting year → nothing is gated.** An organization
  that has not assessed has not concluded anything is immaterial.
- **The gating assessment is matched on the reporting year**, not "the most
  recent" — a newer assessment must not retroactively re-scope a filed year.
  Finalised beats draft; between equals, most recently updated
  (`pickGatingAssessment`).
- **A linked topic that was never assessed leaves the requirement required**,
  flagged as undetermined. "Not yet assessed" is not a conclusion of
  immateriality, and an all-zero `topic_assessments` row is treated as
  unassessed rather than as a score of zero (`isAssessed`).
- **Only when every linked topic was assessed and found immaterial** is a
  requirement excluded — and it is still named in the exported report under
  "Disclosure requirements omitted as not material", per ESRS 2 IRO-2. An
  omission the reader cannot see is indistinguishable from a gap.
- **Requirements loaded by CSV import are ungated unless `topic_codes` is
  supplied.** Over-demanding is visible; a silently dropped disclosure is not.

Logic lives in the pure, tested `lib/materiality-linkage-core.ts`.

The mapping layer is `lib/disclosure-metrics-core.ts`: `resolveMetric()` turns a
`metric_key` into a value from the inventory, so **one** query pass answers
every framework. It reports `missing: true` rather than `0` when the platform
holds no data — a disclosure that says 0 when it means "not measured" is a
misstatement. `coveragePercent()` excludes `not_material` requirements from the
denominator, since deliberately scoping something out is a reporting decision,
not a gap.

## Double materiality

CSRD's gating step — it determines which ESRS topics must be reported at all.

- `material_topics` — the ESRS sub-topic catalog (E1–E5, S1–S4, G1), global
  reference data.
- `materiality_assessments` — one per org per reporting year, carrying the
  `threshold` and a `methodology` narrative. The threshold is stored per
  assessment, not as a platform constant, because it is a judgement the
  undertaking must be able to state and defend.
- `topic_assessments` — the two dimensions per topic: impact (scale, scope,
  irremediability, likelihood, actual/potential, negative/positive) and
  financial (magnitude, likelihood).
- `stakeholder_ratings` — kept **separate** from the organization's own scores.
  Blending them would make it impossible to show which drove a conclusion, and
  ESRS expects stakeholder input to be evidenced.

Scoring is the pure, tested `lib/materiality-core.ts`, following ESRS 1 §3:
severity averages scale/scope/irremediability, with irremediability excluded
for positive impacts (it is not a meaningful measure of a benefit); actual
impacts are not discounted by likelihood since they have already occurred. A
topic is material if **either** dimension crosses the threshold — requiring
both would silently drop topics an undertaking is obliged to report.

The assessment is not a standalone exercise: it **scopes the disclosure
catalog** through `requirement_topics` — see
[Materiality → disclosure linkage](#materiality--disclosure-linkage) above.

## Targets & initiatives

### `goals`
Reduction targets: `absolute` / `intensity` / `net_zero` / `sbti_15c`. Holds the
base year, target year, and a flexible `target_value` / `target_unit` pair.
SBTi 1.5 °C pathways are computed in `calculations.ts` (4.2 %/yr compound).

Migration 021 added **`metric`** (`ghg` / `water` / `waste`) and
**`base_year_value`**. Baselines and targets are stored in the metric family's
canonical unit — the *same* unit the entry tables normalise to (kg CO₂e, US
gallons, kg) — so a goal and a summed entry total are directly comparable with
no conversion step that could drift.

`base_year_emissions_kg` remains as the GHG-only predecessor column that reports
still read. For `metric = 'ghg'` the application writes both in step and they
must agree; for water and waste it is left `NULL`, where populating it would be
a unit lie. `goalBaseline()` in `lib/goal-metrics.ts` reads the general column
first and falls back to the legacy one, so goals created before 021 resolve.

**`net_zero` and `sbti_15c` are offered for GHG only.** The 1.5 °C pathway is
defined on greenhouse gases; applying its 4.2 %/yr to a water volume would be a
fabricated methodology wearing a credible name, so `goalTargetValue()` returns
`null` rather than deriving one.

Progress is *delivered reduction over required reduction*, not
current-over-target: a goal to cut 1,000 t to 600 t is 25 % done at 900 t, not
150 %. `lib/goal-metrics.ts` holds the single definition, called by both the
Goals page and the dashboard so the two cannot disagree about one target.

### `projects`
Reduction initiatives, optionally linked to a `goal` and `site`. Estimated and
actual annual reductions (`*_per_year`), cost, payback, and
`pipeline_inclusion_status` (excluded / forecasted / realized) for pipeline
roll-ups.

Migration 021 added water (`*_water_reduction_gal_per_year`) and waste
(`*_waste_reduction_kg_per_year`) savings alongside CO₂e. A project frequently
delivers against more than one metric — a cooling retrofit cuts both kWh and
make-up water — and recording only carbon left the water and waste pipelines
permanently empty. `summarisePipeline(…, { metric })` in `lib/pipeline.ts`
selects the column pair; a project with no figure for the requested metric
contributes zero but is **not dropped**, since "this project has no estimated
water saving" is itself a data gap worth seeing.

> Migration 007 added `*_per_year` reduction columns and start/completion dates,
> superseding the earlier `estimated_co2e_reduction_kg` /
> `actual_completion_date` columns, which are retained (commented `DEPRECATED`)
> until nothing reads them.

## Supply chain

### `suppliers`
Registry: contact, country, `industry`, `spend_usd`, `tier`.

### Surveys
- `supplier_surveys` — a disclosure campaign with a `title`, `regulation_type`
  (cbam / eudr / pfas / general_carbon / custom), status, and due date. The
  question set for the four regulatory types is defined in code
  (`lib/regulations/`); `custom` draws its questions from the table below.
- `supplier_survey_questions` *(migration 022)* — bespoke question definitions,
  one row per question, mirroring the `SurveyQuestion` interface in
  `lib/regulations/index.ts` so built-in and bespoke sets render through one
  path. `question_key` is the join to `..._question_responses.question_id` and
  is written once at creation — renaming it would orphan submitted answers, so
  the builder never updates it. RLS is scoped through the parent survey rather
  than a copied `organization_id`, which cannot drift out of sync.
  **Regulatory question sets stay in TypeScript on purpose:** they encode CBAM /
  EUDR / PFAS requirements that must not vary per tenant.
- `supplier_survey_invitations` — one row per invited supplier, with a random
  `token` (the capability for the public survey link), `email`/`supplier_name`
  (so ad-hoc invites need no supplier record — `supplier_id` is nullable), and
  status (pending → sent → viewed → submitted). `sent_at`, `last_reminded_at`
  *(migration 022)* and `reminder_count` are written **only by the
  `send-survey-email` edge function, after the provider accepts the message** —
  never optimistically by the browser. An invitation whose email failed stays
  `pending`, because the status is the record of whether the supplier was
  actually asked.
- `supplier_survey_question_responses` — normalized one-row-per-answer store the
  public survey API writes to (`invitation_id` + `question_id` unique).
  `question_id` is bare TEXT with no foreign key so answers from built-in sets
  (`q3_co2e_intensity`) and bespoke ones share one table. Answers whose question
  was later deleted are kept and shown as orphaned, never dropped.
- `supplier_survey_responses` — the original single-JSONB-blob response table,
  kept for the demo seed; the per-question table above is what the app uses.

**Public access:** unauthenticated supplier access happens exclusively through
the service role (the `/survey/[token]` page and `/api/survey/*` routes). The
permissive `USING (true)` invitation-read and response-insert policies were
**removed in migration 006** — they leaked every org's invitation tokens to any
authenticated user. The token is the only capability a supplier needs.

### CBAM
- `cbam_supplier_factors` — supplier-declared emission factors that override EU
  defaults, with `factor_source` provenance.
- `cbam_calculations` — saved CBAM cost estimates (commodity, CN code, quantity,
  factor + `factor_type` eu_default/supplier_provided, total tCO₂e, certificate
  price, estimated cost). EU default factors themselves live in `cbam-data.ts`
  (Reg. (EU) 2023/1773 Annex III).

## Migration history

| # | What |
| --- | --- |
| 001 | Initial schema (orgs, users, sites, entries, goals, projects, suppliers, surveys, reference factor tables) |
| 002 | Row Level Security policies + `auth_org_id()` / `auth_user_role()` helpers |
| 003 | Seed reference data (EPA Scope 1, eGRID Scope 2, IPCC refrigerant GWPs) |
| 004 | Per-question survey response table |
| 005 | CBAM calculator tables |
| 006 | Survey-schema reconciliation (surveys `title`/`notes`, invitation `email`/`supplier_name`, supplier `industry`/`spend_usd`/`notes`) **and removal of two over-permissive RLS policies** |
| 007 | Goals/projects reconciliation (`target_value`/`scope`/`*_per_year` columns) and `organization_id`/`created_by` insert defaults |
| 008 | `audit_log` table + generic `record_audit()` trigger on emission_entries/ehs_entries/goals/projects (append-only change history) |
| 009 | `custom_emission_factors` — org-scoped, effective-date-versioned factor overrides (cited source required) |
| 010 | Scope 3: `scope3_categories` (15 GHG Protocol categories), `scope3_factors` (org-scoped importable library), `scope3_entries` (activity data + lineage + data quality) |
| 011 | Disclosure frameworks: `disclosure_frameworks`, `disclosure_requirements` (config-driven, cited), `disclosure_responses` (org narrative + status per year). Seeds TCFD, IFRS S2, ESRS E1, GRI 305 |
| 012 | `emission_entries.scope1_category` — GHG Protocol Scope 1 source categorisation |
| 013 | Explicit RLS + authenticated read policy on every global reference table |
| 014 | CSRD (full ESRS standard set + ESRS 2 detail), California SB 253 and SB 261 |
| 015 | `business_units` (single-parent hierarchy, cycle-guarded), `site_groups` + `site_group_members` (many-to-many), `sites.business_unit_id` |
| 016 | Double materiality: `material_topics`, `materiality_assessments`, `topic_assessments`, `stakeholder_ratings` |
| 017 | `requirement_topics` — maps disclosure requirements to material topics, so a CSRD report demands only the topics assessed as material |
| 018 | Partial unique index on active custom-factor windows — makes an order-dependent factor tie unrepresentable |
| 019 | `evidence_attachments` + the private `evidence` storage bucket and its RLS policies — source documents behind a reported figure |
| 020 | Site sustainability profile (water source, natural gas, utilities, headcount, backup generators — all nullable so "not recorded" stays distinct from "no") + `site_equipment` asset register with RLS and audit trigger |
| 021 | `goals.metric` (`ghg`/`water`/`waste`) + `goals.base_year_value`; project water and waste savings columns — targets and reduction pipelines for all three metrics |
| 022 | `supplier_survey_questions` — bespoke question definitions backing `regulation_type = 'custom'`; `supplier_survey_invitations.last_reminded_at`. Regulatory question sets (CBAM/EUDR/PFAS) stay in `lib/regulations/` |
| 023–036 (no 034) | See each file's header: social and governance metrics, the regulatory tracker and watch, business metrics, the consolidation boundary, data quality, the auditor role, SSO, the sandbox, regulatory frameworks, staged imports, custom regulation names |
| 037 | Release hardening: RLS helpers resolve a deactivated user to no organization; only an admin may change `is_active`, never on themselves; `record_audit()` skips rows whose organization is being deleted (fixes sandbox reset); audit triggers on `sites` and `organizations`; `SET search_path` on every SECURITY DEFINER helper; evidence record types widened to sites, goals, projects, business metric values and materiality assessments |

## Applying migrations

Run the numbered files in `supabase/migrations/` **in order**. Deploying organizations apply
these by hand (Supabase SQL editor or `psql`), where there is no migration
bookkeeping table — so from 008 onward the migrations are written to be
**safely re-runnable**: `CREATE TABLE/INDEX IF NOT EXISTS`, `DROP … IF EXISTS`
before each trigger and policy, and `ON CONFLICT DO NOTHING` on seed inserts.
A partially-applied script therefore completes on a second run instead of
dead-ending on `relation … already exists`.

Migrations 001–007 predate that convention and are **not** re-runnable; 006 in
particular renames and drops columns. Apply those exactly once, on a fresh
database.

## Rules for changing the schema

0. **Write new migrations to be re-runnable** (see above) — the deploying organization, not a
   CI pipeline, is the one applying them.
1. **New numbered migration for every change.** Never edit an applied migration.
2. **New tenant tables ship with RLS policies in the same migration.**
3. **Regenerate `lib/supabase/types.ts`** (`supabase gen types typescript`)
   after every change and keep it in sync.
4. **Preserve lineage.** Never store a computed number without also storing the
   inputs, factor, and factor source it came from.
5. **Never fabricate factors or regulatory rules.** Cite `factor_source` and
   `data_year`; if unsure, mark it and ask.
