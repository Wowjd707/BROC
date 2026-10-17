import { describe, it, expect } from 'vitest';
import {
  mapSiteRow, canonicalizeSiteRow,
  SITE_IMPORT_HEADERS, SITE_COLUMN_LABELS,
} from './site-import-core';

const none = new Set<string>();

const row = (over: Record<string, string> = {}): Record<string, string> => ({
  name: 'Riverside Plant', ...over,
});

/** The site as the mapper sees it when nothing optional is supplied. */
const bare = () => {
  const r = mapSiteRow(row(), none);
  if (!r.ok) throw new Error('expected ok');
  return r.site;
};

describe('headers', () => {
  it('are spaced and capitalized, with no underscores', () => {
    expect(SITE_IMPORT_HEADERS[0]).toBe('Site Name');
    for (const h of SITE_IMPORT_HEADERS) expect(h).not.toMatch(/_/);
  });
});

describe('canonicalizeSiteRow', () => {
  it('maps the spellings the readable headers normalize to', () => {
    // Two of the template's labels fail to round-trip. "Operated Or Controlled"
    // is the dangerous one: it is optional, so a missing alias would default
    // every site to controlled rather than erroring.
    expect(canonicalizeSiteRow({ site_name: 'A' }).name).toBe('A');
    expect(canonicalizeSiteRow({ floor_area_sqft: '100' }).floor_area_sqft).toBe('100');
    expect(canonicalizeSiteRow({ operated_or_controlled: 'No' }).is_controlled).toBe('No');
  });

  it('accepts the shorthand people type', () => {
    expect(canonicalizeSiteRow({ zip: '29601' }).zip_code).toBe('29601');
    expect(canonicalizeSiteRow({ sqft: '5000' }).floor_area_sqft).toBe('5000');
    expect(canonicalizeSiteRow({ type: 'Office' }).site_type).toBe('Office');
  });

  it('never lets an alias overwrite an explicit column', () => {
    expect(canonicalizeSiteRow({ site_name: 'Wrong', name: 'Right' }).name).toBe('Right');
  });
});

describe('mapSiteRow', () => {
  it('needs only a name', () => {
    expect(mapSiteRow(row(), none).ok).toBe(true);
  });

  it('rejects a row with no name', () => {
    const r = mapSiteRow({ city: 'Greenville' }, none);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(SITE_COLUMN_LABELS.name);
  });

  it('flags a site already on the list, case-insensitively', () => {
    const r = mapSiteRow(row({ name: 'riverside plant' }), new Set(['riverside plant']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect('duplicate' in r && r.duplicate).toBe(true);
  });

  describe('site type', () => {
    it('accepts the dropdown label and the stored key', () => {
      const a = mapSiteRow(row({ site_type: 'Data Center' }), none);
      const b = mapSiteRow(row({ site_type: 'data_center' }), none);
      if (a.ok) expect(a.site.siteType).toBe('data_center');
      if (b.ok) expect(b.site.siteType).toBe('data_center');
    });

    it('defaults to office rather than failing on a blank', () => {
      // The column defaults too, and refusing a row over a blank type would
      // block an otherwise complete site.
      expect(bare().siteType).toBe('office');
    });

    it('rejects a type outside the vocabulary', () => {
      const r = mapSiteRow(row({ site_type: 'Laboratory' }), none);
      expect(r.ok).toBe(false);
      // The column has a CHECK, so this would otherwise surface as a database
      // error naming a constraint rather than a row.
    });
  });

  describe('numbers', () => {
    it('strips separators from floor area', () => {
      const r = mapSiteRow(row({ floor_area_sqft: '220,000' }), none);
      if (r.ok) expect(r.site.floorAreaSqft).toBe(220000);
    });

    it('rejects a non-positive floor area', () => {
      expect(mapSiteRow(row({ floor_area_sqft: '0' }), none).ok).toBe(false);
      expect(mapSiteRow(row({ floor_area_sqft: '-5' }), none).ok).toBe(false);
    });

    it('accepts ownership written with a percent sign', () => {
      const r = mapSiteRow(row({ ownership_percent: '51%' }), none);
      if (r.ok) expect(r.site.ownershipPercent).toBe(51);
    });

    it('rejects ownership outside 0 to 100', () => {
      expect(mapSiteRow(row({ ownership_percent: '120' }), none).ok).toBe(false);
      expect(mapSiteRow(row({ ownership_percent: '-1' }), none).ok).toBe(false);
    });
  });

  describe('operated or controlled', () => {
    it('reads whatever a spreadsheet or a person produces', () => {
      for (const yes of ['Yes', 'y', 'TRUE', '1']) {
        const r = mapSiteRow(row({ is_controlled: yes }), none);
        if (r.ok) expect(r.site.isControlled).toBe(true);
      }
      for (const no of ['No', 'n', 'FALSE', '0']) {
        const r = mapSiteRow(row({ is_controlled: no }), none);
        if (r.ok) expect(r.site.isControlled).toBe(false);
      }
    });

    it('defaults to controlled, matching the column and pre-028 behaviour', () => {
      expect(bare().isControlled).toBe(true);
      expect(bare().ownershipPercent).toBe(100);
    });

    it('rejects something it cannot read rather than guessing', () => {
      // Guessing here decides whether a joint venture contributes everything or
      // nothing under a control approach.
      expect(mapSiteRow(row({ is_controlled: 'partially' }), none).ok).toBe(false);
    });
  });

  describe('warnings', () => {
    it('warns when a US site has no zip, because the factor falls back', () => {
      // getScope2LocationFactor resolves zip, then eGRID, then the national
      // average. The fallback is silent and, on a coal-heavy or hydro-heavy
      // grid, wrong by a wide margin.
      expect(bare().warnings.some(w => /national average/i.test(w))).toBe(true);
    });

    it('does not warn about a missing zip outside the US', () => {
      const r = mapSiteRow(row({ country: 'Germany' }), none);
      if (r.ok) expect(r.site.warnings.some(w => /national average/i.test(w))).toBe(false);
    });

    it('warns when floor area is missing, since intensity needs it', () => {
      expect(bare().warnings.some(w => /intensity/i.test(w))).toBe(true);
    });

    it('warns only when ownership departs from wholly owned and controlled', () => {
      const whollyOwned = bare().warnings.some(w => /consolidation approach/i.test(w));
      expect(whollyOwned).toBe(false);

      const jv = mapSiteRow(row({ ownership_percent: '50', is_controlled: 'No' }), none);
      if (jv.ok) {
        expect(jv.site.warnings.some(w => /consolidation approach/i.test(w))).toBe(true);
      }
    });

    it('never turns a warning into a failure', () => {
      // Every warning here is about accuracy, not validity. A site with no zip
      // and no floor area is still a site.
      const r = mapSiteRow(row(), none);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.site.warnings.length).toBeGreaterThan(0);
    });
  });

  it('defaults country to USA and keeps a stated one', () => {
    expect(bare().country).toBe('USA');
    const r = mapSiteRow(row({ country: 'Mexico' }), none);
    if (r.ok) expect(r.site.country).toBe('Mexico');
  });

  it('carries the business unit as a name for the server to resolve', () => {
    const r = mapSiteRow(row({ business_unit: 'Industrial Products' }), none);
    if (r.ok) expect(r.site.businessUnitName).toBe('Industrial Products');
  });
});
