import { describe, it, expect } from 'vitest';
import {
  toCountryCode, countryName, validateGeometry, parseGeolocation, geometryAreaHa, needsPolygon, buildGeoJson,
  shipmentIssues, isReady, assessmentGaps, statementFields, RISK_CRITERIA,
  type PlotRow, type RiskAssessmentRow, type ShipmentForCheck, type Geometry,
} from './eudr-core';

// ~100 m × ~100 m square near the equator: about 1 ha.
const smallSquare: Geometry = { type: 'Polygon', coordinates: [[[12.0, 4.8], [12.0009, 4.8], [12.0009, 4.8009], [12.0, 4.8009], [12.0, 4.8]]] };

describe('countries', () => {
  it('reads codes and English names', () => {
    expect(toCountryCode('br')).toBe('BR');
    expect(toCountryCode(' Brazil ')).toBe('BR');
    expect(toCountryCode("Côte d’Ivoire")).toBe('CI');
    expect(toCountryCode('Chine')).toBeNull();
    expect(toCountryCode('EU')).toBeNull();
    expect(countryName('ID')).toBe('Indonesia');
  });
});

describe('validateGeometry', () => {
  it('accepts the four TRACES geometry types', () => {
    expect(validateGeometry({ type: 'Point', coordinates: [12.03, 4.81] })).toEqual([]);
    expect(validateGeometry({ type: 'MultiPoint', coordinates: [[12.03, 4.81], [12.04, 4.82]] })).toEqual([]);
    expect(validateGeometry(smallSquare)).toEqual([]);
    expect(validateGeometry({ type: 'MultiPolygon', coordinates: [smallSquare.coordinates] })).toEqual([]);
  });

  it('refuses what TRACES refuses, and says why', () => {
    expect(validateGeometry({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })[0]).toMatch(/not accepted/);
    expect(validateGeometry({ type: 'Point', coordinates: [4.81, 200] })[0]).toMatch(/longitude first/);
    expect(validateGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] })[0]).toMatch(/not closed/);
    expect(validateGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] })[0]).toMatch(/at least four/);
    // A bow-tie.
    expect(validateGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] })[0]).toMatch(/crosses itself/);
    expect(validateGeometry({ type: 'Polygon', coordinates: [smallSquare.coordinates[0], smallSquare.coordinates[0]] })[0]).toMatch(/hole/);
    expect(validateGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [2, 2], [0, 0]]] })[0]).toMatch(/no area/);
  });
});

describe('areas and the 4 ha rule', () => {
  it('computes polygon area in hectares', () => {
    // 0.0009° ≈ 100.2 m of longitude at 4.8°N (× cos 4.8°) and 100.1 m of latitude.
    expect(geometryAreaHa(smallSquare)!).toBeGreaterThan(0.99);
    expect(geometryAreaHa(smallSquare)!).toBeLessThan(1.01);
    expect(geometryAreaHa({ type: 'Point', coordinates: [0, 0] })).toBeNull();
  });

  it('wants a polygon for a point over 4 ha, except for cattle', () => {
    const point = { geometry: { type: 'Point', coordinates: [0, 0] } as Geometry };
    expect(needsPolygon({ ...point, area_ha: 12 })).toBe(true);
    expect(needsPolygon({ ...point, area_ha: 3 })).toBe(false);
    expect(needsPolygon({ ...point, area_ha: 12, commodity: 'Cattle' })).toBe(false);
    expect(needsPolygon({ geometry: smallSquare, area_ha: 12 })).toBe(false);
  });
});

