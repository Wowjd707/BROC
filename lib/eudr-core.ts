/**
 * EUDR due diligence logic, pure and testable.
 *
 *  - Reading geolocation as suppliers send it (GeoJSON, or "lat, lon" pairs)
 *    and checking it the way the EU information system (TRACES) will: WGS 84,
 *    longitude first, Point / MultiPoint / Polygon / MultiPolygon only, closed
 *    rings of at least four positions, no holes, no self-crossing, six
 *    decimals. Catching these here is cheaper than a rejected upload.
 *  - Plot areas, for the rule that a plot of more than four hectares (other
 *    than for cattle) is described by a polygon, not a point
 *    (Regulation (EU) 2023/1115, Art. 2(28)).
 *  - Whether a shipment is ready to file: every gap that would make the due
 *    diligence statement incomplete (Annex II) or the due diligence unfinished
 *    (Art. 9–11, 13), as a list a person can work through.
 *  - The filing pack: the GeoJSON file TRACES accepts and the statement's
 *    fields in the order Annex II lists them.
 *
 * BROC never decides that a risk is negligible. The assessor records the
 * conclusion; this module only checks that one exists, is current, and that
 * the shipment relies on it.
 */

// ─── Countries ───────────────────────────────────────────────────────────────

const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ']);

let countryCache: { code: string; name: string }[] | null = null;

/** ISO 3166-1 alpha-2 codes with English names, from the runtime's own data. */
export function countries(): { code: string; name: string }[] {
  if (countryCache) return countryCache;
  const dn = new Intl.DisplayNames(['en'], { type: 'region' });
  const out: { code: string; name: string }[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (NOT_COUNTRIES.has(code)) continue;
      let name: string | undefined;
      try { name = dn.of(code); } catch { name = undefined; }
      if (name && name !== code && name !== 'Unknown Region') out.push({ code, name });
    }
  }
  countryCache = out.sort((x, y) => x.name.localeCompare(y.name));
  return countryCache;
}

export function countryName(code: string): string {
  return countries().find((c) => c.code === code)?.name ?? code;
}

/** "BR", "br", "Brazil", " brazil " → "BR". Null when it is not recognisably a country. */
export function toCountryCode(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const up = s.toUpperCase();
  if (/^[A-Z]{2}$/.test(up) && countries().some((c) => c.code === up)) return up;
  const lower = s.toLowerCase();
  return countries().find((c) => c.name.toLowerCase() === lower)?.code ?? null;
}

// ─── Geometry ────────────────────────────────────────────────────────────────

export type Position = [number, number];
export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'MultiPoint'; coordinates: Position[] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

