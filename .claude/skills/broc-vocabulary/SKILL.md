---
name: broc-vocabulary
description: Add a fuel, waste stream, unit, metric family or business metric to BROC. Use when the entry forms need to offer something they do not currently offer, or when a conversion or aggregation rule needs changing. These are the changes that are code rather than data, and each has a calculation trap attached.
---

# Vocabularies

Fuels, waste streams, units and metric families are **code**, not data. That is
deliberate. Each one has calculation behaviour attached, and making them
configurable would let someone add a fuel with no heating value, or a waste
stream that nothing knows how to classify — an entry form that accepts input it
cannot correctly convert.

So these changes mean editing TypeScript, and each one has a specific trap.

## Where they live

| Vocabulary | Files |
| --- | --- |
| Waste streams | `WasteDrawer.tsx` + `lib/source-labels.ts` |
| Water sources | `WaterDrawer.tsx` + `lib/water-core.ts` (withdrawal / discharge / recycled) + `lib/source-labels.ts` |
| Fuels, Scope 1 sources | `EmissionDrawer.tsx` + `lib/emission-factor-types.ts` + `lib/conversions.ts` (heating values) + the factor set + `lib/import-cascade-core.ts` (allowed Scope 1 categories) |
| Scope 2 sources | `lib/emission-factor-types.ts` + `calculateScope2` in `lib/calculations.ts` |
| Refrigerants | `refrigerant_factors` rows (data), incl. `is_montreal_protocol` |
| Units | `lib/conversions.ts`, `lib/units.ts` |
| Social & governance metrics | Migration 023 + `lib/social-metrics-core.ts` (+ `isEventCountStream` in `lib/anomaly-core.ts` for rare-event counts) |
| Entry data quality | `lib/entry-data-quality.ts` |

## Trap 1 — a vocabulary often lives in two places

Social and governance metrics exist as a seeded catalog (migration 023) *and*
as a compiled-in list in `social-metrics-core.ts`, so the application works
before the seed has run. Same for evidence record types. Change one and not the
other and the app disagrees with its own database.

Each file says so at the top, and the tests will catch you. Do not silence the
test; fix the second place.

## Trap 2 — flow versus stock

This is the one that silently distorts reported intensity.

- A **flow** accumulates: revenue, incidents, units produced. Twelve monthly
  readings are **summed**.
- A **stock** is a level: headcount, board seats, floor area. The value is the
  **latest reading from each site, added together** — never twelve monthly
  readings summed.

Get this wrong on an intensity denominator and the reported figure comes out at
roughly a twelfth of the truth, in the direction nobody questions. The metric
definition carries the aggregation; set it deliberately.

## Trap 3 — two concepts, one name

`DataQuality` existed twice in this codebase with different members:

```
lib/scope3.ts              'primary' | 'secondary' | 'estimated'
entry data quality         'measured' | 'calculated' | 'estimated'
```

The first grades how close a value-chain factor sits to the reporting entity.
The second records how one reading was obtained. They overlap on exactly one
member, which is what let `lib/entries.ts` apply the Scope 3 tier to EHS
entries — a union whose values the database's own CHECK constraint rejects.

Before naming a new type after a domain word, grep for it. If two concepts
genuinely share a name, name them apart (`EntryDataQuality`,
`Scope3DataQuality`) rather than relying on import order to disambiguate.

## Trap 4 — the database already has an opinion

A vocabulary with a CHECK constraint behind it has two sources of truth. The
TypeScript union and the constraint must agree, and the constraint wins at run
time. When adding a member, add it to both in the same commit, and derive the
runtime validator from the union rather than repeating the literal list — a
duplicated list is a list that will disagree with itself.

## Trap 5 — a source carries accounting rules, not just a label

- **A water source must be classified** in `WATER_SOURCE_CLASS`
  (`lib/water-core.ts`) as withdrawal, discharge or recycled. Unclassified, it
  is left out of every total — consumption is withdrawal minus discharge, and
  adding a discharge as if it were use once reported 1,800 m³ "consumed" for
  200.
- **A fuel needs its heating values.** `lib/conversions.ts` holds EPA HHVs per
  gallon, per short ton and per standard cubic foot, keyed by fuel. A fuel
  missing from a table refuses that unit with an error rather than borrowing
  another fuel's value — that is deliberate; add the published HHV and cite it.
- **Biomass** puts its biogenic CO₂ in `biogenic_co2_factor` (reported outside
  the scopes) and only CH₄ + N₂O in `co2e_factor`.
- **A new Scope 2 source** needs a rule in `calculateScope2`: whose factor
  prices it under each method. Purchased heat is not electricity, and
  self-generated electricity is not purchased.
- **A new refrigerant that is an HCFC or CFC** gets `is_montreal_protocol =
  TRUE`, which reports its leaks outside the scopes.
- **A new social count of rare events** (incidents, grievances) belongs in
  `isEventCountStream`, so a month of zero is not flagged in the data review.

## Checklist

- [ ] Both places updated where a vocabulary is duplicated
- [ ] Aggregation set deliberately: flow sums, stock takes the latest per site
- [ ] Name does not collide with an existing domain type
- [ ] Database CHECK and TypeScript union agree
- [ ] Conversion or factor exists for anything the form now offers
- [ ] Accounting class set where one applies (water class, Scope 2 rule, biogenic split, Montreal flag)
- [ ] Test added — these are exactly the rules that break silently
- [ ] `docs/CUSTOMISING.md` edit-point table still accurate
