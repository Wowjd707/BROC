/**
 * Which reporting years a page should offer.
 *
 * Deliberately NOT in the ReportingYearSelect component file. That file is a
 * Client Component, and every export of a `'use client'` module becomes a
 * client reference when a Server Component imports it — so calling this from a
 * server page would fail at runtime. Pure logic used on both sides lives in a
 * plain module.
 */

/**
 * Years from the earliest entered data to the current reporting year, newest
 * first.
 *
 * With no data yet the list is just the current year. Offering a decade of
 * empty years to a new organization invites someone to file against one by
 * accident, and an empty year looks identical to a broken one.
 */
export function reportingYearOptions(
  currentYear: number,
  earliestDate: string | null,
  maxYears = 10,
): number[] {
  let from = currentYear;
  if (earliestDate) {
    const parsed = Number(String(earliestDate).slice(0, 4));
    if (Number.isFinite(parsed) && parsed >= 1990 && parsed <= currentYear) from = parsed;
  }
  if (currentYear - from + 1 > maxYears) from = currentYear - maxYears + 1;

  const years: number[] = [];
  for (let y = currentYear; y >= from; y--) years.push(y);
  return years;
}

/**
 * The year to actually render, given what arrived in the URL.
 *
 * An unknown or out-of-range year falls back to the current one rather than
 * rendering an empty inventory — `?year=1970` should not look like a bug.
 */
export function resolveReportingYear(
  raw: string | undefined,
  availableYears: readonly number[],
  currentYear: number,
): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && availableYears.includes(parsed) ? parsed : currentYear;
}
