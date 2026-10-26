import { describe, it, expect } from 'vitest';
import { reportingYearRange, getReportingYears, pctChange, fmtCO2e, fmt, formatDate } from './utils';

describe('reportingYearRange', () => {
  it('covers the full calendar year for a January fiscal start', () => {
    expect(reportingYearRange(2024, 1)).toEqual({
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    });
  });

  it('spans into the next calendar year for a mid-year fiscal start', () => {
    // FY starting April 2024 runs Apr 1 2024 → Mar 31 2025
    expect(reportingYearRange(2024, 4)).toEqual({
      startDate: '2024-04-01',
      endDate: '2025-03-31',
    });
  });

  it('handles a July fiscal start with correct end day', () => {
    expect(reportingYearRange(2023, 7)).toEqual({
      startDate: '2023-07-01',
      endDate: '2024-06-30',
    });
  });
});

describe('getReportingYears', () => {
  it('returns consecutive current and prior years', () => {
    const { currentYear, priorYear } = getReportingYears(1);
    expect(currentYear - priorYear).toBe(1);
  });
});

describe('pctChange', () => {
  it('reports an increase', () => {
    const r = pctChange(120, 100);
    expect(r.value).toBeCloseTo(20, 6);
    expect(r.direction).toBe('up');
  });
  it('reports a decrease', () => {
    const r = pctChange(80, 100);
    expect(r.value).toBeCloseTo(-20, 6);
    expect(r.direction).toBe('down');
  });
  it('guards against a zero prior', () => {
    const r = pctChange(50, 0);
    expect(r.direction).toBe('flat');
    expect(r.label).toBe('—');
  });
});

describe('formatDate', () => {
  it('shows a calendar date on its own day, not the day before', () => {
    expect(formatDate('2026-09-30')).toBe('Sep 30, 2026');
  });
  it('formats full timestamps instead of returning "Invalid Date"', () => {
    // Regression: invitation and submission times rendered as "Invalid Date".
    expect(formatDate('2026-06-14T12:00:00+00:00')).toBe('Jun 14, 2026');
    expect(formatDate('2026-06-14T12:00:00.123456+00:00')).toBe('Jun 14, 2026');
  });
  it('renders unparseable input as an em dash', () => {
    expect(formatDate('not a date')).toBe('—');
  });
});

describe('fmtCO2e / fmt', () => {
  it('formats null as an em dash', () => {
    expect(fmtCO2e(null)).toBe('—');
    expect(fmt(null)).toBe('—');
  });
  it('scales CO2e units', () => {
    expect(fmtCO2e(500)).toBe('500 kg CO₂e');
    expect(fmtCO2e(1500)).toBe('1.5 t CO₂e');
    expect(fmtCO2e(388_000)).toBe('388 t CO₂e');
    expect(fmtCO2e(2_629_000)).toBe('2,629 t CO₂e');
    expect(fmtCO2e(2_500_000_000)).toBe('2.50 Mt CO₂e');
  });
  it('never labels thousands of tonnes as megatonnes', () => {
    // Regression: 2,629,000 kg (2,629 t) used to render as "2.63 Mt CO₂e",
    // a thousand times too large.
    expect(fmtCO2e(2_629_000)).not.toMatch(/Mt/);
    expect(fmtCO2e(999_999_999)).not.toMatch(/Mt/);
  });
});
