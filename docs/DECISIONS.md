# Design Decisions & Working State

What is built, the decisions behind it, and the known limits. Read this before
changing behaviour — especially the **standing decisions**, which exist because
reversing any one of them silently reintroduces a wrong number or a security
hole.

---

## Migration status

Migrations **001–039** are in `supabase/migrations/` (there is no 034). Apply in
order. `docs/INSTALL.md` is the step-by-step; `supabase/verify_install.sql`
proves the result.

| Range | Re-runnable? |
| --- | --- |
| 001–007 | **No** — apply once on a fresh database. 006 renames and drops columns. |
| 008–039 | **Yes**, except 024 once 033 is applied (033 re-categorised the tracker; see INSTALL.md). Verified on PostgreSQL 17.5: 001–037 apply clean and 008–037 re-apply with only that exception failing. Verified on PostgreSQL 16.15: 001–039 apply clean, 038 and 039 re-apply, and all 32 checks in `verify_install.sql` pass. |

018 is the one migration that can legitimately refuse to apply: it adds a
uniqueness guarantee, so a database already holding ambiguous duplicate factor
windows must resolve them first. Its error message carries the diagnostic query.

Write every new migration to be re-runnable: migrations are often applied by
hand in the Supabase SQL editor, where there is no bookkeeping, so a
half-applied script must be able to finish on a second run.

---

## Built

