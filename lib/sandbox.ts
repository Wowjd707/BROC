import 'server-only';
import { createServerClient } from '@/lib/supabase/server';
import { resolveOrgContext } from './org-context';
import { removeAllEvidenceFilesInActiveOrg } from './evidence';
import { createEmissionEntry, createEhsEntry } from '@/lib/entries';

/**
 * The practice workspace.
 *
 * A sandbox is a real organization flagged `sandbox_of`, and "practice mode" is
 * the session resolving to it (migration 032). That means isolation is the same
 * row-level security that separates organizations — there is no second mechanism to
 * get wrong, and no query anywhere needs to remember a filter.
 *
 * Seeding goes through createEmissionEntry and createEhsEntry rather than
 * inserting rows directly. Two reasons, and the second matters more:
 *
 *   1. Factors resolve server-side and lineage is recorded, so practice figures
 *      behave like real ones — clicking into a number shows a real provenance
 *      chain rather than a dead end.
 *   2. Hand-written INSERTs would produce data no real code path could have
 *      produced. Someone learning the system would be learning a fiction, and
 *      the sandbox would be useless as a rehearsal of the actual workflow.
 */

export interface SandboxStatus {
  /** The sandbox organization, once provisioned. */
  sandboxOrgId: string | null;
  /** True when this session currently resolves to the sandbox. */
  inSandbox: boolean;
  /** The user's real organization, whatever the session is pointed at. */
  homeOrgId: string | null;
  homeOrgName: string | null;
  seededAt: string | null;
}

export async function getSandboxStatus(): Promise<SandboxStatus> {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { sandboxOrgId: null, inSandbox: false, homeOrgId: null, homeOrgName: null, seededAt: null };
  }

  // Own row is always readable (migration 032 widened users_select_org_or_self),
  // which is what makes this work while the session points at the sandbox.
  const { data: profile } = await supabase
    .from('users')
    .select('organization_id, active_organization_id')
    .eq('id', user.id)
    .maybeSingle();

  const homeOrgId = (profile?.organization_id as string | undefined) ?? null;
  const activeId = (profile?.active_organization_id as string | undefined) ?? null;

  // The organizations policy exposes the home org and its sandbox, so one
  // query answers both "does a sandbox exist" and "what is home called".
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, sandbox_of, sandbox_seeded_at');

  const home = (orgs ?? []).find((o) => o.id === homeOrgId) ?? null;
  const sandbox = (orgs ?? []).find((o) => o.sandbox_of === homeOrgId) ?? null;

  return {
    sandboxOrgId: (sandbox?.id as string | undefined) ?? null,
    inSandbox: activeId !== null && activeId === sandbox?.id,
    homeOrgId,
    homeOrgName: (home?.name as string | undefined) ?? null,
    seededAt: (sandbox?.sandbox_seeded_at as string | undefined) ?? null,
  };
}

/** Create the sandbox if absent and point this session at it. */
export async function enterSandbox(): Promise<{ ok: true; orgId: string } | { ok: false; error: string }> {
  const supabase = await createServerClient();

  const { data: sandboxId, error: provisionError } = await supabase.rpc('provision_sandbox');
  if (provisionError || !sandboxId) {
    return { ok: false, error: provisionError?.message ?? 'Could not create the practice workspace.' };
  }

  const { error: switchError } = await supabase.rpc('set_active_organization', { target: sandboxId });
  if (switchError) return { ok: false, error: switchError.message };

  return { ok: true, orgId: sandboxId as string };
}

