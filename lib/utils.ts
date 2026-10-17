import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a date string (YYYY-MM-DD) for display */
export function formatDate(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  });
}

/** Format a number with commas and optional decimal places */
export function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format kg CO2e to a human-readable string */
export function fmtCO2e(kg: number | null | undefined): string {
  if (kg == null) return '—';
  if (kg >= 1_000_000) return `${(kg / 1_000_000).toFixed(2)} Mt CO₂e`;
  if (kg >= 1_000)     return `${(kg / 1_000).toFixed(1)} t CO₂e`;
  return `${Math.round(kg).toLocaleString()} kg CO₂e`;
}

/** Format gallons */
export function fmtGallons(gallons: number | null | undefined): string {
  if (gallons == null) return '—';
  if (gallons >= 1_000_000) return `${(gallons / 1_000_000).toFixed(1)}M gal`;
  if (gallons >= 1_000)     return `${(gallons / 1_000).toFixed(0)}K gal`;
  return `${Math.round(gallons).toLocaleString()} gal`;
}

/** Percent change with ± prefix and color indicator */
export function pctChange(current: number, prior: number): {
  value: number;
  label: string;
  direction: 'up' | 'down' | 'flat';
} {
  if (prior === 0) return { value: 0, label: '—', direction: 'flat' };
  const v = ((current - prior) / prior) * 100;
  return {
    value: v,
    label: `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
    direction: v > 0.1 ? 'up' : v < -0.1 ? 'down' : 'flat',
  };
}

/** Get current and prior reporting year based on org config */
export function getReportingYears(reportingYearStart: number = 1): {
  currentYear: number;
  priorYear: number;
  startMonth: number;
} {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();
  // If fiscal year starts in Jan, current year = calendar year
  // If fiscal year starts mid-year, adjust accordingly
  const currentYear = month >= reportingYearStart ? year : year - 1;
  return {
    currentYear,
    priorYear: currentYear - 1,
    startMonth: reportingYearStart,
  };
}

/** Generate date range for a reporting year */
export function reportingYearRange(
  year: number,
  startMonth: number = 1,
): { startDate: string; endDate: string } {
  const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
  const endYear = startMonth === 1 ? year : year + 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endDay = new Date(endYear, endMonth, 0).getDate();
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

/** Truncate text with ellipsis */
export function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

/** Sleep (useful for debouncing) */
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Scope label for display */
export function scopeLabel(scope: string): string {
  if (scope === 'scope1') return 'Scope 1';
  if (scope === 'scope2') return 'Scope 2';
  return scope;
}

/** Convert camelCase or snake_case to Title Case */
export function toTitleCase(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
