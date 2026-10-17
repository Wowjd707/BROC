import { describe, it, expect } from 'vitest';
import {
  mapSupplierRow, canonicalizeSupplierRow,
  SUPPLIER_IMPORT_HEADERS, SUPPLIER_COLUMN_LABELS,
} from './supplier-import-core';

const none = new Set<string>();

const row = (over: Record<string, string> = {}): Record<string, string> => ({
  name: 'Midwest Steel', ...over,
});

describe('headers', () => {
  it('are spaced and capitalized, with no underscores', () => {
    expect(SUPPLIER_IMPORT_HEADERS[0]).toBe('Supplier Name');
    for (const h of SUPPLIER_IMPORT_HEADERS) expect(h).not.toMatch(/_/);
  });
});

describe('canonicalizeSupplierRow', () => {
  it('maps the spelling that does not survive normalization', () => {
    // "Annual Spend USD" becomes annual_spend_usd, not spend_usd. Spend is
    // optional, so a broken alias would not error — every supplier would import
    // with no spend and the spend-weighted views would be empty for no reason.
    expect(canonicalizeSupplierRow({ annual_spend_usd: '1000' }).spend_usd).toBe('1000');
  });

  it('accepts the shorthand people actually type', () => {
    expect(canonicalizeSupplierRow({ email: 'a@b.com' }).contact_email).toBe('a@b.com');
    expect(canonicalizeSupplierRow({ supplier: 'Acme' }).name).toBe('Acme');
  });

  it('never lets an alias overwrite an explicit column', () => {
    const out = canonicalizeSupplierRow({ supplier: 'Wrong', name: 'Right' });
    expect(out.name).toBe('Right');
  });
});

describe('mapSupplierRow', () => {
  it('maps a full row', () => {
    const r = mapSupplierRow(row({
      contact_name: 'Dana Whitfield', contact_email: 'dana@midweststeel.com',
      country: 'USA', industry: 'Metals', tier: '1',
      spend_usd: '$1,250,000', notes: 'Primary billet supplier',
    }), none, none);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.supplier).toEqual({
        name: 'Midwest Steel',
        contactName: 'Dana Whitfield',
        contactEmail: 'dana@midweststeel.com',
        country: 'USA',
        industry: 'Metals',
        tier: 1,
        spendUsd: 1250000,
        notes: 'Primary billet supplier',
      });
    }
  });

  it('requires only a name', () => {
    const r = mapSupplierRow(row(), none, none);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.supplier.contactEmail).toBeNull();
  });

  it('rejects a row with no name', () => {
    const r = mapSupplierRow({ contact_email: 'a@b.com' }, none, none);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(SUPPLIER_COLUMN_LABELS.name);
  });

  it('strips currency formatting from spend', () => {
    // A cell formatted as currency exports with the symbol and separators, and
    // rejecting that would fail a file that is entirely correct.
    const r = mapSupplierRow(row({ spend_usd: '$ 2,400,500.50' }), none, none);
    if (r.ok) expect(r.supplier.spendUsd).toBe(2400500.5);
  });

  it('accepts a tier written as "Tier 2"', () => {
    const r = mapSupplierRow(row({ tier: 'Tier 2' }), none, none);
    if (r.ok) expect(r.supplier.tier).toBe(2);
  });

  it('rejects a tier outside 1 to 3', () => {
    expect(mapSupplierRow(row({ tier: '4' }), none, none).ok).toBe(false);
    expect(mapSupplierRow(row({ tier: '0' }), none, none).ok).toBe(false);
    // The column has a CHECK for this, so an out-of-range value would otherwise
    // fail as a database error naming a constraint rather than a row.
  });

  it('rejects a negative spend', () => {
    expect(mapSupplierRow(row({ spend_usd: '-5' }), none, none).ok).toBe(false);
  });

  describe('email', () => {
    it('catches the obvious mistakes', () => {
      expect(mapSupplierRow(row({ contact_email: 'not-an-email' }), none, none).ok).toBe(false);
      expect(mapSupplierRow(row({ contact_email: 'two@at@signs.com' }), none, none).ok).toBe(false);
      expect(mapSupplierRow(row({ contact_email: 'has space@b.com' }), none, none).ok).toBe(false);
      expect(mapSupplierRow(row({ contact_email: 'no@domain' }), none, none).ok).toBe(false);
    });

    it('accepts the awkward but legitimate ones', () => {
      // Rejecting a valid address blocks a real supplier from ever being asked,
      // which costs more than a bounce the invitation flow already reports.
      for (const e of ['a.b+tag@sub.example.co.uk', "o'brien@acme.com", 'UPPER@Acme.COM']) {
        expect(mapSupplierRow(row({ contact_email: e }), none, none).ok).toBe(true);
      }
    });
  });

  describe('duplicates', () => {
    it('flags a name already on the list, case-insensitively', () => {
      const r = mapSupplierRow(row({ name: 'midwest steel' }), new Set(['midwest steel']), none);
      expect(r.ok).toBe(false);
      if (!r.ok) expect('duplicate' in r && r.duplicate).toBe(true);
    });

    it('flags a contact already on the list', () => {
      const r = mapSupplierRow(
        row({ name: 'Different Name', contact_email: 'Dana@Acme.com' }),
        none, new Set(['dana@acme.com']),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect('duplicate' in r && r.duplicate).toBe(true);
    });

    it('keeps a duplicate distinct from a failure', () => {
      // suppliers has no unique constraint, so re-uploading a list would double
      // it — and a duplicated supplier splits that supplier's survey history in
      // two. But "already on your list" is not something to go and fix.
      const dup = mapSupplierRow(row(), new Set(['midwest steel']), none);
      const bad = mapSupplierRow(row({ tier: '9' }), none, none);
      expect('duplicate' in dup).toBe(true);
      expect('duplicate' in bad).toBe(false);
    });
  });
});