export interface ParsedPlot {
  geometry: Geometry;
  name: string | null;
  producerName: string | null;
  country: string | null;
  /** Declared area for points (TRACES property Area), hectares. */
  areaHa: number | null;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function isPosition(p: unknown): p is Position {
  return Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
    && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

function checkPosition(p: Position, where: string): string | null {
  const [lon, lat] = p;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    return `${where}: [${lon}, ${lat}] is outside the globe. GeoJSON is longitude first, then latitude.`;
  }
  return null;
}

function segmentsCross(a: Position, b: Position, c: Position, d: Position): boolean {
  const o = (p: Position, q: Position, r: Position) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Shoelace area in square degrees: only used to spot a polygon with no area. */
function planarArea(ring: Position[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}

function checkRing(ring: Position[], where: string): string[] {
  const errs: string[] = [];
  if (ring.length < 4) errs.push(`${where}: a polygon needs at least four positions (three corners and the first repeated).`);
  const first = ring[0], last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) errs.push(`${where}: the polygon is not closed; the last position must repeat the first.`);
  for (let i = 0; i < ring.length - 1 && errs.length === 0; i++) {
    for (let j = i + 2; j < ring.length - 1; j++) {
      if (i === 0 && j === ring.length - 2) continue; // adjacent through the closing edge
      if (segmentsCross(ring[i], ring[i + 1], ring[j], ring[j + 1])) {
        errs.push(`${where}: the boundary crosses itself. TRACES rejects self-crossing polygons.`);
        break;
      }
    }
  }
  if (errs.length === 0 && Math.abs(planarArea(ring)) < 1e-14) errs.push(`${where}: the polygon has no area (its points are in a line).`);
  return errs;
}

/** Problems TRACES would reject, in words. Empty when the geometry is fine. */
export function validateGeometry(g: unknown): string[] {
  if (!g || typeof g !== 'object') return ['No geometry.'];
  const geom = g as { type?: unknown; coordinates?: unknown };
  const errs: string[] = [];
  switch (geom.type) {
    case 'Point':
      if (!isPosition(geom.coordinates)) return ['Point coordinates must be [longitude, latitude].'];
      { const e = checkPosition(geom.coordinates, 'Point'); if (e) errs.push(e); }
      break;
    case 'MultiPoint':
      if (!Array.isArray(geom.coordinates) || !geom.coordinates.every(isPosition) || geom.coordinates.length === 0) return ['MultiPoint coordinates must be a list of [longitude, latitude].'];
      geom.coordinates.forEach((p, i) => { const e = checkPosition(p as Position, `Point ${i + 1}`); if (e) errs.push(e); });
      break;
    case 'Polygon': {
      const rings = geom.coordinates;
      if (!Array.isArray(rings) || rings.length === 0 || !rings.every((r) => Array.isArray(r) && r.every(isPosition))) return ['Polygon coordinates must be a list of rings of [longitude, latitude].'];
      if (rings.length > 1) errs.push('The polygon has a hole. TRACES does not accept holes; describe it as two polygons instead.');
      (rings[0] as Position[]).forEach((p, i) => { const e = checkPosition(p, `Position ${i + 1}`); if (e) errs.push(e); });
      if (errs.length === 0) errs.push(...checkRing(rings[0] as Position[], 'Polygon'));
      break;
    }
    case 'MultiPolygon': {
      const polys = geom.coordinates;
      if (!Array.isArray(polys) || polys.length === 0) return ['MultiPolygon coordinates must be a list of polygons.'];
      polys.forEach((rings, k) => {
        if (!Array.isArray(rings) || rings.length === 0 || !rings.every((r) => Array.isArray(r) && r.every(isPosition))) { errs.push(`Polygon ${k + 1}: malformed.`); return; }
        if (rings.length > 1) errs.push(`Polygon ${k + 1} has a hole. TRACES does not accept holes.`);
        const ring = rings[0] as Position[];
        const before = errs.length;
        ring.forEach((p, i) => { const e = checkPosition(p, `Polygon ${k + 1}, position ${i + 1}`); if (e) errs.push(e); });
        if (errs.length === before) errs.push(...checkRing(ring, `Polygon ${k + 1}`));
      });
      break;
    }
    default:
      return [`${String(geom.type ?? 'Unknown')} geometries are not accepted. Use Point, MultiPoint, Polygon or MultiPolygon.`];
  }
  return errs;
}

/** Six decimals, as TRACES stores them; outer rings only. */
export function normalizeGeometry(g: Geometry): Geometry {
  const p = (x: Position): Position => [round6(x[0]), round6(x[1])];
  switch (g.type) {
    case 'Point': return { type: 'Point', coordinates: p(g.coordinates) };
    case 'MultiPoint': return { type: 'MultiPoint', coordinates: g.coordinates.map(p) };
    case 'Polygon': return { type: 'Polygon', coordinates: [g.coordinates[0].map(p)] };
    case 'MultiPolygon': return { type: 'MultiPolygon', coordinates: g.coordinates.map((r) => [r[0].map(p)]) };
  }
}

// Spherical area (Chamberlain & Duquette), adequate for plot-sized polygons.
const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

function ringAreaM2(ring: Position[]): number {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    total += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((total * R * R) / 2);
}

/** Hectares for a polygon; null for points (their area is declared, not drawn). */
export function geometryAreaHa(g: Geometry): number | null {
  if (g.type === 'Polygon') return ringAreaM2(g.coordinates[0]) / 10_000;
  if (g.type === 'MultiPolygon') return g.coordinates.reduce((s, r) => s + ringAreaM2(r[0]), 0) / 10_000;
  return null;
}

/** Art. 2(28): a plot over 4 ha, other than for cattle, is described by a polygon. */
export const POLYGON_THRESHOLD_HA = 4;

export function needsPolygon(plot: { geometry: Geometry; area_ha: number | null; commodity?: string | null }): boolean {
  const isPoint = plot.geometry.type === 'Point' || plot.geometry.type === 'MultiPoint';
  const cattle = (plot.commodity ?? '').toLowerCase().includes('cattle');
  return isPoint && !cattle && (plot.area_ha ?? 0) > POLYGON_THRESHOLD_HA;
}

// ─── Reading what suppliers send ─────────────────────────────────────────────

/**
 * Read geolocation from a supplier's answer or a pasted file: a GeoJSON
 * FeatureCollection, Feature or bare geometry; or lines of "latitude,
 * longitude" (the order people write coordinates in, unlike GeoJSON), each
 * becoming a point. Returns the plots it could read and, separately, what was
 * wrong with the rest — nothing is silently dropped.
 */
export function parseGeolocation(text: string): { plots: ParsedPlot[]; errors: string[] } {
  const s = text.trim();
  if (!s) return { plots: [], errors: ['Nothing to read.'] };

  if (s.startsWith('{') || s.startsWith('[')) {
    let json: unknown;
    try { json = JSON.parse(s); } catch { return { plots: [], errors: ['This looks like JSON but could not be read. Check for a missing bracket or comma.'] }; }
    const features: { geometry: unknown; properties?: Record<string, unknown> }[] = [];
    const o = json as { type?: string; features?: unknown[]; geometry?: unknown; properties?: Record<string, unknown> };
    if (o?.type === 'FeatureCollection' && Array.isArray(o.features)) features.push(...(o.features as typeof features));
    else if (o?.type === 'Feature') features.push(o as (typeof features)[number]);
    else if (o?.type) features.push({ geometry: o });
    else return { plots: [], errors: ['Not GeoJSON: expected a FeatureCollection, Feature or geometry.'] };

    const plots: ParsedPlot[] = [];
    const errors: string[] = [];
    features.forEach((f, i) => {
      const label = features.length > 1 ? `Feature ${i + 1}: ` : '';
      const errs = validateGeometry(f.geometry);
      if (errs.length) { errors.push(...errs.map((e) => label + e)); return; }
      const props = f.properties ?? {};
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      const area = typeof props.Area === 'number' && props.Area > 0 ? props.Area : null;
      if (props.Area !== undefined && typeof props.Area !== 'number') errors.push(`${label}Area must be a number of hectares, not text; TRACES reads "${String(props.Area)}" as 0.`);
      plots.push({
        geometry: normalizeGeometry(f.geometry as Geometry),
        name: str(props.ProductionPlace),
        producerName: str(props.ProducerName),
        country: toCountryCode(str(props.ProducerCountry)),
        areaHa: area,
      });
    });
    return { plots, errors };
  }

  const plots: ParsedPlot[] = [];
  const errors: string[] = [];
  s.split(/\n|;/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const m = line.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) { errors.push(`Line ${i + 1}: "${line}" is not "latitude, longitude".`); return; }
    const lat = Number(m[1]), lon = Number(m[2]);
    const geometry: Geometry = { type: 'Point', coordinates: [round6(lon), round6(lat)] };
    const errs = validateGeometry(geometry);
    if (errs.length) { errors.push(`Line ${i + 1}: latitude must be between -90 and 90 and longitude between -180 and 180.`); return; }
    plots.push({ geometry, name: null, producerName: null, country: null, areaHa: null });
  });
  return { plots, errors };
}

