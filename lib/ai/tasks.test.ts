import { describe, it, expect } from 'vitest';
import {
  AI_TASK_IDS, isAiTaskId, AI_TASK_MAX_TOKENS,
  buildRegulatoryChangePrompt, parseRegulatoryChange,
} from './tasks';

describe('the task catalogue', () => {
  it('is a closed set', () => {
    expect(isAiTaskId('draft_disclosure_narrative')).toBe(true);
    expect(isAiTaskId('summarise_regulatory_change')).toBe(true);
    expect(isAiTaskId('anything_else')).toBe(false);
  });

  it('gives every task a token ceiling', () => {
    for (const id of AI_TASK_IDS) {
      expect(AI_TASK_MAX_TOKENS[id], id).toBeGreaterThan(0);
    }
  });
});

describe('buildRegulatoryChangePrompt', () => {
  const input = {
    itemName: 'EU Deforestation Regulation',
    itemCode: 'EUDR',
    sourceUrl: 'https://example.europa.eu/eudr',
    currentStatusSummary: 'Applies from 30 December 2026.',
    currentStage: 'adopted',
    currentMilestone: 'Application for large operators',
    currentMilestoneDate: '2026-12-30',
    diffExcerpt: '+ The Commission has adopted a delegated act on 1 October 2026.',
  };

  it('forbids stating what a regulation requires', () => {
    const { system } = buildRegulatoryChangePrompt(input);
    expect(system).toMatch(/NEVER state what a regulation requires/i);
    expect(system).toMatch(/cannot set the entry's confidence rating/i);
  });

  it('grounds the check on the diff alone, not the stored summary', () => {
    // A date the model echoed from our own stored text is not evidence the
    // source said it, so the stored fields must stay out of the context.
    const { context } = buildRegulatoryChangePrompt(input);
    expect(context).toBe(input.diffExcerpt);
    expect(context).not.toContain('30 December 2026');
  });

  it('labels the stored values as context rather than evidence', () => {
    const { user } = buildRegulatoryChangePrompt(input);
    expect(user).toMatch(/context only - not evidence/i);
    expect(user).toContain(input.diffExcerpt);
  });

  it('says plainly when no milestone date is recorded', () => {
    const { user } = buildRegulatoryChangePrompt({ ...input, currentMilestoneDate: null });
    expect(user).toMatch(/no date announced/i);
  });
});

describe('parseRegulatoryChange', () => {
  it('parses a clean JSON reply', () => {
    const out = parseRegulatoryChange(JSON.stringify({
      summary: 'A delegated act was added.',
      substantive: true,
      suggested_changes: { stage: 'in_force' },
    }));
    expect(out.summary).toBe('A delegated act was added.');
    expect(out.substantive).toBe(true);
    expect(out.suggestedChanges).toEqual({ stage: 'in_force' });
    expect(out.fellBackToProse).toBe(false);
  });

  it('handles a fenced code block', () => {
    const raw = '```json\n{"summary":"Cosmetic only.","substantive":false,"suggested_changes":{}}\n```';
    expect(parseRegulatoryChange(raw).summary).toBe('Cosmetic only.');
  });

  it('handles a leading sentence before the JSON', () => {
    const raw = 'Here is my analysis:\n{"summary":"Nav change.","substantive":false}';
    const out = parseRegulatoryChange(raw);
    expect(out.summary).toBe('Nav change.');
    expect(out.fellBackToProse).toBe(false);
  });

  it('falls back to prose when the reply is not JSON', () => {
    // Losing the optional patch is fine; the summary is the valuable part.
    const out = parseRegulatoryChange('The page reordered its navigation menu.');
    expect(out.summary).toBe('The page reordered its navigation menu.');
    expect(out.suggestedChanges).toEqual({});
    expect(out.fellBackToProse).toBe(true);
  });

  it('falls back when the JSON is malformed', () => {
    const out = parseRegulatoryChange('{"summary": "unterminated');
    expect(out.fellBackToProse).toBe(true);
    expect(out.summary).toContain('unterminated');
  });

  it('treats an unstated substantive flag as not substantive', () => {
    // The safe reading of an unmade claim is the conservative one.
    expect(parseRegulatoryChange('{"summary":"Something."}').substantive).toBe(false);
    expect(parseRegulatoryChange('{"summary":"S","substantive":"yes"}').substantive).toBe(false);
  });

  it('uses the raw text when summary is empty or missing', () => {
    const out = parseRegulatoryChange('{"summary":"   ","substantive":false}');
    expect(out.summary.length).toBeGreaterThan(0);
  });

  it('defaults suggested_changes to an empty object', () => {
    expect(parseRegulatoryChange('{"summary":"S"}').suggestedChanges).toEqual({});
  });
});
