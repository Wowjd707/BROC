# Regulatory content packs

A pack turns a regulatory tracker export into a numbered migration that loads
into `regulatory_frameworks`, `regulatory_items`, `regulatory_updates`,
`regulatory_relationships` and `regulatory_glossary`.

```
regulatory-packs/
  build.py            inspect an export, then emit a migration from a mapping
  <pack>/
    mapping.json      every judgement call, in one reviewable file
```

## Why a generator

The same reasoning as [`../factor-packs`](../factor-packs/README.md). An export
holds a few hundred dated claims, each with sources and a confidence rating.
Transcribing those by hand is where a wrong date quietly enters a system whose
whole value is dates that are right — and a regulatory tracker that is
confidently wrong is worse for a user than no tracker at all.

So the conversion is mechanical and repeatable, and the judgement lives in
`mapping.json` where it can be read and argued with rather than buried in two
thousand lines of generated SQL.

## Building one

```bash
./build.py inspect ../SomeTracker.html                    # what is in the export
./build.py mapping ../SomeTracker.html > new/mapping.json # starter mapping
# edit new/mapping.json — see below
./build.py emit ../SomeTracker.html new/mapping.json \
    > ../supabase/migrations/0NN_regulatory_pack_<date>.sql
```

Then read the warnings on stderr. They are the review.

## What the mapping decides

**`items` — which codes already exist.** This is the one that matters. Migration
024 seeded 21 items, and their codes are referenced by
`regulatory_source_snapshots`, `regulatory_change_proposals` and
`regulatory_capabilities`. A code must never be reissued, so `existing: true`
makes the generator update the framework and domain of that row and leave its
reviewed prose alone. Getting this wrong duplicates a regime under two codes,
and the duplicate looks exactly as authoritative as the original.

**`stage`** maps export lifecycle phases onto BROC's deliberately coarse stages.
Coarse because finer stages differ per jurisdiction and would not compare
across them. Two mappings worth understanding:

- `rescinding` → `stayed`, not `withdrawn`. A rule an agency is moving to
  rescind is still on the books, and calling it withdrawn asserts an outcome
  that has not happened.
- `litigation` → `applying`, not `enjoined`. A challenged rule that no court has
  stopped still binds; the status text carries the challenge.

**`scrub`** is literal text replacement, for an export written inside one
company and reused generally.

## What the generator decides, and why you cannot override it

**Confidence is capped, not copied.** A claim whose sources are all secondary
cannot be stored above `medium`, because `medium` is defined as "credible
secondary reporting — legal analysis of a text nobody on our side read". Three
law firms agreeing is still nobody on our side having read it. Every cap is
printed so the change is visible in review rather than silent.

**Relationships get composed provenance.** A crosswalk export usually carries no
sources of its own, because "California references a frozen GHG Protocol
version" is an observation from reading both texts, not a sentence either body
published. The schema still refuses an unsourced row. So the generator carries
the sources of the instruments at each end and stores the relationship at
`medium` — rather than inventing a citation that says what we want.

**Loose dates keep their looseness.** `2027-Q2` becomes `2027-04-01` plus a note
saying "Estimated Q2 2027". The date column needs a date; rounding a quarter to
a day without saying so would assert a precision the regulator has not given.

## Do not hand-edit the output

Re-run the generator against an updated export instead, so the tracker and the
migration cannot drift apart. If the output is wrong, the mapping or the
generator is wrong — fix it there, where the next person will see it.
