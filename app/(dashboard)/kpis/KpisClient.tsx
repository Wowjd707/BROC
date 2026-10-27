'use client';

import {
  isDivertedWaste, isRenewableElectricity, isElectricitySource,
} from '@/lib/source-labels';
import {
  boundaryMap, shareForEntry, isWholeBoundary, CONSOLIDATION_LABELS,
  type ConsolidationApproach,
} from '@/lib/consolidation-core';

import { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fmt, fmtAxis, pctChange, reportingYearRange } from '@/lib/utils';
import { latestEntryMonth, samePeriodLastYear } from '@/lib/period-compare-core';
import { useUnits, UnitToggle } from '@/components/layout/UnitPreferences';
import { formatCarbon, formatWater, formatWaste, formatEnergy, convertForDisplay, unitLabel } from '@/lib/units';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmissionRow {
  scope: string;
  co2e_kg: number;
  co2e_kg_location_based: number | null;
  accounting_method: string | null;
  source_type: string;
  site_id: string;
  entry_date: string;
  unit_normalized: string | null;
  quantity_normalized: number | null;
}

interface EhsRow {
  metric_type: string;
  source_type: string | null;
  quantity_normalized: number | null;
  unit_normalized: string | null;
  /** Null for entity-level governance metrics, which belong to no site. */
  site_id: string | null;
  entry_date: string;
}

interface Site {
  id: string;
  name: string;
  floor_area_sqft: number | null;
  ownership_percent?: number | null;
  is_controlled?: boolean | null;
}

