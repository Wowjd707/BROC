import { describe, it, expect } from 'vitest';
import { goalMeasurement, measurementCaption } from './goal-period-core';

describe('goalMeasurement', () => {
  it('judges a goal on the latest complete year, not the year in progress', () => {
    // Regression: Jan–Jul 2026 (2,629 t) was judged against an annual target
    // and read "on track"; the whole of 2025 was 4,784 t.
    expect(goalMeasurement(2025, 4_784_000, 2026, 2_629_000))
      .toEqual({ value: 4_784_000, year: 2025, partial: false });
  });

  it('falls back to the year to date, flagged partial, when no complete year has data', () => {
    expect(goalMeasurement(2025, null, 2026, 1_200_000))
      .toEqual({ value: 1_200_000, year: 2026, partial: true });
  });

  it('treats a measured zero as a measurement', () => {
    expect(goalMeasurement(2025, 0, 2026, 500)?.value).toBe(0);
  });

  it('is null with no data at all', () => {
    expect(goalMeasurement(2025, null, 2026, null)).toBeNull();
  });
});

describe('measurementCaption', () => {
  it('names the year and whether it is partial', () => {
    expect(measurementCaption({ value: 1, year: 2025, partial: false })).toContain('2025, the latest complete');
    expect(measurementCaption({ value: 1, year: 2026, partial: true })).toContain('partial year');
    expect(measurementCaption(null)).toBe('No measured data yet.');
  });
});
