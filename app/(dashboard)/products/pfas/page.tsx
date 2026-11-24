import { createServerClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import { loadPfas, loadProfile } from '../load';
import { PfasDashboard } from './PfasDashboard';

/**
 * PFAS dashboard: declarations across every part, the substances on record,
 * and which parts each PFAS regime touches. A part's declaration is recorded
 * in its PFAS tab on Products and Parts.
 */
export default async function PfasPage() {
  const supabase = await createServerClient();
  const profile = await loadProfile(supabase);
  if (!profile) return null;

  const [products, suppliers, pfas] = await Promise.all([
    fetchAll((from, to) => supabase
      .from('products').select('id, part_number, description, supplier_id, country_of_origin, is_active').order('part_number').range(from, to)),
    supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
    loadPfas(supabase),
  ]);
  const loadError = pfas.error ?? [products, suppliers].find((r) => r.error)?.error?.message ?? null;

  return (
    <PfasDashboard
      products={products.data ?? []}
      suppliers={suppliers.data ?? []}
      {...pfas.data}
      role={profile.role}
      loadError={loadError}
    />
  );
}
