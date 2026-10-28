/**
 * Editing your own display name (Edit profile in the sidebar). The dialog
 * writes first_name / last_name on the caller's own row; RLS and the guard
 * trigger (032, 037) must allow exactly that and refuse it on anyone else's.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootDatabase, type Harness } from './rls-harness';

let h: Harness;
let editor: string;
let colleague: string;

async function id(sql: string, p: unknown[] = []): Promise<string> {
  return (await h.db.query<{ id: string }>(sql, p)).rows[0].id;
}

beforeAll(async () => {
  h = await bootDatabase();
  const org = await id(`INSERT INTO organizations (name) VALUES ('Name Co') RETURNING id`);
  editor = await id(`INSERT INTO users (organization_id, email, role) VALUES ($1,'ed@name.test','editor') RETURNING id`, [org]);
  colleague = await id(`INSERT INTO users (organization_id, email, role, first_name) VALUES ($1,'col@name.test','viewer','Pat') RETURNING id`, [org]);
}, 120_000);

afterAll(async () => { await h?.db.close(); });

describe('editing your own name', () => {
  it('saves on your own row', async () => {
    await h.signIn(editor);
    const { rows } = await h.db.query(
      `UPDATE users SET first_name = 'Sustainability', last_name = 'Lead' WHERE id = $1 RETURNING id`, [editor]);
    await h.asServiceRole();
    expect(rows).toHaveLength(1);
    const r = (await h.db.query<{ first_name: string; last_name: string }>(
      `SELECT first_name, last_name FROM users WHERE id = $1`, [editor])).rows[0];
    expect(r).toEqual({ first_name: 'Sustainability', last_name: 'Lead' });
  });

  it("does nothing to a colleague's row", async () => {
    await h.signIn(editor);
    const { rows } = await h.db.query(
      `UPDATE users SET first_name = 'Hacked' WHERE id = $1 RETURNING id`, [colleague]);
    await h.asServiceRole();
    expect(rows).toHaveLength(0);
    const r = (await h.db.query<{ first_name: string }>(`SELECT first_name FROM users WHERE id = $1`, [colleague])).rows[0];
    expect(r.first_name).toBe('Pat');
  });
});
