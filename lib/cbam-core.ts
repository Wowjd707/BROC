/**
 * CBAM definitive regime: the annual threshold, embedded emissions per import,
 * and the annual declaration. Pure functions, tested in cbam-core.test.ts.
 *
 * Sources (Regulation (EU) 2023/956 as amended by Regulation (EU) 2025/2083):
 *   Art. 2a(1)   the single mass-based threshold applies to the total net mass
 *                of goods under all CN codes, per importer and calendar year
 *   Art. 2a(2)   above it, every obligation applies to the emissions embedded
 *                in ALL goods imported, not just those over the threshold
 *   Art. 2a(4)   it does not apply to imports of electricity or hydrogen
 *   Annex VII(1) the threshold is 50 tonnes of net mass
 *   Art. 6(1)    the declaration is due by 30 September of the following year,
 *                first in 2027 for 2026
 *   Art. 6(2)    (a) total quantity per type of goods, (b) total embedded
 *                emissions, (c) certificates to surrender, (d) verification
 *                reports where applicable
 *   Annex II     iron and steel, aluminium and hydrogen: direct emissions only
 *
 * BROC never supplies an emission value: every figure comes from the producer
 * or from the Commission's default-value publication, with its source.
 */

import type { CBAMSector } from './cbam-data';

export interface ThresholdEntry { tonnes: number; source: string }

/**
 * The threshold by calendar year. Art. 2a(3) lets the Commission change it,
 * effective from the next 1 January, so a year missing here falls back to the
 * latest known value and says so.
 */
export const CBAM_THRESHOLDS: Record<number, ThresholdEntry> = {
  2026: { tonnes: 50, source: 'Regulation (EU) 2023/956, Annex VII point 1, as inserted by Regulation (EU) 2025/2083' },
};

export function thresholdFor(year: number): ThresholdEntry & { confirmed: boolean } {
  if (CBAM_THRESHOLDS[year]) return { ...CBAM_THRESHOLDS[year], confirmed: true };
  const known = Object.keys(CBAM_THRESHOLDS).map(Number).filter((y) => y <= year).sort((a, b) => b - a);
  const base = CBAM_THRESHOLDS[known[0] ?? Math.min(...Object.keys(CBAM_THRESHOLDS).map(Number))];
  return { ...base, confirmed: false };
}

/** Art. 6(1): 30 September of the year after the imports. */
export function declarationDue(year: number): string {
  return `${year + 1}-09-30`;
}

/**
 * The CBAM sector for a CN or HS code, from the headings of Annex I. Only used
 * to decide which emissions count and whether the threshold applies; whether a
 * part is in scope at all comes from the organization's cited scope rules.
 */
const SECTOR_PREFIXES: [string, CBAMSector][] = [
  ['2716', 'Electricity'],
  ['280410', 'Hydrogen'],
  ['25070080', 'Cement'], ['2523', 'Cement'],
  ['2808', 'Fertilisers'], ['2814', 'Fertilisers'], ['283421', 'Fertilisers'], ['3102', 'Fertilisers'], ['3105', 'Fertilisers'],
  ['260112', 'Iron & Steel'], ['72', 'Iron & Steel'],
  ['7301', 'Iron & Steel'], ['7302', 'Iron & Steel'], ['7303', 'Iron & Steel'], ['7304', 'Iron & Steel'],
  ['7305', 'Iron & Steel'], ['7306', 'Iron & Steel'], ['7307', 'Iron & Steel'], ['7308', 'Iron & Steel'],
  ['7309', 'Iron & Steel'], ['7310', 'Iron & Steel'], ['7311', 'Iron & Steel'], ['7318', 'Iron & Steel'], ['7326', 'Iron & Steel'],
  ['76', 'Aluminium'],
];

export function sectorForCode(code: string | null | undefined): CBAMSector | null {
  const c = (code ?? '').replace(/[\s.]/g, '');
  if (!c) return null;
  const hit = SECTOR_PREFIXES.filter(([p]) => c.startsWith(p)).sort((a, b) => b[0].length - a[0].length)[0];
  return hit?.[1] ?? null;
}

