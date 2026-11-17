/**
 * The supplier-survey invitation and reminder emails. Pure; no I/O.
 *
 * Laid out like the account emails in supabase/email-templates/ (tables,
 * inline styles, a system font stack, a PNG logo with alt text), because
 * suppliers read these in Outlook and Gmail, not in a browser.
 *
 * Everything that comes from a person — the survey title, the supplier name —
 * is HTML-escaped. A survey title is typed by a user and a supplier name can
 * arrive from an import file; neither should be able to put markup into an
 * email that goes out under your domain.
 */

export type SurveyEmailKind = 'invite' | 'reminder';

export interface SurveyEmailInput {
  kind: SurveyEmailKind;
  appUrl: string;
  token: string;
  surveyTitle: string;
  supplierName: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  dueDate: string | null;
  /** Which reminder this is, 1-based. Ignored for invitations. */
  reminderNumber?: number;
  productName: string;
  /** Absolute URL of a PNG wordmark, or null to set the product name as text. */
  logoUrl: string | null;
  /** Fixed "today", for tests. */
  now?: Date;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  surveyUrl: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "December 1, 2026", read as a calendar date with no timezone shift. */
export function formatDueDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function isPastDue(iso: string, now: Date): boolean {
  return iso.slice(0, 10) < now.toISOString().slice(0, 10);
}

export function renderSurveyEmail(input: SurveyEmailInput): RenderedEmail {
  const now = input.now ?? new Date();
  const base = input.appUrl.replace(/\/+$/, '');
  const surveyUrl = `${base}/survey/${encodeURIComponent(input.token)}`;
  const title = input.surveyTitle.trim() || 'Supplier survey';
  const isReminder = input.kind === 'reminder';
  const overdue = input.dueDate ? isPastDue(input.dueDate, now) : false;
  const due = input.dueDate ? formatDueDate(input.dueDate) : null;

  const subject = isReminder
    ? overdue
      ? `Overdue: ${title}`
      : `Reminder: ${title}`
    : `Please complete: ${title}`;

  const greeting = input.supplierName?.trim() ? `Hello ${input.supplierName.trim()},` : 'Hello,';

  const lead = isReminder
    ? overdue
      ? `We haven't received your response to ${title} yet, and it was due on ${due}. It only takes a few minutes, and it saves where you left off.`
      : `This is a reminder that we're still waiting for your response to ${title}. Your answers save as you go, so you can pick up where you left off.`
    : `We're asking our suppliers for some sustainability information, and we'd be grateful for your answers to ${title}. You don't need an account or a password: the button below opens it in your browser, and your answers save as you go.`;

  const dueLine = due && !overdue ? `Please respond by ${due}.` : null;
  const button = isReminder ? 'Continue the survey' : 'Open the survey';

  const e = escapeHtml;
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const logo = input.logoUrl
    ? `<img src="${e(input.logoUrl)}" width="79" height="28" alt="${e(input.productName)}" style="display:block;border:0;outline:none;text-decoration:none;height:28px;width:79px;font-family:${font};font-size:22px;font-weight:700;letter-spacing:2px;color:#059669;">`
    : `<span style="font-family:${font};font-size:22px;font-weight:700;letter-spacing:1px;color:#059669;">${e(input.productName)}</span>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(isReminder ? `Still waiting on ${title}.` : `${title}: a few questions for our suppliers.`)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
          <tr><td style="padding:0 4px 20px 4px;">${logo}</td></tr>
          <tr>
            <td style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:36px 32px;font-family:${font};color:#111827;">
              <h1 style="margin:0 0 16px 0;font-size:20px;line-height:28px;font-weight:600;color:#111827;">${e(title)}</h1>
              <p style="margin:0 0 12px 0;font-size:15px;line-height:24px;color:#374151;">${e(greeting)}</p>
              <p style="margin:0 0 ${dueLine ? '12' : '24'}px 0;font-size:15px;line-height:24px;color:#374151;">${e(lead)}</p>
              ${dueLine ? `<p style="margin:0 0 24px 0;font-size:15px;line-height:24px;color:#111827;font-weight:600;">${e(dueLine)}</p>` : ''}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td align="center" bgcolor="#059669" style="border-radius:8px;">
                    <a href="${e(surveyUrl)}" target="_blank" style="display:inline-block;padding:12px 24px;font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;background-color:#059669;">${e(button)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:13px;line-height:20px;color:#6b7280;">The button not working? Copy this link into your browser:</p>
              <p style="margin:0;font-size:13px;line-height:20px;word-break:break-all;"><a href="${e(surveyUrl)}" style="color:#047857;text-decoration:underline;">${e(surveyUrl)}</a></p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 4px 0 4px;font-family:${font};font-size:12px;line-height:18px;color:#9ca3af;">
              You're receiving this because your company was asked to take part in this survey. The link is unique to you, so please don't forward it. If you think this reached you by mistake, you can ignore it.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    title,
    '',
    greeting,
    '',
    lead,
    ...(dueLine ? ['', dueLine] : []),
    '',
    `${button}: ${surveyUrl}`,
    '',
    "You're receiving this because your company was asked to take part in this survey. The link is unique to you, so please don't forward it.",
  ].join('\n');

  return { subject, html, text, surveyUrl };
}