// ─── Filing pack ─────────────────────────────────────────────────────────────

export interface PlotRow {
  id: string;
  name: string;
  producer_name: string | null;
  country_code: string;
  commodity: string | null;
  geometry: Geometry;
  area_ha: number | null;
}

/**
 * The GeoJSON file to upload with the statement. Property names are the ones
 * TRACES reads (ProductionPlace, ProducerName, ProducerCountry, Area); Area is
 * a number and only set for points, which is when TRACES uses it.
 */
export function buildGeoJson(plots: PlotRow[]) {
  return {
    type: 'FeatureCollection' as const,
    features: plots.map((p) => {
      const isPoint = p.geometry.type === 'Point' || p.geometry.type === 'MultiPoint';
      const properties: Record<string, string | number> = { ProductionPlace: p.name, ProducerCountry: p.country_code };
      if (p.producer_name) properties.ProducerName = p.producer_name;
      if (isPoint && p.area_ha != null) properties.Area = Number(p.area_ha);
      return { type: 'Feature' as const, properties, geometry: normalizeGeometry(p.geometry) };
    }),
  };
}

/** TRACES caps all GeoJSON for one statement at 25 MB. */
export const MAX_GEOJSON_BYTES = 25 * 1024 * 1024;

// ─── Risk assessment ─────────────────────────────────────────────────────────

/**
 * Art. 10(2) criteria, (a)–(n). Short labels for the form; the regulation's
 * text is authoritative.
 */
