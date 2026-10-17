'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  /** The year currently being shown. */
  value: number;
  /** Selectable years, newest first. */
  years: number[];
  /** Label shown before the control. Omit for none. */
  label?: string;
}

/**
 * Reporting-year picker that drives the `year` search param.
 *
 * The year lives in the URL rather than in component state so that a particular
 * year is linkable and survives a refresh — someone assembling a disclosure
 * sends a colleague "look at FY2025" and it has to land on FY2025. It also means
 * the server component re-fetches for the chosen year rather than the client
 * filtering data it was never given.
 *
 * Other params are preserved, so this composes with the reporting-scope filter
 * instead of clearing it.
 */
export function ReportingYearSelect({ value, years, label = 'Reporting year' }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // A single option is not a choice; render it as text rather than a dead control.
  if (years.length <= 1) {
    return (
      <span className="text-sm text-gray-500 whitespace-nowrap">
        {label ? `${label}: ` : ''}FY {value}
      </span>
    );
  }

  function onChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('year', next);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="text-sm text-gray-500 whitespace-nowrap hidden sm:inline">{label}</span>
      )}
      <Select value={String(value)} onValueChange={onChange}>
        <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>FY {y}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
