/**
 * PPWR packaging and EPR reporting: packaging weight per part, tonnes placed
 * per country and year, and what still stands between the data and a report.
 * Pure functions, tested in ppwr-core.test.ts.
 *
 * Sources (Regulation (EU) 2025/40):
 *   Art. 5(4)   lead, cadmium, mercury and hexavalent chromium together
 *               shall not exceed 100 mg/kg
 *   Art. 5(5)   from 12 August 2026, PFAS limits in food-contact packaging:
 *               25 ppb any PFAS, 250 ppb sum of PFAS, 50 ppm total PFAS
 *   Art. 7      minimum recycled content in plastic packaging, from 2030
 *   Art. 15, 39 technical documentation and the EU declaration of conformity
 *   Art. 44(2)  register in each Member State where packaging is first made
 *               available
 *   Art. 44(7)  report by 1 June for the preceding calendar year
 *   Art. 44(8)  producers under 10 tonnes a year report under Annex IX,
 *               Part B, point 2
 *   Annex IX    Part B, point 2: quantities by weight for glass, plastic,
 *               paper/cardboard, ferrous metal, aluminium, wood and other
 *
 * Outside the EU (a US state's packaging EPR law, say) BROC adds up the same
 * tonnes but states no deadline or rule: those belong to that scheme.
 */

export const MATERIALS = [
  { key: 'glass', label: 'Glass' },
  { key: 'plastic', label: 'Plastic' },
  { key: 'paper_cardboard', label: 'Paper and cardboard' },
  { key: 'ferrous_metal', label: 'Ferrous metal' },
  { key: 'aluminium', label: 'Aluminium' },
  { key: 'wood', label: 'Wood' },
  { key: 'other', label: 'Other' },
] as const;
export type Material = (typeof MATERIALS)[number]['key'];
export const MATERIAL_LABEL = Object.fromEntries(MATERIALS.map((m) => [m.key, m.label])) as Record<Material, string>;

export const FUNCTIONS = [
  { key: 'sales', label: 'Sales packaging' },
  { key: 'grouped', label: 'Grouped packaging' },
  { key: 'transport', label: 'Transport packaging' },
] as const;
export type PackagingFunction = (typeof FUNCTIONS)[number]['key'];
export const FUNCTION_LABEL = Object.fromEntries(FUNCTIONS.map((f) => [f.key, f.label])) as Record<PackagingFunction, string>;

export const EU_MEMBER_STATES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
] as const;
export const isEuMemberState = (j: string) => (EU_MEMBER_STATES as readonly string[]).includes(j);

/** Art. 44(8): producers placing less than this report under Annex IX, Part B, point 2. */
export const SMALL_PRODUCER_TONNES = 10;

export interface ComponentRow {
  id: string;
  product_id: string;
  name: string;
  material: Material;
  material_detail: string | null;
  function: PackagingFunction;
  weight_g: number;
  units_per_packaging: number;
  reusable: boolean;
  food_contact: boolean;
  recycled_content_pct: number | null;
  supplier_id: string | null;
  heavy_metals_evidence: string | null;
  pfas_evidence: string | null;
  conformity_reference: string | null;
  notes: string | null;
  is_active: boolean;
}

export interface PlacementRow {
  id: string;
  product_id: string;
  jurisdiction: string;
  year: number;
  quarter: number | null;
  units: number;
  source: string | null;
  notes: string | null;
}

export interface RegistrationRow {
  id: string;
  jurisdiction: string;
  register_name: string | null;
  registration_number: string | null;
  fulfilment: 'own' | 'pro' | 'authorised_representative';
  pro_name: string | null;
  authorised_representative: string | null;
  registered_on: string | null;
  notes: string | null;
}

export interface ReportRow {
  id: string;
  jurisdiction: string;
  year: number;
  status: 'draft' | 'submitted';
  submitted_on: string | null;
  reference: string | null;
  notes: string | null;
}

export interface Issue { level: 'block' | 'warn'; message: string }

/** Grams of this packaging per unit of the part. */
export const gramsPerUnit = (c: Pick<ComponentRow, 'weight_g' | 'units_per_packaging'>) =>
  Number(c.weight_g) / Number(c.units_per_packaging);

export function componentIssues(c: ComponentRow): Issue[] {
  const out: Issue[] = [];
  if (c.food_contact && !c.pfas_evidence?.trim()) {
    out.push({ level: 'block', message: 'Food-contact packaging needs evidence it meets the PFAS limits of Art. 5(5), in force since 12 August 2026.' });
  }
  if (!c.heavy_metals_evidence?.trim()) {
    out.push({ level: 'warn', message: 'No evidence yet that lead, cadmium, mercury and hexavalent chromium stay under 100 mg/kg (Art. 5(4)).' });
  }
  if (!c.conformity_reference?.trim()) {
    out.push({ level: 'warn', message: 'No EU declaration of conformity referenced (Art. 39).' });
  }
  if (c.material === 'plastic' && c.recycled_content_pct == null) {
    out.push({ level: 'warn', message: 'Recycled content not recorded; minimum levels for plastic packaging apply from 2030 (Art. 7).' });
  }
  return out;
}

type ByMaterial = Record<Material, number>;
const zero = (): ByMaterial => Object.fromEntries(MATERIALS.map((m) => [m.key, 0])) as ByMaterial;

