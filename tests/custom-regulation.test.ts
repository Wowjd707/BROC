/**
 * Migration 036's constraint, both ways round.
 *
 * The point of the migration is not the column — it is the rule that a custom
 * survey must be named and a named regime must not be. A CHECK that silently
 * does not fire looks exactly like one that works, so it is asserted here
 * rather than assumed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootDatabase, type Harness } from './rls-harness';

let h: Harness;
let org: string;

/** Insert a survey as the database owner; RLS is not what is under test here. */
async function create(regulationType: string, customName: string | null) {
  try {
    await h.db.query(
      `INSERT INTO supplier_surveys (organization_id, title, regulation_type, custom_regulation_name)
       VALUES ($1, $2, $3, $4)`,
      [org, `Survey ${Math.random()}`, regulationType, customName]);
    return 'accepted' as const;
  } catch (e) {
    if (/supplier_surveys_custom_name/.test((e as Error).message)) return 'refused' as const;
    throw e;
  }
}

beforeAll(async () => {
  h = await bootDatabase();
  org = (await h.db.query<{ id: string }>(
    `INSERT INTO organizations (name) VALUES ('Acme Steel') RETURNING id`)).rows[0].id;
}, 180_000);

afterAll(async () => { await h?.db.close(); });

describe('custom_regulation_name', () => {
  it('accepts a named custom survey', async () => {
    expect(await create('custom', 'California SB 253')).toBe('accepted');
  });

  it('refuses a custom survey with no name', async () => {
    // Renders as "Custom", which tells a supplier nothing about what they are
    // being asked to disclose.
    expect(await create('custom', null)).toBe('refused');
  });

  it('refuses a custom survey named only with whitespace', async () => {
    expect(await create('custom', '   ')).toBe('refused');
  });

  it('accepts a named regime with no custom name', async () => {
    expect(await create('cbam', null)).toBe('accepted');
  });

  it('refuses a named regime carrying a custom name', async () => {
    // This is the worse direction: the badge would show one regulation while
    // the question set came from another.
    expect(await create('cbam', 'Something else')).toBe('refused');
  });

  it('still refuses a regulation type outside the vocabulary', async () => {
    // The type stays closed on purpose — the application branches on it, so an
    // unknown value would silently match no question set.
    await expect(create('battery_regulation', null)).rejects.toThrow();
  });
});