const DIRECT_ONLY: readonly CBAMSector[] = ['Iron & Steel', 'Aluminium', 'Hydrogen'];
const OUTSIDE_THRESHOLD: readonly CBAMSector[] = ['Electricity', 'Hydrogen'];

export interface ImportRow {
  id: string;
  product_id: string;
  supplier_id: string | null;
  import_date: string;
  customs_reference: string | null;
  cn_code: string;
  quantity: number;
  unit: 'tonne' | 'MWh';
  country_of_origin: string;
  installation_name: string | null;
  installation_id: string | null;
  direct_emissions: number | null;
  indirect_emissions: number | null;
  emissions_basis: 'actual' | 'default' | null;
  emissions_source: string | null;
  verification_report: string | null;
  carbon_price_paid_eur: number | null;
  carbon_price_evidence: string | null;
  notes: string | null;
}

export interface DeclarationRow {
  id: string;
  year: number;
  authorised_declarant_number: string | null;
  carbon_price_deduction: number | null;
  carbon_price_deduction_source: string | null;
  free_allocation_adjustment: number | null;
  free_allocation_source: string | null;
  price_q1_eur: number | null;
  price_q2_eur: number | null;
  price_q3_eur: number | null;
  price_q4_eur: number | null;
  price_source: string | null;
  status: 'draft' | 'submitted';
  submitted_on: string | null;
  registry_reference: string | null;
  notes: string | null;
}

export const yearOf = (i: Pick<ImportRow, 'import_date'>) => Number(i.import_date.slice(0, 4));
export const quarterOf = (i: Pick<ImportRow, 'import_date'>) => Math.floor((Number(i.import_date.slice(5, 7)) - 1) / 3) + 1;

/**
 * Embedded emissions of one import, in tCO2e. Null when a figure the sector
 * needs is missing: an unknown is reported as unknown, never as zero.
 */
export function embeddedEmissions(i: ImportRow): { perUnit: number; total: number } | null {
  const sector = sectorForCode(i.cn_code);
  const direct = i.direct_emissions == null ? null : Number(i.direct_emissions);
  const indirect = i.indirect_emissions == null ? null : Number(i.indirect_emissions);
  if (direct == null) return null;
  const directOnly = sector ? DIRECT_ONLY.includes(sector) : false;
  if (!directOnly && indirect == null) return null;
  const perUnit = direct + (directOnly ? 0 : indirect ?? 0);
  return { perUnit, total: perUnit * Number(i.quantity) };
}

/** Whether the import's net mass counts towards the threshold (Art. 2a(1), (4)). */
export function countsTowardsThreshold(i: Pick<ImportRow, 'cn_code' | 'unit'>): boolean {
  const sector = sectorForCode(i.cn_code);
  return i.unit === 'tonne' && !(sector && OUTSIDE_THRESHOLD.includes(sector));
}

export interface Issue { level: 'block' | 'warn'; message: string }

export function importIssues(i: ImportRow): Issue[] {
  const out: Issue[] = [];
  const sector = sectorForCode(i.cn_code);
  if (!sector) out.push({ level: 'warn', message: `CN ${i.cn_code} is not under a CBAM heading of Annex I. Check the code and your scope rules.` });
  if (i.direct_emissions == null) {
    out.push({ level: 'block', message: 'No embedded emissions yet. Ask the producer, or use the Commission\'s default value and cite it.' });
  } else if (sector && !DIRECT_ONLY.includes(sector) && i.indirect_emissions == null) {
    out.push({ level: 'block', message: `${sector} counts indirect emissions too (Annex II); add them.` });
  }
  if (i.emissions_basis === 'actual' && !i.verification_report?.trim()) {
    out.push({ level: 'warn', message: 'Actual values need a verification report from an accredited verifier (Art. 8, Annex VI).' });
  }
  if (!i.installation_name?.trim() && i.emissions_basis === 'actual') {
    out.push({ level: 'warn', message: 'Name the producing installation the actual values come from.' });
  }
  if (i.carbon_price_paid_eur != null && !i.carbon_price_evidence?.trim()) {
    out.push({ level: 'warn', message: 'A carbon price paid abroad needs its evidence to be deducted (Art. 9).' });
  }
  return out;
}

