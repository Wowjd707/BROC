/**
 * Migration 037 — each defect it fixes, pinned against a real Postgres.
 *
 * Every test here failed before 037 was written. They speak SQL directly,
 * through the same harness as sandbox-rls.test.ts, because what they assert is
 * the database's decision: a mocked Supabase client would pass whatever the
 * policies said.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootDatabase, isRlsRefusal, type Harness } from './rls-harness';

let h: Harness;
let org: string;
let admin: string;
let editor: string;
let leaver: string;
let site: string;

async function id(sql: string, p: unknown[] = []): Promise<string> {
  return (await h.db.query<{ id: string }>(sql, p)).rows[0].id;
}

async function errorOf(sql: string, p: unknown[] = []): Promise<string | null> {
  try {
    await h.db.query(sql, p);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

beforeAll(async () => {
  h = await bootDatabase();
  org = await id(`INSERT INTO organizations (name) VALUES ('Acme Steel') RETURNING id`);
  admin = await id(
    `INSERT INTO users (organization_id, email, role) VALUES ($1,'admin@acme.test','admin') RETURNING id`, [org]);
  editor = await id(
    `INSERT INTO users (organization_id, email, role) VALUES ($1,'editor@acme.test','editor') RETURNING id`, [org]);
  leaver = await id(
    `INSERT INTO users (organization_id, email, role) VALUES ($1,'leaver@acme.test','editor') RETURNING id`, [org]);
  site = await id(`INSERT INTO sites (organization_id, name) VALUES ($1,'Riverside') RETURNING id`, [org]);
}, 120_000);

afterAll(async () => { await h?.db.close(); });

describe('deactivation', () => {
  it('an active editor can read their organization', async () => {
    await h.signIn(leaver);
    const { rows } = await h.db.query(`SELECT id FROM sites`);
    expect(rows).toHaveLength(1);
    await h.asServiceRole();
  });

  it('an editor cannot deactivate a colleague', async () => {
    await h.signIn(editor);
    const err = await errorOf(`UPDATE users SET is_active = false WHERE id = $1`, [leaver]);
    await h.asServiceRole();
    // Either the guard raises or RLS filters the row out; both leave it active.
    const { rows } = await h.db.query<{ is_active: boolean }>(
      `SELECT is_active FROM users WHERE id = $1`, [leaver]);
    expect(rows[0].is_active).toBe(true);
    expect(err === null || /administrator/.test(err)).toBe(true);
  });

  it('an administrator cannot deactivate themselves', async () => {
    await h.signIn(admin);
    const err = await errorOf(`UPDATE users SET is_active = false WHERE id = $1`, [admin]);
    await h.asServiceRole();
    expect(err).toMatch(/your own account/);
  });

  it('an administrator can deactivate someone else', async () => {
    await h.signIn(admin);
    expect(await errorOf(`UPDATE users SET is_active = false WHERE id = $1`, [leaver])).toBeNull();
    await h.asServiceRole();
  });

  it('a deactivated user reads nothing', async () => {
    await h.signIn(leaver);
    const sites = await h.db.query(`SELECT id FROM sites`);
    const orgs = await h.db.query(`SELECT id FROM organizations`);
    await h.asServiceRole();
    expect(sites.rows).toHaveLength(0);
    expect(orgs.rows).toHaveLength(0);
  });

  it('a deactivated user writes nothing', async () => {
    await h.signIn(leaver);
    let refused = false;
    try {
      await h.db.query(`INSERT INTO sites (organization_id, name) VALUES ($1,'Sneaky')`, [org]);
    } catch (e) {
      refused = isRlsRefusal(e);
    }
    await h.asServiceRole();
    expect(refused).toBe(true);
  });

  it('a deactivated user cannot reactivate themselves', async () => {
    await h.signIn(leaver);
    await errorOf(`UPDATE users SET is_active = true WHERE id = $1`, [leaver]);
    await h.asServiceRole();
    const { rows } = await h.db.query<{ is_active: boolean }>(
      `SELECT is_active FROM users WHERE id = $1`, [leaver]);
    expect(rows[0].is_active).toBe(false);
  });
});

describe('practice workspace reset', () => {
  it('succeeds when the sandbox holds audited data', async () => {
    await h.signIn(admin);
    const sandbox = (await h.db.query<{ id: string }>(`SELECT provision_sandbox() AS id`)).rows[0].id;
    await h.db.query(`SELECT set_active_organization($1)`, [sandbox]);
    const practiceSite = await id(
      `INSERT INTO sites (organization_id, name) VALUES ($1,'Practice') RETURNING id`, [sandbox]);
    await h.db.query(
      `INSERT INTO ehs_entries (organization_id, site_id, entry_date, metric_type, source_type,
         quantity, unit, quantity_normalized, unit_normalized, created_by)
       VALUES ($1,$2,'2026-08-31','water','municipal_consumption',1,'gallons',3.785,'liters',$3)`,
      [sandbox, practiceSite, admin]);

    const err = await errorOf(`SELECT reset_sandbox()`);
    await h.db.query(`SELECT set_active_organization(null)`);
    await h.asServiceRole();
    expect(err).toBeNull();

    const gone = await h.db.query(`SELECT 1 FROM organizations WHERE id = $1`, [sandbox]);
    expect(gone.rows).toHaveLength(0);
  });
});

describe('boundary changes are audited', () => {
  it('records a change to a site ownership share', async () => {
    await h.signIn(admin);
    await h.db.query(`UPDATE sites SET ownership_percent = 60 WHERE id = $1`, [site]);
    await h.asServiceRole();
    const { rows } = await h.db.query<{ changes: { old: { ownership_percent: string }; new: { ownership_percent: string } } }>(
      `SELECT changes FROM audit_log WHERE table_name = 'sites' AND record_id = $1 AND action = 'update'`,
      [site]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].changes.new.ownership_percent)).toBe(60);
    expect(Number(rows[0].changes.old.ownership_percent)).toBe(100);
  });

  it('records a change to the consolidation approach', async () => {
    await h.signIn(admin);
    await h.db.query(`UPDATE organizations SET consolidation_approach = 'equity_share' WHERE id = $1`, [org]);
    await h.asServiceRole();
    const { rows } = await h.db.query(
      `SELECT 1 FROM audit_log WHERE table_name = 'organizations' AND record_id = $1 AND action = 'update'`,
      [org]);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('evidence record types', () => {
  const attach = (recordType: string, recordId: string) =>
    errorOf(
      `INSERT INTO evidence_attachments (organization_id, record_type, record_id, storage_path, file_name)
       VALUES ($1::uuid, $2::text, $3::uuid,
               $1::text || '/' || $2::text || '/' || $3::text || '/' || gen_random_uuid()::text || '-x.pdf',
               'x.pdf')`,
      [org, recordType, recordId]);

  it.each(['site', 'goal', 'project', 'business_metric_value', 'materiality_assessment'])(
    'accepts %s', async (recordType) => {
      expect(await attach(recordType, site)).toBeNull();
    });

  it('still refuses an unknown record type', async () => {
    expect(await attach('invoice', site)).toMatch(/record_type_allowed/);
  });
});
