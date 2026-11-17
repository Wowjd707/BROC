import { describe, it, expect } from 'vitest';
import { reminderState, isReminderDue, describeSchedule, parseSchedule } from './survey-reminder-core';

const now = new Date('2026-11-17T14:00:00Z');
const weekly = { reminder_interval_days: 7, reminder_max: 3, status: 'active' };
const sentInv = (over: Partial<Parameters<typeof reminderState>[1]> = {}) => ({
  status: 'sent',
  email: 'a@supplier.example',
  sent_at: '2026-11-01T09:00:00Z',
  last_reminded_at: null,
  reminder_count: 0,
  ...over,
});

describe('reminderState', () => {
  it('is off when the survey has no interval', () => {
    expect(reminderState({ ...weekly, reminder_interval_days: null }, sentInv(), now)).toEqual({ kind: 'off' });
  });

  it('counts the first reminder from the invitation date', () => {
    const state = reminderState(weekly, sentInv({ sent_at: '2026-11-12T09:00:00Z' }), now);
    expect(state).toMatchObject({ kind: 'scheduled', due: false, number: 1 });
    if (state.kind === 'scheduled') expect(state.nextAt.toISOString()).toBe('2026-11-19T09:00:00.000Z');
  });

  it('is due once the interval has passed', () => {
    expect(isReminderDue(weekly, sentInv(), now)).toBe(true);
  });

  it('restarts the clock at the last reminder', () => {
    const inv = sentInv({ last_reminded_at: '2026-11-15T09:00:00Z', reminder_count: 1 });
    const state = reminderState(weekly, inv, now);
    expect(state).toMatchObject({ kind: 'scheduled', due: false, number: 2 });
  });

  it('stops at the maximum', () => {
    expect(reminderState(weekly, sentInv({ reminder_count: 3 }), now)).toEqual({ kind: 'finished', sent: 3 });
  });

  it('never chases a submitted, unsent or emailless invitation, or a closed survey', () => {
    expect(isReminderDue(weekly, sentInv({ status: 'submitted' }), now)).toBe(false);
    expect(isReminderDue(weekly, sentInv({ status: 'pending', sent_at: null }), now)).toBe(false);
    expect(isReminderDue(weekly, sentInv({ email: null }), now)).toBe(false);
    expect(isReminderDue({ ...weekly, status: 'closed' }, sentInv(), now)).toBe(false);
  });

  it('still chases a supplier who opened the survey but did not submit', () => {
    expect(isReminderDue(weekly, sentInv({ status: 'viewed' }), now)).toBe(true);
  });
});

describe('describeSchedule', () => {
  it('names the interval and the cap', () => {
    expect(describeSchedule(weekly)).toBe('Every week, up to 3 reminders');
    expect(describeSchedule({ reminder_interval_days: 5, reminder_max: 1 })).toBe('Every 5 days, up to 1 reminder');
    expect(describeSchedule({ reminder_interval_days: null, reminder_max: 3 })).toBe('Automatic reminders off');
  });
});

describe('parseSchedule', () => {
  it('accepts off, and valid numbers', () => {
    expect(parseSchedule('off', 3)).toEqual({ ok: true, reminder_interval_days: null, reminder_max: 3 });
    expect(parseSchedule('14', '5')).toEqual({ ok: true, reminder_interval_days: 14, reminder_max: 5 });
  });
  it('rejects out-of-range values', () => {
    expect(parseSchedule(0, 3).ok).toBe(false);
    expect(parseSchedule(91, 3).ok).toBe(false);
    expect(parseSchedule(7, 0).ok).toBe(false);
    expect(parseSchedule(7, 21).ok).toBe(false);
    expect(parseSchedule(7.5, 3).ok).toBe(false);
  });
});
