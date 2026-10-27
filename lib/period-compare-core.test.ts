import { describe, it, expect } from 'vitest';
import { latestEntryMonth, samePeriodLastYear } from './period-compare-core';

const CAL_2025 = { startDate: '2025-01-01', endDate: '2025-12-31' };
const FY_APR_2025 = { startDate: '2025-04-01', endDate: '2026-03-31' };

const rows = (...dates: string[]) => dates.map((entry_date, i) => ({ entry_date, kg: i + 1 }));

describe('latestEntryMonth', () => {
  it('finds the latest month regardless of order', () => {
    expect(latestEntryMonth(rows('2026-03-31', '2026-07-15', '2026-01-02'))).toBe('2026-07');
  });
  it('is null with no rows', () => {
    expect(latestEntryMonth([])).toBeNull();
  });
});

describe('samePeriodLastYear', () => {
  const prior = rows('2025-01-31', '2025-06-30', '2025-07-31', '2025-08-31', '2025-12-31');

  it('cuts the prior year to the months the current year has data for', () => {
    // Regression: Jan–Jul 2026 was compared with all of 2025, reading as a
    // fall of about 40% from the calendar alone.
    const r = samePeriodLastYear(prior, '2026-07', CAL_2025);
    expect(r.prior.map((x) => x.entry_date)).toEqual(['2025-01-31', '2025-06-30', '2025-07-31']);
    expect(r.partial).toBe(true);
    expect(r.label).toBe('Jan–Jul 2025');
  });

  it('keeps the whole prior year once the current year is complete', () => {
    const r = samePeriodLastYear(prior, '2026-12', CAL_2025);
    expect(r.prior).toHaveLength(5);
    expect(r.partial).toBe(false);
    expect(r.label).toBe('prior year');
  });

  it('keeps the whole prior year when there is no current data to match', () => {
    expect(samePeriodLastYear(prior, null, CAL_2025).prior).toHaveLength(5);
  });

  it('includes the last day of the matching month', () => {
    const r = samePeriodLastYear(rows('2025-02-28', '2025-03-01'), '2026-02', CAL_2025);
    expect(r.prior.map((x) => x.entry_date)).toEqual(['2025-02-28']);
    expect(r.label).toBe('Jan–Feb 2025');
  });

  it('labels a single month on its own', () => {
    expect(samePeriodLastYear(prior, '2026-01', CAL_2025).label).toBe('Jan 2025');
  });

  it('handles a fiscal year that spans two calendar years', () => {
    const fy = rows('2025-04-30', '2025-12-31', '2026-01-31', '2026-03-31');
    const r = samePeriodLastYear(fy, '2027-01', FY_APR_2025);
    expect(r.prior.map((x) => x.entry_date)).toEqual(['2025-04-30', '2025-12-31', '2026-01-31']);
    expect(r.label).toBe('Apr 2025–Jan 2026');
  });
});