| Area | State |
| --- | --- |
| Scope 1 & 2 accounting | Server-side calculation (single authoritative path), full lineage per entry, dual location/market-based Scope 2, GHG Protocol source categories (stationary/mobile/process/fugitive) |
| Scope 3 | All 15 categories, org-scoped factor library (ships empty), supplier declarations feeding Category 1, supplier data-quality scoring |
| Emission factors | Global reference tables (EPA/eGRID/IPCC) + org-scoped, effective-dated custom overrides, entered singly or bulk-loaded from CSV |
| Water / waste | Entry, normalization, diversion rate, broken-out recycling streams |
| Site profile | Water withdrawal source, wastewater discharge, natural-gas and utility identification, headcount and operating hours, backup generation — plus a per-site equipment inventory (chillers, boilers, compressors, production machines) with refrigerant charge for fugitive screening |
| Goals & projects | Targets across GHG, water and waste; SBTi 1.5 °C pathways (GHG only); pipeline pro-rated by in-service date and denominated per metric; gap-to-target on all three |
| Suppliers | Registry, tokenized public surveys (CBAM/EUDR/PFAS/general), CBAM calculator |
| Disclosures | TCFD, IFRS S2, ESRS E1, GRI 305, CSRD (all ESRS standards), CA SB 253, CA SB 261 — with metric auto-answering and assembled HTML report export |
| Materiality | Double materiality per ESRS 1 §3, matrix, stakeholder divergence, and topic → disclosure-requirement gating (a CSRD report demands only the topics assessed as material, and names every omission) |
| Org structure | Business-unit hierarchy (cycle-guarded), many-to-many site groups, URL-driven scope filtering across all modules |
| Auditability | Trigger-based append-only audit log (including sites and the organization's consolidation approach since 037), CSV export, basis-of-preparation appendix on reports, evidence attachments on every figure-bearing record — entries, factors, disclosures, suppliers, sites, goals, projects, business metric values and materiality assessments (private storage, signed reads) |
| Data review | `/data/review` — silent sites, reporting gaps against each stream's own cadence, MoM/YoY variance, robust outliers, cross-site intensity comparison, duplicates. Grouped by business unit, CSV export. No schema of its own |
| Imports | Activity data CSV, Scope 3 factor library CSV, custom emission factor CSV, disclosure requirement CSV |
| AI (optional) | Off by default. Provider-agnostic — Claude, OpenAI, or any OpenAI-shaped endpoint incl. self-hosted. Fixed task catalogue, no free-text prompt endpoint, drafts checked for figures absent from the supplied data |
| Social & governance | Safety (hours worked, recordable/lost-time/restricted-duty cases, lost days, high-consequence injuries, fatalities, near misses), workforce (headcount, hires, voluntary/involuntary separations), training, and governance (board composition, confirmed corruption incidents, grievance channel reports, anti-corruption training) — on `ehs_entries`, with a seeded metric catalog carrying each metric's canonical unit and aggregation rule. Rates (TRIR, DART, LTIR, severity, turnover, board independence) are **derived at read time, never stored**, and carry their hours basis. Entity-level metrics store with a null site. |
| Regulatory tracker | 21 seeded regimes across GHG accounting standards, EU and US, each carrying stage, status, key points, next milestone, confidence rating, cited sources and a last-verified date. Confidence is capped as an entry ages, so "confirmed five months ago" cannot present as "confirmed". An item with no source is rejected by a CHECK constraint, not by convention. |
| Organizational boundary | GHG Protocol consolidation approaches — equity share, financial control, operational control — with per-site ownership percentage and control flag. A 50% joint venture contributes half under equity share and nothing under a control approach it falls outside. Applied identically by the report, the dashboard and the KPI page, so the views cannot drift. |
| Intensity denominators | Org-defined business metrics — revenue, FTE, production volume, units shipped, room-nights, whatever the business runs on — used as the divisor for reported intensity. Falls back to floor area when nothing is chosen. |
| Data quality | measured / calculated / estimated on Scope 1, 2 and EHS entries, with the estimation method required by CHECK when estimated. Lets a close proceed on a gap-filled site without the estimate becoming indistinguishable from a meter read, and lets the estimated share be disclosed — weighted by emissions, not row count. |
| Roles | admin, editor, viewer and auditor. Auditor is read-only by construction: every SELECT policy gates on organization alone and every write policy allowlists admin and editor. |
| Regulatory capability map | Each tracked regime linked to the platform features that serve it, with readiness computed from the organization's own data — site coverage, questionnaires sent and answered, Scope 3 categories, framework coverage, evidence, targets. Deterministic and model-free, so it works with the AI layer off. Records absence as a first-class answer: `not_built` (EUDR plot geolocation, EU Taxonomy, land-sector accounting) and `no_action` (the stayed SEC rule). Surfaces the single biggest gap per regime with a link into the feature that closes it. |
| Regulatory watch | Change detection over every tracked source: fetch, normalise, hash, compare. Detection is deterministic and model-free, so a run with no changes makes no model calls at all. Where a source genuinely changed, an optional AI task summarises **the diff it was handed** — never what a regulation now requires. Output is a review queue; nothing reaches `regulatory_items` without a human approving it, and the reviewer sets the confidence themselves while `last_verified` is stamped on approval. A patch may not carry `confidence`, `last_verified`, `sources` or `code` — enforced by CHECK constraint, not convention. Failed fetches are a first-class outcome and never read as "unchanged". |
| Quality | Strict TypeScript; `npm test` runs the unit suites and RLS tests that apply every migration to an in-process Postgres. |

---

## Known limitations

- **ESRS datapoint-level detail.** Migration 017 links requirements to material
  topics, but CSRD topics E2–E5, S1–S4 and G1 are seeded at standard level only
  (see standing decisions). Load disclosure-requirement detail through the
  requirement importer with `topic_codes` set to get a genuinely scoped ESRS
  statement. Requirements imported without `topic_codes` stay ungated — safe,
  but not scoped.
- **Factor files must match the template.** The custom-factor CSV importer is
  all-or-nothing with the unit derived from the category. There is no
  column-mapping UI for an arbitrary publisher workbook; use `factor-packs/`
  to convert one into the template.
- **US-centric defaults.** The seeded reference factors are US (eGRID, ZIP
  codes, gallons/MMBtu) plus AIB residual mixes for ten European countries.
  International factor sets (DEFRA, IEA and others) are loaded by you through
  the custom-factor importer, under their own licences — see `docs/FACTORS.md`.
  A site outside the US cannot record electricity until it has a grid factor.
- **Methodology gaps an adopting team may need to close.** One `is_controlled`
  flag serves both control approaches, and joint control is not modelled
  (financial control should take a jointly controlled operation at its equity
  share). Energy is stated on HHV; ESRS readers usually expect NCV, and the
  E1-5 fossil/nuclear/renewable split is not computed. Intensity goals are not
  computable until a goal stores its numerator and denominator. Mobile
  combustion uses stationary CH₄/N₂O factors per MMBtu (EPA publishes mobile
  ones per mile). Water storage change is taken as zero.
- **Pre-039 Scope 2 rows.** Entries saved before migration 039 carry
  `scope2_market_basis = 'legacy'`; some market-based ones used an unsourced
  0.455 kg/kWh default. Re-save them (docs/FACTORS.md has the query).
- **Report output** is self-contained HTML (prints to PDF). ESRS XBRL tagging,
  required for an actual CSRD filing, is not built.
- **Regulatory frameworks, crosswalk and glossary start empty.** Migration 033
  creates the tables; fill them through `regulatory-packs/` or by hand, under
  the rules in `docs/REGULATORY_CONTENT.md`.
- **AI tasks.** One task is wired: drafting disclosure narratives. More can be
  added by writing a fixed system prompt in `lib/ai/tasks.ts` with typed input;
  there is deliberately no generic prompt endpoint to extend instead. The
  OpenAI adapter sends `max_completion_tokens` for provider `openai` and
  `max_tokens` for `openai-compatible`; a mismatch with your endpoint surfaces
  the provider's own error verbatim.

---

## Standing decisions

These were made deliberately. Each one prevents a reporting misstatement or a
security hole, so do not reverse one quietly — if your organization needs it
changed, change it knowingly and update this list.

- **No fabricated factors or regulatory content.** Scope 3 factor libraries and
  SASB/CDP content ship empty because they are licensed and revised annually.
  Demo factors are labelled `DEMO DATA — not for reporting`. Nor do CBAM
  default values or a certificate price ship. The calculation engine has no
  built-in fallback factor: a missing factor refuses the entry with a message
  saying what to add, because a hard-coded number drifts from the table it
  claims to mirror (the 0.386 and 0.455 that once did both matched nothing).
- **Every Scope 2 row carries both figures.** `co2e_kg` is market-based on a
  Scope 2 row (contract → residual mix → grid average, recorded in
  `scope2_market_basis` and disclosed); `co2e_kg_location_based` is
  location-based. Electricity generated and used on site is zero under both;
  purchased heat uses the supplier's factor, never a grid factor.
- **Biogenic CO₂ and Montreal Protocol gases are reported outside the scopes**
  (`co2e_kg_outside_scopes`), so every total that sums `co2e_kg` excludes them
  without a filter. GHG Protocol Corporate Standard ch. 4 and 9.
- **Water consumption is withdrawal minus discharge**, and every "water use"
  view reads withdrawal (`lib/water-core.ts`). A new water source type must be
  classified there or it is left out of every total.
- **No filing deadlines stored** for the California frameworks. SB 253's
  first-year deadline has been re-noticed by CARB; SB 261 is under a Ninth
  Circuit injunction. The catalog records *what*, not *when*.
- **CSRD topics E2–E5/S1–S4/G1 seeded at standard level only.** ESRS runs to
  ~1,000 datapoints; asserting DR codes from memory in a compliance tool is
  worse than leaving them to be loaded via the requirement importer.
- **Scope 3 is never folded into "Total Scope 1 + 2"** or into goal progress.
  Goals are defined on the operational boundary; silently changing that number
  would misstate progress against existing targets.
- **A scope filter that matches nothing shows zeros**, never org-wide totals.
  `null` (no filter) and `[]` (matches nothing) are kept distinct throughout.
- **Stakeholder ratings are never blended into materiality scores.** Blending
  would make it impossible to show which drove a conclusion.
- **An invitation is never marked `sent` until the mailer confirms it.**
  `supabase.functions.invoke()` resolves with `{ error }` instead of throwing,
  so a `try/catch` around it catches nothing. `sent_at`, `last_reminded_at` and
  `reminder_count` are now written by the `send-survey-email` edge function
  only, after Resend accepts the message. A failed send stays `pending`: the
  status is the record of whether a supplier was actually asked, and an
  unanswered survey and an unsent one are different findings in an audit.
- **Regulatory question sets stay in code; only bespoke ones live in the
  database.** `supplier_survey_questions` (022) backs `regulation_type =
  'custom'`. CBAM/EUDR/PFAS question sets remain in `lib/regulations/` so
  regulatory content cannot be reworded per tenant.
- **The materiality gate never shrinks an obligation by default.** No
  assessment for the year, an unlinked requirement, or a linked topic nobody
  has assessed all leave the requirement *required*. Only "assessed and
  concluded immaterial" excludes anything, an all-zero score row counts as
  unassessed rather than as zero, and the gating assessment is matched on the
  reporting year so a newer one cannot re-scope a filed year. Excluded
  requirements are listed in the report as explicit omissions (ESRS 2 IRO-2),
  never dropped silently.
- **Metrics report "missing" rather than 0** when no data exists. A disclosure
  reading 0 when it means "not measured" is a misstatement.
- **A blank site-profile answer is `NULL`, never `FALSE` or `0`.** "Not
  recorded" and "no" are different claims. A site defaulted to
  `uses_natural_gas = FALSE` looks deliberately excluded from stationary
  combustion when nobody actually looked, and data review cannot then test the
  assertion against the entries.
- **Equipment nameplate capacity is never converted to kW.** Tons of
  refrigeration → kW needs an efficiency assumption, and a chiller's "tons" and
  a press's "tons" are different physical quantities entirely. Connected load
  sums only equipment with a stated `rated_power_kw` and reports how many items
  were excluded, rather than estimating and quietly understating the unknown.
- **Goal baselines and targets are stored in each metric's canonical entry
  unit** (kg CO₂e, US gallons, kg), so a goal and a summed total need no
  conversion between them. `base_year_emissions_kg` stays as the GHG-only
  predecessor, written in step for GHG goals and left `NULL` for water and
  waste, where populating it would be a unit lie.
- **SBTi and net-zero targets are GHG-only.** The 1.5 °C pathway's 4.2 %/yr
  (of base-year emissions, linear — not compounded) is defined on greenhouse
  gases. Applying it to a water volume would fabricate a
  methodology under a name an assurance provider recognises, so no target is
  derived at all rather than a plausible-looking wrong one.
- **Goal progress is delivered reduction over required reduction**, never
  current-over-target. A 1,000 → 600 t goal is 25 % done at 900 t, not 150 %.
  One implementation in `lib/goal-metrics.ts` serves both the Goals page and the
  dashboard, so the two can never disagree about the same target. A GHG goal is
  measured on its own scope (`scope1`, `scope2`, `scope1_2`) and Scope 2
  method, with the consolidation boundary applied as in the report.
- **`pipeline_inclusion_status = 'excluded'` keeps a project out of the
  pipeline**; the project form sets it ("Reduction pipeline"). Ideas and
  cancelled projects never count whatever it says.
- **A project with no saving for a metric counts as zero, not as excluded** from
  that pipeline. The project count and the savings total answer different
  questions, and dropping it would hide that its water saving was never
  estimated.
- **A factor's unit is derived from its category, never read from an import
  file.** MMBtu vs kWh is a ~293× error, so a contradicting unit fails the
  import rather than being silently corrected. Likewise an import key that
  resolves to no known fuel, refrigerant or site is rejected — such a factor
  would sit in the table looking applied while entries silently used the
  reference factor.
- **AI is additive, never load-bearing, and never near a number.** Off by
  default; no core feature has a code path through it. The model is given
  platform-computed figures rather than asked to recall any, output is always a
  draft the user must review and save, and there is no free-text prompt
  endpoint — callers name a task whose system prompt is a constant. Drafts are
  independently checked for figures absent from the supplied data, and that
  check says "verify" rather than "wrong" because it cannot tell a fabrication
  from a correct derivation.
- **The AI interface carries no sampling parameters.** `temperature` and friends
  are rejected by current Claude models and accepted by OpenAI-shaped ones;
  putting them in the shared interface would make it work against one provider
  and fail against the other.
- **The data review never asserts an error.** Findings are prompts carrying the
  numbers behind them, because whether a 300% jump is a new production line or a
  units error is the reviewer's call. Statistics use median/MAD so one bad entry
  cannot mask itself, `deviationFrom` covers the MAD-zero case rather than
  silently scoring `null`, and a stream with too little history is reported as
  such instead of scored on noise.
- **Evidence cannot be silently substituted or silently removed.** Storage
  objects have no UPDATE policy, an attachment row's identity columns are
  immutable via a column-level grant, and deletions land in `audit_log`. A file
  can be removed — a wrong upload must be — but never without a surviving record
  that it existed.
- **Reference tables carry explicit RLS + a read policy.** Relying on RLS being
  *disabled* plus a bare GRANT leaves them one dashboard click from returning
  zero rows with no error (see migration 013).
- **Deactivation removes access.** The RLS helpers resolve an inactive profile
  to no organization (037). Do not add a code path that reads `users` to decide
  access without also honouring `is_active`.
- **Sign-up closes after the first organization** unless `ALLOW_PUBLIC_SIGNUP`
  is set. Disclosure requirements and the regulatory tracker are shared across
  every organization on a deployment and any org admin can edit them, so an
  open signup hands strangers write access to what your users read
  (`lib/signup-core.ts`, SECURITY.md).
- **A client-side write checks its result.** Supabase reports an RLS-filtered
  UPDATE or DELETE as success with zero rows. Every delete/archive/role change
  in the UI uses `.select()` and treats zero rows as a refusal — otherwise the
  screen shows a change the database never made.
- **Hard-deleting a record that can carry evidence must release it.** Call
  `releaseEvidence()` (`components/evidence/release-evidence.ts`) after the
  delete succeeds, as Projects, Suppliers and Emission Factors do; otherwise the
  documents stay in storage, unlinked, and `verify_install.sql` check 30 fails.
- **Evidence uploads are scoped to the active organization**, via
  `evidenceOrganizationId()` in `lib/evidence.ts`. Never pass
  `users.organization_id` to the evidence panel.

---

## Environment notes

- `npm run dev` uses `next dev --webpack`; `next build` uses Turbopack. The two
  bundlers can behave differently (this has caused a CSS-only breakage before).
  If something renders in one and not the other, look here first.
- A stray `package-lock.json` in a parent directory makes Next infer the wrong
  workspace root; `next.config.ts` pins it via `turbopack.root` and
  `outputFileTracingRoot`.
- In a cloud-synced folder (OneDrive, Dropbox), deleting `.next` while a dev
  server runs, or building during a sync, produces transient `EPERM`/`EBUSY`
  failures. Retry rather than debugging the build. If line endings flip to
  CRLF, `.gitattributes` plus `git add --renormalize .` fixes it.
