'use client';

import { cn } from '@/lib/utils';
import { InfoBubble } from '@/components/ui/info-bubble';
import type { RegulatoryFramework } from '@/lib/regulatory-crosswalk-core';

/**
 * Framework identity.
 *
 * One colour per publishing body, used in every place that body appears — the
 * key, the filter, the card spine, the crosswalk. The colour is not decoration:
 * it is the only thing that lets a reader see at a glance that five differently
 * named workstreams are all the GHG Protocol rewriting itself, which is the
 * fact the flat list buried.
 *
 * Colours are data (`regulatory_frameworks.accent_color`, seeded by the content
 * pack), not code, so a deploying team retunes the palette without a release.
 */

/** Used where a framework has no colour of its own, and for "all frameworks". */
export const NEUTRAL_ACCENT = '#94A3B8';

export function FrameworkDot({ color, size = 9 }: { color?: string | null; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block flex-shrink-0 rounded-[3px]"
      style={{ width: size, height: size, backgroundColor: color ?? NEUTRAL_ACCENT }}
    />
  );
}

/**
 * The standing colour key.
 *
 * Hidden below `xl` rather than wrapped: at narrow widths it costs more vertical
 * space than the orientation is worth, and every dot it explains still sits
 * beside its own label everywhere else on the page.
 */
export function FrameworkKey({ frameworks }: { frameworks: RegulatoryFramework[] }) {
  if (frameworks.length === 0) return null;

  return (
    <div className="hidden xl:flex items-center gap-3 rounded-lg border border-gray-200 bg-slate-50 px-3 py-1.5">
      {frameworks.map((f) => (
        <span
          key={f.code}
          title={`${f.name} — ${f.publisher}`}
          className="inline-flex items-center gap-1.5 whitespace-nowrap text-[10.5px] font-bold text-slate-600"
        >
          <FrameworkDot color={f.accent_color} size={8} />
          {f.short_name ?? f.name}
        </span>
      ))}
      <InfoBubble label="What the framework colours mean" title="Framework colours">
        <p>
          Each publishing body keeps the same colour in every view — the filter, the
          entry spine, the crosswalk map. A colour identifies who publishes a rule,
          not how urgent it is.
        </p>
        <p>
          Bodies with several live workstreams share one colour across all of them,
          which is how five separately named GHG Protocol revisions read as one body
          rewriting itself rather than five unrelated rules.
        </p>
      </InfoBubble>
    </div>
  );
}

/**
 * Framework filter.
 *
 * "All" first and always present. A framework with no matching workstreams is
 * still listed rather than hidden, because here an empty result is information —
 * it says this body has nothing under the current filters, which is different
 * from the body not being tracked.
 */
export function FrameworkFilter({
  frameworks, counts, value, onChange,
}: {
  frameworks: RegulatoryFramework[];
  counts: Record<string, number>;
  value: string;
  onChange: (code: string) => void;
}) {
  if (frameworks.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <FrameworkFilterChip
        active={value === 'all'} onClick={() => onChange('all')}
        color={NEUTRAL_ACCENT} label="All frameworks"
      />
      {frameworks.map((f) => (
        <FrameworkFilterChip
          key={f.code}
          active={value === f.code}
          onClick={() => onChange(f.code)}
          color={f.accent_color}
          label={f.short_name ?? f.name}
          title={`${f.name} — ${f.publisher}`}
          count={counts[f.code] ?? 0}
        />
      ))}
    </div>
  );
}

function FrameworkFilterChip({
  active, onClick, color, label, title, count,
}: {
  active: boolean;
  onClick: () => void;
  color?: string | null;
  label: string;
  title?: string;
  count?: number;
}) {
  const accent = color ?? NEUTRAL_ACCENT;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors',
        active
          ? 'bg-gray-100 font-semibold text-gray-900'
          : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
      )}
      // The framework's own colour as a left indicator rather than a fill: on
      // light chrome a full-strength fill leaves the label unreadable.
      style={active ? { boxShadow: `inset 3px 0 0 ${accent}` } : undefined}
    >
      <FrameworkDot color={accent} size={8} />
      {label}
      {count !== undefined && (
        <span className="tabular-nums text-[10px] text-gray-400">{count}</span>
      )}
    </button>
  );
}

/**
 * The header a group of workstreams sits under, tinted with its framework's
 * colour at low alpha so the tint reads as identity rather than as a state.
 */
export function FrameworkHeader({ framework }: { framework: RegulatoryFramework }) {
  const accent = framework.accent_color ?? NEUTRAL_ACCENT;
  return (
    <div
      className="rounded-xl border px-5 py-4"
      style={{
        borderLeft: `4px solid ${accent}`,
        borderColor: `${accent}3a`,
        borderLeftColor: accent,
        backgroundColor: `${accent}12`,
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[17px] font-semibold text-gray-900">{framework.name}</h2>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {framework.publisher}
        </span>
      </div>
      {framework.tagline && (
        <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{framework.tagline}</p>
      )}
      {framework.status_headline && (
        <p className="mt-2.5 text-[12.5px] font-medium text-gray-900">
          Status: {framework.status_headline}
        </p>
      )}
    </div>
  );
}
