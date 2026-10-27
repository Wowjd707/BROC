/**
 * Which figure a goal is judged on.
 *
 * Goal targets are annual ("3,389 t CO₂e in 2030"). Judging them against the
 * current reporting year while it is still running compares a part year with a
 * whole one: by July, seven months of emissions sit comfortably under any
 * annual target, so every goal reads "on track" and every reduction looks
 * large. That is the calendar, not performance.
 *
 * So progress is measured on the latest COMPLETE reporting year. Only when
 * there is no complete year with data yet — a new organization in its first
 * year — does the year to date stand in, and it is flagged as partial so the
 * page can say so rather than present it as a result.
 *
 * Pure and I/O-free.
 */

export interface GoalMeasurement {
  /** The measured value, in the metric's canonical unit. */
  value: number;
  /** The reporting year the value covers. */
  year: number;
  /** True when this is a year-to-date figure, not a complete year. */
  partial: boolean;
}

/**
 * @param latestCompleteYear the most recent reporting year that has ended
 * @param completeValue      its total, or null when it has no entries
 * @param currentYear        the reporting year in progress
 * @param yearToDateValue    the current year's running total, or null when it has no entries
 */
export function goalMeasurement(
  latestCompleteYear: number,
  completeValue: number | null,
  currentYear: number,
  yearToDateValue: number | null,
): GoalMeasurement | null {
  if (completeValue != null) return { value: completeValue, year: latestCompleteYear, partial: false };
  if (yearToDateValue != null) return { value: yearToDateValue, year: currentYear, partial: true };
  return null;
}

/** A short caption naming what goal progress is measured on. */
export function measurementCaption(m: GoalMeasurement | null): string {
  if (!m) return 'No measured data yet.';
  return m.partial
    ? `Measured on ${m.year} to date — a partial year, so progress will change as the year fills in.`
    : `Measured on ${m.year}, the latest complete reporting year.`;
}