export const RISK_CRITERIA: { key: string; label: string }[] = [
  { key: 'a', label: 'Risk assigned to the country of production (or part of it) under Art. 29' },
  { key: 'b', label: 'Presence of forests in the country of production' },
  { key: 'c', label: 'Presence of indigenous peoples' },
  { key: 'd', label: 'Consultation and cooperation in good faith with indigenous peoples' },
  { key: 'e', label: 'Duly reasoned claims by indigenous peoples on use or ownership of the area' },
  { key: 'f', label: 'Prevalence of deforestation or forest degradation' },
  { key: 'g', label: 'Source, reliability and validity of the Art. 9 information, and links to other documentation' },
  { key: 'h', label: 'Concerns about the country: corruption, document falsification, weak law enforcement, human rights, armed conflict, sanctions' },
  { key: 'i', label: 'Complexity of the supply chain and stage of processing, including difficulty linking products to plots' },
  { key: 'j', label: 'Risk of circumvention, or mixing with products of unknown or non-compliant origin' },
  { key: 'k', label: 'Conclusions of the Commission expert groups' },
  { key: 'l', label: 'Substantiated concerns (Art. 31) and history of non-compliance in the supply chain' },
  { key: 'm', label: 'Any other information pointing to a risk of non-compliance' },
  { key: 'n', label: 'Complementary information, such as certification or third-party verification' },
];

export interface CriterionAnswer { finding: string; concern: boolean }

export interface RiskAssessmentRow {
  id: string;
  supplier_id: string | null;
  country_code: string;
  commodity: string;
  country_risk: 'low' | 'standard' | 'high';
  country_risk_basis: string;
  criteria: Record<string, CriterionAnswer>;
  conclusion: 'negligible' | 'not_negligible';
  mitigation: string | null;
  assessed_at: string;
  review_by: string | null;
}

/** Problems with an assessment as a record, before anyone relies on it. */
export function assessmentGaps(a: Pick<RiskAssessmentRow, 'country_risk' | 'criteria' | 'conclusion' | 'mitigation'>): string[] {
  const gaps: string[] = [];
  // Art. 13: low-risk countries need no Art. 10 assessment, unless something points to a risk.
  if (a.country_risk !== 'low') {
    const missing = RISK_CRITERIA.filter((c) => !a.criteria[c.key]?.finding?.trim()).map((c) => `(${c.key})`);
    if (missing.length) gaps.push(`No finding recorded for criteria ${missing.join(', ')}.`);
  }
  const concerns = RISK_CRITERIA.filter((c) => a.criteria[c.key]?.concern).map((c) => `(${c.key})`);
  if (a.conclusion === 'negligible' && concerns.length > 0 && !a.mitigation?.trim()) {
    gaps.push(`Concerns are flagged under ${concerns.join(', ')} but no mitigation is recorded to explain why the risk is negligible.`);
  }
  return gaps;
}

// ─── Readiness ───────────────────────────────────────────────────────────────

export interface ShipmentForCheck {
  activity: 'import' | 'export' | 'domestic';
  hs_code: string | null;
  description: string | null;
  net_mass_kg: number | null;
  countries_of_production: string[];
  production_from: string | null;
  production_to: string | null;
  upstream_references: { reference: string; verification?: string }[];
  status: 'draft' | 'filed' | 'withdrawn';
}

export interface Issue { level: 'block' | 'warn'; message: string }

/**
 * Everything standing between this shipment and a complete statement. A
 * "block" leaves the statement incomplete or the due diligence unfinished; a
 * "warn" is worth a look but does not stop filing.
 */
