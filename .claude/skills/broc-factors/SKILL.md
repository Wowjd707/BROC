---
name: broc-factors
description: Load, update or build emission factor sets in BROC — DEFRA, eGRID, EPA GHG Emission Factors Hub, or a company's own factors. Use when asked to add factors, change a factor vintage, fix a wrong factor, or prepare a factor pack from a publisher's spreadsheet.
---

# Emission factors

A wrong factor that parses cleanly is the worst defect this project can ship.
It produces a finished-looking number, every downstream total inherits it, and
nobody re-checks a figure that looks complete. Assume an assurance provider
will ask where each one came from.

## Never transcribe factors by hand — and do not transcribe them as an AI either

Reading thousands of values out of a spreadsheet is precisely where a silent
wrong number enters. This is why `factor-packs/` ships the *tooling* to convert
a publisher's own file, and ships **no `factors.csv` at all**:

```
factor-packs/
  build.py          inspect a publication, then emit factors.csv from a mapping
  verify.py         validate a pack before loading it
  <pack>/
    ATTRIBUTION.md  source, licence, URL, date retrieved
    mapping.json    which sheet and columns the values came from
    factors.csv     the emitted pack — absent until someone builds it
```

Building a pack takes about twenty minutes:

```bash
pip install openpyxl
./build.py inspect ~/Downloads/ghg-conversion-factors-2026.xlsx   # sheets move every year
# record the URL and today's date in ATTRIBUTION.md, write mapping.json
./build.py emit <pack>
./verify.py --strict <pack>/factors.csv
```

`verify.py` checks what a structural validator cannot: whether values are
plausible for the unit they claim, whether two rows contend for the same
effective-date window, and whether the provenance is specific enough for an
auditor to follow back to a page.

## Every factor carries its provenance

`factor_source` and `data_year` are not optional metadata; they are what makes
a reported number defensible. `data_year` is the year the data *describes*, not
the year it was published — eGRID 2023 released in 2025 is still `2023`.

Never change a factor in place to "correct" a prior year. Superseding a factor
and editing history are different operations, and the second one destroys the
lineage that lets a prior-year figure be reproduced.

## Licensing is a real constraint

`docs/FACTORS.md` records which sources may be redistributed. **GREET may not,
despite being free to download.** ecoinvent is commercially licensed and
non-redistributable. Some DEFRA extracts are licensed rather than open.

Free to download and free to redistribute are different things, and getting it
wrong is discovered after shipping, by somebody else. If a pack's licence is
unclear, ship the mapping and the attribution without the values, exactly as
the three scaffolded packs do.

## Routes into the database

| Route | When |
| --- | --- |
| `/factors` CSV import | A prepared pack, or an organization's own factors |
| `custom_emission_factors` | Organization-specific, supplier-specific |
| Reference seed migration | Factors shipped with the platform |

The importer (`lib/custom-factor-import-core.ts`) validates structure at load
time and shows a plan before writing. Unknown units and unparseable numbers are
errors, not silently skipped rows.

## If you cannot find a source

Say so. Mark it clearly and ask. Do not fill the gap with a value from memory,
a value from a similar fuel, or an average of two others — a marked gap is
recoverable and a confident wrong number is not.
