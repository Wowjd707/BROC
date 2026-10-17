/**
 * Supabase Edge Function: send-survey-email
 * Invoked from the app when an invitation is created or a reminder is sent.
 *
 * Request body: { invitationId: string; type?: 'invite' | 'reminder' }
 *
 * All invitation/survey details are looked up server-side with the service
 * role so the client cannot spoof recipient or content. Requires env:
 *   RESEND_API_KEY, APP_URL, RESEND_FROM_EMAIL
 * (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const APP_URL        = Deno.env.get('APP_URL') ?? 'https://yourdomain.com';
const FROM_EMAIL     = Deno.env.get('RESEND_FROM_EMAIL') ?? 'no-reply@yourdomain.com';
// Kept in sync with lib/branding.ts by env, since a Deno edge function
// cannot import from the Next.js app.
const PRODUCT_NAME   = Deno.env.get('PRODUCT_NAME') ?? 'ESG Jumpstart';
const PRODUCT_TAGLINE = Deno.env.get('PRODUCT_TAGLINE') ?? 'Sustainability & Carbon Accounting';

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { invitationId, type = 'invite' } = await req.json();
  if (!invitationId) {
    return new Response(JSON.stringify({ error: 'Missing invitationId.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const isReminder = type === 'reminder';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: invitation, error } = await supabase
    .from('supplier_survey_invitations')
    .select('id, token, email, supplier_name, status, reminder_count, supplier_surveys(title, due_date, status)')
    .eq('id', invitationId)
    .single();

  if (error || !invitation) {
    return new Response(JSON.stringify({ error: 'Invitation not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const survey = invitation.supplier_surveys as unknown as {
    title: string; due_date: string | null; status: string;
  } | null;

  if (!invitation.email || !survey) {
    return new Response(JSON.stringify({ error: 'Invitation has no email or survey.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (survey.status === 'closed') {
    return new Response(JSON.stringify({ error: 'Survey is closed.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const surveyName  = survey.title;
  const contactName = invitation.supplier_name ?? '';
  const surveyUrl   = `${APP_URL}/survey/${invitation.token}`;
  const dueDateStr  = survey.due_date
    ? new Date(survey.due_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  const subject = isReminder
    ? `Reminder: ${surveyName} — Response Needed`
    : `You've been invited to complete: ${surveyName}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; background: #f9fafb; margin:0; padding:0;">
  <div style="max-width: 560px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08);">
    <div style="background: #059669; padding: 24px 32px;">
      <div style="color: white; font-size: 20px; font-weight: 600;">${PRODUCT_NAME}</div>
      <div style="color: #a7f3d0; font-size: 13px; margin-top: 2px;">${PRODUCT_TAGLINE}</div>
    </div>
    <div style="padding: 32px;">
      <p style="margin:0 0 16px; font-size: 15px;">Dear ${contactName || 'Supplier'},</p>

      ${isReminder
        ? `<p style="margin:0 0 16px; font-size: 15px;">This is a friendly reminder that your response to <strong>${surveyName}</strong> is still pending.</p>`
        : `<p style="margin:0 0 16px; font-size: 15px;">You've been invited to complete a sustainability disclosure survey: <strong>${surveyName}</strong>.</p>`
      }

      <p style="margin:0 0 16px; font-size: 15px;">This survey is part of our supply chain sustainability reporting. Your response helps us meet our environmental disclosure obligations.</p>

      ${dueDateStr ? `<p style="margin:0 0 16px; font-size: 15px; color: #dc2626;"><strong>Due date: ${dueDateStr}</strong></p>` : ''}

      <div style="text-align: center; margin: 28px 0;">
        <a href="${surveyUrl}" style="display: inline-block; background: #059669; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 15px; font-weight: 600;">
          ${isReminder ? 'Complete Survey Now' : 'Start Survey'}
        </a>
      </div>

      <p style="margin:0 0 8px; font-size: 13px; color: #6b7280;">If the button above doesn't work, copy and paste this link into your browser:</p>
      <p style="margin:0 0 24px; font-size: 13px; color: #059669; word-break: break-all;">${surveyUrl}</p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="margin:0; font-size: 12px; color: #9ca3af;">
        You received this email because your organization was added as a supplier.
        If you believe this was sent in error, please ignore it.
      </p>
    </div>
  </div>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: invitation.email,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.json();
    return new Response(JSON.stringify({ error: body }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Record the send. This happens here, after Resend has accepted the message,
  // and deliberately not in the browser: the client cannot know whether the
  // send succeeded, and when it wrote these fields optimistically the UI
  // reported "Sent" for invitations that never left the building.
  const now = new Date().toISOString();

  if (isReminder) {
    await supabase
      .from('supplier_survey_invitations')
      .update({
        reminder_count: (invitation.reminder_count ?? 0) + 1,
        last_reminded_at: now,
      })
      .eq('id', invitation.id);
  } else {
    // Only advance a fresh invitation. A supplier who has already opened or
    // submitted must not be walked backwards to 'sent' by a resend.
    const advanceable = invitation.status === 'pending' || invitation.status === 'sent';
    await supabase
      .from('supplier_survey_invitations')
      .update({
        sent_at: now,
        ...(advanceable ? { status: 'sent' } : {}),
      })
      .eq('id', invitation.id);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
