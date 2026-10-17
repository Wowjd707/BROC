'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { Check, Scale, Ruler, Info } from 'lucide-react';
import {
  consolidationShare, describeBoundaryEffect,
  CONSOLIDATION_LABELS, CONSOLIDATION_DESCRIPTIONS,
  type ConsolidationApproach,
} from '@/lib/consolidation-core';
import { denominatorOptions, type BusinessMetricDefinition } from '@/lib/business-metrics-core';

interface SiteRow {
  id: string;
  name: string;
  ownership_percent: number | null;
  is_controlled: boolean | null;
}

const APPROACHES: ConsolidationApproach[] = [
  'operational_control', 'financial_control', 'equity_share',
];

/**
 * The reporting boundary — which operations count, and by how much.
 *
 * Presented as three cards rather than a dropdown because this is the single
 * most consequential setting in the platform: it decides what the totals mean,
 * an assurance provider will ask about it first, and a reader should be able to
 * see all three definitions side by side before choosing. A `<select>` hides
 * two thirds of that decision behind a click.
 */
export function BoundaryPanel({
  approach: initialApproach,
  intensityMetricKey: initialMetricKey,
  denominators,
  sites: initialSites,
  isAdmin,
}: {
  approach: ConsolidationApproach;
  intensityMetricKey: string | null;
  denominators: BusinessMetricDefinition[];
  sites: SiteRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();

  const [approach, setApproach] = useState<ConsolidationApproach>(initialApproach);
  const [metricKey, setMetricKey] = useState<string>(initialMetricKey ?? '');
  const [sites, setSites] = useState<SiteRow[]>(initialSites);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const options = useMemo(() => denominatorOptions(denominators), [denominators]);
  const chosen = options.find((o) => o.metric_key === metricKey) ?? null;

  const shaped = useMemo(() => sites.map((s) => ({
    id: s.id,
    ownership_percent: Number(s.ownership_percent ?? 100),
    is_controlled: s.is_controlled ?? true,
  })), [sites]);

  const effect = useMemo(() => describeBoundaryEffect(shaped, approach), [shaped, approach]);
  const fullCount = sites.length - effect.partialSites.length - effect.excludedSites.length;

  async function save() {
    if (!isAdmin) return;
    setSaving(true);
    try {
      const { error: orgError } = await supabase
        .from('organizations')
        .update({
          consolidation_approach: approach,
          intensity_metric_key: metricKey || null,
        })
        .not('id', 'is', null);
      if (orgError) { toast(orgError.message, 'error'); return; }

      // Only the rows that actually changed, so an unrelated edit elsewhere is
      // not clobbered by a blanket write.
      const changed = sites.filter((s, i) =>
        s.ownership_percent !== initialSites[i]?.ownership_percent
        || s.is_controlled !== initialSites[i]?.is_controlled);

      for (const s of changed) {
        const { error } = await supabase.from('sites').update({
          ownership_percent: s.ownership_percent ?? 100,
          is_controlled: s.is_controlled ?? true,
        }).eq('id', s.id);
        if (error) { toast(error.message, 'error'); return; }
      }

      setSavedAt(Date.now());
      toast('Reporting boundary saved.', 'success');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function updateSite(id: string, patch: Partial<SiteRow>) {
    setSites((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  const showOwnership = approach === 'equity_share';

  return (
    <div className="space-y-6">

      {/* ── Consolidation approach ──────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-start gap-2">
          <Scale size={16} className="text-emerald-600 mt-0.5 flex-shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Consolidation approach</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              How much of each operation&apos;s emissions are yours. The GHG Protocol requires
              you to choose one and state it; it is the first thing an assurance provider asks.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {APPROACHES.map((a) => {
            const active = approach === a;
            return (
              <button
                key={a}
                type="button"
                disabled={!isAdmin}
                onClick={() => setApproach(a)}
                className={cn(
                  'text-left rounded-xl border p-4 transition-all',
                  active
                    ? 'border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500/20'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50',
                  !isAdmin && 'opacity-60 cursor-not-allowed',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('text-sm font-medium',
                    active ? 'text-emerald-900' : 'text-gray-900')}>
                    {CONSOLIDATION_LABELS[a]}
                  </span>
                  <span className={cn(
                    'w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0',
                    active ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300',
                  )}>
                    {active && <Check size={11} className="text-white" strokeWidth={3} />}
                  </span>
                </div>
                <p className={cn('text-xs mt-1.5 leading-relaxed',
                  active ? 'text-emerald-800' : 'text-gray-500')}>
                  {CONSOLIDATION_DESCRIPTIONS[a]}
                </p>
              </button>
            );
          })}
        </div>

        {/* What the choice actually does to this organization's sites. */}
        <BoundaryEffectBar
          total={sites.length}
          full={fullCount}
          partial={effect.partialSites.length}
          excluded={effect.excludedSites.length}
          approach={approach}
        />
      </div>

      {/* ── Intensity denominator ───────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-start gap-2">
          <Ruler size={16} className="text-emerald-600 mt-0.5 flex-shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Intensity denominator</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              What emissions are reported per unit of. Most boards ask for intensity
              against revenue or headcount rather than floor area.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="denominator">Report intensity per</Label>
            <select
              id="denominator"
              value={metricKey}
              disabled={!isAdmin}
              onChange={(e) => setMetricKey(e.target.value)}
              className="mt-1 flex h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 disabled:opacity-60"
            >
              <option value="">Floor area (default)</option>
              {options.map((o) => (
                <option key={o.metric_key} value={o.metric_key}>
                  {o.label} ({o.unit})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <div className="w-full rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
              <p className="text-xs text-gray-500">Reported as</p>
              <p className="text-sm font-mono text-gray-900 mt-0.5">
                tCO₂e per {chosen ? chosen.unit : 'sq ft'}
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-500 flex items-start gap-1.5">
          <Info size={12} className="flex-shrink-0 mt-0.5 text-gray-400" />
          <span>
            Enter the figures themselves under <span className="text-gray-700">Business metrics</span>.
            Intensity is reported as missing until the chosen denominator has a value for the year —
            it is not estimated.
          </span>
        </p>
      </div>

      {/* ── Per-site ownership ──────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Operations</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {showOwnership
              ? 'Under equity share, each site contributes in proportion to your stake.'
              : 'Under a control approach, a site is included in full or not at all. Ownership is recorded but not applied.'}
          </p>
        </div>

        {sites.length === 0 ? (
          <p className="px-6 py-8 text-sm text-gray-500 text-center">
            No active sites yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="px-6 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Site</th>
                  <th className={cn('px-6 py-2.5 text-xs font-medium uppercase tracking-wide',
                    showOwnership ? 'text-gray-500' : 'text-gray-300')}>Equity stake</th>
                  <th className={cn('px-6 py-2.5 text-xs font-medium uppercase tracking-wide',
                    showOwnership ? 'text-gray-300' : 'text-gray-500')}>Controlled</th>
                  <th className="px-6 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide text-right">Contributes</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => {
                  const share = consolidationShare(
                    { ownership_percent: Number(s.ownership_percent ?? 100), is_controlled: s.is_controlled ?? true },
                    approach,
                  );
                  return (
                    <tr key={s.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-6 py-2.5 text-gray-900">{s.name}</td>
                      <td className="px-6 py-2.5">
                        <div className="flex items-center gap-1.5 max-w-[120px]">
                          <Input
                            type="number" min="0" max="100" step="0.01"
                            value={s.ownership_percent ?? 100}
                            disabled={!isAdmin || !showOwnership}
                            onChange={(e) => updateSite(s.id, { ownership_percent: Number(e.target.value) })}
                            className={cn('h-8', !showOwnership && 'opacity-50')}
                          />
                          <span className={cn('text-xs', showOwnership ? 'text-gray-500' : 'text-gray-300')}>%</span>
                        </div>
                      </td>
                      <td className="px-6 py-2.5">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={s.is_controlled ?? true}
                            disabled={!isAdmin || showOwnership}
                            onChange={(e) => updateSite(s.id, { is_controlled: e.target.checked })}
                            className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-50"
                          />
                          <span className={cn('text-xs', showOwnership ? 'text-gray-300' : 'text-gray-600')}>
                            {(s.is_controlled ?? true) ? 'Yes' : 'No'}
                          </span>
                        </label>
                      </td>
                      <td className="px-6 py-2.5 text-right">
                        <Badge variant={share === 1 ? 'default' : share === 0 ? 'destructive' : 'warning'}>
                          {(share * 100).toFixed(share === 1 || share === 0 ? 0 : 2)}%
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving || !isAdmin}>
          {saving ? 'Saving…' : 'Save boundary'}
        </Button>
        {savedAt && <span className="text-sm text-emerald-600 font-medium">Saved ✓</span>}
        {!isAdmin && <p className="text-xs text-gray-400">Only admins can change the reporting boundary.</p>}
      </div>
    </div>
  );
}

/**
 * A one-glance answer to "what did I just change".
 *
 * Chosen over a sentence because the interesting case is a group with a
 * handful of partly-owned operations, and a proportional bar makes "most of
 * the estate, minus two joint ventures" legible instantly.
 */
function BoundaryEffectBar({ total, full, partial, excluded, approach }: {
  total: number; full: number; partial: number; excluded: number;
  approach: ConsolidationApproach;
}) {
  if (total === 0) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;

  return (
    <div className="rounded-lg bg-gray-50 border border-gray-100 p-4">
      <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-200">
        {full > 0 && <div className="bg-emerald-500" style={{ width: pct(full) }} />}
        {partial > 0 && <div className="bg-amber-400" style={{ width: pct(partial) }} />}
        {excluded > 0 && <div className="bg-red-400" style={{ width: pct(excluded) }} />}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3 text-xs">
        <LegendDot colour="bg-emerald-500" label={`${full} counted in full`} />
        {partial > 0 && <LegendDot colour="bg-amber-400" label={`${partial} partly consolidated`} />}
        {excluded > 0 && <LegendDot colour="bg-red-400" label={`${excluded} excluded entirely`} />}
      </div>
      {excluded > 0 && (
        <p className="text-xs text-gray-500 mt-2">
          Excluded operations contribute nothing to Scope 1 and 2 under{' '}
          {CONSOLIDATION_LABELS[approach].toLowerCase()}. Their data is still recorded and can be
          reported separately.
        </p>
      )}
    </div>
  );
}

function LegendDot({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-gray-600">
      <span className={cn('w-2 h-2 rounded-full', colour)} />
      {label}
    </span>
  );
}
