/**
 * The structured data BROC collects per product, by regulation.
 *
 * These are data requirements — the fields a filing needs — not statements of
 * what the law says. Which products a regulation covers is NOT here: that is
 * the organization's own cited list in `compliance_scope_rules`, for the same
 * reason the regulatory tracker never ships content from memory.
 *
 * Adding a field: add it below with a key of the form `<regulation>.<name>`,
 * and it appears on every in-scope product and in the survey builder's
 * "Saves to" list. Keys are stored in the database, so never rename one that
 * has values; add a new key and stop using the old.
 *
 * `validMonths` is how long an answer stays current before BROC asks for it
 * again. These are working defaults for a supplier-data cycle, not legal
 * retention periods; change them to suit your own process.
 */

export type ComplianceFieldType = 'text' | 'number' | 'select' | 'yes_no' | 'date' | 'country' | 'location';

export interface ComplianceField {
  key: string;
  regulation: RegulationKey;
  label: string;
  type: ComplianceFieldType;
  unit?: string;
  options?: { value: string; label: string }[];
  /** null: does not expire. */
  validMonths: number | null;
  help?: string;
}

export const REGULATIONS = {
  cbam: { label: 'CBAM', name: 'Carbon Border Adjustment Mechanism' },
  eudr: { label: 'EUDR', name: 'EU Deforestation Regulation' },
  ppwr: { label: 'PPWR', name: 'Packaging and Packaging Waste Regulation' },
} as const;

export type RegulationKey = keyof typeof REGULATIONS;

export const REGULATION_KEYS = Object.keys(REGULATIONS) as RegulationKey[];

export function isRegulationKey(v: string): v is RegulationKey {
  return (REGULATION_KEYS as string[]).includes(v);
}

const YES_NO_HELP = 'Yes or no, as the supplier declared it.';

export const COMPLIANCE_FIELDS: ComplianceField[] = [
  // ─── CBAM: per good, from the producing installation ──────────────────────
  { key: 'cbam.installation_name', regulation: 'cbam', label: 'Producing installation', type: 'text', validMonths: 12,
    help: 'Name or identifier of the installation where the good was produced.' },
  { key: 'cbam.installation_country', regulation: 'cbam', label: 'Installation country', type: 'country', validMonths: 12 },
  { key: 'cbam.direct_emissions', regulation: 'cbam', label: 'Direct embedded emissions', type: 'number',
    unit: 't CO₂e per t of good', validMonths: 12,
    help: 'Emissions from producing the good itself, per tonne.' },
  { key: 'cbam.indirect_emissions', regulation: 'cbam', label: 'Indirect embedded emissions', type: 'number',
    unit: 't CO₂e per t of good', validMonths: 12,
    help: 'Emissions from the electricity used to produce it, per tonne.' },
  { key: 'cbam.emissions_basis', regulation: 'cbam', label: 'Basis of the emissions figures', type: 'select', validMonths: 12,
    options: [
      { value: 'actual_verified', label: 'Actual, verified' },
      { value: 'actual_unverified', label: 'Actual, not yet verified' },
      { value: 'default', label: 'Default values' },
    ] },
  { key: 'cbam.production_route', regulation: 'cbam', label: 'Production route', type: 'text', validMonths: 12,
    help: 'For example blast furnace, electric arc furnace, or the route the supplier reports.' },
  { key: 'cbam.carbon_price_paid', regulation: 'cbam', label: 'Carbon price paid abroad', type: 'text', validMonths: 12,
    help: 'Amount and currency per tonne of good, if a carbon price was paid where it was produced.' },
  { key: 'cbam.verification_statement', regulation: 'cbam', label: 'Verification statement', type: 'text', validMonths: 12,
    help: 'Reference to, or name of, the verifier\'s statement.' },

  // ─── EUDR: per product, back to the plots of land ─────────────────────────
  { key: 'eudr.commodity', regulation: 'eudr', label: 'Relevant commodity', type: 'text', validMonths: null },
  { key: 'eudr.country_of_production', regulation: 'eudr', label: 'Country of production', type: 'country', validMonths: 12 },
  { key: 'eudr.geolocation', regulation: 'eudr', label: 'Geolocation of the plots', type: 'location', validMonths: 12,
    help: 'Coordinates or polygons (GeoJSON), or the postal address where a small supplier may give one instead.' },
  { key: 'eudr.production_period', regulation: 'eudr', label: 'Date or period of production', type: 'text', validMonths: 12 },
  { key: 'eudr.upstream_reference', regulation: 'eudr', label: 'Upstream due diligence reference', type: 'text', validMonths: 12,
    help: 'Reference and verification numbers of the statement filed further up the chain, if any.' },
  { key: 'eudr.deforestation_free', regulation: 'eudr', label: 'Declared deforestation-free', type: 'yes_no', validMonths: 12,
    help: YES_NO_HELP },
  { key: 'eudr.legality_evidence', regulation: 'eudr', label: 'Evidence of legal production', type: 'text', validMonths: 12 },

  // ─── PPWR: per packaging component ────────────────────────────────────────
  { key: 'ppwr.packaging_material', regulation: 'ppwr', label: 'Main packaging material', type: 'select', validMonths: 24,
    options: [
      { value: 'paper_cardboard', label: 'Paper / cardboard' },
      { value: 'plastic', label: 'Plastic' },
      { value: 'wood', label: 'Wood' },
      { value: 'steel', label: 'Steel' },
      { value: 'aluminium', label: 'Aluminium' },
      { value: 'glass', label: 'Glass' },
      { value: 'composite', label: 'Composite / multi-material' },
      { value: 'other', label: 'Other' },
    ] },
  { key: 'ppwr.packaging_weight', regulation: 'ppwr', label: 'Packaging weight per unit', type: 'number', unit: 'g', validMonths: 24 },
  { key: 'ppwr.packaging_function', regulation: 'ppwr', label: 'Packaging function', type: 'select', validMonths: 24,
    options: [
      { value: 'sales', label: 'Sales (primary)' },
      { value: 'grouped', label: 'Grouped (secondary)' },
      { value: 'transport', label: 'Transport (tertiary)' },
    ] },
  { key: 'ppwr.reusable', regulation: 'ppwr', label: 'Reusable packaging', type: 'yes_no', validMonths: 24, help: YES_NO_HELP },
  { key: 'ppwr.recycled_content', regulation: 'ppwr', label: 'Recycled content', type: 'number', unit: '%', validMonths: 24 },
  { key: 'ppwr.substances_declaration', regulation: 'ppwr', label: 'Substances declaration', type: 'text', validMonths: 24,
    help: 'Reference to the supplier\'s declaration on restricted substances in the packaging.' },
];

