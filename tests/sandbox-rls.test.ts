/**
 * Practice mode writes must land in the sandbox.
 *
 * Migration 032 redefined auth_org_id() as
 * COALESCE(active_organization_id, organization_id), and every insert policy
 * checks `organization_id = auth_org_id()`. So any code path that writes
 * `users.organization_id` — the HOME org — is refused by RLS while the session
 * is in the sandbox.
 *
 * Nothing surfaced it, and the reason is worth recording because it is the
 * part that made a total failure look like an empty screen. Seeding uses the
 * same broken path, so every seeded entry was refused too; `seedSandbox()`
 * collects those failures into `SeedResult.problems`, the route returns them
 * with HTTP 200, and `SandboxEntryCard` checked only `res.ok`. A practice
 * workspace whose every entry had been rejected therefore reported success and
 * redirected to an empty dashboard.
 *
 * These tests assert the POLICY's view of the world: the id a writer must
 * supply. They are deliberately written against raw SQL rather than through
 * lib/entries.ts, because the thing under test is the database's decision, and
 * a test that mocked the Supabase client would assert nothing about it.
 *
 * Note the limit that follows from that: these pass whether or not
 * `resolveAuthContext()` resolves the active org. They pin the contract the
 * application must meet, not the application's compliance with it — see
 * lib/org-context-core.test.ts for that half.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootDatabase, isRlsRefusal, type Harness } from './rls-harness';

let h: Harness;
let homeOrg: string;
let sandboxOrg: string;
let userId: string;
let homeSite: string;
let sandboxSite: string;

/** The inserts lib/entries.ts performs, every NOT NULL column filled. */
function inserts(orgId: string, siteId: string, createdBy: string) {
  return {
    emission_entries: [
      `INSERT INTO emission_entries (organization_id, site_id, entry_date, scope, source_type,
         quantity, unit, quantity_normalized, unit_normalized, co2e_kg, emission_factor_used,
         emission_factor_source, created_by)
       VALUES ($1,$2,'2026-08-31','scope1','natural_gas',5200,'therms',5200,'therms',27612,5.311,'EPA 2025',$3)`,
      [orgId, siteId, createdBy],
    ],
    ehs_entries: [
      `INSERT INTO ehs_entries (organization_id, site_id, entry_date, metric_type, source_type,
         quantity, unit, quantity_normalized, unit_normalized, created_by)
       VALUES ($1,$2,'2026-08-31','water','municipal_consumption',420000,'gallons',1589873,'liters',$3)`,
      [orgId, siteId, createdBy],
    ],
    scope3_entries: [
      `INSERT INTO scope3_entries (organization_id, site_id, category_number, entry_date,
         calculation_method, activity_value, activity_unit, factor_value, factor_unit,
         factor_source, co2e_kg, created_by)
       VALUES ($1,$2,1,'2026-08-31','spend_based',100,'USD',0.42,'kgCO2e/USD','EEIO 2024',42,$3)`,
      [orgId, siteId, createdBy],
    ],
  } as const;
}

async function attempt(orgId: string, siteId: string, table: keyof ReturnType<typeof inserts>) {
  const [sql, params] = inserts(orgId, siteId, userId)[table];
  try {
    // Spread rather than cast: `inserts()` is `as const`, so `params` is a
    // readonly tuple and a cast to unknown[] does not typecheck under strict.
    await h.db.query(sql, [...params]);
    return 'accepted' as const;
  } catch (e) {
    if (isRlsRefusal(e)) return 'refused' as const;
    throw e; // a schema mistake in the test, not a policy decision
  }
}

const TABLES = ['emission_entries', 'ehs_entries', 'scope3_entries'] as const;

