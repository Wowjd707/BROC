/**
 * Migration 046 — CBAM imports and annual declarations: tenancy, roles,
 * sourced figures, and the lock on a submitted year.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bootDatabase, type Harness } from './rls-harness';

let h: Harness;
let orgA: string, orgB: string, adminA: string, editorA: string, viewerA: string, editorB: string;
let productA: string, productB: string, supplierB: string, imp2026: string;

async function id(sql: string, p: unknown[] = []): Promise<string> {
  return (await h.db.query<{ id: string }>(sql, p)).rows[0].id;
}
async function errorOf(sql: string, p: unknown[] = []): Promise<string | null> {
  try { await h.db.query(sql, p); return null; } catch (e) { return (e as Error).message; }
}
const INS = `INSERT INTO cbam_imports (product_id, import_date, cn_code, quantity, country_of_origin, direct_emissions, emissions_basis, emissions_source)
  VALUES ($1, $2, '73269098', $3, 'CN', 2.1, 'default', 'Commission default values, 2026')`;

beforeAll(async () => {
  h = await bootDatabase();
  orgA = await id(`INSERT INTO organizations (name) VALUES ('A') RETURNING id`);
  orgB = await id(`INSERT INTO organizations (name) VALUES ('B') RETURNING id`);
  adminA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'a@a.test','admin') RETURNING id`, [orgA]);
  editorA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'e@a.test','editor') RETURNING id`, [orgA]);
  viewerA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'v@a.test','viewer') RETURNING id`, [orgA]);
  editorB = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'e@b.test','editor') RETURNING id`, [orgB]);
  await h.asServiceRole();
  productA = await id(`INSERT INTO products (organization_id, part_number, cn_code) VALUES ($1,'BRACKET','73269098') RETURNING id`, [orgA]);
  productB = await id(`INSERT INTO products (organization_id, part_number) VALUES ($1,'B') RETURNING id`, [orgB]);
  supplierB = await id(`INSERT INTO suppliers (organization_id, name) VALUES ($1,'B supplier') RETURNING id`, [orgB]);
});
afterAll(async () => { await h.db.close(); });

describe('imports', () => {
  it('an editor records one; viewers and other organizations cannot', async () => {
    await h.signIn(editorA);
    imp2026 = await id(`${INS} RETURNING id`, [productA, '2026-03-10', 30]);
    await h.signIn(viewerA);
    expect(await errorOf(INS, [productA, '2026-03-11', 1])).not.toBeNull();
    await h.signIn(editorB);
    expect((await h.db.query(`SELECT 1 FROM cbam_imports WHERE id = $1`, [imp2026])).rows).toHaveLength(0);
  });

  it('cannot point at another organization\'s part or supplier', async () => {
    await h.signIn(editorA);
    expect(await errorOf(INS, [productB, '2026-03-12', 1])).not.toBeNull();
    expect(await errorOf(`INSERT INTO cbam_imports (product_id, supplier_id, import_date, cn_code, quantity, country_of_origin)
      VALUES ($1,$2,'2026-03-12','73269098',1,'CN')`, [productA, supplierB])).not.toBeNull();
  });

  it('refuses emissions without a basis and source, and bad codes or quantities', async () => {
    await h.signIn(editorA);
    const base = `INSERT INTO cbam_imports (product_id, import_date, cn_code, quantity, country_of_origin, direct_emissions, emissions_basis, emissions_source) VALUES ($1,'2026-04-01',$2,$3,$4,$5,$6,$7)`;
    expect(await errorOf(base, [productA, '73269098', 1, 'CN', 2, 'default', ' '])).not.toBeNull();
    expect(await errorOf(base, [productA, '73269098', 1, 'CN', 2, null, 'x'])).not.toBeNull();
    expect(await errorOf(base, [productA, '7326 90', 1, 'CN', null, null, null])).not.toBeNull();
    expect(await errorOf(base, [productA, '73269098', 0, 'CN', null, null, null])).not.toBeNull();
    expect(await errorOf(base, [productA, '73269098', 1, 'China', null, null, null])).not.toBeNull();
    // No emissions yet is allowed: it is reported as incomplete, never as zero.
    expect(await errorOf(base, [productA, '73269098', 1, 'CN', null, null, null])).toBeNull();
  });
});

describe('declarations', () => {
  it('only an admin can submit, and only with the registry reference', async () => {
    await h.signIn(editorA);
    const d = await id(`INSERT INTO cbam_declarations (year, authorised_declarant_number) VALUES (2026, 'NL-1') RETURNING id`);
    expect(await errorOf(`UPDATE cbam_declarations SET status='submitted', submitted_on='2027-09-01', registry_reference='R1' WHERE id=$1`, [d])).not.toBeNull();
    await h.signIn(adminA);
    expect(await errorOf(`UPDATE cbam_declarations SET status='submitted' WHERE id=$1`, [d])).not.toBeNull();
    expect(await errorOf(`UPDATE cbam_declarations SET status='submitted', submitted_on='2027-09-01', registry_reference='R1' WHERE id=$1`, [d])).toBeNull();
  });

  it('refuses a deduction without its source', async () => {
    await h.signIn(editorA);
    expect(await errorOf(`INSERT INTO cbam_declarations (year, free_allocation_adjustment) VALUES (2027, 12)`)).not.toBeNull();
    expect(await errorOf(`INSERT INTO cbam_declarations (year, free_allocation_adjustment, free_allocation_source) VALUES (2027, 12, 'Registry calc')`)).toBeNull();
  });

  it('locks the submitted year\'s imports, and only that year\'s', async () => {
    await h.signIn(adminA);
    expect(await errorOf(`UPDATE cbam_imports SET quantity = 31 WHERE id = $1`, [imp2026])).toMatch(/has been submitted/);
    expect(await errorOf(`DELETE FROM cbam_imports WHERE id = $1`, [imp2026])).toMatch(/has been submitted/);
    expect(await errorOf(INS, [productA, '2026-12-01', 5])).toMatch(/has been submitted/);
    // Moving an import out of a locked year is a change to that year too.
    expect(await errorOf(`UPDATE cbam_imports SET import_date = '2027-01-02' WHERE id = $1`, [imp2026])).toMatch(/has been submitted/);
    expect(await errorOf(INS, [productA, '2027-01-05', 5])).toBeNull();
  });

  it('can be reopened by an admin, which unlocks the year', async () => {
    await h.signIn(adminA);
    expect(await errorOf(`UPDATE cbam_declarations SET status='draft' WHERE year = 2026`)).toBeNull();
    expect(await errorOf(`UPDATE cbam_imports SET quantity = 31 WHERE id = $1`, [imp2026])).toBeNull();
  });

  it('records changes in the audit trail', async () => {
    await h.asServiceRole();
    const r = await h.db.query<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE table_name = 'cbam_declarations'`);
    expect(Number(r.rows[0].n)).toBeGreaterThanOrEqual(3);
  });
});

describe('deleting a whole organization', () => {
  it('removes its CBAM records, submitted years included', async () => {
    await h.asServiceRole();
    const org = await id(`INSERT INTO organizations (name) VALUES ('Practice') RETURNING id`);
    const prod = await id(`INSERT INTO products (organization_id, part_number) VALUES ($1,'P') RETURNING id`, [org]);
    await h.db.query(`INSERT INTO cbam_imports (organization_id, product_id, import_date, cn_code, quantity, country_of_origin) VALUES ($1,$2,'2026-02-01','72081000',3,'TR')`, [org, prod]);
    await h.db.query(`INSERT INTO cbam_declarations (organization_id, year, status, submitted_on, registry_reference) VALUES ($1,2026,'submitted','2027-09-01','R')`, [org]);
    expect(await errorOf(`DELETE FROM organizations WHERE id = $1`, [org])).toBeNull();
    expect((await h.db.query(`SELECT 1 FROM cbam_imports WHERE organization_id = $1`, [org])).rows).toHaveLength(0);
  });
});

describe('migration 046', () => {
  it('points the capability map at the new pages and can be applied twice', async () => {
    await h.asServiceRole();
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '046_cbam_imports_and_declarations.sql'), 'utf8');
    await h.db.exec(sql);
    await h.db.exec(sql);
    const r = await h.db.query<{ capability_key: string; route: string; probe: string }>(
      `SELECT capability_key, route, probe FROM regulatory_capabilities WHERE capability_key IN ('eudr_geolocation','cbam_calculator') ORDER BY 1`);
    expect(r.rows).toEqual([
      { capability_key: 'cbam_calculator', route: '/products/cbam', probe: 'cbam_declaration' },
      { capability_key: 'eudr_geolocation', route: '/products/eudr', probe: 'eudr_due_diligence' },
    ]);
  });
});