export function shipmentIssues(
  s: ShipmentForCheck,
  plots: PlotRow[],
  assessments: RiskAssessmentRow[],
  ctx: {
    today: string; productInScope: boolean; geoJsonBytes?: number;
    /** The operator's details (Annex II, point 1). Omit to skip the check. */
    operator?: { address: string | null; eori: string | null };
  },
): Issue[] {
  const out: Issue[] = [];
  const block = (message: string) => out.push({ level: 'block', message });
  const warn = (message: string) => out.push({ level: 'warn', message });

  if (ctx.operator && !ctx.operator.address?.trim()) block('No operator address (Annex II, point 1). Add it under Operator details.');
  if (ctx.operator && s.activity !== 'domestic' && !ctx.operator.eori?.trim()) {
    block('No EORI number; it is required for goods entering or leaving the market (Annex II, point 1). Add it under Operator details.');
  }
  if (!ctx.productInScope) warn('The product is not in scope of EUDR under your scope rules. Check its codes before filing.');
  if (!s.hs_code) block('No HS code (Annex II, point 2).');
  if (!s.description?.trim()) block('No product description (Annex II, point 2).');
  if (s.activity !== 'domestic' && !s.net_mass_kg) block('No net mass in kilograms; it is required for goods entering or leaving the market (Annex II, point 2).');
  if (s.countries_of_production.length === 0) block('No country of production (Annex II, point 3).');
  if (!s.production_from && !s.production_to) block('No date or period of production (Art. 9(1)(c)).');
  if (plots.length === 0 && s.upstream_references.length === 0) {
    block('No plots of land. Add the geolocation of every plot, or the reference of the upstream statement this relies on (Annex II, points 3 and 4).');
  }

  for (const p of plots) {
    if (!s.countries_of_production.includes(p.country_code)) {
      block(`Plot "${p.name}" is in ${countryName(p.country_code)}, which is not listed as a country of production.`);
    }
    if (needsPolygon(p)) warn(`Plot "${p.name}" is recorded as a point but is over 4 hectares; it needs a polygon (Art. 2(28)).`);
  }
  for (const c of s.countries_of_production) {
    if (plots.length > 0 && !plots.some((p) => p.country_code === c) && s.upstream_references.length === 0) {
      warn(`No plot is in ${countryName(c)}, though it is listed as a country of production.`);
    }
  }
  if ((ctx.geoJsonBytes ?? 0) > MAX_GEOJSON_BYTES) block('The geolocation file is over 25 MB, the limit for one statement. Split the shipment or simplify the polygons.');

  // Risk: every country of production needs a current, relied-on conclusion of negligible risk.
  for (const c of s.countries_of_production) {
    const a = assessments.filter((x) => x.country_code === c).sort((x, y) => y.assessed_at.localeCompare(x.assessed_at))[0];
    if (!a) { block(`No risk assessment covers ${countryName(c)}. Record one, even if the country is low risk (Art. 13 still needs the reason).`); continue; }
    if (a.conclusion === 'not_negligible') block(`The risk assessment for ${countryName(c)} concludes the risk is not negligible. The product cannot be placed on the market until mitigation brings it to negligible (Art. 11).`);
    if (a.review_by && a.review_by < ctx.today) warn(`The risk assessment for ${countryName(c)} was due for review on ${a.review_by}.`);
    for (const g of assessmentGaps(a)) block(`Risk assessment for ${countryName(c)}: ${g}`);
  }

  if (s.status === 'filed') return out.filter((i) => i.level === 'warn');
  return out;
}

export function isReady(issues: Issue[]): boolean {
  return !issues.some((i) => i.level === 'block');
}

// ─── The statement's fields ──────────────────────────────────────────────────

export interface StatementInput {
  operator: { name: string; address: string | null; eori: string | null };
  shipment: ShipmentForCheck & { reference: string; supplementary_quantity: number | null; supplementary_unit: string | null };
  plots: PlotRow[];
}

/**
 * The due diligence statement's content in Annex II order, for copying into
 * TRACES or attaching to the file. Point 6 (signature) is completed in TRACES
 * by the person filing.
 */
export function statementFields(input: StatementInput): { point: string; label: string; value: string }[] {
  const { operator, shipment: s, plots } = input;
  const qty = [
    s.net_mass_kg != null ? `${s.net_mass_kg.toLocaleString('en-US')} kg net mass` : null,
    s.supplementary_quantity != null ? `${s.supplementary_quantity.toLocaleString('en-US')} ${s.supplementary_unit ?? ''}`.trim() : null,
  ].filter(Boolean).join('; ');
  const period = s.production_from === s.production_to || !s.production_to
    ? (s.production_from ?? '')
    : `${s.production_from ?? '?'} to ${s.production_to}`;
  return [
    { point: '1', label: 'Operator', value: [operator.name, operator.address].filter(Boolean).join(', ') },
    { point: '1', label: 'EORI number', value: operator.eori ?? (s.activity === 'domestic' ? 'Not required' : 'Missing') },
    { point: '2', label: 'HS code', value: s.hs_code ?? '' },
    { point: '2', label: 'Description', value: s.description ?? '' },
    { point: '2', label: 'Quantity', value: qty },
    { point: '3', label: 'Country of production', value: s.countries_of_production.map(countryName).join(', ') },
    { point: '3', label: 'Geolocation', value: plots.length === 0 ? 'None' : `${plots.length} plot${plots.length === 1 ? '' : 's'}, in the attached GeoJSON file` },
    { point: '3', label: 'Date or period of production', value: period },
    { point: '4', label: 'Upstream statements relied on', value: s.upstream_references.map((r) => r.verification ? `${r.reference} (verification ${r.verification})` : r.reference).join('; ') || 'None' },
    { point: '5', label: 'Declaration', value: 'Made in TRACES on submission: due diligence was carried out and no or only a negligible risk was found.' },
    { point: '6', label: 'Signature', value: 'Completed in TRACES by the person filing' },
    { point: '', label: 'Internal reference', value: s.reference },
  ];
}
