/**
 * supabase/content/scope-packs/eu-cbam-eudr-2026-11.sql loads cleanly, can be
 * re-run, and puts the right products in and out of scope — including the
 * edges where the legal text says "except" or a 2026 amendment deleted a code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bootDatabase, type Harness } from './rls-harness';
import { regulationsForProduct, type ScopeRule, type ProductCodes } from '../lib/compliance-core';

let h: Harness;
let rules: ScopeRule[];
const PACK = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'content', 'scope-packs', 'eu-cbam-eudr-2026-11.sql'), 'utf8',
).replace("'YOUR WORKSPACE NAME'", "'  acme industrial '");

async function load() {
  return (await h.db.query<ScopeRule & { source_citation: string; last_verified: string }>(
    `SELECT regulation, code_system, cn_prefix, source_citation, last_verified::text FROM compliance_scope_rules`)).rows;
}

beforeAll(async () => {
  h = await bootDatabase();
  await h.asServiceRole();
  await h.db.query(`INSERT INTO organizations (name) VALUES ('Acme Industrial'), ('Other Co')`);
  await h.db.exec(PACK);
  rules = await load();
});
afterAll(async () => { await h.db.close(); });

const regs = (p: ProductCodes) => regulationsForProduct(p, rules);
const cn = (code: string) => regs({ cn_code: code });

describe('scope pack: loading', () => {
  it('loads every rule with a citation and verification date, and re-running adds nothing', async () => {
    expect(rules.length).toBe(155);
    expect(rules.every((r) => (r as unknown as { source_citation: string }).source_citation.startsWith('Regulation (EU)'))).toBe(true);
    await h.db.exec(PACK);
    expect((await load()).length).toBe(155);
  });

  it('refuses to guess the workspace', async () => {
    const unset = PACK.replace("'  acme industrial '", "'No Such Workspace'");
    await expect(h.db.exec(unset)).rejects.toThrow(/0 workspace\(s\) named "No Such Workspace". Workspaces here: "Acme Industrial", "Other Co"/);
  });
});

describe('scope pack: CBAM edges', () => {
  it('covers Chapter 72 except the listed ferro-alloys and scrap', () => {
    expect(cn('72085120')).toEqual(['cbam']);          // flat-rolled steel
    expect(cn('72021120')).toEqual(['cbam']);          // ferro-manganese: in
    expect(cn('72026000')).toEqual(['cbam']);          // ferro-nickel: in
    expect(cn('72022100')).toEqual([]);                // ferro-silicon: excepted
    expect(cn('72029910')).toEqual([]);                // ferro-phosphorus: excepted
    expect(cn('72044110')).toEqual([]);                // scrap: excepted
  });

  it('covers only the listed Chapter 73 and 76 headings', () => {
    expect(cn('73181500')).toEqual(['cbam']);          // bolts
    expect(cn('73211100')).toEqual([]);                // stoves: not listed
    expect(cn('76012000')).toEqual(['cbam']);
    expect(cn('76020011')).toEqual([]);                // aluminium scrap
    expect(cn('76151010')).toEqual([]);                // household articles
  });

  it('handles fertilisers, cement and the 8-digit CN entries', () => {
    expect(cn('31052010')).toEqual(['cbam']);
    expect(cn('31056000')).toEqual([]);                // excepted
    expect(cn('25070080')).toEqual(['cbam']);          // calcined clay
    expect(cn('25070020')).toEqual([]);
    expect(cn('25232900')).toEqual(['cbam']);
  });

  it('matches a US HTS or a bare HS code through the shared six digits', () => {
    expect(regs({ hts_code: '7208510030' })).toEqual(['cbam']);
    expect(regs({ hs_code: '252329' })).toEqual(['cbam']);
  });
});

describe('scope pack: EUDR after the 2025 and 2026 amendments', () => {
  it('leaves out 4010 and 4016, and narrows 4012 to tyre treads', () => {
    expect(cn('40101200')).toEqual([]);                // conveyor belts: deleted
    expect(cn('40169300')).toEqual([]);                // gaskets: deleted
    expect(cn('40111000')).toEqual(['eudr']);          // new tyres
    expect(cn('40129030')).toEqual(['eudr']);          // tyre treads
    expect(cn('40122000')).toEqual([]);                // used tyres: out
    expect(cn('40012100')).toEqual(['eudr']);
  });

  it('reflects the other deletions and narrowings', () => {
    expect(cn('41071100')).toEqual([]);                // leather: deleted
    expect(cn('49011000')).toEqual([]);                // printed books: deleted
    expect(cn('12011000')).toEqual([]);                // soya for sowing
    expect(cn('12019000')).toEqual(['eudr']);
    expect(cn('94012000')).toEqual([]);                // motor vehicle seats
    expect(cn('94016100')).toEqual(['eudr']);
    expect(cn('94019190')).toEqual(['eudr']);
  });

  it('does not yet include additions that apply from 30 December 2027', () => {
    expect(cn('21011100')).toEqual([]);                // soluble coffee
    expect(cn('34011100')).toEqual([]);                // palm soap
  });
});
