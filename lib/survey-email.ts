import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { BRANDING } from '@/lib/branding';
import { renderSurveyEmail, type SurveyEmailKind } from '@/lib/survey-email-render';

/**
 * Send a supplier-survey invitation or reminder, and record that it went.
 *
 * This runs inside the app, on the server, and replaces the old
 * send-survey-email Supabase Edge Function. One less thing to deploy, and the
 * same code path serves the "Send invite" and "Remind" buttons and the daily
 * reminder job (app/api/cron/survey-reminders).
 *
 * Settings, all server-side environment variables:
 *   RESEND_API_KEY     the Resend API key
 *   RESEND_FROM_EMAIL  an address on a domain verified in Resend
 *   APP_URL            optional; the address suppliers open the survey at.
 *                      Falls back to NEXT_PUBLIC_APP_URL, then to the
 *                      address the request came in on.
 *
 * Every field is read with the service role, by invitation id. The caller is
 * responsible for checking the user may act on that invitation; see
 * app/api/survey-email/route.ts.
 */

type Service = SupabaseClient<Database>;

export interface SendResult {
  ok: boolean;
  /** HTTP-style status for the API route to pass on. */
  status: number;
  error?: string;
  /** For a reminder skipped because another send claimed it first. */
  skipped?: boolean;
}

export function surveyEmailConfig(fallbackAppUrl?: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim() || null;
  const from = process.env.RESEND_FROM_EMAIL?.trim() || null;
  const appUrl = (process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || fallbackAppUrl || '')
    .replace(/\/+$/, '');
  const missing = [
    !apiKey && 'RESEND_API_KEY',
    !from && 'RESEND_FROM_EMAIL',
    !appUrl && 'APP_URL',
  ].filter(Boolean) as string[];
  return { apiKey, from, appUrl, missing };
}

/** The PNG wordmark for email clients, only while the built-in brand is in use. */
function emailLogoUrl(appUrl: string): string | null {
  return BRANDING.wordmarkSrc === '/brand/broc-wordmark.svg' ? `${appUrl}/brand/broc-wordmark-email.png` : null;
}

export async function sendSurveyEmail(
  service: Service,
  invitationId: string,
  kind: SurveyEmailKind,
  options: { fallbackAppUrl?: string; now?: Date } = {},
): Promise<SendResult> {
  const config = surveyEmailConfig(options.fallbackAppUrl);
  if (config.missing.length > 0) {
    return {
      ok: false,
      status: 503,
      error: `Supplier email is not set up: add ${config.missing.join(', ')} to the app's environment variables (see docs/DEPLOY.md).`,
    };
  }

  const { data: inv, error } = await service
    .from('supplier_survey_invitations')
    .select('id, token, email, supplier_name, status, sent_at, last_reminded_at, reminder_count, supplier_surveys(title, due_date, status)')
    .eq('id', invitationId)
    .single();
  if (error || !inv) return { ok: false, status: 404, error: 'Invitation not found.' };

  const survey = inv.supplier_surveys as unknown as { title: string; due_date: string | null; status: string } | null;
  if (!survey) return { ok: false, status: 404, error: 'Survey not found.' };
  if (!inv.email) return { ok: false, status: 400, error: 'This invitation has no email address.' };
  if (survey.status !== 'active') {
    return { ok: false, status: 400, error: 'The survey is not active, so nothing was sent. Activate it first.' };
  }
  if (inv.status === 'submitted') {
    return { ok: false, status: 400, error: 'This supplier has already submitted.' };
  }

  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const previousCount = inv.reminder_count ?? 0;

  // A reminder claims its slot before it is sent: the count only moves if
  // nobody else moved it first. Two overlapping runs of the daily job, or a
  // click on Remind while the job is running, cannot email a supplier twice.
  if (kind === 'reminder') {
    const { data: claimed } = await service
      .from('supplier_survey_invitations')
      .update({ reminder_count: previousCount + 1, last_reminded_at: nowIso })
      .eq('id', inv.id)
      .eq('reminder_count', previousCount)
      .select('id');
    if (!claimed || claimed.length === 0) {
      return { ok: false, status: 409, skipped: true, error: 'A reminder was just sent to this supplier.' };
    }
  }

  const email = renderSurveyEmail({
    kind,
    appUrl: config.appUrl,
    token: inv.token,
    surveyTitle: survey.title,
    supplierName: inv.supplier_name,
    dueDate: survey.due_date,
    reminderNumber: previousCount + 1,
    productName: BRANDING.productName,
    logoUrl: emailLogoUrl(config.appUrl),
    now,
  });

  let sendError: string | null = null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        // Resend drops a repeat of the same key within 24 hours, so a retry
        // after a timeout cannot send the same reminder twice.
        'Idempotency-Key': kind === 'reminder' ? `reminder-${inv.id}-${previousCount + 1}` : `invite-${inv.id}-${nowIso.slice(0, 16)}`,
      },
      body: JSON.stringify({
        from: `${BRANDING.productName} <${config.from}>`,
        to: inv.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });
    if (!res.ok) {
      let detail = `${res.status}`;
      try {
        const body = (await res.json()) as { message?: string; name?: string };
        detail = body.message || body.name || detail;
      } catch { /* keep the status */ }
      sendError = `The email service refused the message: ${detail}`;
    }
  } catch (err) {
    sendError = `The email service could not be reached: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (sendError) {
    if (kind === 'reminder') {
      // Give the slot back, so the next run tries again.
      await service
        .from('supplier_survey_invitations')
        .update({ reminder_count: previousCount, last_reminded_at: inv.last_reminded_at })
        .eq('id', inv.id)
        .eq('reminder_count', previousCount + 1);
    }
    return { ok: false, status: 502, error: sendError };
  }

  if (kind === 'invite') {
    // Only advance a fresh invitation. A supplier who has already opened the
    // survey must not be walked back to 'sent' by a resend.
    const advanceable = inv.status === 'pending' || inv.status === 'sent';
    await service
      .from('supplier_survey_invitations')
      .update({ sent_at: nowIso, ...(advanceable ? { status: 'sent' } : {}) })
      .eq('id', inv.id);
  }

  return { ok: true, status: 200 };
}
