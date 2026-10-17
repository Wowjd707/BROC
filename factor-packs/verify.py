#!/usr/bin/env python3
"""
Validate a factor pack CSV before it is loaded.

    ./verify.py epa-hub-2024/factors.csv
    ./verify.py --strict defra-2026/factors.csv

The importer in lib/custom-factor-import-core.ts validates structure at load
time. This validates the things a structural check cannot see: whether the
numbers are plausible for the unit they claim, whether two rows fight over the
same effective-date window, and whether the provenance is specific enough for
an auditor to follow.

Exit code 0 if the pack is loadable, 1 if not.
"""
from __future__ import annotations
import argparse, csv, re, sys
from collections import defaultdict
from datetime import date

COLUMNS = [
    'factor_category', 'factor_key', 'label', 'co2e_factor', 'unit',
    'factor_source', 'data_year', 'effective_from', 'effective_to', 'notes',
]

# The denominator each category is expressed per. Mirrors CATEGORY_UNIT in
# lib/custom-factor-import-core.ts, where it is derived from the category and
# never read from the file.
CATEGORY_UNIT = {
    'scope1': 'MMBtu',
    'scope2_location': 'kWh',
    'refrigerant': 'kg',
}

# Order-of-magnitude sanity bands in kg CO2e per the category's unit.
#
# These are NOT authoritative factor values and must never be used as one. They
# are deliberately wide brackets that catch the error that actually happens when
# building a pack: a unit conversion off by 1,000 or 3.6. A real factor sitting
# outside its band is possible — report it, look at it, and use --allow-outliers
# if it is genuinely correct.
#
#   scope1            kg CO2e / MMBtu   fuels cluster around 50-100
#   scope2_location   kg CO2e / kWh     grids range from near-zero to ~1.0
#   refrigerant       kg CO2e / kg      GWPs run from single digits to ~15,000
PLAUSIBLE = {
    'scope1': (1.0, 1000.0),
    'scope2_location': (0.0, 2.0),
    'refrigerant': (1.0, 30000.0),
}

ISO = re.compile(r'^\d{4}-\d{2}-\d{2}$')


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, row: int | None, msg: str) -> None:
        self.errors.append(f"row {row}: {msg}" if row else msg)

    def warn(self, row: int | None, msg: str) -> None:
        self.warnings.append(f"row {row}: {msg}" if row else msg)


def parse_date(s: str) -> date | None:
    if not ISO.match(s or ''):
        return None
    try:
        y, m, d = (int(p) for p in s.split('-'))
        return date(y, m, d)
    except ValueError:
        return None


