import { createServerClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import { loadEudr, loadOrg, loadProfile } from '../load';
import { EudrClient } from './EudrClient';

/**
 * EUDR dashboard: the statements waiting to be filed across every part, all
 * plots and risk assessments. Per-part work happens in the part's EUDR tab on
 * Products and Parts. Readiness is worked out client-side by lib/eudr-core.ts.
 */
export default async function EudrPage() {
  const supabase = await createServerClient();
  const profile = await loadProfile(supabase);
  if (!profile) return null;

  const [org, products, rules, suppliers, values, eudr] = await Promise.all([
    loadOrg(supabase, profile.orgId),
    fetchAll((from, to) => supabase
      .from('products')
      .select('id, part_number, description, hs_code, cn_code, hts_code, supplier_id, is_active')
      .order('part_number').range(from, to)),
    supabase.from('compliance_scope_rules').select('regulation, code_system, cn_prefix').eq('regulation', 'eudr'),
    supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
    fetchAll((from, to) => supabase
      .from('product_compliance_values')
      .select('id, product_id, field_key, value, recorded_at')
      .like('field_key', 'eudr.%')
      .order('id').range(from, to)),
    loadEudr(supabase),
  ]);

  const loadError = org.error ?? eudr.error ?? [products, rules, suppliers, values].find((r) => r.error)?.error?.message ?? null;

  return (
    <EudrClient
      org={org.data}
      products={products.data ?? []}
      rules={rules.data ?? []}
      suppliers={suppliers.data ?? []}
      {...eudr.data}
      values={values.data ?? []}
      role={profile.role}
      loadError={loadError}
    />
  );
}
