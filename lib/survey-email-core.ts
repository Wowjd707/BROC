/**
 * Pure helpers for reporting supplier-survey email failures.
 *
 * `supabase.functions.invoke()` resolves with `{ data, error }` — it does not
 * throw. Wrapping it in try/catch therefore catches nothing, which is how the
 * suppliers page came to report "Sent" for invitations whose email had never
 * left the building.
 *
 * These functions turn a failed invocation into something a procurement lead
 * can act on. The distinction that matters most is *not deployed* versus
 * *rejected*: the first is an install step nobody ran, the second is a bad
 * address or an expired API key. Collapsing both into "failed to send" sends
 * the person deploying it looking in the wrong place.
 */

/** Status the invitation should hold after a send attempt. */
export type SendOutcome = 'sent' | 'pending';

export interface EmailFailure {
  message: string;
  /** True when the cause is a missing deployment rather than a bad send. */
  notDeployed: boolean;
}

/**
 * Pull the most specific message available out of an edge-function error body.
 * Resend nests its own reason under `error`, which is where the useful detail
 * (invalid recipient, unverified domain) actually lives.
 */
export function extractErrorDetail(body: unknown): string | null {
  if (typeof body === 'string') return body.trim() || null;
  if (!body || typeof body !== 'object') return null;

  const record = body as Record<string, unknown>;
  const error = record.error;

  if (typeof error === 'string') return error.trim() || null;
  if (error && typeof error === 'object') {
    const nested = error as Record<string, unknown>;
    for (const key of ['message', 'name', 'error']) {
      const value = nested[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }

  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim();
  }
  return null;
}

/**
 * Build the message shown when an invitation or reminder could not be emailed.
 *
 * A 404 from the functions host means `send-survey-email` was never deployed to
 * this Supabase project — the code exists in the repo either way, so the app
 * cannot infer it from anything but the response.
 */
export function describeSendFailure(
  status: number | null,
  body: unknown,
  fallback = 'The email could not be sent.',
): EmailFailure {
  const detail = extractErrorDetail(body);

  if (status === 404) {
    return {
      notDeployed: true,
      message:
        'The send-survey-email function is not deployed to this Supabase project, so no email was sent. ' +
        'Deploy it with: npx supabase functions deploy send-survey-email',
    };
  }

  if (status === 401 || status === 403) {
    return {
      notDeployed: false,
      message: detail
        ? `The email service rejected the request: ${detail}`
        : 'The email service rejected the request. Check RESEND_API_KEY in the project secrets.',
    };
  }

  return {
    notDeployed: false,
    message: detail ? `${fallback} ${detail}` : fallback,
  };
}

/**
 * What an invitation's status should be after an attempted send.
 *
 * A created invitation whose email failed stays 'pending'. It has a valid
 * token and can still be chased, but claiming it was sent would misreport the
 * one thing the supplier relationship is judged on — whether they were asked.
 */
export function outcomeForSend(emailSucceeded: boolean): SendOutcome {
  return emailSucceeded ? 'sent' : 'pending';
}

/** Summary line for a send attempt across several invitations. */
export function summariseSendAttempt(sent: number, failed: number): string {
  if (failed === 0) return sent === 1 ? 'Invitation sent.' : `${sent} invitations sent.`;
  if (sent === 0) return failed === 1 ? 'Invitation not sent.' : `${failed} invitations not sent.`;
  return `${sent} sent, ${failed} not sent.`;
}
