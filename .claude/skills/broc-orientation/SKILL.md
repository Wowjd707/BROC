---
name: broc-orientation
description: Read this before making any change to BROC. Explains what the codebase is, the decisions that must not be quietly reversed, and which of the other broc-* skills applies to the change at hand. Use when starting work on this repository for the first time in a session, or when unsure whether a change is data or code.
---

# Working on BROC

You are editing a self-hosted ESG and sustainability platform that a team owns
outright. There is no vendor to escalate to and no release train to hide
behind: whatever you change is what runs, and whoever maintains it next is the
person sitting next to whoever asked you.

That shapes how to work here more than any style rule.

## The one thing that makes this domain different

Every number in this system may be read by an external assurance provider, and
a wrong number that looks finished is worse than a missing one, because nobody
checks a number that looks finished.

This is not a slogan. It is the reason for most of the constraints below, and
the reason a plausible-looking guess is a defect here in a way it would not be
in most software.

## Never do these

**Never invent an emission factor, a GWP value, a regulatory date or a
threshold.** Not even a placeholder, not even with a TODO. If you do not have a
cited source, say so and stop. The schema enforces this in the places it can:
`regulatory_items.sources` physically refuses an empty array, and emission
factors carry `factor_source` and `data_year`. Where the schema cannot enforce
it, you have to.

**Never fold Scope 3 into a Scope 1+2 total.** They are not additive for
reporting, and a combined figure misstates the inventory.

**Never make an empty filter scope show organization-wide totals.** An empty
scope shows zeros. Showing the org-wide number is a misstatement dressed as a
convenience.

**Never report a missing metric as 0.** Missing and zero are different facts. An
intensity with no denominator reports as missing, not as a number.

**Never edit an applied migration.** Add a new numbered one. See
`broc-migration`.

If a request seems to require one of these, that is the moment to stop and ask,
not the moment to find a clever way around it. `docs/DECISIONS.md` records these
as standing decisions with the reasoning; read it before arguing with one.

## Data or code?

Most changes here should be data. Ask in this order:

1. **Can it be a row?** Emission factors, regulatory content, business metrics,
   disclosure requirements, the capability map. Change these with SQL or a CSV
   import — no release, no deploy, and they survive every upgrade you pull.
2. **Can it be config?** Product name and mark resolve from `lib/branding.ts`
   and are environment-overridable.
3. **Only then, code.** Vocabularies — fuels, waste streams, units, metric
   families — are code because each has calculation behaviour attached.

`docs/CUSTOMISING.md` has the full edit-point map. If you can do it as data, do
it as data.

## Which skill applies

| The change | Skill |
| --- | --- |
| Schema, tables, columns, RLS | `broc-migration` |
| Tracked regimes, regulatory dates, the crosswalk | `broc-regulatory-content` |
| Emission factors of any vintage | `broc-factors` |
| A new fuel, waste stream, unit or metric | `broc-vocabulary` |
| Standing it up, or upgrading a deployment | `broc-deploy` |

## How to work

**Read before changing.** `docs/DECISIONS.md` first for standing decisions, then
`docs/ARCHITECTURE.md` and `docs/DATA_MODEL.md`. The documents are a
part of the code here, not an afterthought — if you change behaviour, change the
document in the same commit.

**Build in vertical slices.** Migration, data layer, API, UI and docs together.
A schema change with no UI and no document is not a finished slice.

**Keep the tests.** `npm test` is the specification of the domain rules that
are easy to break silently. If you change behaviour deliberately, change the
test in the same commit and say why in the message. Do not delete a failing
test to make a build pass — that is how a reporting misstatement ships.

**Verify before claiming.** `npx tsc --noEmit`, `npm test`, `npm run build`.
Report what actually happened, including failures. "It should work" is not a
result.
