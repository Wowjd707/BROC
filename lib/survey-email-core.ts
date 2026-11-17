/**
 * Pure helpers for reporting supplier-survey email results on the Suppliers
 * page. The sending itself happens on the server (lib/survey-email.ts), which
 * records sent_at and reminder counts only after the email service accepts a
 * message, so the page never reports "Sent" for an email that did not go.
 */

/** Status the invitation should hold after a send attempt. */
export type SendOutcome = 'sent' | 'pending';

export interface EmailFailure {
  message: string;
  /** True when the cause is missing configuration rather than a bad send. */
  notDeployed: boolean;
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
