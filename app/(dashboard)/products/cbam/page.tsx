import { createServerClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import { loadCbam, loadOrg, loadProfile } from '../load';
import { CbamDashboard } from './CbamDashboard';

/**
 * CBAM dashboard: the year's imports across every part, the 50-tonne
 * threshold, and the annual declaration pack. Per-part work happens in the
 * part's CBAM tab on Products and Parts.
 */
export default async function CbamPage() {
  const supabase = await createServerClient();
  const profile = await loadProfile(supabase);
  if (!profile) return null;

  const [org, products, rules, suppliers, values, cbam] = await Promise.all([
    loadOrg(supabase, profile.orgId),
    fetchAll((from, to) => supabase
      .from('products')
      .select('id, part_number, description, hs_code, cn_code, hts_code, supplier_id, country_of_origin, is_active')
      .order('part_number').range(from, to)),
    supabase.from('compliance_scope_rules').select('regulation, code_system, cn_prefix').eq('regulation', 'cbam'),
    supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
    fetchAll((from, to) => supabase
      .from('product_compliance_values')
      .select('id, product_id, field_key, value, recorded_at')
      .like('field_key', 'cbam.%')
      .order('id').range(from, to)),
    loadCbam(supabase),
  ]);

  const loadError = org.error ?? cbam.error ?? [products, rules, suppliers, values].find((r) => r.error)?.error?.message ?? null;

  return (
    <CbamDashboard
      org={org.data}
      products={products.data ?? []}
      rules={rules.data ?? []}
      suppliers={suppliers.data ?? []}
      values={values.data ?? []}
      imports={cbam.data.imports}
      declarations={cbam.data.declarations}
      role={profile.role}
      loadError={loadError}
    />
  );
}
