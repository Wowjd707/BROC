# Skills — teaching your AI to work on BROC

These files ship with the codebase so that whatever AI assistant your team uses
arrives already knowing the things that are expensive to learn by accident.

Your team owns the running software, so your team — and its assistant — make
the changes. An assistant that does not know this
domain will produce changes that compile, pass review and quietly misstate a
reported number — because a wrong figure that looks finished is the one nobody
re-checks. These skills exist to make that failure less likely.

## What is here

| Skill | Covers |
| --- | --- |
| `broc-orientation` | **Start here.** What the codebase is, the decisions that must not be quietly reversed, and which skill applies |
| `broc-migration` | Schema changes, RLS, regenerating the types |
| `broc-regulatory-content` | Tracked regimes, sourcing rules, the crosswalk, content packs |
| `broc-factors` | Emission factors, factor packs, licensing |
| `broc-vocabulary` | Fuels, waste streams, units — the changes that are code |
| `broc-deploy` | Standing it up, upgrading, diagnosing a failed install |

## How they load

Claude Code reads `.claude/skills/*/SKILL.md` from the repository root and
offers each one by its `description`. Nothing needs installing, and they travel
with a `git clone` or a fork.

Other assistants do not read this directory automatically. Point yours at
`broc-orientation` first; the rest are cross-referenced from it.

## They are yours to change

These encode how *this* codebase works, including several traps discovered the
hard way — a regenerated types file that silently drops its hand-maintained
aliases, an RLS policy that gated the wrong half of an UPDATE, two different
domain concepts sharing a type name.

As you make the codebase yours, the skills should follow. When you change a
rule, change the skill in the same commit, exactly as you would a test. A skill
that describes how the code used to work is worse than no skill, for the same
reason a stale regulatory entry is worse than a missing one: it will be
believed.

If you add a module with its own traps, add a skill for it.
