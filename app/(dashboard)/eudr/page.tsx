import { createServerClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import { EudrClient } from './EudrClient';
// JSONB columns (geometry, criteria, upstream_references) come back typed as Json; their shape is enforced by
// CHECK constraints in migration 045 and by lib/eudr-core on write, so the casts below narrow to that shape.
import type { Assessment, Plot, Shipment } from './types';

/**
 * EUDR due diligence: shipments placed on the market or exported, the plots
 * they came from, the risk assessments they rely on, and the filing pack for
 * TRACES. Everything is RLS-scoped; readiness is worked out client-side from
 * these rows by lib/eudr-core.ts.
 */
export default async function EudrPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('role, organization_id, active_organization_id')
    .eq('id', user.id)
    .single();
  const orgId = profile?.active_organization_id ?? profile?.organization_id ?? null;

  const [org, products, rules, suppliers, plots, assessments, shipments, links, values] = await Promise.all([
    orgId
      ? supabase.from('organizations').select('id, name, legal_address, eori_number').eq('id', orgId).single()
      : Promise.resolve({ data: null, error: null }),
    fetchAll((from, to) => supabase
      .from('products')
      .select('id, part_number, description, hs_code, cn_code, hts_code, supplier_id, is_active')
      .order('part_number').range(from, to)),
    supabase.from('compliance_scope_rules').select('regulation, code_system, cn_prefix').eq('regulation', 'eudr'),
    supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
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
    fetchAll((from, to) => supabase
      .from('product_compliance_values')
      .select('id, product_id, field_key, value, recorded_at')
      .like('field_key', 'eudr.%')
      .order('id').range(from, to)),
  ]);

  const loadError = [products, rules, suppliers, plots, assessments, shipments, links, values].find((r) => r.error)?.error?.message ?? null;

  return (
    <EudrClient
      org={org.data ?? null}
      products={products.data ?? []}
      rules={rules.data ?? []}
      suppliers={suppliers.data ?? []}
      plots={(plots.data ?? []) as unknown as Plot[]}
      assessments={(assessments.data ?? []) as unknown as Assessment[]}
      shipments={(shipments.data ?? []) as unknown as Shipment[]}
      links={links.data ?? []}
      values={values.data ?? []}
      role={profile?.role ?? 'viewer'}
      loadError={loadError}
    />
  );
}
