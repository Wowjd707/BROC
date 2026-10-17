import { describe, it, expect } from 'vitest';
import { reportingYearOptions, resolveReportingYear } from './reporting-year-core';

describe('reportingYearOptions', () => {
  it('offers only the current year when there is no data', () => {
    expect(reportingYearOptions(2026, null)).toEqual([2026]);
  });

  it('spans from the earliest entry to now, newest first', () => {
    expect(reportingYearOptions(2026, '2024-03-15')).toEqual([2026, 2025, 2024]);
  });

  it('caps the span so an old stray entry does not produce fifty options', () => {
    expect(reportingYearOptions(2026, '1999-01-01', 3)).toEqual([2026, 2025, 2024]);
    expect(reportingYearOptions(2026, '1999-01-01')).toHaveLength(10);
  });

  it('ignores a future or implausible earliest date', () => {
    expect(reportingYearOptions(2026, '2030-01-01')).toEqual([2026]);
    expect(reportingYearOptions(2026, '1889-01-01')).toEqual([2026]);
    expect(reportingYearOptions(2026, 'garbage')).toEqual([2026]);
    expect(reportingYearOptions(2026, '')).toEqual([2026]);
  });

  it('handles the earliest entry being in the current year', () => {
    expect(reportingYearOptions(2026, '2026-06-01')).toEqual([2026]);
  });
});

describe('resolveReportingYear', () => {
  const years = [2026, 2025, 2024];

  it('honours a year that is on offer', () => {
    expect(resolveReportingYear('2025', years, 2026)).toBe(2025);
  });

  it('falls back for anything not on offer', () => {
    for (const raw of [undefined, '', '1970', '2030', 'garbage', '2025.5']) {
      expect(resolveReportingYear(raw, years, 2026), String(raw)).toBe(2026);
    }
  });
});
