import { describe, it, expect } from 'vitest';
import { reportingYearRange, getReportingYears, pctChange, fmtCO2e, fmt, formatDate, fmtAxis, fmtFigure, fmtFactor, perUnit, todayLocal } from './utils';

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

describe('todayLocal', () => {
  it('uses the local calendar date, not the UTC one', () => {
    // 9 pm on 26 October in the local zone. toISOString() would read
    // 27 October anywhere west of UTC.
    expect(todayLocal(new Date(2026, 9, 26, 21, 30))).toBe('2026-10-26');
    expect(todayLocal(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });
});

describe('fmtFactor / perUnit', () => {
  it('formats factors with separators and natural precision', () => {
    expect(fmtFactor(1842)).toBe('1,842');
    expect(fmtFactor(0.34)).toBe('0.34');
    expect(fmtFactor(0.00213)).toBe('0.0021');
  });
  it('uses the singular after a per-slash', () => {
    // Regression: "640 kg/tonnes".
    expect(perUnit('tonnes')).toBe('tonne');
    expect(perUnit('passenger-mile')).toBe('passenger-mile');
    expect(perUnit(null)).toBe('');
  });
});

describe('fmtFigure', () => {
  it('does not pad whole numbers with decimals', () => {
    // Regression: a count of goals rendered as "2.00 targets".
    expect(fmtFigure(2, 'targets')).toBe('2 targets');
    expect(fmtFigure(42, '% reduction')).toBe('42% reduction');
  });
  it('keeps up to two decimals on small fractions and none on large values', () => {
    expect(fmtFigure(0.125, 'tCO₂e per sq ft')).toBe('0.13 tCO₂e per sq ft');
    expect(fmtFigure(9448.4, 'tCO₂e')).toBe('9,448 tCO₂e');
  });
});

describe('fmtAxis', () => {
  it('keeps neighbouring ticks distinct above a thousand', () => {
    // Regression: 1,700 and 2,200 both rendered as "2k".
    expect(fmtAxis(1700)).toBe('1.7k');
    expect(fmtAxis(2200)).toBe('2.2k');
    expect(fmtAxis(2000)).toBe('2k');
  });
  it('leaves small values as numbers and scales millions', () => {
    expect(fmtAxis(550)).toBe('550');
    expect(fmtAxis(0)).toBe('0');
    expect(fmtAxis(1_500_000)).toBe('1.5M');
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
