# Factor packs

Emission factors ship as CSV packs rather than seed migrations, so that
attribution travels with the data and a BROC upgrade never silently changes
last year's numbers. See [`../docs/FACTORS.md`](../docs/FACTORS.md) for which
sources may legally be redistributed — **GREET may not**, despite being free to
download.

```
factor-packs/
  build.py          inspect a publication, then emit factors.csv from a mapping
  verify.py         validate a pack before loading it
  <pack>/
    ATTRIBUTION.md  source, licence, URL, date retrieved
    mapping.json    which sheet and columns the factors came from
    factors.csv     the emitted pack
```

## Why there is no factor data committed yet

The three packs here are scaffolded with their attribution and mapping, and no
`factors.csv`. That is deliberate: **nobody should transcribe factor values by
hand, and an AI should not either.** Thousands of numbers read out of a
spreadsheet is precisely where a silent wrong number enters a system whose
entire value is defensible numbers, and a wrong factor that parses cleanly is
the worst defect this project can ship.

So the tooling converts the publisher's own file, and the conversion is
reviewable and repeatable. Building a pack takes about twenty minutes.

## Building a pack

```bash
pip install openpyxl

# 1. Download the official file. Record the URL and today's date in ATTRIBUTION.md.

# 2. See what is actually in it — publishers rearrange sheets every year.
./build.py inspect ~/Downloads/ghg-conversion-factors-2026.xlsx

# 3. Edit the pack's mapping.json to match what you saw.

# 4. Emit.
./build.py build defra-2026/mapping.json

# 5. Validate. Never skip this.
./verify.py defra-2026/factors.csv

# 6. Spot-check ten rows by hand against the source document, across different
#    tables. Ten catches transcription AND unit errors; one catches neither
#    reliably.
```

Then load it at `/data/factors` → Import.

## What verify.py catches that the importer cannot

The importer validates structure. The verifier validates plausibility:

- A factor outside an order-of-magnitude band for its unit — which is what a
  conversion error off by 1,000 or 3.6 looks like. This is the single most
  likely real mistake.
- A unit that disagrees with the category's denominator.
- Two rows fighting over the same effective-date window for one key, named with
  both row numbers rather than surfacing one constraint violation partway
  through a load.
- A `factor_source` that names an organisation rather than a findable document.
  "DEFRA" is not a source; "DEFRA 2026 GHG Conversion Factors, Table 1 (fuels)"
  is.
- A factor of exactly zero, which downstream is indistinguishable from "not
  measured".

The plausibility bands in `verify.py` are **wide sanity brackets, not
authoritative values**, and must never be used as factors.

## Mapping format

```json
{
  "source_file": "ghg-conversion-factors-2026.xlsx",
  "source_url": "https://www.gov.uk/government/collections/...",
  "retrieved": "2026-09-14",
  "factor_source": "DEFRA 2026 GHG Conversion Factors for Company Reporting",
  "data_year": 2026,
  "effective_from": "2026-01-01",
  "effective_to": null,
  "groups": [
    {
      "category": "scope1",
      "sheet": "Fuels",
      "header_row": 1,
      "key_column": "Fuel",
      "label_column": "Fuel description",
      "value_column": "kg CO2e",
      "source_unit": "kwh",
      "factor_source": "DEFRA 2026 GHG Conversion Factors, Table 1 (fuels)",
      "note": "Gross CV basis"
    }
  ]
}
```

`source_unit` drives the conversion to the category's denominator — MMBtu for
Scope 1, kWh for location-based Scope 2, kg for refrigerants. Recognised:
`mmbtu`, `kwh`, `mwh`, `gj`, `mj`, `therm`, and mass units for grid factors
published in pounds.

For a factor published **per physical unit** (litre, m³, kg of fuel) the
conversion needs that fuel's energy content, so the mapping must supply
`energy_content_mmbtu_per_unit` taken from the publication's own energy-content
table. The script refuses rather than assuming one — an assumed energy content
is an invented factor.

Set `factor_source` per group, not just at the top. Different tables in one
publication are different sources to an auditor.
