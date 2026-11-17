/**
 * Migration 041 — the reminder schedule columns and the launch-date trigger,
 * against a real Postgres through the same harness as the other RLS tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bootDatabase, type Harness } from './rls-harness';

let h: Harness;
let org: string;
let editor: string;

async function id(sql: string, p: unknown[] = []): Promise<string> {
  return (await h.db.query<{ id: string }>(sql, p)).rows[0].id;
}
async function launched(surveyId: string): Promise<string | null> {
  const r = await h.db.query<{ launched_at: string | null }>(
    `SELECT launched_at::text FROM supplier_surveys WHERE id = $1`, [surveyId]);
  return r.rows[0].launched_at;
}
async function errorOf(sql: string, p: unknown[] = []): Promise<string | null> {
  try { await h.db.query(sql, p); return null; } catch (e) { return (e as Error).message; }
}

beforeAll(async () => {
  h = await bootDatabase();
  org = await id(`INSERT INTO organizations (name) VALUES ('Acme Steel') RETURNING id`);
  editor = await id(
    `INSERT INTO users (organization_id, email, role) VALUES ($1,'editor@acme.test','editor') RETURNING id`, [org]);
});

afterAll(async () => {
  await h.db.close();
});

describe('migration 041', () => {
  it('leaves automatic reminders off by default, capped at 3', async () => {
    await h.asServiceRole();
    const s = await id(
      `INSERT INTO supplier_surveys (organization_id, title, regulation_type) VALUES ($1,'Draft','cbam') RETURNING id`, [org]);
    const r = await h.db.query<{ reminder_interval_days: number | null; reminder_max: number }>(
      `SELECT reminder_interval_days, reminder_max FROM supplier_surveys WHERE id = $1`, [s]);
    expect(r.rows[0]).toEqual({ reminder_interval_days: null, reminder_max: 3 });
  });

  it('refuses intervals and caps outside the allowed range', async () => {
    await h.asServiceRole();
    const insert = (interval: number | null, max: number) => errorOf(
      `INSERT INTO supplier_surveys (organization_id, title, regulation_type, reminder_interval_days, reminder_max)
       VALUES ($1,'x','cbam',$2,$3)`, [org, interval, max]);
    expect(await insert(0, 3)).toMatch(/reminder_interval_check/);
    expect(await insert(91, 3)).toMatch(/reminder_interval_check/);
    expect(await insert(7, 0)).toMatch(/reminder_max_check/);
    expect(await insert(7, 21)).toMatch(/reminder_max_check/);
    expect(await insert(7, 5)).toBeNull();
  });

  it('stamps the launch date when a survey goes live, and never moves it', async () => {
    await h.asServiceRole();
    const s = await id(
      `INSERT INTO supplier_surveys (organization_id, title, regulation_type) VALUES ($1,'Launch','cbam') RETURNING id`, [org]);
    expect(await launched(s)).toBeNull();

    await h.signIn(editor);
    await h.db.query(`UPDATE supplier_surveys SET status = 'active' WHERE id = $1`, [s]);
    const first = await launched(s);
    expect(first).not.toBeNull();

    // A client cannot rewrite it, and closing or re-opening keeps it.
    await h.db.query(`UPDATE supplier_surveys SET launched_at = '2020-01-01' WHERE id = $1`, [s]);
    await h.db.query(`UPDATE supplier_surveys SET status = 'closed' WHERE id = $1`, [s]);
    await h.db.query(`UPDATE supplier_surveys SET status = 'active' WHERE id = $1`, [s]);
    expect(await launched(s)).toBe(first);
  });

  it('ignores a launch date supplied on insert', async () => {
    await h.asServiceRole();
    const draft = await id(
      `INSERT INTO supplier_surveys (organization_id, title, regulation_type, launched_at)
       VALUES ($1,'d','cbam','2020-01-01') RETURNING id`, [org]);
    expect(await launched(draft)).toBeNull();
    const live = await id(
      `INSERT INTO supplier_surveys (organization_id, title, regulation_type, status, launched_at)
       VALUES ($1,'l','cbam','active','2020-01-01') RETURNING id`, [org]);
    expect((await launched(live))?.startsWith('2020')).toBe(false);
  });

  it('can be applied twice without changing anything', async () => {
    await h.asServiceRole();
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'supabase', 'migrations', '041_survey_reminders_and_launch_date.sql'), 'utf8');
    const before = await h.db.query(`SELECT id, launched_at FROM supplier_surveys ORDER BY id`);
    await h.db.exec(sql);
    const after = await h.db.query(`SELECT id, launched_at FROM supplier_surveys ORDER BY id`);
    expect(after.rows).toEqual(before.rows);
  });
});
