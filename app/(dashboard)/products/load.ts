import 'server-only';
import type { createServerClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import type { ImportRow, DeclarationRow } from '@/lib/cbam-core';
// JSONB columns (geometry, criteria, upstream_references) come back typed as Json; their shape is enforced by
// CHECK constraints in migration 045 and by lib/eudr-core on write, so the casts below narrow to that shape.
import type { Assessment, Link, Org, Plot, Shipment } from './eudr/types';

/**
 * What Products and Parts and its regulation dashboards read. One place, so
 * the part panel and the dashboards always agree on the same records.
 */
type Supabase = Awaited<ReturnType<typeof createServerClient>>;

export interface EudrData { plots: Plot[]; assessments: Assessment[]; shipments: Shipment[]; links: Link[] }
export interface CbamData { imports: ImportRow[]; declarations: DeclarationRow[] }

export async function loadProfile(supabase: Supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('users').select('role, organization_id, active_organization_id').eq('id', user.id).single();
  return { role: profile?.role ?? 'viewer', orgId: profile?.active_organization_id ?? profile?.organization_id ?? null };
}

export async function loadOrg(supabase: Supabase, orgId: string | null): Promise<{ data: Org | null; error: string | null }> {
  if (!orgId) return { data: null, error: null };
  const { data, error } = await supabase.from('organizations').select('id, name, legal_address, eori_number').eq('id', orgId).single();
  return { data: data ?? null, error: error?.message ?? null };
}

export async function loadEudr(supabase: Supabase): Promise<{ data: EudrData; error: string | null }> {
  const [plots, assessments, shipments, links] = await Promise.all([
    fetchAll((from, to) => supabase
      .from('eudr_plots')
      .select('id, supplier_id, name, producer_name, country_code, commodity, geometry, area_ha, source, source_value_id, notes, is_active')
      .order('name').range(from, to)),
    supabase.from('eudr_risk_assessments')
      .select('id, supplier_id, country_code, commodity, country_risk, country_risk_basis, criteria, conclusion, mitigation, assessed_at, review_by, notes')
      .order('assessed_at', { ascending: false }),
    fetchAll((from, to) => supabase
      .from('eudr_shipments')
      .select('id, product_id, supplier_id, reference, activity, hs_code, description, net_mass_kg, supplementary_quantity, supplementary_unit, countries_of_production, production_from, production_to, upstream_references, risk_assessment_id, status, dds_reference, dds_verification_number, filed_at, notes, created_at')
      .order('created_at', { ascending: false }).range(from, to)),
    fetchAll((from, to) => supabase.from('eudr_shipment_plots').select('shipment_id, plot_id').order('shipment_id').range(from, to)),
  ]);
  return {
    data: {
      plots: (plots.data ?? []) as unknown as Plot[],
      assessments: (assessments.data ?? []) as unknown as Assessment[],
      shipments: (shipments.data ?? []) as unknown as Shipment[],
      links: links.data ?? [],
    },
    error: [plots, assessments, shipments, links].find((r) => r.error)?.error?.message ?? null,
  };
}

export async function loadCbam(supabase: Supabase): Promise<{ data: CbamData; error: string | null }> {
  const [imports, declarations] = await Promise.all([
    fetchAll((from, to) => supabase
      .from('cbam_imports')
      .select('id, product_id, supplier_id, import_date, customs_reference, cn_code, quantity, unit, country_of_origin, installation_name, installation_id, direct_emissions, indirect_emissions, emissions_basis, emissions_source, verification_report, carbon_price_paid_eur, carbon_price_evidence, notes')
      .order('import_date', { ascending: false }).range(from, to)),
    supabase.from('cbam_declarations')
      .select('id, year, authorised_declarant_number, carbon_price_deduction, carbon_price_deduction_source, free_allocation_adjustment, free_allocation_source, price_q1_eur, price_q2_eur, price_q3_eur, price_q4_eur, price_source, status, submitted_on, registry_reference, notes')
      .order('year', { ascending: false }),
  ]);
  return {
    // unit, emissions_basis and status are constrained by CHECKs in migration 046.
    data: {
      imports: (imports.data ?? []) as unknown as ImportRow[],
      declarations: (declarations.data ?? []) as unknown as DeclarationRow[],
    },
    error: [imports, declarations].find((r) => r.error)?.error?.message ?? null,
  };
}
