import { describe, it, expect } from 'vitest';
import { renderSurveyEmail, escapeHtml, formatDueDate } from './survey-email-render';

const base = {
  appUrl: 'https://app.example.com/',
  token: 'abc123',
  surveyTitle: '2026 CBAM Carbon Disclosure',
  supplierName: 'ElectroParts Co.',
  dueDate: '2026-12-01',
  productName: 'BROC',
  logoUrl: 'https://app.example.com/brand/broc-wordmark-email.png',
  now: new Date('2026-11-17T12:00:00Z'),
};

describe('renderSurveyEmail', () => {
  it('builds an invitation with the survey link, due date and no account needed', () => {
    const email = renderSurveyEmail({ ...base, kind: 'invite' });
    expect(email.subject).toBe('Please complete: 2026 CBAM Carbon Disclosure');
    expect(email.surveyUrl).toBe('https://app.example.com/survey/abc123');
    expect(email.html).toContain('href="https://app.example.com/survey/abc123"');
    expect(email.html).toContain('Please respond by December 1, 2026.');
    expect(email.text).toContain("You don't need an account");
  });

  it('labels a reminder, and an overdue one differently', () => {
    expect(renderSurveyEmail({ ...base, kind: 'reminder' }).subject).toBe('Reminder: 2026 CBAM Carbon Disclosure');
    const late = renderSurveyEmail({ ...base, kind: 'reminder', dueDate: '2026-11-01' });
    expect(late.subject).toBe('Overdue: 2026 CBAM Carbon Disclosure');
    expect(late.text).toContain('it was due on November 1, 2026');
  });

  it('escapes names and titles so they cannot inject markup', () => {
    const email = renderSurveyEmail({ ...base, kind: 'invite', surveyTitle: '<script>x</script>', supplierName: 'A & B "Co"' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('Hello A &amp; B &quot;Co&quot;,');
  });

  it('sets the product name as text when there is no logo', () => {
    const email = renderSurveyEmail({ ...base, kind: 'invite', logoUrl: null, productName: 'Acme ESG' });
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('Acme ESG');
  });

  it('falls back to a neutral greeting with no supplier name', () => {
    expect(renderSurveyEmail({ ...base, kind: 'invite', supplierName: null }).text).toContain('Hello,');
  });
});

describe('helpers', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
  it('reads a due date as a calendar date', () => {
    expect(formatDueDate('2026-01-01')).toBe('January 1, 2026');
  });
});