export interface DeclarationLine {
  cn_code: string;
  sector: CBAMSector | null;
  unit: 'tonne' | 'MWh';
  quantity: number;
  embedded: number;          // tCO2e, from complete imports only
  incomplete: number;        // imports on this line without emissions
  actualShare: number | null; // share of embedded emissions on actual values
  countries: string[];
  installations: string[];
  verificationReports: string[];
}

export interface YearSummary {
  year: number;
  imports: number;
  thresholdMass: number;      // tonnes counting towards the threshold
  threshold: ReturnType<typeof thresholdFor>;
  exceeded: boolean;
  /** Electricity or hydrogen imported: obligations apply regardless of mass (Art. 2a(4)). */
  outsideThresholdGoods: boolean;
  obligationsApply: boolean;
  embedded: number;
  incomplete: number;
  actualShare: number | null;
  carbonPricePaidEur: number;
  lines: DeclarationLine[];
  embeddedByQuarter: [number, number, number, number];
  due: string;
}

export function summariseYear(all: ImportRow[], year: number): YearSummary {
  const rows = all.filter((i) => yearOf(i) === year);
  const byCn = new Map<string, ImportRow[]>();
  for (const i of rows) byCn.set(i.cn_code, [...(byCn.get(i.cn_code) ?? []), i]);
  const byQuarter: [number, number, number, number] = [0, 0, 0, 0];
  let embedded = 0, actual = 0, incomplete = 0;
  const lines: DeclarationLine[] = [...byCn.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cn, list]) => {
    let lineEmb = 0, lineActual = 0, lineInc = 0;
    for (const i of list) {
      const e = embeddedEmissions(i);
      if (!e) { lineInc++; continue; }
      lineEmb += e.total;
      byQuarter[quarterOf(i) - 1] += e.total;
      if (i.emissions_basis === 'actual') lineActual += e.total;
    }
    embedded += lineEmb; actual += lineActual; incomplete += lineInc;
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()))].sort();
    return {
      cn_code: cn,
      sector: sectorForCode(cn),
      unit: list[0].unit,
      quantity: list.reduce((s, i) => s + Number(i.quantity), 0),
      embedded: lineEmb,
      incomplete: lineInc,
      actualShare: lineEmb > 0 ? lineActual / lineEmb : null,
      countries: uniq(list.map((i) => i.country_of_origin)),
      installations: uniq(list.map((i) => i.installation_name)),
      verificationReports: uniq(list.filter((i) => i.emissions_basis === 'actual').map((i) => i.verification_report)),
    };
  });
  const thresholdMass = rows.filter(countsTowardsThreshold).reduce((s, i) => s + Number(i.quantity), 0);
  const threshold = thresholdFor(year);
  const exceeded = thresholdMass > threshold.tonnes;
  const outsideThresholdGoods = rows.some((i) => !countsTowardsThreshold(i));
  return {
    year,
    imports: rows.length,
    thresholdMass,
    threshold,
    exceeded,
    outsideThresholdGoods,
    obligationsApply: exceeded || outsideThresholdGoods,
    embedded,
    incomplete,
    actualShare: embedded > 0 ? actual / embedded : null,
    carbonPricePaidEur: rows.reduce((s, i) => s + (i.carbon_price_paid_eur == null ? 0 : Number(i.carbon_price_paid_eur)), 0),
    lines,
    embeddedByQuarter: byQuarter,
    due: declarationDue(year),
  };
}

export interface Certificates {
  gross: number;
  carbonPriceDeduction: number;
  freeAllocationAdjustment: number;
  net: number;
  /** EUR, when a price is recorded for every quarter that had emissions. */
  estimatedCostEur: number | null;
  /** Average price weighted by each quarter's emissions. */
  averagePriceEur: number | null;
}

/**
 * Certificates for the declaration (Art. 6(2)(c)): one per tonne of embedded
 * emissions, less the deductions the declarant records. The cost estimate
 * prices each quarter's emissions at that quarter's price, which is how 2026
 * certificates are priced (Implementing Regulation (EU) 2025/2548).
 */
