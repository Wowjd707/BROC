import { describe, it, expect } from 'vitest';
import {
  extractErrorDetail,
  describeSendFailure,
  outcomeForSend,
  summariseSendAttempt,
} from './survey-email-core';

describe('extractErrorDetail', () => {
  it('reads a plain string body', () => {
    expect(extractErrorDetail('boom')).toBe('boom');
  });

  it('reads the edge function\'s own { error } string', () => {
    expect(extractErrorDetail({ error: 'Invitation not found.' })).toBe('Invitation not found.');
  });

  it('reaches into a nested provider error', () => {
    const body = { error: { statusCode: 422, message: 'Invalid `to` field.', name: 'validation_error' } };
    expect(extractErrorDetail(body)).toBe('Invalid `to` field.');
  });

  it('falls back to the error name when there is no message', () => {
    expect(extractErrorDetail({ error: { name: 'validation_error' } })).toBe('validation_error');
  });

  it('reads a top-level message', () => {
    expect(extractErrorDetail({ message: 'gateway timeout' })).toBe('gateway timeout');
  });

  it('returns null when there is nothing usable', () => {
    expect(extractErrorDetail(null)).toBeNull();
    expect(extractErrorDetail(undefined)).toBeNull();
    expect(extractErrorDetail({})).toBeNull();
    expect(extractErrorDetail('   ')).toBeNull();
    expect(extractErrorDetail({ error: '  ' })).toBeNull();
    expect(extractErrorDetail(42)).toBeNull();
  });
});

describe('describeSendFailure', () => {
  it('names the missing deployment on a 404 and gives the deploy command', () => {
    const failure = describeSendFailure(404, { code: 'NOT_FOUND' });
    expect(failure.notDeployed).toBe(true);
    expect(failure.message).toContain('not deployed');
    expect(failure.message).toContain('supabase functions deploy send-survey-email');
  });

  it('points at the API key on an auth rejection', () => {
    const failure = describeSendFailure(401, null);
    expect(failure.notDeployed).toBe(false);
    expect(failure.message).toContain('RESEND_API_KEY');
  });

  it('surfaces the provider detail on an auth rejection when there is one', () => {
    const failure = describeSendFailure(403, { error: { message: 'API key is invalid' } });
    expect(failure.message).toContain('API key is invalid');
  });

  it('appends the provider detail to the fallback for other statuses', () => {
    const failure = describeSendFailure(500, { error: { message: 'Domain not verified' } });
    expect(failure.notDeployed).toBe(false);
    expect(failure.message).toBe('The email could not be sent. Domain not verified');
  });

  it('uses the bare fallback when the body explains nothing', () => {
    expect(describeSendFailure(500, {}).message).toBe('The email could not be sent.');
  });

  it('handles a null status, as when the request never reached the host', () => {
    const failure = describeSendFailure(null, null, 'Network error.');
    expect(failure.notDeployed).toBe(false);
    expect(failure.message).toBe('Network error.');
  });
});

describe('outcomeForSend', () => {
  it('marks a confirmed send as sent', () => {
    expect(outcomeForSend(true)).toBe('sent');
  });

  it('leaves a failed send pending rather than claiming it went out', () => {
    expect(outcomeForSend(false)).toBe('pending');
  });
});

describe('summariseSendAttempt', () => {
  it('reports a clean single send', () => {
    expect(summariseSendAttempt(1, 0)).toBe('Invitation sent.');
  });

  it('pluralises a clean batch', () => {
    expect(summariseSendAttempt(3, 0)).toBe('3 invitations sent.');
  });

  it('reports a total failure without claiming anything was sent', () => {
    expect(summariseSendAttempt(0, 1)).toBe('Invitation not sent.');
    expect(summariseSendAttempt(0, 4)).toBe('4 invitations not sent.');
  });

  it('reports a mixed result honestly', () => {
    expect(summariseSendAttempt(2, 1)).toBe('2 sent, 1 not sent.');
  });
});
