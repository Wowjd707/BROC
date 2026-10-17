import 'server-only';
import { createServerClient } from './supabase/server';
import { resolveOrgContext } from './org-context';
import {
  getScope1Factor,
  getScope2LocationFactor,
  getResidualMixFactor,
  getRefrigerantGwp,
} from './emission-factors';
import { calculateEmissionCO2e } from './calculations';
import { normalizeEhsInput } from './conversions';
import {
  METRIC_FAMILIES,
  isSocialGovernanceFamily,
  getMetricDefinition,
  type MetricFamily,
} from './social-metrics-core';
import { getCustomFactor } from './custom-factors';
import { calculateScope3, type Scope3Method, type DataQuality as Scope3DataQuality } from './scope3';
import { isEntryDataQuality, type EntryDataQuality } from './entry-data-quality';

/**
 * Server-side creation of emission and EHS entries.
 *
 * This is the single authoritative path for turning raw activity data into a
 * stored, fully-attributed CO₂e entry. All emission-factor lookups and the
 * CO₂e calculation happen here on the server, so a browser can never submit an
 * arbitrary factor or CO₂e figure — it sends only the raw activity data. The
 * insert runs under the caller's RLS session (organization scoping enforced by
 * the database).
 */

export interface EmissionEntryInput {
  siteId: string;
  scope: 'scope1' | 'scope2';
  sourceType: string;
  /** GHG Protocol Scope 1 source category. Ignored for Scope 2. */
  scope1Category?: string;
  refrigerantCode?: string;
  quantity: number;
  unit: string;
  entryDate: string;
  accountingMethod?: 'location_based' | 'market_based';
  instrumentType?: string;
  supplierFactor?: number; // market-based contractual factor, kg CO₂e/kWh
  /** measured | calculated | estimated. Defaults to calculated, as the column does. */
  dataQuality?: EntryDataQuality;
  /** Required when dataQuality is 'estimated' — enforced by CHECK in migration 029. */
  estimationMethod?: string;
  notes?: string;
}

export interface EhsEntryInput {
  /** Required for site-level metrics; omitted for entity-level governance metrics. */
  siteId?: string;
  metricType: MetricFamily;
  sourceType: string;
  quantity: number;
  unit: string;
  entryDate: string;
  notes?: string;
  /**
   * Defaults to 'measured' rather than 'calculated' as emissions do: water and
   * waste figures normally come off a meter or a weighbridge ticket, so the
   * honest default differs by metric family.
   */
  dataQuality?: EntryDataQuality;
  /** Required when dataQuality is 'estimated' — enforced by CHECK in migration 029. */
  estimationMethod?: string;
}

export interface Scope3EntryInput {
  categoryNumber: number;
  method: Scope3Method;
  activityValue: number;
  activityUnit: string;
  entryDate: string;
  /** Preferred: reference a factor from the org's library. */
  factorId?: string;
  /** Fallback for supplier-specific data not in the library — requires a cited source. */
  factorValue?: number;
  factorUnit?: string;
  factorSource?: string;
  factorDataYear?: number;
  siteId?: string;
  supplierId?: string;
  description?: string;
  dataQuality?: Scope3DataQuality;
  notes?: string;
}

const VALID_SCOPE1_CATEGORIES = [
  'stationary_combustion', 'mobile_combustion', 'process_emissions', 'fugitive_emissions',
];

export type EntryResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

interface AuthContext {
  userId: string;
  /**
   * The organization these entries belong to — the ACTIVE one, so a session in
   * practice mode writes into its sandbox. This used to be the home
   * organization, which meant no entry could be created in practice mode at
   * all: every insert policy checks `organization_id = auth_org_id()`, and
   * auth_org_id() is COALESCE(active_organization_id, organization_id). See
   * lib/org-context.ts for the distinction and which to use where.
   */
  organizationId: string;
  role: string;
}

async function resolveAuthContext(): Promise<EntryResult<AuthContext>> {
  const ctx = await resolveOrgContext(['admin', 'editor']);
  if (!ctx.ok) {
    return {
      ok: false,
      status: ctx.status,
      // Keep the entry-specific wording; the shared helper cannot know what the
      // caller was trying to do.
      error: ctx.status === 403 && ctx.error.startsWith('Insufficient')
        ? 'Insufficient role to create entries.'
        : ctx.error,
    };
  }
  return {
    ok: true,
    data: {
      userId: ctx.data.userId,
      organizationId: ctx.data.activeOrganizationId,
      role: ctx.data.role,
    },
  };
}