export function certificatesFor(s: YearSummary, d: Pick<DeclarationRow,
  'carbon_price_deduction' | 'free_allocation_adjustment' | 'price_q1_eur' | 'price_q2_eur' | 'price_q3_eur' | 'price_q4_eur'> | null): Certificates {
  const cp = Number(d?.carbon_price_deduction ?? 0);
  const fa = Number(d?.free_allocation_adjustment ?? 0);
  const net = Math.max(0, s.embedded - cp - fa);
  const prices = [d?.price_q1_eur, d?.price_q2_eur, d?.price_q3_eur, d?.price_q4_eur].map((p) => (p == null ? null : Number(p)));
  let priced = 0, weight = 0, missing = false;
  s.embeddedByQuarter.forEach((e, q) => {
    if (e <= 0) return;
    if (prices[q] == null) { missing = true; return; }
    priced += e * (prices[q] as number);
    weight += e;
  });
  const averagePriceEur = !missing && weight > 0 ? priced / weight : null;
  return {
    gross: s.embedded,
    carbonPriceDeduction: cp,
    freeAllocationAdjustment: fa,
    net,
    averagePriceEur,
    estimatedCostEur: averagePriceEur == null ? null : net * averagePriceEur,
  };
}

/** What still stands between the year's data and a declaration. */
export function declarationIssues(s: YearSummary, d: DeclarationRow | null): Issue[] {
  const out: Issue[] = [];
  if (!s.obligationsApply) return out;
  if (s.incomplete > 0) out.push({ level: 'block', message: `${s.incomplete} import${s.incomplete === 1 ? ' has' : 's have'} no embedded emissions yet.` });
  if (!d?.authorised_declarant_number?.trim()) out.push({ level: 'block', message: 'No authorised CBAM declarant number recorded.' });
  const unverified = s.lines.some((l) => (l.actualShare ?? 0) > 0 && l.verificationReports.length === 0);
  if (unverified) out.push({ level: 'warn', message: 'Some actual values have no verification report listed (Art. 6(2)(d)).' });
  if (!s.threshold.confirmed) out.push({ level: 'warn', message: `No threshold is recorded for ${s.year}; ${s.threshold.tonnes} t from an earlier year is used. Check for a Commission update under Art. 2a(3).` });
  return out;
}

const fmt = (n: number, dp = 3) => (Math.round(n * 10 ** dp) / 10 ** dp).toString();

/** The declaration pack: one row per type of goods (Art. 6(2)(a)–(b)), then the certificate figures (c) and reports (d). */
export function declarationCsv(s: YearSummary, d: DeclarationRow | null, operator: string): string {
  const c = certificatesFor(s, d);
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows: unknown[][] = [
    ['CBAM annual declaration — working pack', `Year ${s.year}`, `Due ${s.due}`],
    ['Declarant', operator, d?.authorised_declarant_number ?? 'not recorded'],
    [],
    ['CN code', 'Sector', 'Unit', 'Quantity', 'Embedded emissions (tCO2e)', 'Share on actual values', 'Countries of origin', 'Installations', 'Verification reports', 'Imports without emissions'],
    ...s.lines.map((l) => [
      l.cn_code, l.sector ?? '', l.unit, fmt(l.quantity), fmt(l.embedded),
      l.actualShare == null ? '' : `${Math.round(l.actualShare * 100)}%`,
      l.countries.join(' '), l.installations.join('; '), l.verificationReports.join('; '), l.incomplete || '',
    ]),
    [],
    ['Embedded emissions, total (tCO2e)', fmt(s.embedded)],
    ['Less: carbon price paid in country of origin (Art. 9), certificates', fmt(c.carbonPriceDeduction), d?.carbon_price_deduction_source ?? ''],
    ['Less: free allocation adjustment (Implementing Regulation (EU) 2025/2620), certificates', fmt(c.freeAllocationAdjustment), d?.free_allocation_source ?? ''],
    ['CBAM certificates to surrender', fmt(c.net)],
    ['Estimated cost (EUR)', c.estimatedCostEur == null ? 'prices not recorded for every quarter' : fmt(c.estimatedCostEur, 2), d?.price_source ?? ''],
    [],
    ['Net mass counting towards the threshold (t)', fmt(s.thresholdMass), `threshold ${s.threshold.tonnes} t`, s.threshold.source],
  ];
  return rows.map((r) => r.map(q).join(',')).join('\n');
}
