/**
 * Migration 045 — EUDR plots, risk assessments and shipments: tenancy,
 * roles, cross-organization references, and the freeze on filed statements.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bootDatabase, type Harness } from './rls-harness';

let h: Harness;
let orgA: string, orgB: string, adminA: string, editorA: string, viewerA: string, editorB: string;
let productA: string, productB: string, plotA: string, plotB: string, riskB: string, shipment: string;

async function id(sql: string, p: unknown[] = []): Promise<string> {
  return (await h.db.query<{ id: string }>(sql, p)).rows[0].id;
}
async function errorOf(sql: string, p: unknown[] = []): Promise<string | null> {
  try { await h.db.query(sql, p); return null; } catch (e) { return (e as Error).message; }
}
const POINT = JSON.stringify({ type: 'Point', coordinates: [12.03, 4.81] });

beforeAll(async () => {
  h = await bootDatabase();
  orgA = await id(`INSERT INTO organizations (name) VALUES ('A') RETURNING id`);
  orgB = await id(`INSERT INTO organizations (name) VALUES ('B') RETURNING id`);
  adminA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'a@a.test','admin') RETURNING id`, [orgA]);
  editorA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'e@a.test','editor') RETURNING id`, [orgA]);
  viewerA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'v@a.test','viewer') RETURNING id`, [orgA]);
  editorB = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'e@b.test','editor') RETURNING id`, [orgB]);
  await h.asServiceRole();
  productA = await id(`INSERT INTO products (organization_id, part_number, cn_code) VALUES ($1,'TYRE','40111000') RETURNING id`, [orgA]);
  productB = await id(`INSERT INTO products (organization_id, part_number) VALUES ($1,'B') RETURNING id`, [orgB]);
  plotB = await id(`INSERT INTO eudr_plots (organization_id, name, country_code, geometry) VALUES ($1,'B plot','BR',$2) RETURNING id`, [orgB, POINT]);
  riskB = await id(`INSERT INTO eudr_risk_assessments (organization_id, country_code, commodity, country_risk, country_risk_basis, conclusion)
    VALUES ($1,'BR','Rubber','standard','IR 2025/1093','negligible') RETURNING id`, [orgB]);
});
afterAll(async () => { await h.db.close(); });

describe('plots', () => {
  it('an editor adds one; bad countries and geometry types are refused', async () => {
    await h.signIn(editorA);
    plotA = await id(`INSERT INTO eudr_plots (name, country_code, geometry, area_ha) VALUES ('Farm A','BR',$1,2.5) RETURNING id`, [POINT]);
    expect(await errorOf(`INSERT INTO eudr_plots (name, country_code, geometry) VALUES ('x','Brazil',$1)`, [POINT])).not.toBeNull();
    expect(await errorOf(`INSERT INTO eudr_plots (name, country_code, geometry) VALUES ('x','BR',$1)`,
      [JSON.stringify({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })])).not.toBeNull();
  });

  it('are invisible to another organization and read-only for viewers', async () => {
    await h.signIn(editorB);
    expect((await h.db.query(`SELECT 1 FROM eudr_plots WHERE id = $1`, [plotA])).rows).toHaveLength(0);
    await h.signIn(viewerA);
    expect(await errorOf(`INSERT INTO eudr_plots (name, country_code, geometry) VALUES ('v','BR',$1)`, [POINT])).not.toBeNull();
  });
});

describe('shipments', () => {
  it('cannot point at another organization\'s product, assessment or plot', async () => {
    await h.signIn(editorA);
    expect(await errorOf(`INSERT INTO eudr_shipments (product_id, reference) VALUES ($1,'PO-1')`, [productB])).not.toBeNull();
    expect(await errorOf(`INSERT INTO eudr_shipments (product_id, reference, risk_assessment_id) VALUES ($1,'PO-1',$2)`, [productA, riskB])).not.toBeNull();
    shipment = await id(`INSERT INTO eudr_shipments (product_id, reference, hs_code, net_mass_kg, countries_of_production)
      VALUES ($1,'PO-1','401110',1200,'{BR}') RETURNING id`, [productA]);
    expect(await errorOf(`INSERT INTO eudr_shipment_plots (shipment_id, plot_id) VALUES ($1,$2)`, [shipment, plotB])).not.toBeNull();
    expect(await errorOf(`INSERT INTO eudr_shipment_plots (shipment_id, plot_id) VALUES ($1,$2)`, [shipment, plotA])).toBeNull();
  });

  it('cannot be marked filed without the reference TRACES returned', async () => {
    await h.signIn(editorA);
    expect(await errorOf(`UPDATE eudr_shipments SET status = 'filed' WHERE id = $1`, [shipment])).not.toBeNull();
    expect(await errorOf(`UPDATE eudr_shipments SET status = 'filed', dds_reference = '26BRXX', dds_verification_number = 'V1', filed_at = '2026-11-20' WHERE id = $1`, [shipment])).toBeNull();
  });

  it('freezes what a filed statement declared, its plots included', async () => {
    await h.signIn(adminA);
    expect(await errorOf(`UPDATE eudr_shipments SET net_mass_kg = 999 WHERE id = $1`, [shipment])).toMatch(/has been filed/);
    expect(await errorOf(`UPDATE eudr_shipments SET status = 'draft' WHERE id = $1`, [shipment])).toMatch(/has been filed/);
    expect(await errorOf(`DELETE FROM eudr_shipment_plots WHERE shipment_id = $1`, [shipment])).toMatch(/has been filed/);
    expect(await errorOf(`DELETE FROM eudr_shipments WHERE id = $1`, [shipment])).not.toBeNull();
    // Notes can still be added, and it can be withdrawn.
    expect(await errorOf(`UPDATE eudr_shipments SET notes = 'Customs cleared' WHERE id = $1`, [shipment])).toBeNull();
    expect(await errorOf(`UPDATE eudr_shipments SET status = 'withdrawn' WHERE id = $1`, [shipment])).toBeNull();
  });

  it('keeps a plot that a shipment used', async () => {
    await h.signIn(adminA);
    expect(await errorOf(`DELETE FROM eudr_plots WHERE id = $1`, [plotA])).not.toBeNull();
  });

  it('records changes in the audit trail', async () => {
    await h.asServiceRole();
    const r = await h.db.query<{ n: string }>(`SELECT count(*) n FROM audit_log WHERE table_name = 'eudr_shipments' AND record_id = $1`, [shipment]);
    expect(Number(r.rows[0].n)).toBeGreaterThanOrEqual(4);
  });
});

describe('deleting a whole organization', () => {
  it('removes its EUDR records, filed ones included (as a practice-workspace reset does)', async () => {
    await h.asServiceRole();
    const org = await id(`INSERT INTO organizations (name) VALUES ('Practice') RETURNING id`);
    const prod = await id(`INSERT INTO products (organization_id, part_number) VALUES ($1,'P') RETURNING id`, [org]);
    const plot = await id(`INSERT INTO eudr_plots (organization_id, name, country_code, geometry) VALUES ($1,'p','BR',$2) RETURNING id`, [org, POINT]);
    const s = await id(`INSERT INTO eudr_shipments (organization_id, product_id, reference) VALUES ($1,$2,'X') RETURNING id`, [org, prod]);
    await h.db.query(`INSERT INTO eudr_shipment_plots (organization_id, shipment_id, plot_id) VALUES ($1,$2,$3)`, [org, s, plot]);
    await h.db.query(`UPDATE eudr_shipments SET status='filed', dds_reference='R', filed_at='2026-11-20' WHERE id = $1`, [s]);
    expect(await errorOf(`DELETE FROM organizations WHERE id = $1`, [org])).toBeNull();
    expect((await h.db.query(`SELECT 1 FROM eudr_shipments WHERE id = $1`, [s])).rows).toHaveLength(0);
  });
});

describe('risk assessments', () => {
  it('need a country risk basis and a known conclusion', async () => {
    await h.signIn(editorA);
    const ins = `INSERT INTO eudr_risk_assessments (country_code, commodity, country_risk, country_risk_basis, conclusion) VALUES ('BR','Rubber',$1,$2,$3)`;
    expect(await errorOf(ins, ['standard', ' ', 'negligible'])).not.toBeNull();
    expect(await errorOf(ins, ['medium', 'x', 'negligible'])).not.toBeNull();
    expect(await errorOf(ins, ['standard', 'IR 2025/1093', 'probably fine'])).not.toBeNull();
    expect(await errorOf(ins, ['standard', 'IR 2025/1093', 'negligible'])).toBeNull();
  });
});

describe('migration 045', () => {
  it('adds the operator fields and can be applied twice', async () => {
    await h.asServiceRole();
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '045_eudr_due_diligence.sql'), 'utf8');
    await h.db.exec(sql);
    await h.db.exec(sql);
    expect(await errorOf(`UPDATE organizations SET eori_number = 'NL123', legal_address = '1 Main St' WHERE id = $1`, [orgA])).toBeNull();
  });
});
