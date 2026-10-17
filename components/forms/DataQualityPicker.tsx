'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { EntryDataQuality } from '@/lib/entry-data-quality';

interface Props {
  value: EntryDataQuality;
  onChange: (v: EntryDataQuality) => void;
  estimationMethod: string;
  onEstimationMethodChange: (v: string) => void;
  /** Shown under the estimated field. Defaults to an emissions-flavoured example. */
  placeholder?: string;
  error?: string;
}

/**
 * How a figure was obtained: measured, calculated, or estimated.
 *
 * Three buttons rather than a dropdown, deliberately. The choice decides what
 * an assurance provider can rely on, and hiding two thirds of it behind a click
 * invites everyone to leave the default without reading the alternatives.
 *
 * Choosing "estimated" reveals a required basis field. Migration 029 enforces
 * that with a CHECK, but the raw constraint violation is unreadable, so the
 * requirement is stated here in a sentence as well.
 *
 * Extracted from EmissionDrawer so water, waste and emissions cannot drift
 * apart — an entry surface where data quality means something subtly different
 * per metric is worse than one that omits it.
 */
export function DataQualityPicker({
  value, onChange, estimationMethod, onEstimationMethodChange, placeholder, error,
}: Props) {
  const options = [
    { v: 'measured'   as const, t: 'Measured',   d: 'Metered or directly read' },
    { v: 'calculated' as const, t: 'Calculated', d: 'Activity data × a factor' },
    { v: 'estimated'  as const, t: 'Estimated',  d: 'Gap-filled' },
  ];

  return (
    <div>
      <Label>How was this figure obtained?</Label>
      <div className="grid grid-cols-3 gap-2 mt-1">
        {options.map((o) => {
          const active = value === o.v;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(o.v)}
              aria-pressed={active}
              className={
                'text-left rounded-lg border px-3 py-2 transition-colors '
                + (active
                  ? (o.v === 'estimated'
                    ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-400/20'
                    : 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/20')
                  : 'border-gray-200 bg-white hover:bg-gray-50')
              }
            >
              <span className={'block text-sm font-medium ' + (active ? 'text-gray-900' : 'text-gray-700')}>
                {o.t}
              </span>
              <span className="block text-[11px] text-gray-500 mt-0.5">{o.d}</span>
            </button>
          );
        })}
      </div>

      {value === 'estimated' && (
        <div className="mt-3">
          <Label required>How was it estimated?</Label>
          <Input
            value={estimationMethod}
            onChange={(e) => onEstimationMethodChange(e.target.value)}
            placeholder={placeholder ?? 'e.g. prior-year consumption scaled by production volume'}
            error={error}
          />
          <p className="text-xs text-amber-700 mt-1">
            Required. An estimate without its basis cannot be assured — and this is the
            field an auditor will sample.
          </p>
        </div>
      )}
    </div>
  );
}
