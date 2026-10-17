---
name: broc-regulatory-content
description: Add or correct content in BROC's regulatory tracker — tracked regimes, workstreams, dated updates, the crosswalk between regimes, and the glossary. Use when asked to add a regulation, refresh a deadline, record that a rule changed, or build a content pack from a tracker export.
---

# Regulatory content

A tracker that is confidently wrong is worse for a user than no tracker at all.
Regulatory status in this field moved several times in 2026 alone, and someone
will plan a compliance programme around what this screen says.

So the governing rule is simple and absolute: **never add or edit a tracked
regime from memory, or from a single secondary source.** Research it and cite
the primary text. If you cannot find the primary text, that fact is itself the
answer — record lower confidence, not a better-sounding claim.

`docs/REGULATORY_CONTENT.md` is the full standard. This is the working version.

## The shape

```
regulatory_frameworks     the publisher or regime      (GHG Protocol, PFAS)
  └── regulatory_items     one workstream               (Scope 2 revision)
        └── regulatory_updates   the dated feed

regulatory_relationships  how two regimes interact     (crosswalk + watchlist)
regulatory_glossary       terms and acronyms
```

A framework is a body or a regime. An item is one thing that is moving inside
it, with its own stage, confidence and milestone. If a publisher is rewriting
itself in five directions — the GHG Protocol is — that is five items, not one
row averaging five truths.

## Confidence is a claim about your evidence

| Level | What it asserts |
| --- | --- |
| `confirmed` | Final published text or a formally adopted decision. |
| `high` | Official draft, adopted-but-not-in-force act, or a formally announced plan. |
| `medium` | Credible secondary reporting — legal analysis of a text nobody on our side read. |
| `low` | Early signal: scoping, political intent, unconfirmed reporting. |

**A claim sourced only to law-firm briefings is `medium`, however many of them
agree.** Three excellent firms reading the same regulation is still nobody on
our side having read it. Rating it `high` asserts we read the instrument; if we
did not, the honest rating is `medium` and the fix is to go and read it.

`last_verified` means *a human checked this row against its sources on that
date*. Bumping it without re-reading defeats the entire mechanism — the UI
surfaces staleness specifically so an old entry cannot pass as a fresh one.

`next_milestone_date` may be NULL, and NULL is meaningful: it means no date has
been announced, which is a different fact from a date we do not know.

## Adding or correcting one regime

1. Find the primary text — the regulator, the standard-setter, the official
   journal. Not a summary of it.
2. Write the row: stage from the coarse list in 024 (finer stages do not
   compare across jurisdictions), `status_summary` in plain sentences, and
   `key_points` as the four or five things that actually bear on a reporting
   team.
3. Cite every source with a label, a URL and the date you read it.
4. Set confidence honestly, and `confidence_note` saying what is and is not
   verified. "NOT VERIFIED: whether the effective date refers to periods
   beginning or ending on that day" is a genuinely useful sentence.
5. Set `last_verified` to today.
6. Add it as a new migration — content is data, so this needs no code change.

State what published sources say. Do not give a deadline without its source, do
not resolve an ambiguity the regulator has left open, and do not predict what a
regulator will do.

## The crosswalk

`regulatory_relationships` records how two regimes interact, which is the part
a team cannot get from eleven separate trackers. Set `is_watchlist` where a
company must satisfy both ends and cannot with one answer — those need
`watchlist_detail` explaining the bind, because a divergence with no
explanation is not actionable.

Relationships usually have no citation of their own. "California references a
frozen GHG Protocol version while GHG Protocol rewrites it" is an observation
drawn from reading both texts, not a sentence either body published. Carry the
sources of the instruments at each end and store it at `medium`. Do not invent
a citation that says what you want it to say.

## Content packs

To load a tracker export rather than hand-writing rows, use
`regulatory-packs/build.py`:

```bash
./build.py inspect <export.html>                    # what is in it
./build.py mapping <export.html> > mapping.json     # starter mapping, then edit
./build.py emit <export.html> mapping.json > ../supabase/migrations/0NN_pack.sql
```

The mapping holds every judgement call: which export workstream becomes which
BROC item code, **which codes already exist** (a pack must update those, never
duplicate them — item codes are referenced by three other tables), how export
lifecycle phases map onto BROC stages, and any text to scrub.

The generator caps confidence where sources are all secondary and prints every
cap it applied. Read the warnings; they are the review.

Do not hand-edit generated migrations. Re-run the generator against an updated
export, so the tracker and the migration cannot drift apart.
