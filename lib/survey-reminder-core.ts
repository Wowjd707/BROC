/**
 * When an automatic supplier-survey reminder is due. Pure; no I/O.
 *
 * A survey's schedule is two numbers on supplier_surveys (migration 041):
 * reminder_interval_days (null = off) and reminder_max. Each supplier's
 * clock starts when their invitation was actually sent and restarts at each
 * reminder, so a supplier invited late in a campaign is not chased the day
 * after they were asked.
 *
 * Used by the daily job (app/api/cron/survey-reminders) to decide who to
 * email, and by the suppliers page to show "Next reminder" on each
 * invitation, so the two can never disagree.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The choices offered in the app. Any 1–90 is valid in the database. */
export const REMINDER_INTERVAL_CHOICES: { days: number; label: string }[] = [
  { days: 3, label: 'Every 3 days' },
  { days: 7, label: 'Every week' },
  { days: 14, label: 'Every 2 weeks' },
  { days: 30, label: 'Every 30 days' },
];

export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 90;
export const MIN_REMINDERS = 1;
export const MAX_REMINDERS = 20;
export const DEFAULT_REMINDER_MAX = 3;

export interface ReminderSchedule {
  /** Days between reminders; null means automatic reminders are off. */
  reminder_interval_days: number | null;
  reminder_max: number;
  /** Only an active survey sends anything. */
  status: string;
}

export interface ReminderInvitation {
  status: string;
  email: string | null;
  sent_at: string | null;
  last_reminded_at: string | null;
  reminder_count: number | null;
}

export type ReminderState =
  | { kind: 'off' }
  | { kind: 'not_applicable'; reason: 'survey_not_active' | 'submitted' | 'not_sent' | 'no_email' }
  | { kind: 'finished'; sent: number }
  | { kind: 'scheduled'; nextAt: Date; due: boolean; number: number };

/**
 * Where an invitation stands on its survey's reminder schedule.
 *
 * - 'pending' invitations (created, but the email never went) are not
 *   reminded: the supplier has never been asked, and a "reminder" would be
 *   their first contact. Resend the invitation instead.
 * - 'viewed' counts as not yet answered, so it is still chased.
 */
export function reminderState(
  survey: ReminderSchedule,
  inv: ReminderInvitation,
  now: Date,
): ReminderState {
  if (survey.reminder_interval_days == null) return { kind: 'off' };
  if (survey.status !== 'active') return { kind: 'not_applicable', reason: 'survey_not_active' };
  if (inv.status === 'submitted') return { kind: 'not_applicable', reason: 'submitted' };
  if (!inv.email) return { kind: 'not_applicable', reason: 'no_email' };
  if (!inv.sent_at || (inv.status !== 'sent' && inv.status !== 'viewed')) {
    return { kind: 'not_applicable', reason: 'not_sent' };
  }

  const sent = inv.reminder_count ?? 0;
  if (sent >= survey.reminder_max) return { kind: 'finished', sent };

  const base = latest(inv.sent_at, inv.last_reminded_at);
  const nextAt = new Date(base.getTime() + survey.reminder_interval_days * DAY_MS);
  return { kind: 'scheduled', nextAt, due: now.getTime() >= nextAt.getTime(), number: sent + 1 };
}

/** True when the daily job should email this supplier now. */
export function isReminderDue(survey: ReminderSchedule, inv: ReminderInvitation, now: Date): boolean {
  const state = reminderState(survey, inv, now);
  return state.kind === 'scheduled' && state.due;
}

function latest(a: string, b: string | null): Date {
  const da = new Date(a);
  if (!b) return da;
  const db = new Date(b);
  return db.getTime() > da.getTime() ? db : da;
}

/** "Every week, up to 3 reminders", or "Off". */
export function describeSchedule(survey: Pick<ReminderSchedule, 'reminder_interval_days' | 'reminder_max'>): string {
  if (survey.reminder_interval_days == null) return 'Automatic reminders off';
  const choice = REMINDER_INTERVAL_CHOICES.find((c) => c.days === survey.reminder_interval_days);
  const every = choice
    ? choice.label
    : `Every ${survey.reminder_interval_days} day${survey.reminder_interval_days === 1 ? '' : 's'}`;
  const max = survey.reminder_max;
  return `${every}, up to ${max} reminder${max === 1 ? '' : 's'}`;
}

/**
 * Validate a schedule from a form. Returns the values to store, or an error.
 * intervalDays null turns reminders off.
 */
export function parseSchedule(
  intervalDays: unknown,
  maxReminders: unknown,
): { ok: true; reminder_interval_days: number | null; reminder_max: number } | { ok: false; error: string } {
  const max = Number(maxReminders);
  if (!Number.isInteger(max) || max < MIN_REMINDERS || max > MAX_REMINDERS) {
    return { ok: false, error: `Send between ${MIN_REMINDERS} and ${MAX_REMINDERS} reminders.` };
  }
  if (intervalDays === null || intervalDays === '' || intervalDays === 'off') {
    return { ok: true, reminder_interval_days: null, reminder_max: max };
  }
  const days = Number(intervalDays);
  if (!Number.isInteger(days) || days < MIN_INTERVAL_DAYS || days > MAX_INTERVAL_DAYS) {
    return { ok: false, error: `Choose an interval between ${MIN_INTERVAL_DAYS} and ${MAX_INTERVAL_DAYS} days.` };
  }
  return { ok: true, reminder_interval_days: days, reminder_max: max };
}
