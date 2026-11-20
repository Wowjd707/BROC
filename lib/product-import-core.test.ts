import { describe, it, expect } from 'vitest';
import { mapProductRow, type Lookups } from './product-import-core';

const lookups: Lookups = {
  suppliers: new Map([['steelcore', 's1']]),
  businessUnits: new Map([['compression', 'bu1']]),
  sites: new Map([['houston', 'site1']]),
  users: new Map([['pat@acme.test', 'u1']]),
};

describe('mapProductRow', () => {
  it('maps a full row, normalizing the CN code and matching names', () => {
    const r = mapProductRow({
      part_number: 'P-100', description: 'Coil', cn_code: '7208 51 20', supplier: 'Steelcore',
      country_of_origin: 'Turkey', business_unit: 'Compression', site: 'Houston', owner_email: 'PAT@acme.test',
    }, lookups);
    expect(r).toEqual({ ok: true, product: {
      partNumber: 'P-100',
      fields: { description: 'Coil', cn_code: '72085120', supplier_id: 's1', country_of_origin: 'Turkey', business_unit_id: 'bu1', site_id: 'site1', owner_user_id: 'u1' },
      values: [],
    } });
  });

  it('leaves blank cells out, so a re-import cannot wipe stored data', () => {
    const r = mapProductRow({ part_number: 'P-100', description: '', cn_code: '' }, lookups);
    expect(r.ok && r.product.fields).toEqual({});
  });

  it('accepts common ERP header names', () => {
    const r = mapProductRow({ sku: 'P-1', hs: '4011.10', hts: '4011.10.1010', commodity_code: '4011 10 00', vendor: 'steelcore' }, lookups);
    expect(r.ok && r.product).toMatchObject({
      partNumber: 'P-1',
      fields: { hs_code: '401110', hts_code: '4011101010', cn_code: '40111000', supplier_id: 's1' },
    });
  });

  it('refuses an 8-digit code in the HS column', () => {
    expect(mapProductRow({ part_number: 'P-1', hs_code: '7208 51 20' }, lookups)).toEqual({
      ok: false, error: expect.stringMatching(/at most 6 digits/),
    });
  });

  it('refuses a name that is not on file instead of dropping it', () => {
    const r = mapProductRow({ part_number: 'P-1', supplier: 'Nobody Ltd' }, lookups);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/Supplier "Nobody Ltd" is not on file/) });
  });

  it('reads compliance field columns as values', () => {
    const r = mapProductRow({ part_number: 'P-1', 'ppwr.packaging_weight': '1,250', 'ppwr.reusable': 'Yes', 'not.a_field': 'x' }, lookups);
    expect(r.ok && r.product.values).toEqual([
      { field_key: 'ppwr.packaging_weight', value: '1250', unit: 'g' },
      { field_key: 'ppwr.reusable', value: 'yes', unit: null },
    ]);
    expect(mapProductRow({ part_number: 'P-1', 'ppwr.recycled_content': '140' }, lookups).ok).toBe(false);
  });

  it('requires a part number and a sane CN code', () => {
    expect(mapProductRow({ description: 'x' }, lookups).ok).toBe(false);
    expect(mapProductRow({ part_number: 'P', cn_code: 'steel' }, lookups).ok).toBe(false);
  });
});
