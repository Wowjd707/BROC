/**
 * PFAS per part: what each declaration still lacks, and which regimes a part
 * touches given where it is sold. Pure functions, tested in pfas-core.test.ts.
 *
 * PFAS rules move often, so each regime below carries its sources and the date
 * it was last verified. Re-verify before relying on one, and update the date
 * when you do. These rules decide what BROC flags for attention; they are not
 * a legal determination, and a part that appears under a regime is one to
 * check, not one found in breach.
 */

export type PfasStatus = 'unknown' | 'none' | 'intentionally_added';
export type PfasBasis = 'supplier_declaration' | 'test_report' | 'engineering_assessment' | 'other';

export const STATUS_LABEL: Record<PfasStatus, string> = {
  unknown: 'No declaration',
  none: 'No intentionally added PFAS',
  intentionally_added: 'Contains intentionally added PFAS',
};
export const BASIS_LABEL: Record<PfasBasis, string> = {
  supplier_declaration: 'Supplier declaration',
  test_report: 'Test report',
  engineering_assessment: 'Engineering assessment',
  other: 'Other',
};

export interface DeclarationRow {
  id: string;
  product_id: string;
  status: PfasStatus;
  basis: PfasBasis | null;
  evidence: string | null;
  declared_on: string | null;
  supplier_id: string | null;
  markets: string[];
  product_category: string | null;
  notes: string | null;
}

export interface SubstanceRow {
  id: string;
  declaration_id: string;
  name: string;
  cas_number: string | null;
  function: string | null;
  component: string | null;
  amount_low: number | null;
  amount_high: number | null;
  amount_unit: 'ppm' | 'percent' | 'mg_per_unit' | null;
  notes: string | null;
}

export interface Issue { level: 'block' | 'warn'; message: string }

/** A declaration older than this is flagged for renewal. */
export const STALE_MONTHS = 24;

/**
 * CAS Registry Number check digit: the digits before it, read right to left,
 * each multiplied by its position (1, 2, 3…), summed, modulo 10.
 */
export function validCas(cas: string): boolean {
  const m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas.trim());
  if (!m) return false;
  const digits = (m[1] + m[2]).split('').reverse().map(Number);
  const sum = digits.reduce((s, d, i) => s + d * (i + 1), 0);
  return sum % 10 === Number(m[3]);
}

function monthsBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

export function declarationIssues(d: DeclarationRow | null, substances: SubstanceRow[], today: string): Issue[] {
  if (!d || d.status === 'unknown') return [{ level: 'block', message: 'No PFAS declaration: the part is not known to be free of intentionally added PFAS.' }];
  const out: Issue[] = [];
  if (!d.evidence?.trim()) out.push({ level: 'block', message: 'The declaration has no evidence behind it.' });
  if (d.declared_on && monthsBetween(d.declared_on, today) >= STALE_MONTHS) {
    out.push({ level: 'warn', message: `Declared ${d.declared_on}, more than ${STALE_MONTHS} months ago; ask for a current one.` });
  }
  if (d.status === 'intentionally_added') {
    const mine = substances.filter((s) => s.declaration_id === d.id);
    if (mine.length === 0) out.push({ level: 'block', message: 'Contains intentionally added PFAS, but no substance is listed.' });
    for (const s of mine) {
      if (!s.cas_number) out.push({ level: 'warn', message: `${s.name}: no CAS number; most reports ask for one.` });
      else if (!validCas(s.cas_number)) out.push({ level: 'block', message: `${s.name}: ${s.cas_number} is not a valid CAS number (check digit).` });
      if (!s.function?.trim()) out.push({ level: 'warn', message: `${s.name}: what the PFAS does in the part is not recorded.` });
      if (s.amount_low == null && s.amount_high == null) out.push({ level: 'warn', message: `${s.name}: no amount or range recorded.` });
    }
  }
  if (d.markets.length === 0) out.push({ level: 'warn', message: 'No markets recorded, so BROC cannot tell which PFAS rules apply.' });
  return out;
}

export interface Regime {
  code: string;
  name: string;
  /** What the part's facts mean under this regime. */
  summary: string;
  sources: { label: string; url: string }[];
  verified: string;
  applies: (d: DeclarationRow, p: { country_of_origin: string | null }) => boolean;
}

const soldIn = (d: DeclarationRow, j: string) => d.markets.some((m) => m === j);
const soldInUs = (d: DeclarationRow) => d.markets.some((m) => m === 'US' || m.startsWith('US-'));

/**
 * Each rule is re-verified against its sources before it is relied on; update
 * `verified` when you do. If the regulatory tracker holds the same law, change
 * both together.
 */