def verify(path: str, strict: bool, allow_outliers: bool) -> Report:
    r = Report()
    try:
        with open(path, newline='', encoding='utf-8-sig') as fh:
            reader = csv.DictReader(fh)
            header = reader.fieldnames or []
            if header != COLUMNS:
                missing = [c for c in COLUMNS if c not in header]
                extra = [c for c in header if c not in COLUMNS]
                if missing:
                    r.error(None, f"missing columns: {', '.join(missing)}")
                if extra:
                    r.error(None, f"unexpected columns: {', '.join(extra)}")
                if not missing and not extra:
                    r.error(None, f"columns are in the wrong order; expected {', '.join(COLUMNS)}")
                if missing:
                    return r
            rows = list(reader)
    except FileNotFoundError:
        r.error(None, f"no such file: {path}")
        return r

    if not rows:
        r.error(None 
                , "the file has a header but no rows")
        return r

    # (category, key) -> list of (from, to, line)
    windows: dict[tuple[str, str], list[tuple[date, date | None, int]]] = defaultdict(list)
    sources: set[str] = set()
    outliers = 0

    for i, row in enumerate(rows, start=2):   # line 1 is the header
        cat = (row.get('factor_category') or '').strip()
        key = (row.get('factor_key') or '').strip()

        if cat not in CATEGORY_UNIT:
            r.error(i, f"factor_category '{cat}' is not one of {', '.join(CATEGORY_UNIT)}")
            continue
        if not key:
            r.error(i, "factor_key is empty")
            continue

        # ── unit must match the category's denominator ─────────────────────
        unit = (row.get('unit') or '').strip()
        expected = CATEGORY_UNIT[cat]
        if unit != expected:
            r.error(i, f"unit '{unit}' does not match the {cat} denominator '{expected}' "
                       f"(the importer derives the unit from the category, so a mismatch here "
                       f"means the value was converted wrongly)")

        # ── the factor itself ──────────────────────────────────────────────
        raw = (row.get('co2e_factor') or '').strip()
        try:
            val = float(raw)
        except ValueError:
            r.error(i, f"co2e_factor '{raw}' is not a number")
            continue
        if val < 0:
            r.error(i, f"co2e_factor is negative ({val})")
        elif val == 0:
            r.warn(i, f"co2e_factor is exactly 0 for '{key}' — a zero factor and "
                      f"'not measured' look identical downstream; confirm it is really zero")
        else:
            lo, hi = PLAUSIBLE[cat]
            if not (lo <= val <= hi):
                outliers += 1
                msg = (f"co2e_factor {val} is outside the plausible band {lo}-{hi} "
                       f"kg CO2e/{expected} for {cat} — almost always a unit conversion error")
                (r.warn if allow_outliers else r.error)(i, msg)

        # ── provenance ─────────────────────────────────────────────────────
        src = (row.get('factor_source') or '').strip()
        if not src:
            r.error(i, "factor_source is empty — a factor without provenance is one an auditor discounts")
        else:
            sources.add(src)
            if len(src) < 12 or ' ' not in src:
                r.warn(i, f"factor_source '{src}' names an organisation rather than a document. "
                          f"'DEFRA 2026 GHG Conversion Factors, Table 1 (fuels)' is findable; 'DEFRA' is not")

        yr = (row.get('data_year') or '').strip()
        if not yr.isdigit() or not (1990 <= int(yr) <= date.today().year + 1):
            r.error(i, f"data_year '{yr}' is not a plausible year")

        # ── effective dating ───────────────────────────────────────────────
        ef = parse_date((row.get('effective_from') or '').strip())
        if ef is None:
            r.error(i, f"effective_from '{row.get('effective_from')}' is not YYYY-MM-DD")
            continue
        et_raw = (row.get('effective_to') or '').strip()
        et = None
        if et_raw:
            et = parse_date(et_raw)
            if et is None:
                r.error(i, f"effective_to '{et_raw}' is not YYYY-MM-DD")
                continue
            if et <= ef:
                r.error(i, f"effective_to {et} is not after effective_from {ef}")
                continue
        windows[(cat, key)].append((ef, et, i))

    # ── overlapping windows for the same key ───────────────────────────────
    # The database rejects these (migration 018). Catching it here means a
    # readable message naming both rows instead of one constraint violation
    # partway through a load.
    for (cat, key), ws in windows.items():
        ws.sort(key=lambda w: w[0])
        for a, b in zip(ws, ws[1:]):
            a_from, a_to, a_line = a
            b_from, _, b_line = b
            if a_to is None or a_to > b_from:
                r.error(None, f"rows {a_line} and {b_line} both cover {cat}/{key} from {b_from} "
                              f"({'open-ended' if a_to is None else f'first ends {a_to}'}) — "
                              f"the importer rejects overlapping windows")

    if strict and r.warnings:
        r.errors.extend(f"(strict) {w}" for w in r.warnings)
        r.warnings = []

    print(f"{path}: {len(rows)} rows, {len(windows)} distinct factor keys, "
          f"{len(sources)} distinct sources")
    if outliers:
        print(f"  {outliers} row(s) outside the plausibility band")
    return r


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('csv_path')
    ap.add_argument('--strict', action='store_true', help='treat warnings as errors')
    ap.add_argument('--allow-outliers', action='store_true',
                    help='report values outside the plausibility band as warnings rather than errors')
    args = ap.parse_args()

    r = verify(args.csv_path, args.strict, args.allow_outliers)

    for w in r.warnings:
        print(f"  warning: {w}")
    for e in r.errors:
        print(f"  ERROR:   {e}")

    if r.errors:
        print(f"\n{len(r.errors)} error(s). Do not load this pack.")
        return 1
    print(f"\nOK{f' — {len(r.warnings)} warning(s) worth reading' if r.warnings else ''}.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