function validateCommon(input: { siteId?: string; quantity?: number; unit?: string; entryDate?: string }): string | null {
  if (!input.siteId) return 'A site is required.';
  if (input.quantity == null || !Number.isFinite(input.quantity) || input.quantity <= 0) {
    return 'Quantity must be a positive number.';
  }
  if (!input.unit) return 'A unit is required.';
  if (!input.entryDate) return 'An entry date is required.';
  return null;
}

export async function createEmissionEntry(
  input: EmissionEntryInput,
): Promise<EntryResult<unknown>> {
  const auth = await resolveAuthContext();
  if (!auth.ok) return auth;

  const invalid = validateCommon(input);
  if (invalid) return { ok: false, status: 400, error: invalid };
  if (input.dataQuality && !isEntryDataQuality(input.dataQuality)) {
    return { ok: false, status: 400, error: 'dataQuality must be measured, calculated or estimated.' };
  }
  if (input.dataQuality === 'estimated' && !input.estimationMethod?.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'An estimate must say how it was arrived at. Describe the basis — an estimate without one cannot be assured.',
    };
  }
  if (input.scope !== 'scope1' && input.scope !== 'scope2') {
    return { ok: false, status: 400, error: 'scope must be scope1 or scope2.' };
  }
  if (input.scope1Category && !VALID_SCOPE1_CATEGORIES.includes(input.scope1Category)) {
    return {
      ok: false,
      status: 400,
      error: `Unknown Scope 1 category "${input.scope1Category}". Expected one of: ${VALID_SCOPE1_CATEGORIES.join(', ')}.`,
    };
  }

  const supabase = await createServerClient();

  // The site drives the Scope 2 location factor; also confirms the site is in
  // the caller's org (RLS on the select).
  const { data: site } = await supabase
    .from('sites')
    .select('id, zip_code')
    .eq('id', input.siteId)
    .maybeSingle();
  if (!site) return { ok: false, status: 400, error: 'Unknown site.' };

  let scope1Factor: number | undefined;
  let refrigerantGwp: number | undefined;
  let locationBasedFactor: number | undefined;
  let marketBasedFactor: number | undefined;
  let emissionFactorSource: string | undefined;

  try {
    if (input.scope === 'scope2') {
      // Org custom grid factor for this site overrides the global location factor.
      const customLoc = await getCustomFactor('scope2_location', input.siteId, input.entryDate);
      if (customLoc) {
        locationBasedFactor = customLoc.factor;
        emissionFactorSource = customLoc.source;
      } else {
        const loc = await getScope2LocationFactor(site.zip_code ?? undefined);
        locationBasedFactor = loc.factor;
        // The basis travels with the source. A site whose ZIP is not in the
        // seeded set silently falls back to the US national average, which can
        // be off by 80% or more against a real subregion — and recording it as
        // plain "eGRID2023" made that indistinguishable from a genuine match.
        // An assurance provider must be able to see which entries were
        // estimated; that is the whole lineage claim.
        emissionFactorSource = loc.basis ? `${loc.source} (${loc.basis})` : loc.source;
      }
      if (input.accountingMethod === 'market_based') {
        if (input.supplierFactor != null && Number.isFinite(input.supplierFactor)) {
          marketBasedFactor = input.supplierFactor;
          emissionFactorSource = 'supplier_specific';
        } else {
          const residual = await getResidualMixFactor();
          marketBasedFactor = residual.factor;
          emissionFactorSource = residual.source;
        }
      }
    } else if (input.sourceType === 'refrigerants') {
      if (!input.refrigerantCode) {
        return { ok: false, status: 400, error: 'A refrigerant type is required.' };
      }
      const custom = await getCustomFactor('refrigerant', input.refrigerantCode, input.entryDate);
      if (custom) {
        refrigerantGwp = custom.factor;
        emissionFactorSource = custom.source;
      } else {
        const rf = await getRefrigerantGwp(input.refrigerantCode);
        if (!rf) return { ok: false, status: 400, error: 'Unknown refrigerant.' };
        refrigerantGwp = rf.gwp;
        emissionFactorSource = rf.source;
      }
    } else {
      const custom = await getCustomFactor('scope1', input.sourceType, input.entryDate);
      if (custom) {
        scope1Factor = custom.factor;
        emissionFactorSource = custom.source;
      } else {
        const f = await getScope1Factor(input.sourceType);
        if (!f) return { ok: false, status: 400, error: `No emission factor for fuel: ${input.sourceType}` };
        scope1Factor = f.factor;
        emissionFactorSource = f.source;
      }
    }

    const result = calculateEmissionCO2e({
      scope: input.scope,
      sourceType: input.sourceType,
      quantity: input.quantity,
      unit: input.unit,
      accountingMethod: input.accountingMethod,
      locationBasedFactor,
      marketBasedFactor,
      instrumentType: input.instrumentType,
      scope1Factor,
      refrigerantGwp,
      emissionFactorSource,
    });

    const { data, error } = await supabase
      .from('emission_entries')
      .insert({
        organization_id: auth.data.organizationId,
        site_id: input.siteId,
        entry_date: input.entryDate,
        scope: input.scope,
        source_type: input.sourceType,
        scope1_category: input.scope === 'scope1' ? (input.scope1Category || null) : null,
        source_detail: input.sourceType === 'refrigerants' ? input.refrigerantCode : null,
        quantity: input.quantity,
        unit: input.unit,
        quantity_normalized: result.quantityNormalized,
        unit_normalized: result.unitNormalized,
        co2e_kg: result.co2eKg,
        co2e_kg_location_based: result.co2eKgLocationBased,
        accounting_method: result.accountingMethod,
        instrument_type: result.instrumentType ?? null,
        supplier_emission_factor: result.supplierEmissionFactor ?? null,
        emission_factor_used: result.emissionFactorUsed,
        emission_factor_source: result.emissionFactorSource,
        // An estimate must carry its basis. Rejected here with a readable
        // message rather than surfacing the raw CHECK violation from Postgres.
        data_quality: input.dataQuality ?? 'calculated',
        estimation_method: input.estimationMethod?.trim() || null,
        notes: input.notes || null,
        created_by: auth.data.userId,
      })
      .select('*, sites(name)')
      .single();

    if (error) return { ok: false, status: 500, error: error.message };
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Calculation failed.';
    return { ok: false, status: 400, error: message };
  }
}