describe('parseGeolocation', () => {
  it('reads a FeatureCollection with TRACES properties', () => {
    const fc = JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { ProductionPlace: 'Farm A', ProducerCountry: 'BR', Area: 2.5 }, geometry: { type: 'Point', coordinates: [-49.1234567, -22.7654321] } },
    ] });
    const { plots, errors } = parseGeolocation(fc);
    expect(errors).toEqual([]);
    expect(plots[0]).toMatchObject({ name: 'Farm A', country: 'BR', areaHa: 2.5, geometry: { coordinates: [-49.123457, -22.765432] } });
  });

  it('flags an Area given as text, which TRACES reads as zero', () => {
    const f = JSON.stringify({ type: 'Feature', properties: { Area: '3' }, geometry: { type: 'Point', coordinates: [1, 1] } });
    expect(parseGeolocation(f).errors[0]).toMatch(/must be a number/);
  });

  it('reads "latitude, longitude" lines and swaps them into GeoJSON order', () => {
    const { plots, errors } = parseGeolocation('-22.7654, -49.1234\n4.81 12.03\nnot a point');
    expect(plots.map((p) => p.geometry)).toEqual([
      { type: 'Point', coordinates: [-49.1234, -22.7654] },
      { type: 'Point', coordinates: [12.03, 4.81] },
    ]);
    expect(errors).toEqual(['Line 3: "not a point" is not "latitude, longitude".']);
  });

  it('keeps the good features and reports the bad', () => {
    const fc = JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
    ] });
    const r = parseGeolocation(fc);
    expect(r.plots).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^Feature 2: LineString/);
  });
});

describe('buildGeoJson', () => {
  it('uses the property names TRACES reads, Area only on points, and six decimals', () => {
    const plots: PlotRow[] = [
      { id: '1', name: 'Farm A', producer_name: 'Coop', country_code: 'BR', commodity: null, geometry: { type: 'Point', coordinates: [1.12345678, 2] }, area_ha: 2.5 },
      { id: '2', name: 'Farm B', producer_name: null, country_code: 'BR', commodity: null, geometry: smallSquare, area_ha: 1.2 },
    ];
    const g = buildGeoJson(plots);
    expect(g.features[0].properties).toEqual({ ProductionPlace: 'Farm A', ProducerCountry: 'BR', ProducerName: 'Coop', Area: 2.5 });
    expect(g.features[0].geometry).toEqual({ type: 'Point', coordinates: [1.123457, 2] });
    expect(g.features[1].properties).toEqual({ ProductionPlace: 'Farm B', ProducerCountry: 'BR' });
  });
});

const full = (over: Partial<Record<string, { finding: string; concern: boolean }>> = {}) =>
  Object.fromEntries(RISK_CRITERIA.map((c) => [c.key, over[c.key] ?? { finding: 'Checked', concern: false }]));

const assessment = (over: Partial<RiskAssessmentRow> = {}): RiskAssessmentRow => ({
  id: 'a1', supplier_id: 's1', country_code: 'BR', commodity: 'Rubber', country_risk: 'standard',
  country_risk_basis: 'Implementing Regulation (EU) 2025/1093', criteria: full(), conclusion: 'negligible',
  mitigation: null, assessed_at: '2026-10-01', review_by: '2027-10-01', ...over,
});

const shipment = (over: Partial<ShipmentForCheck> = {}): ShipmentForCheck => ({
  activity: 'import', hs_code: '401110', description: 'Tyres', net_mass_kg: 1200, countries_of_production: ['BR'],
  production_from: '2026-06-01', production_to: '2026-06-30', upstream_references: [], status: 'draft', ...over,
});
const plot: PlotRow = { id: 'p1', name: 'Farm A', producer_name: null, country_code: 'BR', commodity: 'Rubber', geometry: smallSquare, area_ha: 1.2 };
const ctx = { today: '2026-11-20', productInScope: true };

describe('assessmentGaps', () => {
  it('needs every criterion answered, unless the country is low risk', () => {
    expect(assessmentGaps(assessment())).toEqual([]);
    expect(assessmentGaps(assessment({ criteria: full({ c: { finding: '', concern: false } }) }))[0]).toMatch(/\(c\)/);
    expect(assessmentGaps(assessment({ country_risk: 'low', criteria: {} }))).toEqual([]);
  });

  it('needs mitigation when concerns are flagged but the risk is called negligible', () => {
    const a = assessment({ criteria: full({ j: { finding: 'Mixed lots', concern: true } }) });
    expect(assessmentGaps(a)[0]).toMatch(/\(j\).*no mitigation/);
    expect(assessmentGaps({ ...a, mitigation: 'Segregated supply confirmed by audit' })).toEqual([]);
  });
});

