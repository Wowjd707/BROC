import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';
import { sendSurveyEmail } from '@/lib/survey-email';

/**
 * POST { productIds: string[], surveyId: string }
 *
 * Ask a supplier about specific products: create one invitation on an active
 * survey, link it to the products, and email it. When the supplier submits,
 * answers to questions that map to a compliance field are recorded on each of
 * those products (app/api/survey/submit).
 *
 * All products must share one supplier with a contact email, because one
 * invitation goes to one address. The answers apply to every product on the
 * invitation, so products whose answers differ (two plots, two installations)
 * should be asked about separately.
 *
 * Everything up to the email runs on the caller's session, so RLS decides
 * what they can see and create. The email itself goes through the same sender
 * and checks as the Suppliers page, including never sending from a practice
 * workspace.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, is_active').eq('id', user.id).single();
  if (!profile?.is_active || !['admin', 'editor'].includes(profile.role)) {
    return NextResponse.json({ error: 'Only admins and editors can ask suppliers for data.' }, { status: 403 });
  }

  let body: { productIds?: unknown; surveyId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const productIds = Array.isArray(body.productIds) ? body.productIds.filter((x): x is string => typeof x === 'string') : [];
  if (productIds.length === 0 || productIds.length > 200 || typeof body.surveyId !== 'string') {
    return NextResponse.json({ error: 'Choose between 1 and 200 products and a survey.' }, { status: 400 });
  }

  const [{ data: survey }, { data: products }] = await Promise.all([
    supabase.from('supplier_surveys').select('id, status, organization_id').eq('id', body.surveyId).maybeSingle(),
    supabase.from('products').select('id, organization_id, supplier_id, is_active, suppliers(id, name, contact_email)').in('id', productIds),
  ]);
  if (!survey) return NextResponse.json({ error: 'Survey not found.' }, { status: 404 });
  if (survey.status !== 'active') {
    return NextResponse.json({ error: 'That survey is not active. Activate it on the Suppliers page first.' }, { status: 400 });
  }
  if (!products || products.length !== productIds.length) {
    return NextResponse.json({ error: 'Some of those products were not found.' }, { status: 404 });
  }

  if (products.some((p) => !p.is_active)) {
    return NextResponse.json({ error: 'Inactive products cannot be sent to suppliers. Reactivate them first.' }, { status: 400 });
  }

  const supplierIds = new Set(products.map((p) => p.supplier_id));
  if (supplierIds.size !== 1 || supplierIds.has(null)) {
    return NextResponse.json(
      { error: 'Every product on one request needs the same supplier. Set the supplier on each product, or ask separately.' },
      { status: 400 },
    );
  }
  const supplier = products[0].suppliers as unknown as { id: string; name: string; contact_email: string | null } | null;
  const email = supplier?.contact_email?.trim();
  if (!supplier || !email) {
    return NextResponse.json({ error: `${supplier?.name ?? 'This supplier'} has no contact email. Add one on the Suppliers page.` }, { status: 400 });
  }

  const { data: inv, error: invError } = await supabase
    .from('supplier_survey_invitations')
    .insert({ survey_id: survey.id, supplier_id: supplier.id, supplier_name: supplier.name, email, status: 'pending' })
    .select('id')
    .single();
  if (invError || !inv) {
    return NextResponse.json({ error: invError?.message ?? 'The invitation could not be created.' }, { status: 500 });
  }

  const { error: linkError } = await supabase.from('supplier_survey_invitation_products').insert(
    productIds.map((product_id) => ({ invitation_id: inv.id, product_id, organization_id: survey.organization_id })),
  );
  if (linkError) {
    return NextResponse.json(
      { error: `The invitation was created, but could not be linked to the products: ${linkError.message}` },
      { status: 500 },
    );
  }

  const service = createServiceClient();
  const { data: org } = await service.from('organizations').select('sandbox_of').eq('id', survey.organization_id).single();
  if (org?.sandbox_of) {
    return NextResponse.json({
      ok: true, invitationId: inv.id, sent: false,
      message: 'Invitation created. The practice workspace never emails suppliers; copy its link from the Suppliers page.',
    });
  }

  const result = await sendSurveyEmail(service, inv.id, 'invite', { fallbackAppUrl: request.nextUrl.origin });
  if (!result.ok) {
    return NextResponse.json({
      ok: true, invitationId: inv.id, sent: false,
      message: `Invitation created but not emailed: ${result.error} Copy its link from the Suppliers page, or use Remind.`,
    });
  }
  return NextResponse.json({ ok: true, invitationId: inv.id, sent: true, message: `Sent to ${supplier.name} (${email}).` });
}
