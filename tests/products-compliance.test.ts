/**
 * Migration 043 — products, scope rules, compliance values and invitation
 * links: tenant isolation, roles, and append-only values.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bootDatabase, type Harness } from './rls-harness';

let h: Harness;
let orgA: string, orgB: string, adminA: string, editorA: string, viewerA: string, editorB: string;
let productA: string, productB: string, surveyA: string, invitationA: string, invitationB: string;

async function id(sql: string, p: unknown[] = []): Promise<string> {
  return (await h.db.query<{ id: string }>(sql, p)).rows[0].id;
}
async function errorOf(sql: string, p: unknown[] = []): Promise<string | null> {
  try { await h.db.query(sql, p); return null; } catch (e) { return (e as Error).message; }
}
async function count(sql: string, p: unknown[] = []): Promise<number> {
  return Number((await h.db.query<{ n: string }>(sql, p)).rows[0].n);
}

beforeAll(async () => {
  h = await bootDatabase();
  orgA = await id(`INSERT INTO organizations (name) VALUES ('A') RETURNING id`);
  orgB = await id(`INSERT INTO organizations (name) VALUES ('B') RETURNING id`);
  adminA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'a@a.test','admin') RETURNING id`, [orgA]);
  editorA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'e@a.test','editor') RETURNING id`, [orgA]);
  viewerA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'v@a.test','viewer') RETURNING id`, [orgA]);
  editorB = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'e@b.test','editor') RETURNING id`, [orgB]);
  await h.asServiceRole();
  productB = await id(`INSERT INTO products (organization_id, part_number) VALUES ($1,'B-1') RETURNING id`, [orgB]);
  surveyA = await id(`INSERT INTO supplier_surveys (organization_id, title, regulation_type, status) VALUES ($1,'S','cbam','active') RETURNING id`, [orgA]);
  const surveyB = await id(`INSERT INTO supplier_surveys (organization_id, title, regulation_type, status) VALUES ($1,'S','cbam','active') RETURNING id`, [orgB]);
  invitationA = await id(`INSERT INTO supplier_survey_invitations (survey_id, supplier_name, email) VALUES ($1,'X','x@x.test') RETURNING id`, [surveyA]);
  invitationB = await id(`INSERT INTO supplier_survey_invitations (survey_id, supplier_name, email) VALUES ($1,'Y','y@y.test') RETURNING id`, [surveyB]);
});
afterAll(async () => { await h.db.close(); });

describe('products', () => {
  it('lets an editor add one, stamped with their organization, and audits it', async () => {
    await h.signIn(editorA);
    productA = await id(`INSERT INTO products (part_number, cn_code) VALUES ('A-1','72085120') RETURNING id`);
    await h.asServiceRole();
    expect(await count(`SELECT count(*) n FROM products WHERE id = $1 AND organization_id = $2`, [productA, orgA])).toBe(1);
    expect(await count(`SELECT count(*) n FROM audit_log WHERE table_name = 'products' AND record_id = $1`, [productA])).toBe(1);
  });

  it('keeps part numbers unique per organization, ignoring case', async () => {
    await h.signIn(editorA);
    expect(await errorOf(`INSERT INTO products (part_number) VALUES ('a-1')`)).toMatch(/uq_products_org_part|duplicate/);
    await h.signIn(editorB);
    expect(await errorOf(`INSERT INTO products (part_number) VALUES ('A-1')`)).toBeNull();
  });

  it('refuses a malformed CN code', async () => {
    await h.signIn(editorA);
    expect(await errorOf(`INSERT INTO products (part_number, cn_code) VALUES ('A-2','72.08')`)).not.toBeNull();
  });

  it('is invisible across organizations and read-only to viewers', async () => {
    await h.signIn(editorB);
    expect(await count(`SELECT count(*) n FROM products WHERE id = $1`, [productA])).toBe(0);
    await h.signIn(viewerA);
    expect(await count(`SELECT count(*) n FROM products`)).toBe(1);
    expect(await errorOf(`INSERT INTO products (part_number) VALUES ('V-1')`)).not.toBeNull();
  });
});

describe('scope rules', () => {
  it('are admin-only and must carry a citation', async () => {
    const insert = `INSERT INTO compliance_scope_rules (regulation, cn_prefix, source_citation, last_verified) VALUES ('cbam','72',$1,'2026-11-19')`;
    await h.signIn(editorA);
    expect(await errorOf(insert, ['Annex I'])).not.toBeNull();
    await h.signIn(adminA);
    expect(await errorOf(insert, ['  '])).not.toBeNull();
    expect(await errorOf(insert, ['Regulation (EU) 2023/956, Annex I'])).toBeNull();
  });
});

describe('compliance values', () => {
  const insert = `INSERT INTO product_compliance_values (product_id, field_key, value, source) VALUES ($1,$2,'x','manual')`;

  it('accept an editor\'s value on their own product only', async () => {
    await h.signIn(editorA);
    expect(await errorOf(insert, [productA, 'eudr.geolocation'])).toBeNull();
    expect(await errorOf(insert, [productB, 'eudr.geolocation'])).not.toBeNull();
    expect(await errorOf(insert, [productA, 'not a key'])).not.toBeNull();
    await h.signIn(viewerA);
    expect(await errorOf(insert, [productA, 'eudr.geolocation'])).not.toBeNull();
  });

  it('cannot be edited or deleted', async () => {
    await h.signIn(editorA);
    await errorOf(`UPDATE product_compliance_values SET value = 'changed'`);
    await errorOf(`DELETE FROM product_compliance_values`);
    await h.asServiceRole();
    const r = await h.db.query<{ value: string }>(`SELECT value FROM product_compliance_values WHERE product_id = $1`, [productA]);
    expect(r.rows).toEqual([{ value: 'x' }]);
  });
});

describe('invitation links', () => {
  it('link only your own invitation to your own product', async () => {
    const link = `INSERT INTO supplier_survey_invitation_products (invitation_id, product_id) VALUES ($1,$2)`;
    await h.signIn(editorA);
    expect(await errorOf(link, [invitationA, productB])).not.toBeNull();
    expect(await errorOf(link, [invitationB, productA])).not.toBeNull();
    expect(await errorOf(link, [invitationA, productA])).toBeNull();
  });

  it('maps_to accepts a field key or nothing', async () => {
    await h.asServiceRole();
    const q = `INSERT INTO supplier_survey_questions (survey_id, question_key, label, maps_to) VALUES ($1,$2,'L',$3)`;
    expect(await errorOf(q, [surveyA, 'k1', 'eudr.geolocation'])).toBeNull();
    expect(await errorOf(q, [surveyA, 'k2', null])).toBeNull();
    expect(await errorOf(q, [surveyA, 'k3', 'geolocation'])).not.toBeNull();
  });
});

describe('migration 043', () => {
  it('can be applied twice', async () => {
    await h.asServiceRole();
    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '043_products_and_compliance_data.sql'), 'utf8');
    await h.db.exec(sql);
    expect(await count(`SELECT count(*) n FROM products`)).toBe(3);
  });
});