export interface JurisdictionReport {
  jurisdiction: string;
  year: number;
  eu: boolean;
  units: number;
  /** Tonnes by material, all functions. */
  tonnes: ByMaterial;
  /** Tonnes by function, then material. */
  byFunction: Record<PackagingFunction, ByMaterial>;
  reusableTonnes: number;
  singleUseTonnes: number;
  total: number;
  /** Parts placed here with no packaging recorded: their tonnes are unknown, not zero. */
  partsWithoutPackaging: string[];
  smallProducer: boolean | null;
  due: string | null;
}

export function jurisdictionReport(
  placements: PlacementRow[], components: ComponentRow[], jurisdiction: string, year: number,
): JurisdictionReport {
  const rows = placements.filter((p) => p.jurisdiction === jurisdiction && p.year === year);
  const tonnes = zero();
  const byFunction = { sales: zero(), grouped: zero(), transport: zero() } as Record<PackagingFunction, ByMaterial>;
  let reusable = 0, single = 0, units = 0;
  const missing = new Set<string>();
  for (const p of rows) {
    units += Number(p.units);
    const comps = components.filter((c) => c.product_id === p.product_id && c.is_active);
    if (comps.length === 0) { missing.add(p.product_id); continue; }
    for (const c of comps) {
      const t = (gramsPerUnit(c) * Number(p.units)) / 1e6;
      tonnes[c.material] += t;
      byFunction[c.function][c.material] += t;
      if (c.reusable) reusable += t; else single += t;
    }
  }
  const total = Object.values(tonnes).reduce((a, b) => a + b, 0);
  const eu = isEuMemberState(jurisdiction);
  return {
    jurisdiction, year, eu, units, tonnes, byFunction,
    reusableTonnes: reusable, singleUseTonnes: single, total,
    partsWithoutPackaging: [...missing],
    smallProducer: eu ? total < SMALL_PRODUCER_TONNES : null,
    due: eu ? `${year + 1}-06-01` : null,
  };
}

/** Every jurisdiction with placements in the year, largest first. */
export function jurisdictionsFor(placements: PlacementRow[], year: number): string[] {
  const units = new Map<string, number>();
  for (const p of placements.filter((x) => x.year === year)) units.set(p.jurisdiction, (units.get(p.jurisdiction) ?? 0) + Number(p.units));
  return [...units.entries()].sort((a, b) => b[1] - a[1]).map(([j]) => j);
}

export function reportIssues(r: JurisdictionReport, reg: RegistrationRow | null, components: ComponentRow[], placements: PlacementRow[]): Issue[] {
  const out: Issue[] = [];
  if (r.partsWithoutPackaging.length) {
    const n = r.partsWithoutPackaging.length;
    out.push({ level: 'block', message: `${n} part${n === 1 ? ' has' : 's have'} quantities here but no packaging recorded.` });
  }
  if (r.eu && !reg) out.push({ level: 'block', message: 'No registration recorded for this Member State; producers register in each one where they make packaging available (Art. 44(2)).' });
  if (reg && !reg.registration_number?.trim()) out.push({ level: 'warn', message: 'Registration recorded without its registration number.' });
  if (reg?.fulfilment === 'authorised_representative' && !reg.authorised_representative?.trim()) {
    out.push({ level: 'warn', message: 'Name the authorised representative (Art. 45(3)).' });
  }
  const placed = new Set(placements.filter((p) => p.jurisdiction === r.jurisdiction && p.year === r.year).map((p) => p.product_id));
  const foodContactGaps = components.filter((c) => c.is_active && placed.has(c.product_id) && c.food_contact && !c.pfas_evidence?.trim()).length;
  if (r.eu && foodContactGaps) out.push({ level: 'block', message: `${foodContactGaps} food-contact component${foodContactGaps === 1 ? '' : 's'} without PFAS evidence (Art. 5(5)).` });
  return out;
}

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** The report pack: the Annex IX, Part B, point 2 material columns, by packaging function. */
export function reportCsv(r: JurisdictionReport, reg: RegistrationRow | null, operator: string): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['', ...MATERIALS.map((m) => `${m.label} (t)`), 'Total (t)'];
  const line = (label: string, by: ByMaterial) => [label, ...MATERIALS.map((m) => fmt(by[m.key])), fmt(Object.values(by).reduce((a, b) => a + b, 0))];
  const rows: unknown[][] = [
    ['Packaging placed on the market — working pack', r.jurisdiction, `Year ${r.year}`, r.due ? `Due ${r.due} (Regulation (EU) 2025/40, Art. 44(7))` : 'Check the scheme\'s deadline'],
    ['Producer', operator, reg?.registration_number ? `Registration ${reg.registration_number}` : 'Registration number not recorded', reg?.register_name ?? ''],
    ['Fulfilment', reg ? ({ own: 'Individually', pro: `Producer responsibility organisation: ${reg.pro_name ?? ''}`, authorised_representative: `Authorised representative: ${reg.authorised_representative ?? ''}` })[reg.fulfilment] : ''],
    [],
    head,
    ...FUNCTIONS.map((f) => line(f.label, r.byFunction[f.key])),
    line('Total', r.tonnes),
    [],
    ['Reusable packaging (t)', fmt(r.reusableTonnes)],
    ['Single-use packaging (t)', fmt(r.singleUseTonnes)],
    ['Units of parts placed', fmt(r.units)],
    ...(r.smallProducer ? [['Under 10 tonnes: reported under Annex IX, Part B, point 2 (Art. 44(8))']] : []),
    ...(r.partsWithoutPackaging.length ? [['Parts placed without packaging recorded — tonnes incomplete', r.partsWithoutPackaging.length]] : []),
  ];
  return rows.map((x) => x.map(q).join(',')).join('\n');
}
