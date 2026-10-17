# eGRID

**Publisher** US Environmental Protection Agency
**Licence** Work of the US Government — public domain.
**Source** https://www.epa.gov/egrid
**Retrieved** _(fill in when you download)_
**Data year** 2023 _(the year the generation data describes, not the release year)_

US grid emission rates by eGRID subregion. This is the default source for
location-based Scope 2 in the United States.

## Notes for whoever rebuilds this

- **Subregion, not state.** eGRID subregions cross state lines, and a state
  average is a different number. `factor_key` should be the subregion acronym
  (RFCW, SRVC, CAMX…), which is what a site maps to.
- eGRID releases lag their data year by roughly two years. `data_year` is the
  generation year; `effective_from` is when you started applying it.
- Use the **output** emission rate for Scope 2, not the input rate.
- The workbook has separate sheets for subregion, state and national. Only take
  the one you mean.
