/**
 * Migration 042 — evidence_checks is tenant-scoped and append-only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootDatabase, type Harness } from './rls-harness';

let h: Harness;
let orgA: string, orgB: string, editorA: string, viewerA: string, editorB: string;

async function id(sql: string, p: unknown[] = []): Promise<string> {
  return (await h.db.query<{ id: string }>(sql, p)).rows[0].id;
}
async function errorOf(sql: string, p: unknown[] = []): Promise<string | null> {
  try { await h.db.query(sql, p); return null; } catch (e) { return (e as Error).message; }
}
const INSERT = `INSERT INTO evidence_checks
  (record_type, record_id, file_name, outcome, summary, entry_snapshot, document_reading, comparison, provider, model, checked_by)
  VALUES ('emission_entry', gen_random_uuid(), 'bill.pdf', $1, 'S', '{}', '{}', '{}', 'anthropic', 'm', $2)`;

beforeAll(async () => {
  h = await bootDatabase();
  orgA = await id(`INSERT INTO organizations (name) VALUES ('A') RETURNING id`);
  orgB = await id(`INSERT INTO organizations (name) VALUES ('B') RETURNING id`);
  editorA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'e@a.test','editor') RETURNING id`, [orgA]);
  viewerA = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'v@a.test','viewer') RETURNING id`, [orgA]);
  editorB = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'e@b.test','editor') RETURNING id`, [orgB]);
});
afterAll(async () => { await h.db.close(); });

describe('evidence_checks', () => {
  it('lets an editor record a check, stamped with their organization', async () => {
    await h.signIn(editorA);
    expect(await errorOf(INSERT, ['match', editorA])).toBeNull();
    const r = await h.db.query<{ organization_id: string }>(`SELECT organization_id FROM evidence_checks`);
    expect(r.rows).toEqual([{ organization_id: orgA }]);
  });

  it('refuses a viewer, and a check recorded in someone else\'s name', async () => {
    await h.signIn(viewerA);
    expect(await errorOf(INSERT, ['match', viewerA])).not.toBeNull();
    await h.signIn(editorA);
    expect(await errorOf(INSERT, ['match', viewerA])).not.toBeNull();
  });

  it('refuses an outcome outside the vocabulary', async () => {
    await h.signIn(editorA);
    expect(await errorOf(INSERT, ['looks fine', editorA])).toMatch(/check/i);
  });

  it('keeps each organization\'s checks to itself', async () => {
    await h.signIn(editorB);
    expect((await h.db.query(`SELECT 1 FROM evidence_checks`)).rows).toHaveLength(0);
  });

  it('cannot be edited or deleted, even by its author', async () => {
    // Refused either by the missing grant or by the absent policy (0 rows);
    // what matters is that the row is untouched.
    await h.signIn(editorA);
    await errorOf(`UPDATE evidence_checks SET outcome = 'mismatch'`);
    await errorOf(`DELETE FROM evidence_checks`);
    await h.asServiceRole();
    const r = await h.db.query<{ outcome: string }>(`SELECT outcome FROM evidence_checks`);
    expect(r.rows).toEqual([{ outcome: 'match' }]);
  });
});
