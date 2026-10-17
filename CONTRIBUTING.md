# Contributing to BROC

BROC exists so that a sustainability team can stop renting software and own
the thing instead. That shapes how this project takes contributions.

## You do not need permission to change it

The most likely correct thing for you to do with this repository is **fork it
and change it to fit your organization**, and never send anything back. That is
not a lesser outcome; it is the point. Your waste streams, your metrics, your
business units, and your reporting boundary are yours. There is no admin UI for
the vocabularies because the codebase *is* the configuration — a sustainability
professional editing a TypeScript array is doing configuration, not
programming, and they end up understanding their own numbers better for it.

Contribute upstream when the change would be true for everyone: a real bug, a
correctness fix in a calculation, a regulatory entry that is out of date, a
framework mapping that is wrong. Keep your own vocabularies in your fork.

## What makes a good pull request here

**Correctness beats features.** This software produces numbers that go into
assured disclosures. A wrong number that looks plausible is worse than a
missing feature, because nobody catches it until an auditor does. If you fix a
calculation, say in the PR what the wrong output was and what triggered it.

**Show your source.** Any change to a factor, a framework mapping, or a
regulatory entry needs a citation to the primary instrument — the regulation,
the standard, the agency guidance. Not a blog post about it, and not a model's
recollection. The database enforces this for regulatory entries: an unsourced
claim will not store.

**Tests for anything that computes.** Pure calculation logic lives in
`lib/*-core.ts` with no I/O precisely so it can be tested directly. If your
change touches aggregation, intensity, consolidation, or rate derivation, it
needs a test with a hand-worked expected value.

```bash
npm test
npx tsc --noEmit
```

## Traps worth knowing before you start

These have each caused a real wrong number in this codebase.

**Stock versus flow.** Headcount is a *stock* — 400 people on 1 January and 410
on 1 July is 410 people, not 810. Energy is a *flow* — it sums. Every metric
declares `sum`, `point_in_time`, or `average`, and getting it wrong silently
distorts every intensity figure that metric feeds. For a `point_in_time` metric
across multiple sites, the correct aggregation is the latest reading **per
site**, then summed across sites — not the single latest reading overall.

**Numerator and denominator must cover the same estate.** An intensity figure
computed over all sites but divided by a denominator that only some sites
reported is wrong, often by tens of percent. BROC reports intensity as
`missing` rather than estimating it. Keep it that way.

**Migrations from 008 onward are re-runnable.** `IF NOT EXISTS`,
`DROP ... IF EXISTS`, `ON CONFLICT`. Someone will apply them twice. 001–007
predate this convention and are single-shot; do not model new work on them.

**RLS policy shape.** `SELECT` policies gate on `organization_id = auth_org_id()`
and nothing else — never on role. Write policies additionally allowlist roles.
Mixing role checks into `SELECT` is how a viewer stops being able to see their
own organization's data in a way that takes a day to diagnose.

**`pipeline_inclusion_status` defaults to `'excluded'`.** Honouring it naively
makes every project disappear from every view. Check what a status column
actually contains before filtering on it.

## Regulatory content

Entries carry a confidence rating and a verification date, and confidence is
capped automatically as an entry ages. If you update an entry, update
`last_verified`. If you are not sure a change is right, lower the confidence
rather than raising it — an honestly uncertain entry is useful, a confidently
wrong one is a liability.

The AI regulatory watch may only *propose* changes. It cannot set confidence,
verification dates, or sources, and every proposal requires human review before
it lands. Do not loosen that.

## Style

Follow what is already there; `CLAUDE.md` is the standing rulebook. Comments
explain *why*, not *what* — a comment saying a threshold exists because GRI
403-9 permits two hour bases is worth keeping; a comment saying a loop iterates
over sites is not.

## Reporting a wrong number

Open an issue with the inputs, the figure BROC produced, and the figure you
expected. That is enough; you do not need to find the cause. Wrong-number
issues take precedence over everything else.

## Security

Do not open a public issue for a vulnerability, especially one touching
tenancy isolation or the service-role key path. Use the repository's private
vulnerability reporting instead — see [`SECURITY.md`](SECURITY.md).

## Licence

Contributions are accepted under the Apache Licence 2.0, the same terms the
project is distributed under. You keep copyright in what you write.
