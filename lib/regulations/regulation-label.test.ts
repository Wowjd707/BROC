import { describe, it, expect } from 'vitest';
import { regulationLabel, REGULATION_LABELS } from './index';

describe('regulationLabel', () => {
  it('uses the short label for a named regime', () => {
    expect(regulationLabel('cbam')).toBe('CBAM');
    expect(regulationLabel('general_carbon')).toBe('General Carbon');
  });

  it('uses the typed name for a custom survey', () => {
    // "Custom" tells a supplier nothing about what they are being asked to
    // disclose, and the supplier cannot ask a follow-up question.
    expect(regulationLabel('custom', 'California SB 253')).toBe('California SB 253');
  });

  it('ignores a custom name on a named regime', () => {
    // Migration 036 refuses this combination, but the display must not depend on
    // the constraint holding: a badge showing one regulation while the question
    // set comes from another is worse than no badge.
    expect(regulationLabel('cbam', 'Something else')).toBe('CBAM');
  });

  it('trims, and falls back when the name is only whitespace', () => {
    expect(regulationLabel('custom', '  EUDR annex II  ')).toBe('EUDR annex II');
    expect(regulationLabel('custom', '   ')).toBe(REGULATION_LABELS.custom);
  });

  it('falls back for a custom survey with no name at all', () => {
    // Only reachable for rows written before 036 added its constraint.
    expect(regulationLabel('custom')).toBe('Custom');
    expect(regulationLabel('custom', null)).toBe('Custom');
  });

  it('shows an unknown type as itself rather than blank', () => {
    // A badge that renders empty reads as a layout bug; one reading the raw
    // value reads as data needing attention.
    expect(regulationLabel('eudr_v2')).toBe('eudr_v2');
  });
});
