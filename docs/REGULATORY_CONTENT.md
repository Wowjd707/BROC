# Maintaining the regulatory tracker

The tracker in `/regulations` is the one module where being wrong is worse than
being absent. Everywhere else in this platform a mistake produces a number
somebody can check against their own records. Here, a mistake produces a date
somebody plans around.

This document is the standard for adding and updating entries. It is short on
purpose.

---

## The one rule

**Nothing enters this table from memory.**

Not from a model's memory, not from yours. Every entry is researched against a
current source at the moment it is written, and it carries that source.

This is not caution for its own sake. When the seed content was researched on
4 September 2026, the research contradicted confident prior belief on at least
six points:

- California SB 253's first deadline had moved to 10 November 2026. A
  from-memory answer would have said 1 January or 10 August.
- SB 253's first-year reporting requires no assurance. The statute implies 2026;
  CARB's regulation defers it to 2027.
- The EU Omnibus was **final law**, not still in negotiation.
- CSDDD thresholds had gone from 1,000 employees / €450m to 5,000 / €1.5bn.
- EUDR had been postponed a **second** time, to 30 December 2026.
- The SEC climate rule was never vacated by a court. It was stayed by the SEC
  itself and is being rescinded administratively.

Six wrong answers out of roughly twenty entries. That is the failure rate of
writing this from memory, and it is why the schema will not accept an unsourced
row.

---

## What the schema enforces

`regulatory_items` (migration 024) makes the standard structural rather than
cultural:

| Column | Rule |
| --- | --- |
| `sources` | `CHECK` requires a non-empty JSON array. An unsourced claim cannot be stored. |
| `confidence` | `NOT NULL`, one of `confirmed` / `high` / `medium` / `low`. |
| `last_verified` | `NOT NULL`. Surfaced in the UI, so a stale entry announces itself. |
| `next_milestone_date` | Nullable **and that is meaningful** — it means no date has been announced, which is different from a date we failed to find. |

Try to insert a row with `sources: '[]'` and the database refuses it. That is
deliberate: conventions erode under deadline pressure and constraints do not.

### The shape, after migration 033

024 gave every tracked rule one flat row. That stopped being right once a
publisher was being rewritten in several directions at once — the GHG Protocol
has five live workstreams with different stages, confidence and milestone
dates. One row would have averaged five truths.

```
regulatory_frameworks     the publisher or regime      (GHG Protocol, PFAS)
  └── regulatory_items     one workstream               (Scope 2 revision)
        └── regulatory_updates   the dated feed

regulatory_relationships  how two regimes interact     (crosswalk + watchlist)
regulatory_glossary       terms and acronyms
```

`regulatory_items.category` now means **domain** — what the rule is about — and
`jurisdiction` carries geography. 024 conflated them (`ghg_accounting`, `eu`,
`us`, `other`), which filed PFAS, packaging and deforestation under "eu", where
nobody filtering for chemicals would find them.

`regulatory_updates` gained `so_what`: what a reporting team should actually do
about an item. Nullable, because an update with no action is honest and an
invented one is not.

### The crosswalk carries the same guarantee

`regulatory_relationships` records how two regimes interact, which is the part
a team cannot get from eleven separate trackers — that California references a
frozen GHG Protocol version while GHG Protocol rewrites it, for instance. It
enforces `sources` and `last_verified` exactly as items do, because a claim
that two rules conflict is precisely the kind of claim someone spends money on.

`is_watchlist` marks the subset where a company must satisfy both ends and
cannot with one answer, and requires `watchlist_detail` explaining the bind: a
divergence with no explanation is not actionable.

Relationships usually have no citation of their own, because the observation is
drawn from reading both texts rather than from something either body published.
Carry the sources of the instruments at each end and store the relationship at
`medium`. Do not invent a citation that says what you want it to say.

---

## The confidence vocabulary

| Rating | Means |
| --- | --- |
| `confirmed` | The official published text says this. Official Journal, Federal Register, the standard-setter's own document. |
| `high` | An official announcement or agreed political text says this, but the binding instrument was not read directly. |
| `medium` | Credible secondary reporting — typically legal analysis of a text nobody on our side read. |
| `low` | Commentary or speculation. Directionally useful, never a basis for a compliance decision. |