/**
 * Create a Scope 3 entry. The factor is resolved server-side — either from the
 * org's factor library (preferred, by factorId) or supplied explicitly for
 * supplier-specific data, in which case a cited source is mandatory. The
 * resolved factor is denormalized onto the entry so the reported number stays
 * reproducible even if the library row is later superseded.
 */
export async function createScope3Entry(
  input: Scope3EntryInput,
): Promise<EntryResult<unknown>> {
  const auth = await resolveAuthContext();
  if (!auth.ok) return auth;

  if (!input.entryDate) return { ok: false, status: 400, error: 'An entry date is required.' };
  if (input.activityValue == null || !Number.isFinite(input.activityValue) || input.activityValue < 0) {
    return { ok: false, status: 400, error: 'Activity value must be a non-negative number.' };
  }
  if (!input.activityUnit) return { ok: false, status: 400, error: 'An activity unit is required.' };

  const supabase = await createServerClient();

  let factorValue = input.factorValue;
  let factorUnit = input.factorUnit;
  let factorSource = input.factorSource;
  let factorDataYear = input.factorDataYear;
  let factorId: string | null = null;

  if (input.factorId) {
    const { data: factor } = await supabase
      .from('scope3_factors')
      .select('id, factor_value, activity_unit, factor_source, data_year, category_number, is_active')
      .eq('id', input.factorId)
      .maybeSingle();
    if (!factor) return { ok: false, status: 400, error: 'Unknown emission factor.' };
    if (!factor.is_active) return { ok: false, status: 400, error: 'That emission factor is no longer active.' };
    if (factor.category_number !== input.categoryNumber) {
      return {
        ok: false,
        status: 400,
        error: `That factor belongs to category ${factor.category_number}, not ${input.categoryNumber}.`,
      };
    }
    factorId = factor.id;
    factorValue = Number(factor.factor_value);
    factorUnit = factor.activity_unit;
    factorSource = factor.factor_source;
    factorDataYear = factor.data_year;
  }

  if (factorValue == null || !factorUnit || !factorSource) {
    return {
      ok: false,
      status: 400,
      error: 'Select a factor from your library, or supply a factor value, unit, and cited source.',
    };
  }

  try {
    const result = calculateScope3({
      categoryNumber: input.categoryNumber,
      method: input.method,
      activityValue: input.activityValue,
      activityUnit: input.activityUnit,
      factorValue,
      factorUnit,
      factorSource,
      factorDataYear,
      dataQuality: input.dataQuality,
    });

    const { data, error } = await supabase
      .from('scope3_entries')
      .insert({
        organization_id: auth.data.organizationId,
        site_id: input.siteId || null,
        supplier_id: input.supplierId || null,
        category_number: result.categoryNumber,
        entry_date: input.entryDate,
        description: input.description || null,
        calculation_method: result.method,
        activity_value: result.activityValue,
        activity_unit: result.activityUnit,
        factor_id: factorId,
        factor_value: result.factorValue,
        factor_unit: result.factorUnit,
        factor_source: result.factorSource,
        factor_data_year: result.factorDataYear ?? null,
        co2e_kg: result.co2eKg,
        data_quality: result.dataQuality,
        notes: input.notes || null,
        created_by: auth.data.userId,
      })
      .select('*, suppliers(name), sites(name)')
      .single();

    if (error) return { ok: false, status: 500, error: error.message };
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Calculation failed.';
    return { ok: false, status: 400, error: message };
  }
}

