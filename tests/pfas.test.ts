/**
 * Migration 048 — PFAS declarations and substances: tenancy, roles, and the
 * rules that keep an answer honest (evidence behind it, sane CAS and markets).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bootDatabase, type Harness } from './rls-harness';

let h: Harness;
let orgA: string, orgB: string, adminA: string, editorA: string, viewerA: string, editorB: string;
let productA: string, productA2: string, productB: string, declA: string, declB: string;

async function id(sql: string, p: unknown[] = []): Promise<string> {
  return (await h.db.query<{ id: string }>(sql, p)).rows[0].id;
}
async function errorOf(sql: string, p: unknown[] = []): Promise<string | null> {
  try { await h.db.query(sql, p); return null; } catch (e) { return (e as Error).message; }
}
const DECL = `INSERT INTO pfas_declarations (product_id, status, basis, evidence, declared_on, markets) VALUES ($1, $2, $3, $4, $5, $6)`;

beforeAll(async () => {
  h = await bootDatabase();
  orgA = await id(`INSERT INTO organizations (name) VALUES ('A') RETURNING id`);
  orgB = await id(`INSERT INTO organizations (name) VALUES ('B') RETURNING id`);
  adminA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'a@a.test','admin') RETURNING id`, [orgA]);
  editorA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'e@a.test','editor') RETURNING id`, [orgA]);
  viewerA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'v@a.test','viewer') RETURNING id`, [orgA]);
  editorB = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'e@b.test','editor') RETURNING id`, [orgB]);
  await h.asServiceRole();
  productA = await id(`INSERT INTO products (organization_id, part_number) VALUES ($1,'SEAL') RETURNING id`, [orgA]);
  productA2 = await id(`INSERT INTO products (organization_id, part_number) VALUES ($1,'BOLT') RETURNING id`, [orgA]);
  productB = await id(`INSERT INTO products (organization_id, part_number) VALUES ($1,'B') RETURNING id`, [orgB]);
  declB = await id(`INSERT INTO pfas_declarations (organization_id, product_id) VALUES ($1,$2) RETURNING id`, [orgB, productB]);
});
afterAll(async () => { await h.db.close(); });

describe('declarations', () => {
  it('an editor records one per part; viewers and other organizations cannot', async () => {
    await h.signIn(editorA);
    declA = await id(`${DECL} RETURNING id`, [productA, 'intentionally_added', 'supplier_declaration', 'Letter 2026-05', '2026-05-01', '{US-MN,DE}']);
    expect(await errorOf(DECL, [productA, 'none', 'test_report', 'x', '2026-05-01', '{}'])).not.toBeNull();
    expect(await errorOf(DECL, [productB, 'unknown', null, null, null, '{}'])).not.toBeNull();
    await h.signIn(viewerA);
    expect(await errorOf(DECL, [productA2, 'unknown', null, null, null, '{}'])).not.toBeNull();
    await h.signIn(editorB);
    expect((await h.db.query(`SELECT 1 FROM pfas_declarations WHERE id = $1`, [declA])).rows).toHaveLength(0);
  });

  it('refuses an answer with no evidence or date, and malformed markets', async () => {
    await h.signIn(editorA);
    expect(await errorOf(DECL, [productA2, 'none', 'supplier_declaration', ' ', '2026-05-01', '{}'])).not.toBeNull();
    expect(await errorOf(DECL, [productA2, 'none', null, 'Letter', '2026-05-01', '{}'])).not.toBeNull();
    expect(await errorOf(DECL, [productA2, 'none', 'supplier_declaration', 'Letter', null, '{}'])).not.toBeNull();
    expect(await errorOf(DECL, [productA2, 'none', 'supplier_declaration', 'Letter', '2026-05-01', '{Minnesota}'])).not.toBeNull();
    expect(await errorOf(DECL, [productA2, 'maybe', null, null, null, '{}'])).not.toBeNull();
    // Unknown needs nothing: it is the honest default.
    expect(await errorOf(DECL, [productA2, 'unknown', null, null, null, '{}'])).toBeNull();
  });
});

describe('substances', () => {
  const SUB = `INSERT INTO pfas_substances (declaration_id, name, cas_number, amount_low, amount_high, amount_unit) VALUES ($1,$2,$3,$4,$5,$6)`;
  it('belong to the organization\'s own declaration, with a well-formed CAS and amount', async () => {
    await h.signIn(editorA);
    expect(await errorOf(SUB, [declA, 'PTFE', '9002-84-0', 1200, 1500, 'mg_per_unit'])).toBeNull();
    expect(await errorOf(SUB, [declB, 'PTFE', '9002-84-0', null, null, null])).not.toBeNull();
    expect(await errorOf(SUB, [declA, 'PTFE', '9002840', null, null, null])).not.toBeNull();
    expect(await errorOf(SUB, [declA, 'PTFE', null, 5, 2, 'ppm'])).not.toBeNull();
    expect(await errorOf(SUB, [declA, 'PTFE', null, 5, 5, null])).not.toBeNull();
    expect(await errorOf(SUB, [declA, ' ', null, null, null, null])).not.toBeNull();
  });

  it('can be removed by an editor; a declaration only by an admin, taking its substances', async () => {
    await h.signIn(editorA);
    const s = await id(`${SUB} RETURNING id`, [declA, 'FKM', '9011-17-0', null, null, null]);
    expect(await errorOf(`DELETE FROM pfas_substances WHERE id = $1`, [s])).toBeNull();
    await h.db.query(`DELETE FROM pfas_declarations WHERE id = $1`, [declA]);
    expect((await h.db.query(`SELECT 1 FROM pfas_declarations WHERE id = $1`, [declA])).rows).toHaveLength(1);
    await h.signIn(adminA);
    expect(await errorOf(`DELETE FROM pfas_declarations WHERE id = $1`, [declA])).toBeNull();
    expect((await h.db.query(`SELECT 1 FROM pfas_substances WHERE declaration_id = $1`, [declA])).rows).toHaveLength(0);
  });

  it('keeps an audit trail', async () => {
    await h.asServiceRole();
    const r = await h.db.query<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE table_name = 'pfas_declarations'`);
    expect(Number(r.rows[0].n)).toBeGreaterThanOrEqual(2);
  });
});

describe('migration 048', () => {
  it('adds the capability rows and can be applied twice', async () => {
    await h.asServiceRole();
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '048_pfas_declarations.sql'), 'utf8');
    await h.db.exec(sql);
    await h.db.exec(sql);
    const r = await h.db.query<{ item_code: string }>(`SELECT item_code FROM regulatory_capabilities WHERE capability_key = 'pfas_declarations' ORDER BY 1`);
    expect(r.rows.map((x) => x.item_code)).toEqual(['EPA-PFAS-TSCA', 'EU-PFAS']);
  });
});