describe('shipmentIssues', () => {
  it('is ready when the statement is complete and the risk negligible', () => {
    const issues = shipmentIssues(shipment(), [plot], [assessment()], ctx);
    expect(issues).toEqual([]);
    expect(isReady(issues)).toBe(true);
  });

  it('blocks on each missing Annex II fact', () => {
    const issues = shipmentIssues(shipment({ hs_code: null, net_mass_kg: null, countries_of_production: [], production_from: null, production_to: null }), [], [], ctx);
    const text = issues.map((i) => i.message).join('\n');
    expect(text).toMatch(/No HS code/);
    expect(text).toMatch(/No net mass/);
    expect(text).toMatch(/No country of production/);
    expect(text).toMatch(/No date or period of production/);
    expect(text).toMatch(/No plots of land/);
    expect(isReady(issues)).toBe(false);
  });

  it('accepts an upstream statement in place of plots, and needs no net mass for domestic production', () => {
    const issues = shipmentIssues(shipment({ activity: 'domestic', net_mass_kg: null, upstream_references: [{ reference: '25FRXVV3VOAA5U' }] }), [], [assessment()], ctx);
    expect(isReady(issues)).toBe(true);
  });

  it('blocks a plot outside the declared countries, and a non-negligible risk', () => {
    const issues = shipmentIssues(shipment(), [{ ...plot, country_code: 'ID' }], [assessment({ conclusion: 'not_negligible' })], ctx);
    expect(issues.filter((i) => i.level === 'block').map((i) => i.message).join('\n')).toMatch(/Indonesia.*not listed[\s\S]*not negligible/);
  });

  it('needs a risk assessment for each country, even a low-risk one', () => {
    const issues = shipmentIssues(shipment({ countries_of_production: ['BR', 'US'] }), [plot], [assessment()], ctx);
    expect(issues.some((i) => i.level === 'block' && /United States/.test(i.message))).toBe(true);
  });

  it('warns rather than blocks for review dates, big points and scope', () => {
    const big: PlotRow = { ...plot, geometry: { type: 'Point', coordinates: [1, 1] }, area_ha: 10 };
    const issues = shipmentIssues(shipment(), [big], [assessment({ review_by: '2026-11-01' })], { ...ctx, productInScope: false });
    expect(issues.every((i) => i.level === 'warn')).toBe(true);
    expect(issues).toHaveLength(3);
  });

  it('only reports warnings once filed', () => {
    expect(shipmentIssues(shipment({ status: 'filed', hs_code: null }), [plot], [assessment()], ctx)).toEqual([]);
  });

  it('needs the operator address, and an EORI number unless the goods are domestic', () => {
    const none = { ...ctx, operator: { address: null, eori: null } };
    const msgs = shipmentIssues(shipment(), [plot], [assessment()], none).map((i) => i.message);
    expect(msgs.some((m) => m.includes('operator address'))).toBe(true);
    expect(msgs.some((m) => m.includes('EORI'))).toBe(true);
    const domestic = shipmentIssues(shipment({ activity: 'domestic' }), [plot], [assessment()], { ...ctx, operator: { address: 'Main St 1', eori: null } });
    expect(domestic.some((i) => i.message.includes('EORI'))).toBe(false);
  });
});

describe('statementFields', () => {
  it('lists the statement in Annex II order', () => {
    const f = statementFields({
      operator: { name: 'Building Corp', address: '1 Main St, Davidson NC', eori: 'NL123456789' },
      shipment: { ...shipment({ upstream_references: [{ reference: 'REF1', verification: 'VER1' }] }), reference: 'PO-77', supplementary_quantity: 40, supplementary_unit: 'p/st' },
      plots: [plot],
    });
    expect(f.map((x) => x.point)).toEqual(['1', '1', '2', '2', '2', '3', '3', '3', '4', '5', '6', '']);
    expect(f.find((x) => x.label === 'Quantity')?.value).toBe('1,200 kg net mass; 40 p/st');
    expect(f.find((x) => x.label === 'Country of production')?.value).toBe('Brazil');
    expect(f.find((x) => x.label === 'Upstream statements relied on')?.value).toBe('REF1 (verification VER1)');
  });
});
