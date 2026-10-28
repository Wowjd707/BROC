# Making this yours

This platform ships with default assumptions: US fuels, US grid factors, a
general set of waste streams. Yours will differ, and the answer is not a
settings screen — **you own this code**, so you change it.

A configuration UI can only offer the choices somebody anticipated. A codebase
you can read lets you add the waste stream your plant actually generates, the
denominator your board actually asks for, and the fuel nobody else burns — and
the change is reviewable and versioned like any other.

This document is the map of where to edit.

---

## The two shapes of customisation

**Data.** Emission factors, regulatory content, business metrics, disclosure
requirements, the capability map. Change these with SQL or a CSV import. No
release, no deploy, and they survive every upgrade you pull.

**Code.** Vocabularies — the fuels, waste streams and metric families the entry
forms offer. Change these by editing TypeScript. They are code because each one
has calculation behaviour attached, and pretending otherwise would let someone
add a fuel with no heating value or a waste stream nothing knows how to classify.

If you can do it as data, do it as data.

---

## Where the edit points are

| What you want to change | Where | Shape |
| --- | --- | --- |
| Emission factors, any vintage | `/data/factors` CSV import, or `custom_emission_factors` | Data |
| Regulatory tracker content | `regulatory_items` / `regulatory_frameworks`, see `REGULATORY_CONTENT.md` | Data |
| How two regimes interact | `regulatory_relationships` (migration 033) | Data |
| Tracker glossary and acronyms | `regulatory_glossary` (migration 033) | Data |
| A whole tracker export | `regulatory-packs/build.py` + a mapping | Data |
| Which features serve which regime | `regulatory_capabilities` (migration 026) | Data |
| Business metrics and intensity denominators | `business_metrics` (migration 027) | Data |
| Disclosure requirements | Requirement importer CSV | Data |
| Consolidation approach, ownership | `organizations`, `sites` (migration 028) | Data |
| Product name and mark | `lib/branding.ts`, env-overridable | Data |
| Site grid, residual-mix and heat/steam factors | Emission factors page, per site (`scope2_location`, `scope2_residual`, `scope2_heat`) | Data |
| **Waste streams** | `WasteDrawer.tsx` + `source-labels.ts` | Code |
| **Water sources** | `WaterDrawer.tsx` + `water-core.ts` (withdrawal, discharge or recycled) | Code |
| **Fuels and Scope 1 sources** | `EmissionDrawer.tsx` + `conversions.ts` (heating values) + factors | Code |
| **Social & governance metrics** | Migration 023 + `social-metrics-core.ts` | Both |
| **Units** | `lib/conversions.ts`, `lib/units.ts` | Code |
| **What your AI assistant knows** | `.claude/skills/` | Code |

---

## Worked example: adding a waste stream

Say you generate spent solvent and want it tracked and counted as diverted.

**1. Offer it on the form** — `app/(dashboard)/data/WasteDrawer.tsx`:

```ts
{ value: 'hazardous_solvent_recovered', label: 'Solvent — recovered' },
```

**2. Give it a display name** — `lib/source-labels.ts`, in `SOURCE_LABELS`:

```ts
hazardous_solvent_recovered: 'Solvent — recovered',
```

**3. Decide whether it counts as diverted** — same file, `DIVERTED_WASTE_SOURCES`.
Solvent sent for recovery is diverted from disposal, so add it. Solvent
incinerated without energy recovery is not.

**4. Add a test.** `lib/source-labels.test.ts` pins the classifiers against the
exact strings the drawers write. That file exists because three separate
calculations once tested against invented vocabularies — `'recycled'`,
`'composted'`, `'waste_to_energy'` — that this platform has never stored, so
they silently reported 0.0% forever. Add your value to
`WASTE_SOURCE_TYPES_WRITTEN_BY_THE_APP` and the existing tests will tell you if
a classifier disagrees.

That is the whole change. No migration: `ehs_entries.source_type` is free text
by design, precisely so your streams are yours.

---

## Rules worth keeping

**Where a vocabulary lives in two places, change both.** The social and
governance metrics exist as a seeded catalog (migration 023) *and* as a
compiled-in list in `social-metrics-core.ts`, so the app works before the seed
runs. Same for the evidence record types. Each file says so at the top; the
tests will catch you if you forget.

**Never invent a factor or a regulatory date.** Every factor carries a
`factor_source` and `data_year`, and the regulatory tracker will physically
refuse to store a claim with no source. If you do not have a citation, mark it
clearly rather than guessing — a confident wrong number is worse than a gap,
because nobody checks a number that looks finished.

**Watch aggregation when adding a metric.** A flow (revenue, incidents) is
summed. A stock (headcount, board seats) is the latest reading *from each site*,
added together — never twelve monthly readings summed. Get this wrong on a
denominator and reported intensity comes out at a twelfth of the truth, in the
direction nobody questions.

**Keep the tests.** They are not ceremony; they are the specification of the
domain rules that are easy to break silently. If you change behaviour
deliberately, change the test in the same commit and say why.

**Do not edit an applied migration.** Add a new numbered one. Everything from
008 on is written to be safely re-runnable, and `supabase/verify_install.sql`
checks the result.

---

## Upgrading later

Nothing here calls home, so an upgrade is a `git pull` and any new migrations.

Two habits make that painless. Keep your changes in commits with honest
messages, so a conflict is a conversation rather than a mystery. And prefer data
changes over code changes wherever both are possible — a factor loaded by CSV
never conflicts with anything, whereas an edited `conversions.ts` might.

If you fork and diverge heavily, that is a legitimate choice too. You are not
locked in, which was the entire point.
