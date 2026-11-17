import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';
import { sendSurveyEmail } from '@/lib/survey-email';

/**
 * POST { invitationId, type: 'invite' | 'reminder' }
 *
 * Emails one supplier their survey link, from the "Send invite", bulk invite
 * and "Remind" buttons on the Suppliers page. The daily reminder job calls the
 * same sender directly (app/api/cron/survey-reminders).
 *
 * Who may send: an active admin or editor, for a survey their own
 * organization owns. Ownership is checked through RLS on supplier_surveys
 * with the caller's own session; only then does the service role read the
 * invitation and send. Nothing is sent from a practice workspace: its
 * suppliers are invented, and their addresses could belong to real people.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users').select('role, is_active').eq('id', user.id).single();
  if (!profile || !profile.is_active || !['admin', 'editor'].includes(profile.role)) {
    return NextResponse.json({ error: 'Only admins and editors can email suppliers.' }, { status: 403 });
  }

  let body: { invitationId?: unknown; type?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const invitationId = typeof body.invitationId === 'string' ? body.invitationId : null;
  const kind = body.type === 'reminder' ? 'reminder' : body.type === 'invite' ? 'invite' : null;
  if (!invitationId || !kind) {
    return NextResponse.json({ error: 'Send an invitationId and a type of invite or reminder.' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: inv } = await service
    .from('supplier_survey_invitations').select('survey_id').eq('id', invitationId).single();
  if (!inv) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });

  // RLS answers "is this survey in my workspace?"; the service role cannot.
  const { data: survey } = await supabase
    .from('supplier_surveys').select('id, organization_id').eq('id', inv.survey_id).maybeSingle();
  if (!survey) return NextResponse.json({ error: 'Invitation not found.' }, { status: 404 });

  const { data: org } = await service
    .from('organizations').select('sandbox_of').eq('id', survey.organization_id).single();
  if (org?.sandbox_of) {
    return NextResponse.json(
      { error: 'The practice workspace never emails suppliers. Copy the survey link instead.' },
      { status: 400 },
    );
  }

  const result = await sendSurveyEmail(service, invitationId, kind, { fallbackAppUrl: request.nextUrl.origin });
  if (!result.ok) {
    if (result.status >= 500) console.error('[survey-email]', invitationId, kind, result.error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