Most law-firm client alerts are `medium`, however reputable the firm. They are
excellent sources and they are still somebody's reading of a text. If the entry
depends on a specific threshold or date, get it from the instrument.

### Confidence decays

`effectiveConfidence()` in `lib/regulatory-core.ts` caps a rating as the entry
ages: `high` after 45 days, `medium` after 120. The UI shows the original
struck through next to the capped value.

This is the part most trackers get wrong. "Confirmed" is a claim about when
somebody checked, not a permanent property of a fact. A page that keeps
displaying a March verification as `confirmed` in September has quietly
converted a reader's healthy uncertainty into false confidence, which is the
specific harm this module exists to avoid.

---

## Updating an entry

Content is data, so this is an `UPDATE` — no release, no migration:

```sql
UPDATE regulatory_items
SET status_summary      = '…',
    stage               = 'in_force',
    next_milestone_date = '2027-02-01',
    key_points          = '["…","…"]'::jsonb,
    sources             = '[{"label":"…","url":"…","dated":"2026-11-02"}]'::jsonb,
    confidence          = 'confirmed',
    last_verified       = CURRENT_DATE,
    updated_at          = NOW()
WHERE code = 'CBAM';
```

Bumping `last_verified` without re-reading the sources defeats the entire
mechanism. If you only had time to check half the entries, bump half of them.
A tracker with four fresh entries and seventeen honestly stale ones is more
useful than twenty-one uniformly claiming to be current.

Material changes should also get a `regulatory_updates` row, which is what
drives the "what changed" feed. `source_url` is `NOT NULL` there: an undated,
unsourced update is a rumour.

---

## Loading a content pack

Hand-writing a few hundred sourced claims is where a wrong date quietly enters.
`regulatory-packs/build.py` converts a tracker export into a numbered migration
instead, on the same reasoning as `factor-packs/build.py`:

```bash
cd regulatory-packs
./build.py inspect <export.html>                        # what is in it
./build.py mapping <export.html> > new/mapping.json     # starter, then edit
./build.py emit <export.html> new/mapping.json > ../supabase/migrations/0NN_pack.sql
```

The mapping holds every judgement call, most importantly **which item codes
already exist**. Codes are referenced by `regulatory_source_snapshots`,
`regulatory_change_proposals` and `regulatory_capabilities`, so a code must
never be reissued — a pack updates those rows rather than inserting duplicates,
and a duplicated regime looks exactly as authoritative as the original.

The generator enforces the confidence rule rather than trusting the export: any
claim whose sources are all secondary is capped at `medium`, and every cap is
printed on stderr. Read the warnings — they are the review.

Do not hand-edit a generated migration. Re-run the generator against an updated
export, so the tracker and the migration cannot drift apart.

---

## What this module must never do

It states what published sources say. It does **not**:

- **Tell a company whether a regime applies to it.** Thresholds are recorded as
  published; applying them to an entity's facts is legal judgement.
- **Compute a compliance status.** "You are compliant with CBAM" is not a
  sentence this software gets to write.
- **Give a deadline without its source.**

The first two are the fastest available route from a helpful reference to a
liability, and the disclaimer at the top of the page is load-bearing rather than
decorative. Keep it visible.

---

## The source watch

Migration 025 adds change detection, on the `/regulations` page under **Source
watch**. It exists because re-reading twenty-one pages a month to find that
nineteen are unchanged is the part nobody sustains.

### What it does, in order

```
fetch → strip tags → collapse whitespace → hash → compare to last snapshot
                                                        │
                              unchanged ────────────────┤
                              cosmetic  ────────────────┤ (baseline updated, no proposal)
                              changed   ────────────────┴──→ optional AI summary → REVIEW QUEUE
```

Detection is arithmetic. **A run where nothing changed makes no model calls at
all**, so this is nearly free to operate and works fully with no AI provider
configured — you just read the diff yourself.

### What the model is and is not asked

It is asked: *"here is a diff from a page fetched thirty seconds ago; what
changed in this text?"* That is reading comprehension on supplied evidence.

It is never asked: *"what is the current status of the EUDR?"* That is recall,
which is the thing models do confidently and wrongly — six of twenty-one seed
entries, when this was researched.