/** Return this session to the live workspace. */
export async function leaveSandbox(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  // NULL is the documented "return to the home org" argument (migration 032
  // branches on `target IS NULL`). `supabase gen types` emits every function
  // argument as non-nullable, so the cast is against a generated type that
  // cannot express a nullable parameter, not against the SQL contract.
  const { error } = await supabase.rpc(
    'set_active_organization',
    { target: null as unknown as string },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Throw the practice data away and start again. Admin only, enforced in the
 * database — a reset discards whatever a colleague was midway through.
 *
 * Leaves the caller in the live workspace: the delete cascades a null onto
 * everyone's active organization. Out of practice mode is the safe direction
 * to land.
 */
export async function resetSandbox(): Promise<{ ok: true; orgId: string } | { ok: false; error: string }> {
  const supabase = await createServerClient();

  // Deleting the sandbox organization cascades its attachment rows away — and
  // with them the only record of where its files are. So remove the files
  // first, while the rows still say where. Only from INSIDE the sandbox and
  // only as an admin: the removal targets the active organization, which
  // outside practice mode is the live one.
  const ctx = await resolveOrgContext(['admin']);
  if (!ctx.ok) return { ok: false, error: 'Only an administrator can reset the practice workspace.' };
  if (ctx.data.inPracticeMode) await removeAllEvidenceFilesInActiveOrg();

  const { data, error } = await supabase.rpc('reset_sandbox');
  if (error) return { ok: false, error: error.message };
  return { ok: true, orgId: data as string };
}

// ─── Seeding ─────────────────────────────────────────────────────────────────

export interface SeedResult {
  sites: number;
  emissionEntries: number;
  ehsEntries: number;
  /** Steps that failed, so a partial seed is visible rather than silent. */
  problems: string[];
}

// Invented places. City and state are labels only: electricity factors resolve
// by zip code or eGRID subregion (003), neither of which these rows carry, so
// changing a city changes nothing but the text on screen.
const SEED_SITES = [
  { name: 'Riverside Plant',    site_type: 'manufacturing', city: 'Greenville', state: 'SC', floor_area_sqft: 220_000 },
  { name: 'Northgate Assembly', site_type: 'manufacturing', city: 'Toledo',     state: 'OH', floor_area_sqft: 140_000 },
  { name: 'Corporate Office',   site_type: 'office',        city: 'Naperville', state: 'IL', floor_area_sqft: 32_000 },
];

/** Month ends for the last `count` complete months, oldest first. */
function recentMonthEnds(count: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = count; i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Fill the sandbox with enough to practise on: three sites and eighteen months
 * of gas, electricity, water and waste.
 *
 * The caller must already be inside the sandbox — every write below goes
 * wherever auth_org_id() currently points, which is the entire safety model.
 * Call enterSandbox() first.
 *
 * Eighteen months rather than twelve so year-on-year comparisons, goal
 * progress and the data-review anomaly checks all have something to say. A
 * sandbox where every chart is empty teaches nothing.
 */
export async function seedSandbox(): Promise<SeedResult> {
  const supabase = await createServerClient();
  const result: SeedResult = { sites: 0, emissionEntries: 0, ehsEntries: 0, problems: [] };

  const status = await getSandboxStatus();
  if (!status.inSandbox || !status.sandboxOrgId) {
    result.problems.push('Refusing to seed: this session is not in the practice workspace.');
    return result;
  }
  const sandboxOrgId = status.sandboxOrgId;

  // organization_id is filled by the RLS insert policy's own check against
  // auth_org_id(), but it is set explicitly so the intent is readable.
  const { data: inserted, error: siteError } = await supabase
    .from('sites')
    .insert(SEED_SITES.map((s) => ({ ...s, organization_id: sandboxOrgId })))
    .select('id, name');

  if (siteError || !inserted?.length) {
    result.problems.push(`Could not create practice sites: ${siteError?.message ?? 'no rows returned'}`);
    return result;
  }
  result.sites = inserted.length;

  const months = recentMonthEnds(18);

  // Deterministic rather than random. A sandbox that looks different every time
  // it is reset makes "did my change do that?" unanswerable, which is the one
  // question a practice environment exists to answer.
  const wave = (i: number, base: number, swing: number) =>
    Math.round(base + swing * Math.sin((i / 12) * 2 * Math.PI));

  for (const site of inserted) {
    const plant = site.name !== 'Corporate Office';

    for (let i = 0; i < months.length; i++) {
      const entryDate = months[i];

      // Scope 1 — natural gas. Winter-heavy, so the seasonal shape is visible.
      const gas = plant ? wave(i + 6, 5200, 2600) : wave(i + 6, 900, 500);
      const gasResult = await createEmissionEntry({
        siteId: site.id,
        scope: 'scope1',
        sourceType: 'natural_gas',
        scope1Category: 'stationary_combustion',
        quantity: gas,
        unit: 'therms',
        entryDate,
        dataQuality: 'measured',
        notes: 'Practice data',
      });
      if (gasResult.ok) result.emissionEntries++;
      else if (result.problems.length < 5) result.problems.push(`Gas ${site.name} ${entryDate}: ${gasResult.error}`);

      // Scope 2 — electricity, location-based.
      const kwh = plant ? wave(i, 310_000, 45_000) : wave(i, 58_000, 9_000);
      const elecResult = await createEmissionEntry({
        siteId: site.id,
        scope: 'scope2',
        sourceType: 'electricity',
        quantity: kwh,
        unit: 'kWh',
        entryDate,
        accountingMethod: 'location_based',
        dataQuality: 'measured',
        notes: 'Practice data',
      });
      if (elecResult.ok) result.emissionEntries++;
      else if (result.problems.length < 5) result.problems.push(`Electricity ${site.name} ${entryDate}: ${elecResult.error}`);

      // Water and waste, quarterly — enough for the KPI tiles and the
      // diversion rate to be non-zero without burying the entry list.
      if (i % 3 === 0) {
        const water = await createEhsEntry({
          siteId: site.id,
          metricType: 'water',
          sourceType: 'municipal_consumption',
          quantity: plant ? wave(i, 420_000, 60_000) : wave(i, 31_000, 4_000),
          unit: 'gallons',
          entryDate,
          dataQuality: 'measured',
          notes: 'Practice data',
        });
        if (water.ok) result.ehsEntries++;

        for (const [sourceType, qty] of [
          ['non_hazardous_landfill', plant ? 18_000 : 2_400],
          ['non_hazardous_recycled', plant ? 26_000 : 3_900],
        ] as const) {
          const waste = await createEhsEntry({
            siteId: site.id,
            metricType: 'waste',
            sourceType,
            quantity: qty,
            unit: 'kg',
            entryDate,
            dataQuality: 'measured',
            notes: 'Practice data',
          });
          if (waste.ok) result.ehsEntries++;
        }
      }
    }
  }

  await supabase
    .from('organizations')
    .update({ sandbox_seeded_at: new Date().toISOString() })
    .eq('id', sandboxOrgId);

  return result;
}
