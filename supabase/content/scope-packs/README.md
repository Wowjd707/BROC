# Scope packs

Cited lists of the customs codes a regulation covers, ready to load as one
workspace's scope rules (Products and Parts → Which regulations apply).

They are **data, not schema**: nothing here runs as a migration or loads by
default. An admin runs a pack in the SQL editor after setting the workspace
name at the top, reviews the result on the Products and Parts page, and owns
it from then on — editing, removing and re-verifying rules like any others.

| Pack | Covers | Verified against | Notes |
| --- | --- | --- | --- |
| `eu-cbam-eudr-2026-11.sql` | CBAM Annex I; EUDR Annex I | Consolidated texts on EUR-Lex, 20 Nov 2026 | EUDR additions applying from 30 Dec 2027 are included commented out |

Every rule carries its citation, a link to the source, and the date it was
checked. How "except" lists, "ex" codes and 8-digit CN codes were turned into
prefixes is written at the top of each pack, so a reviewer can check the
translation as well as the codes. `tests/scope-pack.test.ts` loads each pack
into a real database and checks the edge cases.

A new pack follows the same rules as regulatory content
(`docs/REGULATORY_CONTENT.md`): researched from the primary legal text, cited,
dated, and never written from memory.