beforeAll(async () => {
  h = await bootDatabase();
  const q = async (sql: string, p: unknown[] = []) =>
    (await h.db.query<{ id: string }>(sql, p)).rows[0].id;

  homeOrg = await q(`INSERT INTO organizations (name) VALUES ('Acme Steel') RETURNING id`);
  userId = await q(
    `INSERT INTO users (organization_id, email, role) VALUES ($1,'editor@acme.test','editor') RETURNING id`,
    [homeOrg]);
  homeSite = await q(
    `INSERT INTO sites (organization_id, name) VALUES ($1,'Riverside Plant') RETURNING id`, [homeOrg]);

  await h.signIn(userId);
  sandboxOrg = (await h.db.query<{ id: string }>(`SELECT provision_sandbox() AS id`)).rows[0].id;
  await h.db.query(`SELECT set_active_organization($1)`, [sandboxOrg]);
  sandboxSite = await q(
    `INSERT INTO sites (organization_id, name) VALUES ($1,'Practice Plant') RETURNING id`, [sandboxOrg]);
  await h.db.query(`SELECT set_active_organization(null)`);
}, 120_000);

afterAll(async () => { await h?.db.close(); });

describe('auth_org_id() follows the active organization', () => {
  it('is the home org outside practice mode', async () => {
    await h.db.query(`SELECT set_active_organization(null)`);
    const { rows } = await h.db.query<{ id: string }>(`SELECT auth_org_id() AS id`);
    expect(rows[0].id).toBe(homeOrg);
  });

  it('is the sandbox inside practice mode', async () => {
    await h.db.query(`SELECT set_active_organization($1)`, [sandboxOrg]);
    const { rows } = await h.db.query<{ id: string }>(`SELECT auth_org_id() AS id`);
    expect(rows[0].id).toBe(sandboxOrg);
  });
});

describe('entry creation in practice mode', () => {
  beforeAll(async () => { await h.db.query(`SELECT set_active_organization($1)`, [sandboxOrg]); });

  // The regression itself. resolveAuthContext() must resolve the ACTIVE org,
  // so these inserts carry the sandbox id and the policy accepts them.
  it.each(TABLES)('accepts %s written with the active organization id', async (table) => {
    expect(await attempt(sandboxOrg, sandboxSite, table)).toBe('accepted');
  });

  // The other half, and the one that actually failed: supplying the home org
  // id from inside the sandbox must stay refused. If this ever starts passing,
  // practice data can leak into the live workspace.
  it.each(TABLES)('refuses %s written with the home organization id', async (table) => {
    expect(await attempt(homeOrg, sandboxSite, table)).toBe('refused');
  });
});

describe('entry creation in the live workspace', () => {
  beforeAll(async () => { await h.db.query(`SELECT set_active_organization(null)`); });

  it.each(TABLES)('still accepts %s written with the home organization id', async (table) => {
    expect(await attempt(homeOrg, homeSite, table)).toBe('accepted');
  });
});

describe('evidence uploads follow the same rule', () => {
  // buildStoragePath() puts the organization id first, and migration 019's
  // storage policies check that segment against auth_org_id(). The route at
  // app/api/evidence/route.ts re-checks the same segment, and now resolves it
  // through lib/org-context.ts — so the id it compares against is the active
  // one. Before that it used the home org, which is the same defect in a
  // second place.
  const upload = async (orgId: string) => {
    try {
      await h.db.query(
        `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('evidence', $1, $2)`,
        [`${orgId}/emission_entry/${crypto.randomUUID()}/invoice.pdf`, userId]);
      return 'accepted' as const;
    } catch (e) {
      if (isRlsRefusal(e)) return 'refused' as const;
      throw e;
    }
  };

  it('accepts a path scoped to the active organization', async () => {
    await h.db.query(`SELECT set_active_organization($1)`, [sandboxOrg]);
    expect(await upload(sandboxOrg)).toBe('accepted');
  });

  it('refuses a home-org path from inside practice mode', async () => {
    await h.db.query(`SELECT set_active_organization($1)`, [sandboxOrg]);
    expect(await upload(homeOrg)).toBe('refused');
  });
});
