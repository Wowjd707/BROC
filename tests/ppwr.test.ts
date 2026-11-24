/**
 * Migration 047 — PPWR packaging, placements, EPR registrations and reports:
 * tenancy, roles, value checks, and the lock on a submitted report.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bootDatabase, type Harness } from './rls-harness';

let h: Harness;
let orgA: string, orgB: string, adminA: string, editorA: string, viewerA: string, editorB: string;
let productA: string, productB: string, component: string, placement: string;

async function id(sql: string, p: unknown[] = []): Promise<string> {
  return (await h.db.query<{ id: string }>(sql, p)).rows[0].id;
}
async function errorOf(sql: string, p: unknown[] = []): Promise<string | null> {
  try { await h.db.query(sql, p); return null; } catch (e) { return (e as Error).message; }
}
const COMP = `INSERT INTO packaging_components (product_id, name, material, function, weight_g) VALUES ($1, $2, $3, $4, $5)`;
const PLACE = `INSERT INTO packaging_placements (product_id, jurisdiction, year, quarter, units) VALUES ($1, $2, $3, $4, $5)`;

beforeAll(async () => {
  h = await bootDatabase();
  orgA = await id(`INSERT INTO organizations (name) VALUES ('A') RETURNING id`);
  orgB = await id(`INSERT INTO organizations (name) VALUES ('B') RETURNING id`);
  adminA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'a@a.test','admin') RETURNING id`, [orgA]);
  editorA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'e@a.test','editor') RETURNING id`, [orgA]);
  viewerA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'v@a.test','viewer') RETURNING id`, [orgA]);
  editorB = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'e@b.test','editor') RETURNING id`, [orgB]);
  await h.asServiceRole();
  productA = await id(`INSERT INTO products (organization_id, part_number) VALUES ($1,'PUMP') RETURNING id`, [orgA]);
  productB = await id(`INSERT INTO products (organization_id, part_number) VALUES ($1,'B') RETURNING id`, [orgB]);
});
afterAll(async () => { await h.db.close(); });

describe('packaging components', () => {
  it('an editor records one; viewers and other organizations cannot', async () => {
    await h.signIn(editorA);
    component = await id(`${COMP} RETURNING id`, [productA, 'Carton', 'paper_cardboard', 'sales', 820]);
    await h.signIn(viewerA);
    expect(await errorOf(COMP, [productA, 'x', 'plastic', 'sales', 10])).not.toBeNull();
    await h.signIn(editorB);
    expect((await h.db.query(`SELECT 1 FROM packaging_components WHERE id = $1`, [component])).rows).toHaveLength(0);
    expect(await errorOf(COMP, [productA, 'x', 'plastic', 'sales', 10])).not.toBeNull();
  });

  it('refuses unknown materials or functions, zero weights and impossible percentages', async () => {
    await h.signIn(editorA);
    expect(await errorOf(COMP, [productA, 'x', 'styrofoam', 'sales', 10])).not.toBeNull();
    expect(await errorOf(COMP, [productA, 'x', 'plastic', 'primary', 10])).not.toBeNull();
    expect(await errorOf(COMP, [productA, 'x', 'plastic', 'sales', 0])).not.toBeNull();
    expect(await errorOf(COMP, [productB, 'x', 'plastic', 'sales', 10])).not.toBeNull();
    expect(await errorOf(`UPDATE packaging_components SET recycled_content_pct = 120 WHERE id = $1`, [component])).not.toBeNull();
  });
});

describe('placements and reports', () => {
  it('takes jurisdiction codes for countries and US states, once per period', async () => {
    await h.signIn(editorA);
    placement = await id(`${PLACE} RETURNING id`, [productA, 'DE', 2026, null, 1200]);
    expect(await errorOf(PLACE, [productA, 'US-OR', 2026, null, 50])).toBeNull();
    expect(await errorOf(PLACE, [productA, 'Germany', 2026, null, 1])).not.toBeNull();
    expect(await errorOf(PLACE, [productA, 'DE', 2026, null, 5])).not.toBeNull();
    expect(await errorOf(PLACE, [productA, 'DE', 2026, 5, 5])).not.toBeNull();
    expect(await errorOf(PLACE, [productB, 'DE', 2026, null, 5])).not.toBeNull();
  });

  it('records one registration per jurisdiction', async () => {
    await h.signIn(editorA);
    const ins = `INSERT INTO epr_registrations (jurisdiction, register_name, registration_number, fulfilment) VALUES ('DE','LUCID','DE123',$1)`;
    expect(await errorOf(ins, ['pro'])).toBeNull();
    expect(await errorOf(ins, ['pro'])).not.toBeNull();
    expect(await errorOf(`INSERT INTO epr_registrations (jurisdiction, fulfilment) VALUES ('FR','somebody')`)).not.toBeNull();
  });

  it('only an admin submits a report, and only with its reference', async () => {
    await h.signIn(editorA);
    const r = await id(`INSERT INTO epr_reports (jurisdiction, year) VALUES ('DE', 2026) RETURNING id`);
    expect(await errorOf(`UPDATE epr_reports SET status='submitted', submitted_on='2027-05-20', reference='R1' WHERE id=$1`, [r])).not.toBeNull();
    await h.signIn(adminA);
    expect(await errorOf(`UPDATE epr_reports SET status='submitted' WHERE id=$1`, [r])).not.toBeNull();
    expect(await errorOf(`UPDATE epr_reports SET status='submitted', submitted_on='2027-05-20', reference='R1' WHERE id=$1`, [r])).toBeNull();
  });

  it('locks the reported country-year, and only that one', async () => {
    await h.signIn(adminA);
    expect(await errorOf(`UPDATE packaging_placements SET units = 1300 WHERE id = $1`, [placement])).toMatch(/has been submitted/);
    expect(await errorOf(`DELETE FROM packaging_placements WHERE id = $1`, [placement])).toMatch(/has been submitted/);
    expect(await errorOf(`UPDATE packaging_placements SET jurisdiction = 'AT' WHERE id = $1`, [placement])).toMatch(/has been submitted/);
    expect(await errorOf(PLACE, [productA, 'DE', 2026, 1, 3])).toMatch(/has been submitted/);
    expect(await errorOf(PLACE, [productA, 'FR', 2026, null, 3])).toBeNull();
    expect(await errorOf(PLACE, [productA, 'DE', 2027, null, 3])).toBeNull();
  });

  it('unlocks when an admin reopens the report, and keeps an audit trail', async () => {
    await h.signIn(adminA);
    expect(await errorOf(`UPDATE epr_reports SET status='draft' WHERE jurisdiction='DE' AND year=2026`)).toBeNull();
    expect(await errorOf(`UPDATE packaging_placements SET units = 1300 WHERE id = $1`, [placement])).toBeNull();
    await h.asServiceRole();
    const n = await h.db.query<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE table_name = 'epr_reports'`);
    expect(Number(n.rows[0].n)).toBeGreaterThanOrEqual(3);
  });

  it('keeps a part that has packaging on record', async () => {
    await h.signIn(adminA);
    expect(await errorOf(`DELETE FROM products WHERE id = $1`, [productA])).not.toBeNull();
  });
});

describe('deleting a whole organization', () => {
  it('removes its packaging records, submitted reports included', async () => {
    await h.asServiceRole();
    const org = await id(`INSERT INTO organizations (name) VALUES ('Practice') RETURNING id`);
    const prod = await id(`INSERT INTO products (organization_id, part_number) VALUES ($1,'P') RETURNING id`, [org]);
    await h.db.query(`INSERT INTO packaging_components (organization_id, product_id, name, material, function, weight_g) VALUES ($1,$2,'c','wood','transport',9000)`, [org, prod]);
    await h.db.query(`INSERT INTO packaging_placements (organization_id, product_id, jurisdiction, year, units) VALUES ($1,$2,'NL',2026,4)`, [org, prod]);
    await h.db.query(`INSERT INTO epr_reports (organization_id, jurisdiction, year, status, submitted_on, reference) VALUES ($1,'NL',2026,'submitted','2027-05-01','X')`, [org]);
    expect(await errorOf(`DELETE FROM organizations WHERE id = $1`, [org])).toBeNull();
    expect((await h.db.query(`SELECT 1 FROM packaging_placements WHERE organization_id = $1`, [org])).rows).toHaveLength(0);
  });
});

describe('migration 047', () => {
  it('adds the packaging capability row and can be applied twice', async () => {
    await h.asServiceRole();
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '047_ppwr_packaging_and_epr.sql'), 'utf8');
    await h.db.exec(sql);
    await h.db.exec(sql);
    const r = await h.db.query<{ route: string }>(`SELECT route FROM regulatory_capabilities WHERE item_code='PPWR' AND capability_key='ppwr_packaging'`);
    expect(r.rows).toEqual([{ route: '/products/ppwr' }]);
  });
});
