# Emission factors — what can ship, and how

BROC ships almost no emission factors, and that is a licensing decision rather
than an unfinished feature. This document says which public sources can be
bundled with Apache-2.0 software, which cannot, and how to load the rest.

**Verified 2026-09-13.** Licence terms change. Re-check before adding a source,
and record the date you checked.

---

## What can be bundled

| Source | Licence | Bundle? | Condition |
| --- | --- | --- | --- |
| **EPA GHG Emission Factors Hub** | US Government work, public domain | ✅ Yes | Cite version and publication year |
| **eGRID** (US EPA) | US Government work, public domain | ✅ Yes | Cite the eGRID year — subregion factors move annually |
| **DEFRA / UK BEIS conversion factors** | [Open Government Licence v3.0](https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting) | ✅ Yes | Attribution required; state if modified |
| **IPCC AR6 GWP values** | Cite-and-use | ✅ Yes | Already seeded |
| **GREET** (Argonne) | **CC BY-NC 4.0**, modified | ❌ **No** | See below |
| **IEA** emission factors | Commercial licence | ❌ No | Not redistributable |
| **ecoinvent** | Commercial licence | ❌ No | Each organization loads its own |

### The GREET trap

This is the one worth reading twice, because it looks bundleable and is not.

GREET is US-government-funded and free to download, which makes it feel like
public domain. It is not. Argonne distributes it under **Creative Commons
Attribution-NonCommercial 4.0**, with additional terms: redistribution is
permitted for **non-commercial** use only, commercial use requires written
approval from Argonne, and source modification is prohibited
([terms](https://greet.anl.gov/copyright)).

Apache-2.0 grants every recipient the right to use the work commercially.
Shipping GREET-derived factors inside an Apache-2.0 repository would mean
granting a right we do not hold, and every downstream company using BROC
commercially — which is most of them — would be in breach without knowing it.

**So GREET factors do not go in this repository.** A user who has accepted
Argonne's terms can load them into their own deployment through the importer,
which is exactly where that decision belongs.

The general rule: **a NonCommercial licence is incompatible with this project.**
Free to download is not the same as free to redistribute. Check the licence,
not the price.

### DEFRA can be bundled

Unlike IEA, DEFRA is not blocked on licensing. OGL v3.0 explicitly permits copying,
publishing, distributing and adapting the data, including commercially, with
attribution. DEFRA is the single largest bundleable win available — roughly
four thousand factors covering fuels, transport, materials, water and waste.

Attribution goes in `NOTICE` and in the pack's own README:

> Contains public sector information licensed under the Open Government
> Licence v3.0. UK Government GHG Conversion Factors for Company Reporting,
> \<year\>, Department for Energy Security and Net Zero.

---

## Factor packs

Bundled factors ship as **CSV packs**, not as seed migrations. Three reasons,
in order of importance:

1. **Licensing stays visible.** A pack carries its own attribution file next to
   its data. A migration buries the provenance in SQL nobody reads.
2. **Factor years are data, not schema.** DEFRA 2027 should be a new CSV, not a
   new migration. Users upgrading BROC should not get new factors as a side
   effect of a code upgrade — that would silently change last year's numbers.
3. **The importer already exists and validates.** `lib/custom-factor-import-core.ts`
   checks units, resolves keys, enforces effective-date windows, and rejects
   overlapping windows for the same key. Anything loaded through it is
   validated; anything loaded by `INSERT` is not.

```
factor-packs/
  epa-hub-2024/
    ATTRIBUTION.md        source, licence, URL, date retrieved
    factors.csv
  egrid-2023/
    ATTRIBUTION.md
    factors.csv
  defra-2026/
    ATTRIBUTION.md        OGL v3.0 notice
    factors.csv
```

Each `factors.csv` uses the existing import contract, so no new code is needed:

```
factor_category,factor_key,label,co2e_factor,unit,factor_source,data_year,effective_from,effective_to,notes
```

`factor_category` is one of `scope1`, `scope2_location`, `refrigerant`. The
unit is derived from the category and never read from the file — MMBtu for
Scope 1, kWh for location-based Scope 2, kg for refrigerants — so a pack cannot
smuggle in a mismatched denominator.

**`factor_source` must identify the document, not the organisation.** "DEFRA"
is not a source. "DEFRA 2026 GHG Conversion Factors, Table 1 (fuels)" is,
because an auditor can go and find it.

---

## How to build a pack

Do not transcribe factor values by hand, and do not have a language model do it.
Thousands of numbers read out of a spreadsheet is exactly where a silent wrong
number enters a system whose entire value is defensible numbers. Write a script
that reads the official file and emits the CSV, and keep the script in the pack
directory so anyone can re-run it against next year's release and diff it.

1. Download the official file from the publisher. Record the URL and the date.
2. Write a conversion script — `build.py` or similar — that reads it and emits
   `factors.csv`. Commit the script.
3. Convert units to the category denominator in the script, showing the
   arithmetic. DEFRA publishes per litre, per kg and per kWh; Scope 1 here is
   per MMBtu.
4. Spot-check ten rows by hand against the source document. Not one, and not
   all of them — ten across different tables catches both transcription and
   unit-conversion errors.
5. Set `effective_from` to the start of the year the factors apply to, and
   `effective_to` to `null`. The importer rejects overlapping windows for the
   same key, so loading two years in the wrong order fails loudly.
6. Write `ATTRIBUTION.md` before loading anything.

## Loading a pack

Through the UI at `/data/factors` → import, or by feeding the CSV to the same
import path. The importer reports per-row errors rather than failing the whole
file, so a pack with three bad rows loads the rest and names the three.

After loading, check `/data/factors` shows the expected `factor_source` and
`data_year` on a sample of rows. A factor without visible provenance is a
factor an auditor will discount.

---

## What organisations supply themselves

- **Scope 3 factors.** The demo set is invented and labelled
  `DEMO DATA — not for reporting`. Load a licensed library before reporting
  anything real. This is the single most common way a first inventory goes
  wrong.
- **ecoinvent, IEA, GREET, and any other licensed set.**
- **Supplier-specific factors**, which are better than any published average
  and are what CBAM and Scope 3 Category 1 actually want.
- **Grid factors outside the US and UK.**

---

## Keeping packs current

Publishers revise these sets annually. Rebuilding a pack is almost entirely data
work — scripting, unit conversion and checking — rather than application code:
re-run `factor-packs/build.py` against the new publisher file, review the diff,
and load it with a later `effective_from` so historical entries keep the
factors they were calculated with.
