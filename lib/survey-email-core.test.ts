import { describe, it, expect } from 'vitest';
import { outcomeForSend, summariseSendAttempt } from './survey-email-core';

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