interface Props {
  scopeLabel: string;
  currentYear: number;
  priorYear: number;
  fyStart: number;
  curEmissions: EmissionRow[];
  priorEmissions: EmissionRow[];
  curEhs: EhsRow[];
  priorEhs: EhsRow[];
  sites: Site[];
  consolidationApproach: ConsolidationApproach;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function getS2Co2e(row: EmissionRow, method: 'market' | 'location'): number {
  if (row.scope !== 'scope2') return 0;
  if (method === 'location') return row.co2e_kg_location_based ?? row.co2e_kg;
  return row.co2e_kg;
}

function totalEmissions(rows: EmissionRow[], method: 'market' | 'location'): number {
  return rows.reduce((sum, r) => {
    if (r.scope === 'scope1') return sum + r.co2e_kg;
    if (r.scope === 'scope2') return sum + getS2Co2e(r, method);
    return sum;
  }, 0);
}

function totalEhsQty(rows: EhsRow[], metricType: string): number {
  return rows
    .filter(r => r.metric_type === metricType)
    .reduce((sum, r) => sum + (r.quantity_normalized ?? 0), 0);
}

/** kWh for scope2 electricity */
function totalKwh(rows: EmissionRow[]): number {
  return rows
    // 'kWh', not 'kwh' — conversions.ts writes the mixed-case form, so the
    // lower-case comparison here matched nothing and energy intensity was
    // permanently blank.
    .filter(r => r.scope === 'scope2' && isElectricitySource(r.source_type) && r.unit_normalized === 'kWh')
    .reduce((sum, r) => sum + (r.quantity_normalized ?? 0), 0);
}

/** % of scope2 kWh from renewable instruments */
function renewablePct(rows: EmissionRow[]): number {
  const elec = rows.filter(r => r.scope === 'scope2' && isElectricitySource(r.source_type));
  const totalKwhVal = elec.reduce((s, r) => s + (r.quantity_normalized ?? 0), 0);
  const renewKwh = elec
    .filter(r => isRenewableElectricity(r.source_type))
    .reduce((s, r) => s + (r.quantity_normalized ?? 0), 0);
  if (totalKwhVal === 0) return 0;
  return (renewKwh / totalKwhVal) * 100;
}

function wasteDiversionRate(rows: EhsRow[]): number {
  const waste = rows.filter(r => r.metric_type === 'waste');
  const total = waste.reduce((s, r) => s + (r.quantity_normalized ?? 0), 0);
  const diverted = waste
    .filter(r => isDivertedWaste(r.source_type))
    .reduce((s, r) => s + (r.quantity_normalized ?? 0), 0);
  if (total === 0) return 0;
  return (diverted / total) * 100;
}

// Monthly data for the trend chart
/**
 * Month index (0–11) of a `YYYY-MM-DD` date, read from the string.
 * `new Date('2026-03-01').getMonth()` parses as UTC midnight and so returns
 * February anywhere west of Greenwich, moving every entry dated the 1st into
 * the previous month.
 */
function monthIndexOf(entryDate: string): number {
  return Number(entryDate.slice(5, 7)) - 1;
}

/**
 * Monthly totals in the display unit. A month with no entries is null — a gap
 * in the line — never zero, which would read as emissions stopping.
 */
function buildMonthlyTrend(
  curRows: EmissionRow[],
  priorRows: EmissionRow[],
  fyStart: number,
  method: 'market' | 'location',
  toDisplay: (kg: number) => number,
): { month: string; current: number | null; prior: number | null }[] {
  const months = Array.from({ length: 12 }, (_, i) => (fyStart - 1 + i) % 12);
  const total = (rows: EmissionRow[], m: number) => {
    const inMonth = rows.filter(r => monthIndexOf(r.entry_date) === m);
    if (inMonth.length === 0) return null;
    const kg = inMonth.reduce((s, r) => s + (r.scope === 'scope1' ? r.co2e_kg : getS2Co2e(r, method)), 0);
    return Math.round(toDisplay(kg) * 100) / 100;
  };
  return months.map((m) => ({ month: MONTHS[m], current: total(curRows, m), prior: total(priorRows, m) }));
}

// Site-level KPI rollup
function buildSiteKpis(
  curEmissions: EmissionRow[],
  curEhs: EhsRow[],
  sites: Site[],
  method: 'market' | 'location',
) {
  return sites.map(site => {
    const emRows = curEmissions.filter(r => r.site_id === site.id);
    const ehsRows = curEhs.filter(r => r.site_id === site.id);
    const sqft = site.floor_area_sqft ?? 0;

    const totalCo2e = totalEmissions(emRows, method);
    const kwh = totalKwh(emRows);
    const water = totalEhsQty(ehsRows, 'water');
    const wasteTotal = totalEhsQty(ehsRows.filter(r => r.metric_type === 'waste'), 'waste');
    const divRate = wasteDiversionRate(ehsRows);
    const renew = renewablePct(emRows);

    return {
      id: site.id,
      name: site.name,
      sqft,
      totalCo2e,
      emissionsIntensity: sqft > 0 ? totalCo2e / sqft : null,
      euiKwhPerSqft: sqft > 0 && kwh > 0 ? kwh / sqft : null,
      waterIntensity: sqft > 0 && water > 0 ? water / sqft : null,
      wasteDiversionRate: divRate,
      renewablePct: renew,
      kwh,
      water,
    };
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  unit,
  change,
  comparedTo = 'prior year',
  tooltip,
}: {
  label: string;
  value: string;
  unit?: string;
  change?: { label: string; direction: 'up' | 'down' | 'flat' };
  /** What the change is measured against, e.g. "Jan–Jul 2025". */
  comparedTo?: string;
  tooltip?: string;
}) {
  const changeColor =
    change?.direction === 'down'
      ? 'text-emerald-600'
      : change?.direction === 'up'
      ? 'text-red-500'
      : 'text-gray-400';

  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
        <div className="flex items-end gap-1.5">
          <span className="text-2xl font-bold text-gray-900">{value}</span>
          {unit && <span className="text-sm text-gray-500 mb-0.5">{unit}</span>}
        </div>
        {change && (
          <p className={`text-xs mt-1 font-medium ${changeColor}`}>
            {change.label} vs {comparedTo}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A coloured badge. `tone` says whether the figure is good or bad; `arrow`
 * says which way it moved. They are separate because "higher is better" metrics
 * (diversion, renewables) used to borrow the emissions convention, so a rising
 * diversion rate — or a flat one — rendered with a down arrow.
 */
function TrendBadge({ tone, arrow = 'none', label }: {
  tone: 'good' | 'bad' | 'neutral';
  arrow?: 'up' | 'down' | 'none';
  label: string;
}) {
  const glyph = arrow === 'up' ? ' ↑' : arrow === 'down' ? ' ↓' : '';
  const variant = tone === 'good' ? 'default' : tone === 'bad' ? 'destructive' : 'secondary';
  return <Badge variant={variant} className="text-xs">{label}{glyph}</Badge>;
}

/** Badge props for a percentage change where lower is better (emissions, water, waste). */
function lowerIsBetter(chg: { label: string; direction: 'up' | 'down' | 'flat' }) {
  return {
    label: chg.label,
    tone: chg.direction === 'down' ? 'good' : chg.direction === 'up' ? 'bad' : 'neutral',
    arrow: chg.direction === 'flat' ? 'none' : chg.direction,
  } as const;
}

/** A change in percentage points where higher is better (diversion, renewables). */
function pointsChange(cur: number, prior: number) {
  const d = Math.round((cur - prior) * 10) / 10;
  return {
    label: `${d > 0 ? '+' : ''}${d.toFixed(1)} pts`,
    // KpiCard colours 'down' green; for these metrics an increase is the good direction.
    direction: (d > 0 ? 'down' : d < 0 ? 'up' : 'flat') as 'up' | 'down' | 'flat',
    tone: (d > 0 ? 'good' : d < 0 ? 'bad' : 'neutral') as 'good' | 'bad' | 'neutral',
    arrow: (d > 0 ? 'up' : d < 0 ? 'down' : 'none') as 'up' | 'down' | 'none',
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function KpisClient({
  scopeLabel,
  currentYear,
  priorYear,
  fyStart,
  curEmissions: rawCurEmissions,
  priorEmissions: rawPriorEmissions,
  curEhs,
  priorEhs: priorEhsFull,
  sites,
  consolidationApproach,
}: Props) {
  const { units } = useUnits();
  const [s2Method, setS2Method] = useState<'market' | 'location'>('market');

  // ── Organizational boundary ────────────────────────────────────────────────
  // Applied once, here, by scaling the rows — so every metric below, and the
  // per-site table, sees the same consolidated figures the report does. Scaling
  // at the source rather than inside each calculation is what stops this page
  // and the filed inventory drifting apart, which is a mistake this codebase
  // has already made once with the waste and renewable definitions.
  //
  // With the defaults (operational control, wholly owned) every share is 1 and
  // this is an identity map, so nothing changes for most deployments.
  const boundaries = useMemo(
    () => boundaryMap(sites.map((x) => ({
      id: x.id,
      ownership_percent: Number(x.ownership_percent ?? 100),
      is_controlled: x.is_controlled ?? true,
    }))),
    [sites],
  );
  const boundaryIsWhole = useMemo(
    () => isWholeBoundary(
      sites.map((x) => ({
        id: x.id,
        ownership_percent: Number(x.ownership_percent ?? 100),
        is_controlled: x.is_controlled ?? true,
      })),
      consolidationApproach,
    ),
    [sites, consolidationApproach],
  );

  const scaleEmissions = useMemo(() => (rows: EmissionRow[]): EmissionRow[] => {
    if (boundaryIsWhole) return rows;
    return rows.map((r) => {
      const share = shareForEntry(r.site_id ?? null, boundaries, consolidationApproach);
      if (share === 1) return r;
      return {
        ...r,
        co2e_kg: (r.co2e_kg ?? 0) * share,
        co2e_kg_location_based: r.co2e_kg_location_based == null
          ? r.co2e_kg_location_based
          : r.co2e_kg_location_based * share,
        quantity_normalized: (r.quantity_normalized ?? 0) * share,
      };
    });
  }, [boundaries, consolidationApproach, boundaryIsWhole]);

  const curEmissions = useMemo(() => scaleEmissions(rawCurEmissions), [scaleEmissions, rawCurEmissions]);
  // The whole prior year, for the trend chart's dashed line.
  const priorEmissionsFull = useMemo(() => scaleEmissions(rawPriorEmissions), [scaleEmissions, rawPriorEmissions]);

  // ── Like-for-like comparison ───────────────────────────────────────────────
  // Every "vs prior year" figure compares the same span: the prior year cut to
  // the months the current year has data for. See lib/period-compare-core.ts.
  const priorRange = useMemo(() => reportingYearRange(priorYear, fyStart), [priorYear, fyStart]);
  const emCmp = useMemo(
    () => samePeriodLastYear(priorEmissionsFull, latestEntryMonth(curEmissions), priorRange),
    [priorEmissionsFull, curEmissions, priorRange],
  );
  const ehsCmp = useMemo(
    () => samePeriodLastYear(priorEhsFull, latestEntryMonth(curEhs), priorRange),
    [priorEhsFull, curEhs, priorRange],
  );
  const priorEmissions = emCmp.prior;
  const priorEhs = ehsCmp.prior;

  // ── Org-level metrics ──────────────────────────────────────────────────────
  const curTotal = useMemo(() => totalEmissions(curEmissions, s2Method), [curEmissions, s2Method]);
  const priorTotal = useMemo(() => totalEmissions(priorEmissions, s2Method), [priorEmissions, s2Method]);
  const curWater = useMemo(() => totalEhsQty(curEhs, 'water'), [curEhs]);
  const priorWater = useMemo(() => totalEhsQty(priorEhs, 'water'), [priorEhs]);
  const curWaste = useMemo(() => totalEhsQty(curEhs.filter(r => r.metric_type === 'waste'), 'waste'), [curEhs]);
  const priorWaste = useMemo(() => totalEhsQty(priorEhs.filter(r => r.metric_type === 'waste'), 'waste'), [priorEhs]);
  const curDivRate = useMemo(() => wasteDiversionRate(curEhs), [curEhs]);
  const priorDivRate = useMemo(() => wasteDiversionRate(priorEhs), [priorEhs]);
  const curRenew = useMemo(() => renewablePct(curEmissions), [curEmissions]);
  const priorRenew = useMemo(() => renewablePct(priorEmissions), [priorEmissions]);
  const curKwh = useMemo(() => totalKwh(curEmissions), [curEmissions]);
  const priorKwh = useMemo(() => totalKwh(priorEmissions), [priorEmissions]);

  // Total floor area
  const totalSqft = useMemo(() => sites.reduce((s, x) => s + (x.floor_area_sqft ?? 0), 0), [sites]);

  // Intensity metrics (org level)
  const curIntensity = totalSqft > 0 ? curTotal / totalSqft : null;
  const priorIntensity = totalSqft > 0 ? priorTotal / totalSqft : null;
  const curEui = totalSqft > 0 && curKwh > 0 ? curKwh / totalSqft : null;
  const priorEui = totalSqft > 0 && priorKwh > 0 ? priorKwh / totalSqft : null;
  const curWaterInt = totalSqft > 0 && curWater > 0 ? curWater / totalSqft : null;
  const priorWaterInt = totalSqft > 0 && priorWater > 0 ? priorWater / totalSqft : null;

  // Intensities follow the unit preferences like every other figure on the page
  // (water intensity was fixed to gallons even with m³ selected).
  const waterIntUnit = `${unitLabel('water', units.water)}/ft²`;
  const fmtWaterInt = (galPerSqft: number) => {
    const v = convertForDisplay(galPerSqft, 'water', units.water);
    return v >= 1 ? v.toFixed(2) : v.toPrecision(3);
  };
  /** Emissions intensity in kg CO₂e per ft². */
  const fmtEmInt = (kgPerSqft: number) => fmt(kgPerSqft, kgPerSqft >= 10 ? 1 : 2);

  // Trend chart
  const carbonUnit = unitLabel('carbon', units.carbon);
  const trendData = useMemo(
    () => buildMonthlyTrend(
      curEmissions, priorEmissionsFull, fyStart, s2Method,
      (kg) => convertForDisplay(kg, 'carbon', units.carbon),
    ),
    [curEmissions, priorEmissionsFull, fyStart, s2Method, units.carbon],
  );

  // Site KPIs
  const siteKpis = useMemo(
    () => buildSiteKpis(curEmissions, curEhs, sites, s2Method),
    [curEmissions, curEhs, sites, s2Method],
  );

  // Bar chart data: intensity by site
  const siteBarData = siteKpis
    .filter(s => s.emissionsIntensity !== null)
    .map(s => ({ name: s.name, intensity: parseFloat(s.emissionsIntensity!.toFixed(2)) }))
    .sort((a, b) => b.intensity - a.intensity);

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];

  return (
    <div className="p-6 lg:p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">KPI Tracker</h1>
          <p className="text-sm text-gray-500 mt-0.5">{scopeLabel} · Reporting year {currentYear}</p>
        </div>
        <UnitToggle families={['carbon', 'water', 'waste', 'energy']} />
        {/* Scope 2 method toggle */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setS2Method('market')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              s2Method === 'market'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Market-Based
          </button>
          <button
            onClick={() => setS2Method('location')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              s2Method === 'location'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Location-Based
          </button>
        </div>
      </div>

      {/* ── Org-Level KPI Cards ── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Organization-Wide Metrics
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Total GHG Emissions"
            value={formatCarbon(curTotal, units)}
            change={priorTotal > 0 ? pctChange(curTotal, priorTotal) : undefined}
            comparedTo={emCmp.label}
          />
          <KpiCard
            label="Emissions Intensity"
            value={curIntensity != null ? fmtEmInt(curIntensity) : '—'}
            unit={curIntensity != null ? 'kg CO₂e/ft²' : undefined}
            change={
              curIntensity != null && priorIntensity != null
                ? pctChange(curIntensity, priorIntensity)
                : undefined
            }
            comparedTo={emCmp.label}
          />
          <KpiCard
            label="Energy Use Intensity"
            value={curEui != null ? curEui.toFixed(1) : '—'}
            unit={curEui != null ? 'kWh/ft²' : undefined}
            change={
              curEui != null && priorEui != null ? pctChange(curEui, priorEui) : undefined
            }
            comparedTo={emCmp.label}
          />
          <KpiCard
            label="Renewable Energy"
            value={`${curRenew.toFixed(1)}%`}
            change={priorRenew > 0 ? pointsChange(curRenew, priorRenew) : undefined}
            comparedTo={emCmp.label}
          />
          <KpiCard
            label="Total Water Use"
            value={formatWater(curWater, units)}
            change={priorWater > 0 ? pctChange(curWater, priorWater) : undefined}
            comparedTo={ehsCmp.label}
          />
          <KpiCard
            label="Water Intensity"
            value={curWaterInt != null ? fmtWaterInt(curWaterInt) : '—'}
            unit={curWaterInt != null ? waterIntUnit : undefined}
            change={
              curWaterInt != null && priorWaterInt != null
                ? pctChange(curWaterInt, priorWaterInt)
                : undefined
            }
            comparedTo={ehsCmp.label}
          />
          <KpiCard
            label="Waste Generated"
            // formatWaste already appends the user's chosen unit, so passing
            // `unit` as well rendered "12.3 t tonnes" — and "27,000 lb tonnes"
            // for anyone whose waste preference is pounds.
            value={formatWaste(curWaste, units)}
            change={priorWaste > 0 ? pctChange(curWaste, priorWaste) : undefined}
            comparedTo={ehsCmp.label}
          />
          <KpiCard
            label="Waste Diversion Rate"
            value={`${curDivRate.toFixed(1)}%`}
            change={priorDivRate > 0 ? pointsChange(curDivRate, priorDivRate) : undefined}
            comparedTo={ehsCmp.label}
          />
        </div>
      </section>

      {/* ── Monthly Emissions Trend ── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Monthly Emissions Trend</CardTitle>
            <p className="text-xs text-gray-500">{carbonUnit} — {currentYear} vs {priorYear}</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trendData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtAxis(v)} />
                <Tooltip formatter={(v: number) => [`${v.toLocaleString('en-US')} ${carbonUnit}`, '']} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="current"
                  name={String(currentYear)}
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="prior"
                  name={String(priorYear)}
                  stroke="#d1d5db"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Emissions Intensity by Site */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Emissions Intensity by Site</CardTitle>
            <p className="text-xs text-gray-500">kg CO₂e per sq ft</p>
          </CardHeader>
          <CardContent>
            {siteBarData.length === 0 ? (
              <div className="h-[240px] flex items-center justify-center text-sm text-gray-400">
                No floor area data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={siteBarData}
                  layout="vertical"
                  margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                  <Tooltip formatter={(v: number) => [`${v} kg CO₂e/ft²`, 'Intensity']} />
                  <Bar dataKey="intensity" radius={[0, 4, 4, 0]}>
                    {siteBarData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Site-by-Site KPI Table ── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Site-by-Site Breakdown
        </h2>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Site</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Floor Area</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total CO₂e</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Intensity</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">EUI</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Water Intensity</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Diversion</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Renewable</th>
                </tr>
              </thead>
              <tbody>
                {siteKpis.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-gray-400 text-sm">
                      No site data available
                    </td>
                  </tr>
                ) : (
                  siteKpis.map((s, i) => (
                    <tr
                      key={s.id}
                      className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                        i === siteKpis.length - 1 ? 'border-b-0' : ''
                      }`}
                    >
                      <td className="px-5 py-3 font-medium text-gray-900">{s.name}</td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {s.sqft > 0 ? `${fmt(s.sqft)} ft²` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 font-medium">
                        {formatCarbon(s.totalCo2e, units)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {s.emissionsIntensity != null
                          ? `${fmtEmInt(s.emissionsIntensity)} kg/ft²`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {s.euiKwhPerSqft != null
                          ? `${s.euiKwhPerSqft.toFixed(1)} kWh/ft²`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {s.waterIntensity != null
                          ? `${fmtWaterInt(s.waterIntensity)} ${waterIntUnit}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {s.wasteDiversionRate > 0 ? (
                          <TrendBadge
                            tone={s.wasteDiversionRate >= 50 ? 'good' : 'bad'}
                            label={`${s.wasteDiversionRate.toFixed(0)}%`}
                          />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {s.renewablePct > 0 ? (
                          <TrendBadge
                            tone={s.renewablePct >= 50 ? 'good' : 'neutral'}
                            label={`${s.renewablePct.toFixed(0)}%`}
                          />
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {siteKpis.length > 1 && (
                <tfoot>
                  <tr className="bg-gray-50 border-t border-gray-200">
                    <td className="px-5 py-3 font-semibold text-gray-700">Total / Avg</td>
                    <td className="px-4 py-3 text-right text-gray-700 font-medium">
                      {totalSqft > 0 ? `${fmt(totalSqft)} ft²` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-semibold">
                      {formatCarbon(curTotal, units)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {curIntensity != null
                        ? `${fmtEmInt(curIntensity)} kg/ft²`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {curEui != null ? `${curEui.toFixed(1)} kWh/ft²` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {curWaterInt != null ? `${fmtWaterInt(curWaterInt)} ${waterIntUnit}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <TrendBadge
                        tone={curDivRate >= 50 ? 'good' : 'bad'}
                        label={`${curDivRate.toFixed(0)}%`}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <TrendBadge
                        tone={curRenew >= 50 ? 'good' : 'neutral'}
                        label={`${curRenew.toFixed(0)}%`}
                      />
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      </section>

      {/* ── YoY Summary ── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Year-over-Year Summary
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              label: 'GHG Emissions',
              cur: formatCarbon(curTotal, units),
              prior: formatCarbon(priorTotal, units),
              chg: priorTotal > 0 ? lowerIsBetter(pctChange(curTotal, priorTotal)) : null,
              vs: emCmp.label,
            },
            {
              label: 'Energy Use (Electricity)',
              cur: formatEnergy(curKwh, units),
              prior: formatEnergy(priorKwh, units),
              chg: priorKwh > 0 ? lowerIsBetter(pctChange(curKwh, priorKwh)) : null,
              vs: emCmp.label,
            },
            {
              label: 'Water Consumption',
              cur: formatWater(curWater, units),
              prior: formatWater(priorWater, units),
              chg: priorWater > 0 ? lowerIsBetter(pctChange(curWater, priorWater)) : null,
              vs: ehsCmp.label,
            },
            {
              label: 'Waste Generated',
              cur: formatWaste(curWaste, units),
              prior: formatWaste(priorWaste, units),
              chg: priorWaste > 0 ? lowerIsBetter(pctChange(curWaste, priorWaste)) : null,
              vs: ehsCmp.label,
            },
            {
              label: 'Waste Diversion Rate',
              cur: `${curDivRate.toFixed(1)}%`,
              prior: `${priorDivRate.toFixed(1)}%`,
              chg: priorDivRate > 0 ? pointsChange(curDivRate, priorDivRate) : null,
              vs: ehsCmp.label,
            },
            {
              label: 'Renewable Energy %',
              cur: `${curRenew.toFixed(1)}%`,
              prior: `${priorRenew.toFixed(1)}%`,
              chg: priorRenew > 0 ? pointsChange(curRenew, priorRenew) : null,
              vs: emCmp.label,
            },
          ].map(row => (
            <Card key={row.label}>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs font-medium text-gray-500 mb-2">{row.label}</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg font-bold text-gray-900">{row.cur}</p>
                    <p className="text-xs text-gray-400">{currentYear}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">{row.prior}</p>
                    <p className="text-xs text-gray-400">{row.vs === 'prior year' ? priorYear : row.vs}</p>
                  </div>
                </div>
                {row.chg && (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <TrendBadge tone={row.chg.tone} arrow={row.chg.arrow} label={row.chg.label} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
