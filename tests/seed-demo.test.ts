/**
 * The demo seed still loads, and still loads everything.
 *
 * `seed_demo.sql` carried a header saying "run after migrations 001-011" while
 * the schema had reached 035. Nobody knew whether it still ran, because running
 * it meant having a database — and the modules added in between (social and
 * governance metrics, business metrics, materiality, custom factors, the
 * equipment profile) had quietly fallen out of its coverage without anything
 * saying so. A demo that silently stops covering half the product is worse than
 * no demo: the screens it misses look finished and empty.
 *
 * This boots a real Postgres, applies every migration, runs the seed twice, and
 * checks both that it works and that a second run changes nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bootDatabase, type Harness } from './rls-harness';

let h: Harness;
let firstPass: Record<string, number>;
let secondPass: Record<string, number>;

/** Every module the seed is expected to populate, with a floor for each. */
const EXPECTED: [label: string, from: string, atLeast: number][] = [
  ['emission entries',   'emission_entries',                              60],
  ['water and waste',    "ehs_entries WHERE metric_type IN ('water','waste')", 40],
  ['safety metrics',     "ehs_entries WHERE metric_type = 'safety'",       60],
  ['workforce metrics',  "ehs_entries WHERE metric_type = 'workforce'",    40],
  ['training metrics',   "ehs_entries WHERE metric_type = 'training'",     20],
  ['governance metrics', "ehs_entries WHERE metric_type = 'governance'",    6],
  ['Scope 3 entries',    'scope3_entries',                                  5],
  ['goals',              'goals',                                           1],
  ['projects',           'projects',                                        2],
  ['suppliers',          'suppliers',                                       2],
  ['business metrics',   'business_metric_values',                          4],
  ['site equipment',     'site_equipment',                                  4],
  ['materiality',        'materiality_assessments',                         1],
  ['scored topics',      'topic_assessments',                              10],
  ['custom factors',     'custom_emission_factors',                         1],
];

async function snapshot(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [label, from] of EXPECTED) {
    const { rows } = await h.db.query<{ c: string }>(`SELECT count(*)::text c FROM ${from}`);
    out[label] = Number(rows[0].c);
  }
  return out;
}

beforeAll(async () => {
  h = await bootDatabase();

  // The seed attaches to whichever organization already exists, the way it does
  // against a real install after somebody has signed up.
  const org = (await h.db.query<{ id: string }>(
    `INSERT INTO organizations (name) VALUES ('Acme Steel') RETURNING id`)).rows[0].id;
  await h.db.query(
    `INSERT INTO users (organization_id, email, role) VALUES ($1, 'a@acme.test', 'admin')`,
    [org]);

  const sql = fs.readFileSync(
    path.resolve(__dirname, '..', 'supabase', 'seed_demo.sql'), 'utf8');

  await h.db.exec(sql);
  firstPass = await snapshot();

  await h.db.exec(sql);
  secondPass = await snapshot();
}, 300_000);

afterAll(async () => { await h?.db.close(); });

describe('seed_demo.sql', () => {
  it.each(EXPECTED)('populates %s', (label, _from, atLeast) => {
    expect(firstPass[label]).toBeGreaterThanOrEqual(atLeast);
  });

  it('re-runs without duplicating anything', () => {
    // The script promises idempotency in its header and clears its own [DEMO]
    // rows first. If a newly seeded table is missed from that clear block, the
    // second run doubles it — which shows up as inflated totals rather than an
    // error, so it has to be asserted rather than watched for.
    expect(secondPass).toEqual(firstPass);
  });

  it('files governance metrics at organization level, not against a site', () => {
    // Migration 023 made site_id nullable for exactly this. Board composition
    // is a property of the company; attaching it to a plant would double-count
    // it the moment a second site appeared.
    return h.db.query<{ c: string }>(
      `SELECT count(*)::text c FROM ehs_entries
        WHERE metric_type = 'governance' AND site_id IS NOT NULL`,
    ).then(({ rows }) => expect(Number(rows[0].c)).toBe(0));
  });

  it('stores each metric in its own canonical unit', async () => {
    // One family, more than one unit — the trap 023 is shaped around. Hours
    // worked and a count of injuries are both 'safety', and storing a count as
    // hours would make every derived rate wrong while looking fine.
    const { rows } = await h.db.query<{ source_type: string; unit: string }>(
      `SELECT DISTINCT e.source_type, e.unit
         FROM ehs_entries e
         JOIN sustainability_metrics m
           ON m.metric_type = e.metric_type AND m.source_type = e.source_type
        WHERE e.unit <> m.canonical_unit`,
    );
    expect(rows).toEqual([]);
  });

  it('seeds no emission factor that claims a source it does not have', async () => {
    // A fabricated citation is the one thing this platform must never carry.
    // Demo factors say so in factor_source rather than naming a document that
    // does not exist.
    const { rows } = await h.db.query<{ factor_source: string }>(
      `SELECT factor_source FROM custom_emission_factors WHERE notes = '[DEMO]'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.factor_source).toMatch(/DEMO/i);
  });
});
