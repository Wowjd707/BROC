# DEFRA / UK Government GHG Conversion Factors

**Publisher** UK Department for Energy Security and Net Zero
**Licence** [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)
— permits copying, distribution and adaptation, including commercially, with
attribution.
**Source** https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting
**Retrieved** _(fill in when you download)_
**Data year** 2026

The broadest openly licensed set available: fuels, transport, materials, water
and waste — roughly four thousand factors.

## Required attribution

OGL v3.0 requires this notice wherever the data is used:

> Contains public sector information licensed under the Open Government
> Licence v3.0. UK Government GHG Conversion Factors for Company Reporting,
> 2026, Department for Energy Security and Net Zero.

It appears in the repository `NOTICE` file as well as here.

## Notes for whoever rebuilds this

- **Gross CV (HHV) versus net CV (LHV).** DEFRA publishes both. BROC's Scope 1
  denominator is MMBtu and the EPA factors already loaded are HHV, so take gross
  CV or the two sets will not be comparable. Record which in `notes`.
- Many factors are published per litre or per kg, so those groups need
  `energy_content_mmbtu_per_unit` from DEFRA's own energy-content table.
- The workbook has many sheets and a multi-row header. Run `build.py inspect`
  and set `header_row` per group rather than assuming row 1.
- Only fuels and electricity map to `scope1` / `scope2_location`. Materials,
  waste and water factors belong to Scope 3 and load through the Scope 3
  importer instead.
