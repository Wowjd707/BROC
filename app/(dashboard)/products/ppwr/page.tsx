import { createServerClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import { loadOrg, loadPpwr, loadProfile } from '../load';
import { PpwrDashboard } from './PpwrDashboard';

/**
 * PPWR and packaging EPR dashboard: tonnes by country and year, registrations,
 * the report pack per country, and every packaging piece still missing
 * evidence. Per-part packaging is recorded in the part's PPWR tab.
 */
export default async function PpwrPage() {
  const supabase = await createServerClient();
  const profile = await loadProfile(supabase);
  if (!profile) return null;

  const [org, products, suppliers, values, ppwr] = await Promise.all([
    loadOrg(supabase, profile.orgId),
    fetchAll((from, to) => supabase
      .from('products').select('id, part_number, description, supplier_id, is_active').order('part_number').range(from, to)),
    supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
    fetchAll((from, to) => supabase
      .from('product_compliance_values').select('id, product_id, field_key, value, recorded_at')
      .like('field_key', 'ppwr.%').order('id').range(from, to)),
    loadPpwr(supabase),
  ]);

  const loadError = org.error ?? ppwr.error ?? [products, suppliers, values].find((r) => r.error)?.error?.message ?? null;

  return (
    <PpwrDashboard
      org={org.data}
      products={products.data ?? []}
      suppliers={suppliers.data ?? []}
      values={values.data ?? []}
      {...ppwr.data}
      role={profile.role}
      loadError={loadError}
    />
  );
}