export const FIELD_BY_KEY = new Map(COMPLIANCE_FIELDS.map((f) => [f.key, f]));

export function fieldsFor(regulation: RegulationKey): ComplianceField[] {
  return COMPLIANCE_FIELDS.filter((f) => f.regulation === regulation);
}

/**
 * The survey question type that collects a field, for the question builder:
 * a question mapped to a field should ask for the right kind of answer.
 */
export function questionTypeFor(field: ComplianceField): 'text' | 'number' | 'select' | 'yes_no' | 'date' {
  if (field.type === 'country' || field.type === 'location') return 'text';
  return field.type;
}

/**
 * Normalize an answer for storage, or return an error the supplier/user can
 * act on. Lenient about formatting, strict about meaning: "1,234" is a number,
 * "about 1200" is not.
 */
export function normalizeFieldValue(field: ComplianceField, raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = raw.trim();
  if (!v) return { ok: false, error: `${field.label} is empty.` };
  switch (field.type) {
    case 'number': {
      const n = Number(v.replace(/,/g, ''));
      if (!Number.isFinite(n)) return { ok: false, error: `${field.label} must be a number, got "${raw}".` };
      if (field.unit === '%' && (n < 0 || n > 100)) return { ok: false, error: `${field.label} must be between 0 and 100.` };
      return { ok: true, value: String(n) };
    }
    case 'yes_no': {
      const s = v.toLowerCase();
      if (['yes', 'y', 'true'].includes(s)) return { ok: true, value: 'yes' };
      if (['no', 'n', 'false'].includes(s)) return { ok: true, value: 'no' };
      return { ok: false, error: `${field.label} must be yes or no.` };
    }
    case 'select': {
      const opt = field.options?.find((o) => o.value === v || o.label.toLowerCase() === v.toLowerCase());
      if (!opt) return { ok: false, error: `${field.label} must be one of: ${field.options?.map((o) => o.label).join(', ')}.` };
      return { ok: true, value: opt.value };
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? { ok: true, value: v } : { ok: false, error: `${field.label} must be a date (YYYY-MM-DD).` };
    default:
      return { ok: true, value: v.slice(0, 20000) };
  }
}

/** How a stored value reads on screen. */
export function displayFieldValue(field: ComplianceField | undefined, value: string, unit?: string | null): string {
  if (!field) return value;
  if (field.type === 'select') return field.options?.find((o) => o.value === value)?.label ?? value;
  if (field.type === 'yes_no') return value === 'yes' ? 'Yes' : value === 'no' ? 'No' : value;
  const u = unit ?? field.unit;
  return u ? `${value} ${u}` : value;
}

/**
 * Built-in survey questions that fill a field. Custom question sets say this
 * per question (supplier_survey_questions.maps_to); the built-in sets say it
 * here, keyed by regulation type and question id.
 */
export const BUILT_IN_QUESTION_MAP: Record<string, Record<string, string>> = {
  cbam: {
    q5_country: 'cbam.installation_country',
  },
  eudr: {
    q1_commodity: 'eudr.commodity',
    q2_origin: 'eudr.country_of_production',
    q3_gps: 'eudr.geolocation',
    q4_deforestation_free: 'eudr.deforestation_free',
  },
};
