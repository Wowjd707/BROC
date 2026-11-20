import { createServerClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import { ProductsClient } from './ProductsClient';
import { surveyFieldKeys } from '@/lib/compliance-core';

/**
 * Products and Parts: the list every product regulation hangs off (CBAM, EUDR,
 * PPWR). Which regulations apply comes from the organization's cited scope
 * rules; what has been collected comes from product_compliance_values.
 */
export default async function ProductsPage() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();

  const [products, suppliers, businessUnits, sites, users, rules, values, surveys, surveyQuestions] = await Promise.all([
    fetchAll((from, to) => supabase
      .from('products')
      .select('id, part_number, description, hs_code, cn_code, hts_code, supplier_id, country_of_origin, business_unit_id, site_id, owner_user_id, notes, is_active')
      .order('part_number')
      .range(from, to)),
    supabase.from('suppliers').select('id, name, contact_email').eq('is_active', true).order('name'),
    supabase.from('business_units').select('id, name').order('name'),
    supabase.from('sites').select('id, name').order('name'),
    supabase.from('users').select('id, email, first_name, last_name').eq('is_active', true).order('email'),
    supabase.from('compliance_scope_rules')
      .select('id, regulation, code_system, cn_prefix, label, source_citation, source_url, last_verified')
      .order('regulation').order('code_system').order('cn_prefix'),
    fetchAll((from, to) => supabase
      .from('product_compliance_values')
      .select('id, product_id, field_key, value, unit, valid_from, valid_to, source, source_invitation_id, note, recorded_at')
      .order('id')
      .range(from, to)),
    supabase.from('supplier_surveys').select('id, title, regulation_type, status').eq('status', 'active').order('created_at', { ascending: false }),
    // Which product fields each survey fills, for the Ask supplier dialog.
    supabase.from('supplier_survey_questions').select('survey_id, maps_to'),
  ]);

  const loadError = [products, suppliers, businessUnits, sites, users, rules, values, surveys, surveyQuestions].find((r) => r.error)?.error?.message ?? null;

  return (
    <ProductsClient
      products={products.data ?? []}
      suppliers={suppliers.data ?? []}
      businessUnits={businessUnits.data ?? []}
      sites={sites.data ?? []}
      users={(users.data ?? []).map((u) => ({ id: u.id, label: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email }))}
      rules={rules.data ?? []}
      values={values.data ?? []}
      surveys={(surveys.data ?? []).map((s) => ({
        id: s.id, title: s.title, regulation_type: s.regulation_type,
        fieldKeys: surveyFieldKeys(s, surveyQuestions.data ?? []),
      }))}
      role={profile?.role ?? 'viewer'}
      loadError={loadError}
    />
  );
}