The system prompt in `lib/ai/tasks.ts` forbids stating what a regulation
requires unless it appears in the supplied diff, and the grounding check runs
the model's summary against **the diff alone** — not against the tracker's own
stored text, so a date the model echoed back from our summary is flagged rather
than treated as corroborated.

### Why approval is a real act

Approving does two things a machine cannot:

1. **You state the confidence.** A proposal is structurally incapable of
   carrying a `confidence` value — `sanitisePatch` strips it and a CHECK
   constraint rejects it.
2. **`last_verified` is stamped with today.** That field drives the whole decay
   mechanism. If anything but a human approval could set it, the freshness badge
   would stop meaning "a person checked this" and `effectiveConfidence()` would
   be measuring nothing.

Which is why the source link is the most prominent thing on a proposal card.
**Approving without opening it is the one way to defeat this design.** Nothing
in the software can stop you; it is a discipline, and it is the discipline the
whole module rests on.

A proposal may only ever suggest: `status_summary`, `key_points`, `stage`,
`next_milestone`, `next_milestone_date`, `next_milestone_note`. Not `sources`,
not `code`, and not the two above.

### Failed fetches are not "no change"

Some sources actively resist automated fetching — ECHA returns 403, EUR-Lex
serves metadata rather than article text, and PDFs cannot be diffed as text. All
of these raise a proposal that says so and tells you to read the page by hand.
A watcher that silently reported those as unchanged would be worse than no
watcher, because it would look like verification.

### Scheduling it

The API route is admin-authenticated rather than a public cron endpoint: a run
makes outbound requests to two dozen government sites from your IP and, with AI
configured, spends your API budget. To run it on a schedule, call
`runRegulatoryWatch({ triggeredBy: null, triggerKind: 'scheduled' })` from your
own scheduler (a Supabase scheduled Edge Function, a cron container, a CI job)
using the service role.

Monthly is right for most of these. Weekly is worth it only while something you
depend on is in active litigation or scrutiny.

**A run does not update the tracker.** It fills a queue. If nobody works the
queue, the tracker goes stale exactly as it would have without the watch — the
badges will just tell you so honestly.

---

## Re-verification cadence

Roughly matched to how fast each area actually moves:

| Area | Cadence | Why |
| --- | --- | --- |
| Anything in litigation (SB 261, SEC) | Monthly | A ruling changes the answer overnight. |
| EU instruments in scrutiny | Monthly | Publication in the OJ flips stage and dates. |
| Items with a milestone inside 90 days | Monthly | The window where a reader acts on it. |
| Standards in drafting (GHGP, ISO) | Quarterly | Consultations and slippage move in quarters. |
| Everything else | Quarterly | |

The **Entries to re-verify** metric on the page counts anything past the
45-day freshness threshold, which is the queue to work from.

---

## Known gaps in the seed content

Carried from the 4 September 2026 research and worth resolving before anyone
relies on them. Each is stated in the entry's own `confidence_note` too, so a
reader meets the caveat where it matters rather than only here.

- **EUDR** — whether the 13 July 2026 product-scope delegated act has cleared
  EP/Council scrutiny; the specific high-risk and low-risk country lists; the
  binding status of the proposed downstream due-diligence-statement changes.
- **CA SB 253** — whether OAL has approved the modified regulation, and whether
  CARB's guidance and intake platform launched as planned on 1 September 2026.
  One source (KPMG) implied assurance applies in 2026; two more specific sources
  place it in 2027. Confirm against CARB's regulation text.
- **CA SB 261** — whether the Ninth Circuit has ruled in *Chamber of Commerce
  v. Sanchez*. The single most volatile entry on the page.
- **SEC** — whether a final rescission has been adopted since the comment period
  closed 3 August 2026.
- **PPWR / CBAM / CSDDD** — the PFAS thresholds, the 50-tonne de minimis
  definition and the 3% penalty cap were sourced to the Commission, Council or
  law-firm analysis rather than to the article text, because EUR-Lex serves
  metadata rather than full text to automated fetching. A human should read the
  OJ before these are relied on as legal fact.
- **US states** — Colorado, New Jersey and Illinois statuses come from an
  April 2025 source and their 2026-session outcomes are unverified. No
  Washington enterprise-level bill was found either way.
