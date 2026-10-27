/**
 * Like-for-like year-over-year comparison.
 *
 * Mid-year, the current reporting year holds only the months entered so far.
 * Comparing that against the whole of the prior year reports a fall that is
 * nothing but the calendar: seven months of data against twelve reads as
 * "-42% vs prior year" with no change in performance at all. On a dashboard
 * that is misleading; in a report it is a misstatement.
 *
 * So the prior year is cut to the same span the current year has data for —
 * from the start of the reporting year through the latest month with an entry —
 * and the comparison says which span it used.
 *
 * Pure and I/O-free; the pages pass rows they have already fetched.
 */

export interface DatedRow {
  /** `YYYY-MM-DD`. */
  entry_date: string;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `YYYY-MM` of the latest entry, or null when there are none. */
export function latestEntryMonth(rows: readonly DatedRow[]): string | null {
  let latest: string | null = null;
  for (const r of rows) {
    const m = typeof r.entry_date === 'string' ? r.entry_date.slice(0, 7) : '';
    if (/^\d{4}-\d{2}$/.test(m) && (latest === null || m > latest)) latest = m;
  }
  return latest;
}

/** Last calendar day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
function monthEnd(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${yyyyMm}-${String(day).padStart(2, '0')}`;
}

function shiftYear(yyyyMm: string, years: number): string {
  const [y, m] = yyyyMm.split('-');
  return `${Number(y) + years}-${m}`;
}

function monthName(yyyyMm: string): string {
  return MONTHS_SHORT[Number(yyyyMm.slice(5, 7)) - 1];
}

export interface LikeForLike<T> {
  /** The prior-year rows inside the comparable span. */
  prior: T[];
  /** True when the prior year was cut short to match. */
  partial: boolean;
  /** What the comparison is against, for display: "prior year" or "Jan–Jul 2025". */
  label: string;
}

/**
 * Cut the prior year's rows to the span the current year has data for.
 *
 * @param prior          rows from the prior reporting year
 * @param currentThrough `YYYY-MM` of the latest current-year entry (see latestEntryMonth)
 * @param priorRange     the prior reporting year's bounds, from reportingYearRange
 */
export function samePeriodLastYear<T extends DatedRow>(
  prior: readonly T[],
  currentThrough: string | null,
  priorRange: { startDate: string; endDate: string },
): LikeForLike<T> {
  const whole: LikeForLike<T> = { prior: [...prior], partial: false, label: 'prior year' };
  if (!currentThrough) return whole;

  const cutoff = monthEnd(shiftYear(currentThrough, -1));
  if (cutoff >= priorRange.endDate) return whole;
  if (cutoff < priorRange.startDate) return { prior: [], partial: true, label: 'prior year' };

  const startMonth = priorRange.startDate.slice(0, 7);
  const endMonth = cutoff.slice(0, 7);
  const startYear = startMonth.slice(0, 4);
  const endYear = endMonth.slice(0, 4);
  const label =
    startMonth === endMonth
      ? `${monthName(startMonth)} ${startYear}`
      : startYear === endYear
        ? `${monthName(startMonth)}–${monthName(endMonth)} ${endYear}`
        : `${monthName(startMonth)} ${startYear}–${monthName(endMonth)} ${endYear}`;

  return {
    prior: prior.filter((r) => r.entry_date <= cutoff),
    partial: true,
    label,
  };
}