export async function createEhsEntry(input: EhsEntryInput): Promise<EntryResult<unknown>> {
  const auth = await resolveAuthContext();
  if (!auth.ok) return auth;

  if (!(METRIC_FAMILIES as readonly string[]).includes(input.metricType)) {
    return {
      ok: false,
      status: 400,
      error: `Unknown metric type "${input.metricType}". Expected one of: ${METRIC_FAMILIES.join(', ')}.`,
    };
  }

  // Social and governance metrics are defined in the catalog, so the pair must
  // resolve before anything else is checked — the definition is what says
  // whether a site is required and which unit is acceptable.
  const definition = isSocialGovernanceFamily(input.metricType)
    ? getMetricDefinition(input.metricType, input.sourceType)
    : null;

  if (isSocialGovernanceFamily(input.metricType) && !definition) {
    return {
      ok: false,
      status: 400,
      error: `Unknown ${input.metricType} metric "${input.sourceType}".`,
    };
  }

  // Entity-level metrics (board composition, confirmed corruption cases) are
  // properties of the organization, not of a plant, and are stored with a null
  // site. Everything else still requires one.
  const isOrgLevel = definition?.orgLevel === true;

  const invalid = validateCommon({
    siteId: isOrgLevel ? 'org-level' : input.siteId,
    quantity: input.quantity,
    unit: input.unit,
    entryDate: input.entryDate,
  });
  if (invalid) return { ok: false, status: 400, error: invalid };

  // Checked here rather than left to the CHECK constraint: the raw violation
  // message is unreadable, and this is a field an auditor samples.
  if (input.dataQuality && !isEntryDataQuality(input.dataQuality)) {
    return { ok: false, status: 400, error: 'dataQuality must be measured, calculated or estimated.' };
  }
  if (input.dataQuality === 'estimated' && !input.estimationMethod?.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'An estimated figure needs its basis recorded. Say how it was estimated.',
    };
  }

  const supabase = await createServerClient();

  let siteId: string | null = null;
  if (!isOrgLevel) {
    const { data: site } = await supabase
      .from('sites')
      .select('id')
      .eq('id', input.siteId!)
      .maybeSingle();
    if (!site) return { ok: false, status: 400, error: 'Unknown site.' };
    siteId = site.id;
  }

  try {
    const { quantityNormalized, unitNormalized } = normalizeEhsInput(
      input.quantity,
      input.unit,
      input.metricType,
      input.sourceType,
    );

    const { data, error } = await supabase
      .from('ehs_entries')
      .insert({
        organization_id: auth.data.organizationId,
        site_id: siteId,
        entry_date: input.entryDate,
        metric_type: input.metricType,
        source_type: input.sourceType,
        quantity: input.quantity,
        unit: input.unit,
        quantity_normalized: quantityNormalized,
        unit_normalized: unitNormalized,
        data_quality: input.dataQuality ?? 'measured',
        estimation_method: input.estimationMethod?.trim() || null,
        notes: input.notes || null,
        created_by: auth.data.userId,
      })
      .select('*, sites(name)')
      .single();

    if (error) return { ok: false, status: 500, error: error.message };
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Calculation failed.';
    return { ok: false, status: 400, error: message };
  }
}
