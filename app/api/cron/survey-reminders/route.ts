import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/fetch-all';
import { isReminderDue } from '@/lib/survey-reminder-core';
import { sendSurveyEmail, surveyEmailConfig } from '@/lib/survey-email';

/**
 * Daily job: email every supplier whose survey reminder is due.
 *
 * Scheduled by vercel.json on Vercel. Anywhere else, have any scheduler call
 *   GET /api/cron/survey-reminders
 *   Authorization: Bearer <CRON_SECRET>
 * once a day (cron, a GitHub Action, Azure Logic Apps, pg_cron with pg_net…).
 *
 * The rule for "due" is lib/survey-reminder-core.ts, the same function that
 * shows "Next reminder" on the Suppliers page. Each reminder claims its slot
 * before sending (lib/survey-email.ts), so overlapping runs cannot double-send.
 *
 * Never runs for a practice workspace, and refuses to run at all without
 * CRON_SECRET: an open endpoint that emails suppliers is not something to
 * leave on the internet.
 */

// Leaves headroom under the free Resend plan's 100 emails a day for the
// invitations people send by hand. Whatever is left over goes out tomorrow.
const MAX_PER_RUN = 50;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not set, so the reminder job is disabled.' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = surveyEmailConfig(request.nextUrl.origin);
  if (config.missing.length > 0) {
    return NextResponse.json({ error: `Supplier email is not set up: ${config.missing.join(', ')} missing.` }, { status: 503 });
  }

  const service = createServiceClient();
  const now = new Date();

  const { data: surveys, error: surveyError } = await service
    .from('supplier_surveys')
    .select('id, status, reminder_interval_days, reminder_max, organizations!inner(sandbox_of)')
    .eq('status', 'active')
    .not('reminder_interval_days', 'is', null);
  if (surveyError) {
    console.error('[cron/survey-reminders] could not read surveys:', surveyError.message);
    return NextResponse.json({ error: 'Could not read surveys.' }, { status: 500 });
  }

  const live = (surveys ?? []).filter(
    (s) => !(s.organizations as unknown as { sandbox_of: string | null } | null)?.sandbox_of,
  );
  const bySurvey = new Map(live.map((s) => [s.id, s]));
  if (bySurvey.size === 0) return NextResponse.json({ surveys: 0, due: 0, sent: 0, failed: 0 });

  const { data: invitations, error: invitationError } = await fetchAll((from, to) => service
    .from('supplier_survey_invitations')
    .select('id, survey_id, status, email, sent_at, last_reminded_at, reminder_count')
    .in('survey_id', [...bySurvey.keys()])
    .in('status', ['sent', 'viewed'])
    .order('id')
    .range(from, to));
  if (invitationError) {
    console.error('[cron/survey-reminders] could not read invitations:', invitationError.message);
    return NextResponse.json({ error: 'Could not read invitations.' }, { status: 500 });
  }

  const due = (invitations ?? []).filter((inv) => {
    const survey = bySurvey.get(inv.survey_id);
    return survey ? isReminderDue(survey, inv, now) : false;
  });

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const inv of due.slice(0, MAX_PER_RUN)) {
    const result = await sendSurveyEmail(service, inv.id, 'reminder', { fallbackAppUrl: request.nextUrl.origin, now });
    if (result.ok) sent++;
    else if (!result.skipped) {
      failed++;
      if (errors.length < 5 && result.error) errors.push(result.error);
    }
  }

  const summary = {
    surveys: bySurvey.size,
    due: due.length,
    sent,
    failed,
    deferred: Math.max(0, due.length - MAX_PER_RUN),
    ...(errors.length ? { errors } : {}),
  };
  console.log('[cron/survey-reminders]', JSON.stringify(summary));
  return NextResponse.json(summary);
}