export const REGIMES: Regime[] = [
  {
    code: 'US-MN',
    name: 'Minnesota — Amara\'s Law (Minn. Stat. § 116.943)',
    summary: 'Products sold in Minnesota with intentionally added PFAS are reported to the MPCA: initial reports were due 15 September 2026, then updates each year. Products made before 1 July 2023 are excluded from reporting (2026 amendment). Sale of any product with intentionally added PFAS is prohibited from 1 January 2032 unless the MPCA decides the use is currently unavoidable.',
    sources: [
      { label: 'MPCA — PFAS in products', url: 'https://www.pca.state.mn.us/get-engaged/pfas-in-products' },
      { label: 'Bergeson & Campbell — deadline extended to 15 September 2026', url: 'https://www.lawbc.com/minnesota-extends-pfas-reporting-deadline-to-september-15-2026-provides-resources-and-support-for-using-reporting-system/' },
    ],
    verified: '2026-11-24',
    applies: (d) => d.status === 'intentionally_added' && soldIn(d, 'US-MN'),
  },
  {
    code: 'US-ME',
    name: 'Maine — Products containing PFAS (38 M.R.S. § 1614)',
    summary: 'Sale of any product with intentionally added PFAS is prohibited from 1 January 2032 unless Maine DEP designates the use as currently unavoidable; some categories are prohibited earlier. Reporting applies only to products covered by a currently-unavoidable-use designation.',
    sources: [
      { label: 'Maine DEP — PFAS in Products', url: 'https://www.maine.gov/dep/spills/topics/pfas/PFAS-products/' },
      { label: '38 M.R.S. § 1614', url: 'https://legislature.maine.gov/statutes/38/title38sec1614.html' },
    ],
    verified: '2026-11-24',
    applies: (d) => d.status === 'intentionally_added' && soldIn(d, 'US-ME'),
  },
  {
    code: 'EPA-PFAS-TSCA',
    name: 'US federal — TSCA section 8(a)(7) reporting (40 CFR part 705)',
    summary: 'Manufacturers and importers of PFAS or PFAS-containing articles since 2011 report to EPA. The submission period starts on 31 January 2027 or 60 days after EPA\'s pending revision takes effect, whichever is earlier; the revision as proposed would exempt imported articles. Parts with PFAS imported into the US are flagged for review.',
    sources: [
      { label: 'Federal Register — start of the submission period (13 April 2026)', url: 'https://www.federalregister.gov/documents/2026/04/13/2026-07062/modification-to-the-start-of-the-submission-period-for-perfluoroalkyl-and-polyfluoroalkyl-substances' },
      { label: 'EPA — TSCA 8(a)(7) reporting', url: 'https://www.epa.gov/assessing-and-managing-chemicals-under-tsca/tsca-section-8a7-reporting-and-recordkeeping' },
    ],
    verified: '2026-11-24',
    applies: (d, p) => d.status === 'intentionally_added' && soldInUs(d) && !!p.country_of_origin && p.country_of_origin !== 'US',
  },
];

export function regimesFor(d: DeclarationRow | null, p: { country_of_origin: string | null }): Regime[] {
  return d ? REGIMES.filter((r) => r.applies(d, p)) : [];
}

const amount = (s: SubstanceRow) => {
  if (s.amount_low == null && s.amount_high == null) return '';
  const unit = { ppm: 'ppm', percent: '%', mg_per_unit: 'mg per unit' }[s.amount_unit ?? 'ppm'];
  if (s.amount_low != null && s.amount_high != null && Number(s.amount_low) !== Number(s.amount_high)) return `${s.amount_low}–${s.amount_high} ${unit}`;
  return `${s.amount_low ?? s.amount_high} ${unit}`;
};

/** One row per substance per part: the facts most PFAS reports ask for. */
export function inventoryCsv(
  parts: { id: string; part_number: string; description: string | null; country_of_origin: string | null }[],
  declarations: DeclarationRow[], substances: SubstanceRow[],
): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows: unknown[][] = [['Part', 'Description', 'Status', 'Substance', 'CAS number', 'Function', 'Where in the part', 'Amount', 'Markets', 'Basis', 'Evidence', 'Declared on', 'Regimes to check']];
  for (const p of parts) {
    const d = declarations.find((x) => x.product_id === p.id) ?? null;
    const regimes = regimesFor(d, p).map((r) => r.code).join(' ');
    const base = [p.part_number, p.description, STATUS_LABEL[d?.status ?? 'unknown']];
    const tail = [d?.markets.join(' ') ?? '', d?.basis ? BASIS_LABEL[d.basis] : '', d?.evidence ?? '', d?.declared_on ?? '', regimes];
    const mine = d ? substances.filter((s) => s.declaration_id === d.id) : [];
    if (mine.length === 0) rows.push([...base, '', '', '', '', '', ...tail]);
    for (const s of mine) rows.push([...base, s.name, s.cas_number ?? '', s.function ?? '', s.component ?? '', amount(s), ...tail]);
  }
  return rows.map((r) => r.map(q).join(',')).join('\n');
}
