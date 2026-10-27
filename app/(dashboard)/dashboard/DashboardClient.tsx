'use client';

import { isDivertedWaste, isRenewableElectricity, isElectricitySource } from '@/lib/source-labels';
import {
  boundaryMap, shareForEntry, isWholeBoundary,
  type ConsolidationApproach,
} from '@/lib/consolidation-core';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { pctChange, reportingYearRange, fmtAxis } from '@/lib/utils';
import { latestEntryMonth, samePeriodLastYear } from '@/lib/period-compare-core';
import { goalMeasurement, type GoalMeasurement } from '@/lib/goal-period-core';
import { useUnits, UnitToggle } from '@/components/layout/UnitPreferences';
import {
  formatCarbon, formatWater, formatWaste, formatMetric,
  convertForDisplay, unitLabel,
} from '@/lib/units';
import { summarisePipeline, gapToTarget, type PipelineProject, type PipelineMetric } from '@/lib/pipeline';
import {
  GOAL_METRICS, GOAL_METRIC_LABELS, GOAL_METRIC_FAMILY,
  asGoalMetric, computeGoalProgress, progressColor, type GoalMetric,
} from '@/lib/goal-metrics';
import { SCOPE1_CATEGORY_LABELS } from '@/lib/emission-factor-types';
import { TrendingDown, TrendingUp, Minus, Info, ArrowUpRight } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EmissionRow {
  scope: string;
  scope1_category: string | null;
  co2e_kg: number;
  co2e_kg_location_based: number | null;
  accounting_method: string;
  source_type: string;
  site_id: string;
  entry_date: string;
  unit_normalized: string;
  quantity_normalized: number;
}
interface PriorEmissionRow { scope: string; co2e_kg: number; co2e_kg_location_based: number | null; accounting_method: string; site_id: string; entry_date: string; }
// site_id is nullable: entity-level governance metrics (board composition,
// confirmed corruption incidents) belong to the organization, not a site.
interface EhsRow { metric_type: string; source_type: string; quantity_normalized: number; unit_normalized: string; site_id: string | null; entry_date: string; }
interface PriorEhsRow { metric_type: string; quantity_normalized: number; entry_date: string; }
interface Site {
  ownership_percent?: number | null;
  is_controlled?: boolean | null; id: string; name: string; floor_area_sqft: number | null; }
interface Goal {
  id: string;
  name: string;
  goal_type: string;
  metric: string | null;
  base_year: number;
  base_year_emissions_kg: number | null;
  base_year_value: number | null;
  target_year: number;
  target_value: number | null;
  progress_pct: number | null;
  scope2_accounting_method: string;
}
type Project = PipelineProject;
interface Survey { id: string; }
interface Invitation { id: string; status: string; survey_id: string; }

interface RegulatoryMilestone {
  code: string;
  name: string;
  next_milestone: string | null;
  next_milestone_date: string | null;
  stage: string;
}

interface Props {
  orgName: string;
  scopeLabel: string;
  /** True when a site/business-unit filter is narrowing the inventory figures. */
  scopeIsFiltered: boolean;
  /** The organizational boundary the report applies. Kept identical here. */
  consolidationApproach: ConsolidationApproach;
  currentYear: number;
  priorYear: number;
  fyStart: number;
  curEmissions: EmissionRow[];
  priorEmissions: PriorEmissionRow[];
  curEhs: EhsRow[];
  priorEhs: PriorEhsRow[];
  sites: Site[];
  goals: Goal[];
  projects: Project[];
  activeSurveys: Survey[];
  regulatoryMilestones: RegulatoryMilestone[];
  invitations: Invitation[];
  curScope3: Scope3Row[];
  priorScope3: Scope3Row[];
}

interface Scope3Row { category_number: number; co2e_kg: number; data_quality: string | null; entry_date: string; }

/**
 * Apply the organizational boundary (consolidation approach) to emission rows.
 * Used for BOTH years: scaling only the current year compared a boundary-
 * adjusted figure against an unadjusted one whenever a site was partly owned.
 */
function applyBoundary<T extends { site_id: string | null; co2e_kg: number; co2e_kg_location_based: number | null; quantity_normalized?: number }>(
  rows: T[], sites: Site[], approach: ConsolidationApproach,
): T[] {
  const shaped = sites.map((x) => ({
    id: x.id,
    ownership_percent: Number(x.ownership_percent ?? 100),
    is_controlled: x.is_controlled ?? true,
  }));
  if (isWholeBoundary(shaped, approach)) return rows;
  const boundaries = boundaryMap(shaped);
  return rows.map((r) => {
    const share = shareForEntry(r.site_id ?? null, boundaries, approach);
    if (share === 1) return r;
    return {
      ...r,
      co2e_kg: (r.co2e_kg ?? 0) * share,
      co2e_kg_location_based: r.co2e_kg_location_based == null ? r.co2e_kg_location_based : r.co2e_kg_location_based * share,
      ...(r.quantity_normalized === undefined ? {} : { quantity_normalized: (r.quantity_normalized ?? 0) * share }),
    };
  });
}

/** Scope 2 kg under the chosen accounting method. */
function scope2Kg(e: { co2e_kg: number; co2e_kg_location_based: number | null }, method: 'location_based' | 'market_based'): number {
  return method === 'market_based' ? e.co2e_kg : (e.co2e_kg_location_based ?? e.co2e_kg);
}

// ─── Month abbreviations ─────────────────────────────────────────────────────
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── Clickable card shell ────────────────────────────────────────────────────

/**
 * Every headline figure on the dashboard is a summary of a page that explains
 * it, so every card is a way in.
 *
 * Two shapes, because they fail differently. `CardLink` wraps a whole card and
 * suits a card that is only a number. A card carrying its own toggles cannot be
 * wrapped — the link would swallow every click on a control — so those get a
 * header link instead, via `CardTitleLink`.
 *
 * `h-full` on both: these sit in a grid where one sibling may be much taller,
 * and without it a card renders at content height inside a stretched cell,
 * which is what made the Scope 2 card look mis-sized.
 */
function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="group block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-xl">
      {children}
    </Link>
  );
}

function CardTitleLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1 text-sm font-semibold text-gray-900 hover:text-emerald-700 transition-colors"
    >
      {children}
      <ArrowUpRight size={13} className="text-gray-300 group-hover:text-emerald-600 transition-colors" />
    </Link>
  );
}

const CLICKABLE_CARD = 'h-full transition-shadow group-hover:shadow-md group-hover:border-gray-300';

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({
  title, value, subValue, change, comparedTo = 'prior year', tooltip, href,
}: {
  title: string; value: string; subValue?: string;
  change?: { value: number; direction: 'up' | 'down' | 'flat'; label: string };
  /** What the change is measured against, e.g. "Jan–Jul 2025". */
  comparedTo?: string;
  tooltip?: string;
  /** Where this figure is explained in full. */
  href?: string;
}) {
  const changeColor = change?.direction === 'down' ? 'text-emerald-600' : change?.direction === 'up' ? 'text-red-500' : 'text-gray-400';
  const ChangeIcon = change?.direction === 'down' ? TrendingDown : change?.direction === 'up' ? TrendingUp : Minus;

  const card = (
    <Card className={href ? CLICKABLE_CARD : 'h-full'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          {title}
          {tooltip && (
            <span title={tooltip} className="text-gray-300 cursor-help"><Info size={12} /></span>
          )}
          {href && (
            <ArrowUpRight
              size={13}
              className="ml-auto text-gray-300 group-hover:text-emerald-600 transition-colors"
            />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {subValue && <p className="text-sm text-gray-500 mt-0.5">{subValue}</p>}
        {change && (
          <div className={`flex items-center gap-1 mt-1.5 text-xs font-medium ${changeColor}`}>
            <ChangeIcon size={12} />
            {change.label} vs {comparedTo}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return href ? <CardLink href={href}>{card}</CardLink> : card;
}

// ─── Main component ──────────────────────────────────────────────────────────
export function DashboardClient({
  orgName, scopeLabel, scopeIsFiltered, consolidationApproach, currentYear, priorYear, fyStart,
  curEmissions: rawCurEmissions, priorEmissions: rawPriorEmissions, curEhs, priorEhs,
  sites, goals, projects, activeSurveys, invitations,
  curScope3, priorScope3, regulatoryMilestones,
}: Props) {
  const { units } = useUnits();
  const [scope2Method, setScope2Method] = useState<'location_based' | 'market_based'>('location_based');
  // Read once per mount, so "days until" is stable across re-renders.
  const [nowMs] = useState(() => Date.now());

  // The same organizational boundary the report and the KPI page apply, done
  // once by scaling the rows so every card below agrees with the filed figure.
  // An identity map under the defaults.
  const curEmissions = useMemo(
    () => applyBoundary(rawCurEmissions, sites, consolidationApproach),
    [rawCurEmissions, sites, consolidationApproach],
  );
  const priorEmissions = useMemo(
    () => applyBoundary(rawPriorEmissions, sites, consolidationApproach),
    [rawPriorEmissions, sites, consolidationApproach],
  );
  const [pipelineMetric, setPipelineMetric] = useState<PipelineMetric>('ghg');
  const [goalMetric, setGoalMetric] = useState<GoalMetric>('ghg');
  const [goalIndex, setGoalIndex] = useState(0);

  // ── Aggregate KPIs ──────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const scope1Cur   = curEmissions.filter((e) => e.scope === 'scope1').reduce((s, e) => s + e.co2e_kg, 0);
    // Like-for-like: the prior year cut to the months the current year has
    // data for. See lib/period-compare-core.ts.
    const priorRange = reportingYearRange(priorYear, fyStart);
    const emCmp = samePeriodLastYear(priorEmissions, latestEntryMonth(curEmissions), priorRange);
    const ehsCmp = samePeriodLastYear(priorEhs, latestEntryMonth(curEhs), priorRange);
    const s3Cmp = samePeriodLastYear(priorScope3, latestEntryMonth(curScope3), priorRange);

    const scope1Prior = emCmp.prior.filter((e) => e.scope === 'scope1').reduce((s, e) => s + e.co2e_kg, 0);

    const scope2LocationCur = curEmissions
      .filter((e) => e.scope === 'scope2')
      .reduce((s, e) => s + (e.co2e_kg_location_based ?? e.co2e_kg), 0);
    const scope2MarketCur = curEmissions
      .filter((e) => e.scope === 'scope2')
      .reduce((s, e) => s + e.co2e_kg, 0);
    const scope2Cur = scope2Method === 'market_based' ? scope2MarketCur : scope2LocationCur;

    // The same accounting method as the current figure — comparing a
    // location-based year against a market-based one measures the method.
    const scope2Prior = emCmp.prior.filter((e) => e.scope === 'scope2').reduce((s, e) => s + scope2Kg(e, scope2Method), 0);

    const totalCur   = scope1Cur + scope2Cur;
    const totalPrior = scope1Prior + scope2Prior;

    const waterCur   = curEhs.filter((e) => e.metric_type === 'water').reduce((s, e) => s + e.quantity_normalized, 0);
    const waterPrior = ehsCmp.prior.filter((e) => e.metric_type === 'water').reduce((s, e) => s + e.quantity_normalized, 0);

    const wasteAll     = curEhs.filter((e) => e.metric_type === 'waste');
    const wasteTotal   = wasteAll.reduce((s, e) => s + e.quantity_normalized, 0);
    const wasteDiverted = wasteAll
      .filter((e) => isDivertedWaste(e.source_type))
      .reduce((s, e) => s + e.quantity_normalized, 0);
    // null, not 0, with no waste recorded: "0% diverted" is a claim about
    // waste that was never measured.
    const diversionRate = wasteTotal > 0 ? (wasteDiverted / wasteTotal) * 100 : null;

    const wastePriorTotal = ehsCmp.prior.filter((e) => e.metric_type === 'waste').reduce((s, e) => s + e.quantity_normalized, 0);

    // Electricity kWh for renewable % calc
    const elecTotal = curEmissions
      .filter((e) => e.scope === 'scope2' && isElectricitySource(e.source_type))
      .reduce((s, e) => s + e.quantity_normalized, 0);
    const renewableGenerated = curEmissions
      .filter((e) => isRenewableElectricity(e.source_type))
      .reduce((s, e) => s + e.quantity_normalized, 0);
    const renewablePct = elecTotal > 0 ? (renewableGenerated / elecTotal) * 100 : null;

    // Scope 3 is reported alongside, never folded into totalCur: goals and the
    // "Total Scope 1 + 2" card are defined on the operational boundary.
    const scope3Cur   = curScope3.reduce((s, e) => s + e.co2e_kg, 0);
    const scope3Prior = s3Cmp.prior.reduce((s, e) => s + e.co2e_kg, 0);
    const scope3Categories = new Set(curScope3.map((e) => e.category_number)).size;
    const scope3PrimaryKg = curScope3
      .filter((e) => e.data_quality === 'primary')
      .reduce((s, e) => s + e.co2e_kg, 0);
    const scope3PrimaryPct = scope3Cur > 0 ? (scope3PrimaryKg / scope3Cur) * 100 : 0;
    const footprintCur = totalCur + scope3Cur;

    return {
      totalCur, totalPrior, scope1Cur, scope1Prior,
      scope2LocationCur, scope2MarketCur, scope2Cur, scope2Prior,
      scope3Cur, scope3Prior, scope3Categories, scope3PrimaryPct, footprintCur,
      waterCur, waterPrior, wasteTotal, wastePriorTotal, diversionRate, renewablePct,
      emissionsVs: emCmp.label, ehsVs: ehsCmp.label, scope3Vs: s3Cmp.label,
    };
  }, [curEmissions, priorEmissions, curEhs, priorEhs, curScope3, priorScope3, scope2Method, priorYear, fyStart]);

  // ── Scope 1 by GHG Protocol source category ─────────────────────────────
  // Unclassified entries are shown rather than hidden: the gap is actionable,
  // and silently omitting them would make the split look complete when it isn't.
  const scope1ByCategory = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const e of curEmissions) {
      if (e.scope !== 'scope1') continue;
      const key = e.scope1_category ?? 'unclassified';
      buckets.set(key, (buckets.get(key) ?? 0) + e.co2e_kg);
    }
    const order = ['stationary_combustion', 'mobile_combustion', 'process_emissions', 'fugitive_emissions', 'unclassified'];
    return order
      .filter((k) => buckets.has(k))
      .map((k) => ({
        key: k,
        label: k === 'unclassified' ? 'Unclassified' : SCOPE1_CATEGORY_LABELS[k] ?? k,
        kg: buckets.get(k)!,
      }));
  }, [curEmissions]);

  // ── Monthly trend data (current + prior year) ───────────────────────────
  const trendData = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => {
      const monthIndex = ((fyStart - 1 + i) % 12);
      return {
        month: MONTHS_SHORT[monthIndex], monthIndex,
        s1Cur: 0, s2Cur: 0, s1Prior: 0, s2Prior: 0,
        // Whether any entry exists — a month with none is missing, not zero.
        has: { s1Cur: false, s2Cur: false, s1Prior: false, s2Prior: false },
      };
    });

    function entryMonthOffset(dateStr: string) {
      const m = parseInt(dateStr.split('-')[1], 10) - 1; // 0-indexed
      const offset = (m - (fyStart - 1) + 12) % 12;
      return offset;
    }

    curEmissions.forEach((e) => {
      const offset = entryMonthOffset(e.entry_date);
      if (offset < 12) {
        if (e.scope === 'scope1') { months[offset].s1Cur += e.co2e_kg; months[offset].has.s1Cur = true; }
        else { months[offset].s2Cur += scope2Kg(e, scope2Method); months[offset].has.s2Cur = true; }
      }
    });

    priorEmissions.forEach((e) => {
      const offset = entryMonthOffset(e.entry_date);
      if (offset < 12) {
        if (e.scope === 'scope1') { months[offset].s1Prior += e.co2e_kg; months[offset].has.s1Prior = true; }
        else { months[offset].s2Prior += scope2Kg(e, scope2Method); months[offset].has.s2Prior = true; }
      }
    });

    // Plotted in the user's chosen carbon unit — tonnes by default — so the
    // charts agree with the KPI cards above them. Rounding happens after the
    // conversion; rounding kg first and dividing would lose the decimals that
    // make a small site's month visible at all.
    // A month with no entries plots as a gap (null), never as zero: drawing
    // unentered months at zero reads as emissions stopping.
    const toDisplay = (kg: number, present: boolean) => {
      if (!present) return null;
      const v = convertForDisplay(kg, 'carbon', units.carbon);
      return Math.round(v * 100) / 100;
    };

    return months.map((m) => ({
      month: m.month,
      'Scope 1 (Current)': toDisplay(m.s1Cur, m.has.s1Cur),
      'Scope 2 (Current)': toDisplay(m.s2Cur, m.has.s2Cur),
      'Scope 1 (Prior)': toDisplay(m.s1Prior, m.has.s1Prior),
      'Scope 2 (Prior)': toDisplay(m.s2Prior, m.has.s2Prior),
    }));
  }, [curEmissions, priorEmissions, fyStart, scope2Method, units.carbon]);

  const carbonUnitLabel = unitLabel('carbon', units.carbon);

  // ── Emissions by site ────────────────────────────────────────────────────
  const siteData = useMemo(() => {
    const bySite: Record<string, number> = {};
    curEmissions.forEach((e) => {
      bySite[e.site_id] = (bySite[e.site_id] ?? 0) + e.co2e_kg;
    });
    return sites
      .map((s) => ({
        name: s.name,
        co2e: Math.round(convertForDisplay(bySite[s.id] ?? 0, 'carbon', units.carbon) * 100) / 100,
      }))
      .filter((s) => s.co2e > 0)
      .sort((a, b) => b.co2e - a.co2e);
  }, [curEmissions, sites, units.carbon]);

  // ── Measured current value per metric, in canonical stored units ─────────
  // Goals and the pipeline are both denominated this way, so all three compare
  // without a conversion step that could drift.
  // Goals are judged on the latest complete reporting year, falling back to
  // the year to date (flagged partial) only when that year has no data. See
  // lib/goal-period-core.ts — a part year against an annual target always
  // looks on track.
  const goalMeasurements = useMemo<Record<GoalMetric, GoalMeasurement | null>>(() => {
    const s12Prior = priorEmissions.filter((e) => e.scope === 'scope1' || e.scope === 'scope2');
    const ghgPrior = s12Prior.length === 0 ? null : s12Prior.reduce(
      (sum, e) => sum + (e.scope === 'scope2' ? scope2Kg(e, scope2Method) : e.co2e_kg), 0);
    const ehsPrior = (metric: string) => {
      const rows = priorEhs.filter((e) => e.metric_type === metric);
      return rows.length === 0 ? null : rows.reduce((sum, e) => sum + e.quantity_normalized, 0);
    };
    const hasCur = (metric: string) => curEhs.some((e) => e.metric_type === metric);
    const hasCurGhg = curEmissions.some((e) => e.scope === 'scope1' || e.scope === 'scope2');
    return {
      ghg: goalMeasurement(priorYear, ghgPrior, currentYear, hasCurGhg ? kpis.totalCur : null),
      water: goalMeasurement(priorYear, ehsPrior('water'), currentYear, hasCur('water') ? kpis.waterCur : null),
      waste: goalMeasurement(priorYear, ehsPrior('waste'), currentYear, hasCur('waste') ? kpis.wasteTotal : null),
    };
  }, [priorEmissions, priorEhs, curEmissions, curEhs, scope2Method, priorYear, currentYear, kpis.totalCur, kpis.waterCur, kpis.wasteTotal]);

  const currentByMetric = useMemo<Record<GoalMetric, number>>(() => ({
    ghg: goalMeasurements.ghg?.value ?? 0,
    water: goalMeasurements.water?.value ?? 0,
    waste: goalMeasurements.waste?.value ?? 0,
  }), [goalMeasurements]);

  // ── Goal progress, grouped by metric ─────────────────────────────────────
  // Every active goal is shown, not just the first. Grouping by metric lets the
  // reader move between an interim target and a 2050 one, and between carbon,
  // water and waste, without leaving the dashboard.
  const goalsByMetric = useMemo(() => {
    const groups: Record<GoalMetric, Goal[]> = { ghg: [], water: [], waste: [] };
    for (const g of goals) groups[asGoalMetric(g.metric)].push(g);
    // Nearest target year first — that is the one being managed to now.
    for (const m of GOAL_METRICS) groups[m].sort((a, b) => a.target_year - b.target_year);
    return groups;
  }, [goals]);

  const metricsWithGoals = GOAL_METRICS.filter((m) => goalsByMetric[m].length > 0);

  // A metric with no goals must never be the selected tab, and an index left
  // over from a longer list must not read past the end of a shorter one.
  const activeGoalMetric = metricsWithGoals.includes(goalMetric)
    ? goalMetric
    : metricsWithGoals[0];
  const goalsForMetric = activeGoalMetric ? goalsByMetric[activeGoalMetric] : [];
  const selectedGoal = goalsForMetric[Math.min(goalIndex, goalsForMetric.length - 1)];

  const selectedGoalProgress = useMemo(() => {
    if (!selectedGoal) return null;
    return computeGoalProgress(selectedGoal, currentByMetric[asGoalMetric(selectedGoal.metric)]);
  }, [selectedGoal, currentByMetric]);

  // ── Pipeline summaries, one per metric ───────────────────────────────────
  // Savings are annualised rates; a project going live mid-year only delivers
  // part of that this year. summarisePipeline pro-rates by in-service date so
  // the current-year figure is not overstated. All three metrics are computed
  // up front so the toggle is instant and the counts stay consistent.
  const pipelines = useMemo(() => {
    const build = (metric: PipelineMetric) => {
      const summary = summarisePipeline(projects, currentYear, fyStart, { metric });
      return {
        activeCount: summary.projects.filter((p) => p.status !== 'completed').length,
        currentYear: summary.currentYearValue,
        annualised: summary.annualisedValue,
        future: summary.futureValue,
      };
    };
    return { ghg: build('ghg'), water: build('water'), waste: build('waste') };
  }, [projects, currentYear, fyStart]);

  const pipeline = pipelines[pipelineMetric];

  /**
   * Gap between the selected metric's pipeline and the nearest goal for it.
   * Uses the annualised run-rate, since a target is a question about run-rate
   * at the target date rather than about what lands this year.
   */
  const pipelineGap = useMemo(() => {
    const metricGoals = goalsByMetric[pipelineMetric as GoalMetric] ?? [];
    const goal = metricGoals[0];
    if (!goal) return null;
    const progress = computeGoalProgress(goal, currentByMetric[pipelineMetric as GoalMetric]);
    if (!progress.isComputable || progress.targetValue == null || progress.baseValue == null) return null;
    return {
      goal,
      gap: gapToTarget(
        progress.baseValue,
        progress.targetValue,
        progress.currentValue,
        pipelines[pipelineMetric].annualised,
      ),
    };
  }, [goalsByMetric, pipelineMetric, currentByMetric, pipelines]);

  /** Format a value in the family a metric belongs to, at the user's unit. */
  function fmtMetric(metric: GoalMetric, value: number | null | undefined): string {
    const family = GOAL_METRIC_FAMILY[metric];
    return formatMetric(value, family, units[family]);
  }

  // ── Survey response rate ─────────────────────────────────────────────────
  const surveyStats = useMemo(() => {
    const surveyIds = activeSurveys.map((s) => s.id);
    const relevant = invitations.filter((i) => surveyIds.includes(i.survey_id));
    const submitted = relevant.filter((i) => i.status === 'submitted').length;
    return { total: relevant.length, submitted };
  }, [activeSurveys, invitations]);

  const totalChange = pctChange(kpis.totalCur, kpis.totalPrior);
  const waterChange = pctChange(kpis.waterCur, kpis.waterPrior);
  const wasteChange = pctChange(kpis.wasteTotal, kpis.wastePriorTotal);

  const CHART_COLORS = ['#059669','#6366f1','#f59e0b','#ec4899','#06b6d4'];

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">{orgName} · {scopeLabel} · Reporting year {currentYear}</p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <UnitToggle families={['carbon', 'water', 'waste']} />
          {/* Scope 2 method toggle */}
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
            <span className="text-xs text-gray-500 px-2">Scope 2:</span>
            {(['location_based', 'market_based'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setScope2Method(m)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${scope2Method === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {m === 'location_based' ? 'Location' : 'Market'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Regulatory deadlines ──────────────────────────────────────────
          A cross-link, not a copy of the tracker. The dashboard is where
          people actually land, and a regulatory deadline nobody sees until
          they think to open a reference page is a deadline that gets missed.
          Only dated, future milestones appear here; everything else lives on
          the tracker with its sources and caveats. ─────────────────────────*/}
      {regulatoryMilestones.length > 0 && (
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex items-baseline justify-between gap-4 mb-3">
              <h2 className="text-sm font-semibold text-gray-900">Regulatory deadlines ahead</h2>
              <Link href="/regulations"
                    className="text-xs text-emerald-700 hover:text-emerald-800 font-medium">
                Open the tracker &rarr;
              </Link>
            </div>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
              {regulatoryMilestones.map((m) => {
                const days = m.next_milestone_date
                  ? Math.round((Date.parse(m.next_milestone_date + 'T00:00:00Z') - nowMs) / 86400000)
                  : null;
                const soon = days !== null && days <= 90;
                return (
                  <li key={m.code} className="flex items-baseline gap-3 text-sm">
                    <span className={`font-mono text-xs flex-shrink-0 w-24 ${soon ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                      {m.next_milestone_date}
                    </span>
                    <span className="text-gray-900 font-medium flex-shrink-0">{m.code}</span>
                    <span className="text-gray-500 truncate">{m.next_milestone}</span>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-gray-400 mt-3">
              Reference only, not legal advice, and not scoped to your business units.
              Confirm against the primary source before acting.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── KPI cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          title="Total Scope 1 + 2"
          value={formatCarbon(kpis.totalCur, units)}
          subValue={scope2Method === 'market_based' ? 'Market-based' : 'Location-based'}
          change={totalChange}
          comparedTo={kpis.emissionsVs}
          tooltip="Total greenhouse gas emissions for the current reporting year."
          href="/kpis"
        />
        <CardLink href="/kpis">
        <Card className={CLICKABLE_CARD}>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              Scope 1 (Direct)
              <ArrowUpRight size={13} className="ml-auto text-gray-300 group-hover:text-emerald-600 transition-colors" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900">{formatCarbon(kpis.scope1Cur, units)}</p>
            {(() => {
              const c = pctChange(kpis.scope1Cur, kpis.scope1Prior);
              const color = c.direction === 'down' ? 'text-emerald-600' : c.direction === 'up' ? 'text-red-500' : 'text-gray-400';
              const Icon = c.direction === 'down' ? TrendingDown : c.direction === 'up' ? TrendingUp : Minus;
              return (
                <div className={`flex items-center gap-1 mt-1.5 text-xs font-medium ${color}`}>
                  <Icon size={12} />{c.label} vs {kpis.emissionsVs}
                </div>
              );
            })()}
            {scope1ByCategory.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
                {scope1ByCategory.map((c) => (
                  <div key={c.key} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className={c.key === 'unclassified' ? 'text-amber-600' : 'text-gray-500'}>
                      {c.label}
                    </span>
                    <span className="text-gray-700 font-medium tabular-nums">
                      {formatCarbon(c.kg, units)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        </CardLink>
        {/* Previously wrapped in a bare div, which became the stretched grid
            item while the card inside kept its content height — that is why
            this card read as a different size from its neighbours. */}
        <CardLink href="/kpis">
          <Card className={CLICKABLE_CARD}>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                Scope 2 (Indirect)
                <ArrowUpRight size={13} className="ml-auto text-gray-300 group-hover:text-emerald-600 transition-colors" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-gray-900">{formatCarbon(kpis.scope2LocationCur, units)}</p>
              <p className="text-xs text-gray-400 mt-0.5">Location-based</p>
              {kpis.scope2MarketCur !== kpis.scope2LocationCur && (
                <>
                  <p className="text-base font-semibold text-gray-600 mt-1">{formatCarbon(kpis.scope2MarketCur, units)}</p>
                  <p className="text-xs text-gray-400">Market-based</p>
                </>
              )}
            </CardContent>
          </Card>
        </CardLink>
        <KpiCard
          title="Scope 3 (Value chain)"
          value={formatCarbon(kpis.scope3Cur, units)}
          subValue={
            kpis.scope3Cur > 0
              ? `${kpis.scope3Categories}/15 categories · ${kpis.scope3PrimaryPct.toFixed(0)}% primary data`
              : 'No Scope 3 data yet'
          }
          change={kpis.scope3Prior > 0 ? pctChange(kpis.scope3Cur, kpis.scope3Prior) : undefined}
          comparedTo={kpis.scope3Vs}
          tooltip="Value-chain emissions, reported separately from the Scope 1+2 operational boundary."
          href="/scope3"
        />
      </div>

      {/* Total footprint incl. Scope 3 */}
      {kpis.scope3Cur > 0 && (
        <div className="mb-6">
          <CardLink href="/kpis">
          <Card className={CLICKABLE_CARD}>
            <CardContent className="py-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div>
                <p className="text-xs text-gray-500 font-medium">Total footprint (Scope 1 + 2 + 3)</p>
                <p className="text-2xl font-bold text-gray-900">{formatCarbon(kpis.footprintCur, units)}</p>
              </div>
              <div className="text-sm text-gray-500">
                Scope 3 is{' '}
                <span className="font-semibold text-gray-700">
                  {kpis.footprintCur > 0 ? ((kpis.scope3Cur / kpis.footprintCur) * 100).toFixed(0) : 0}%
                </span>{' '}
                of the total footprint
              </div>
            </CardContent>
          </Card>
          </CardLink>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          title="Water Consumption"
          value={formatWater(kpis.waterCur, units)}
          change={{ ...waterChange, direction: waterChange.direction === 'up' ? 'up' : waterChange.direction === 'down' ? 'down' : 'flat' }}
          comparedTo={kpis.ehsVs}
          href="/kpis"
        />
        <KpiCard
          title="Total Waste"
          value={formatWaste(kpis.wasteTotal, units)}
          change={wasteChange}
          comparedTo={kpis.ehsVs}
          href="/kpis"
        />
        <KpiCard
          title="Waste Diversion Rate"
          value={kpis.diversionRate == null ? '—' : `${kpis.diversionRate.toFixed(1)}%`}
          subValue={kpis.diversionRate == null ? 'No waste recorded' : 'recycled + composted'}
          tooltip="Percentage of total waste diverted from landfill."
          href="/kpis"
        />
        <KpiCard
          title="Renewable Energy"
          value={kpis.renewablePct == null ? '—' : `${kpis.renewablePct.toFixed(1)}%`}
          subValue={kpis.renewablePct == null ? 'No electricity recorded' : 'of total electricity'}
          href="/kpis"
        />
      </div>

      {/* ── Goal progress ───────────────────────────────────────────────────
          Every active goal, toggleable by metric and then by goal, so an
          interim target and a 2050 one are both reachable without leaving the
          page. Its own card rather than a KPI tile: a single percentage with
          no way to ask "which goal?" was the previous, less useful shape. */}
      {activeGoalMetric && selectedGoal && selectedGoalProgress && (
        <Card className="mb-8">
          <CardContent className="pt-5">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
              <CardTitleLink href="/goals">Goal Progress</CardTitleLink>

              <div className="flex items-center gap-2 flex-wrap">
                {metricsWithGoals.length > 1 && (
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                    {metricsWithGoals.map((m) => (
                      <button
                        key={m}
                        onClick={() => { setGoalMetric(m); setGoalIndex(0); }}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                          activeGoalMetric === m
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {GOAL_METRIC_LABELS[m]}
                      </button>
                    ))}
                  </div>
                )}
                {goalsForMetric.length > 1 && (
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                    {goalsForMetric.map((g, i) => (
                      <button
                        key={g.id}
                        onClick={() => setGoalIndex(i)}
                        title={g.name}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                          g.id === selectedGoal.id
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {g.target_year}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* A goal's baseline and target are organization-wide; the current
                value on this page is scope-filtered. Comparing them would
                report a business unit's emissions against the whole company's
                baseline and show near-complete progress against a target
                nobody has met. The figures are withheld rather than caveated,
                because a wrong number with a footnote is still a wrong number. */}
            {scopeIsFiltered ? (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <p className="text-sm font-medium text-gray-900">{selectedGoal.name}</p>
                <p className="text-xs text-amber-800 mt-1">
                  Targets are set for the whole organization, so progress cannot be
                  measured against <span className="font-medium">{scopeLabel}</span> alone.
                  Clear the reporting scope, or{' '}
                  <Link href="/goals" className="underline hover:text-amber-900">
                    open Goals
                  </Link>{' '}
                  for organization-wide progress.
                </p>
              </div>
            ) : (
            <>
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{selectedGoal.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {selectedGoalProgress.isComputable ? (
                    <>
                      {fmtMetric(activeGoalMetric, selectedGoalProgress.baseValue)} ({selectedGoal.base_year})
                      {' → '}
                      {fmtMetric(activeGoalMetric, selectedGoalProgress.targetValue)} ({selectedGoal.target_year})
                      {goalMeasurements[activeGoalMetric] && (
                        <>
                          {' · '}
                          {fmtMetric(activeGoalMetric, selectedGoalProgress.currentValue)}
                          {' in '}{goalMeasurements[activeGoalMetric]!.year}
                          {goalMeasurements[activeGoalMetric]!.partial ? ' to date (partial year)' : ''}
                        </>
                      )}
                    </>
                  ) : (
                    // Says so rather than presenting an entered number as a
                    // calculated one: no baseline means no derivable target.
                    <span className="text-amber-600">
                      No base year value recorded — progress is the manually entered figure, not calculated
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-gray-900">
                  {selectedGoalProgress.progressPct.toFixed(0)}%
                </p>
                <p className="text-xs text-gray-400">
                  {selectedGoal.target_year - currentYear > 0
                    ? `${selectedGoal.target_year - currentYear} yr left`
                    : selectedGoal.target_year === currentYear ? 'Target year' : 'Overdue'}
                </p>
              </div>
            </div>

            <div className="mt-3 h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${progressColor(selectedGoalProgress.progressPct)}`}
                style={{ width: `${Math.min(100, selectedGoalProgress.progressPct)}%` }}
              />
            </div>
            </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Charts row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Monthly trend */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Monthly Emissions Trend</h2>
          <p className="text-xs text-gray-400 mb-4">{carbonUnitLabel} — {currentYear} vs {priorYear}</p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtAxis(v)} />
              <Tooltip formatter={(v: number) => [`${v.toLocaleString()} ${carbonUnitLabel}`, '']} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Scope 1 (Current)" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Scope 2 (Current)" stroke="#8b5cf6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Scope 1 (Prior)" stroke="#93c5fd" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
              <Line type="monotone" dataKey="Scope 2 (Prior)" stroke="#c4b5fd" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Emissions by site */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Emissions by Site</h2>
          <p className="text-xs text-gray-400 mb-4">{carbonUnitLabel} — {currentYear}</p>
          {siteData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-sm text-gray-400">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={siteData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmtAxis(v)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                <Tooltip formatter={(v: number) => [`${v.toLocaleString()} ${carbonUnitLabel}`, 'Emissions']} />
                <Bar dataKey="co2e" radius={[0, 4, 4, 0]}>
                  {siteData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Bottom summary cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Project pipeline. Toggles across metrics so the same projects can be
            read as a carbon, water or waste reduction plan, each against its
            own goal — the three rarely progress at the same rate. */}
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
              <CardTitleLink href="/projects">Project Pipeline</CardTitleLink>
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                {(['ghg', 'water', 'waste'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPipelineMetric(m)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      pipelineMetric === m
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {GOAL_METRIC_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-2xl font-bold text-gray-900">{pipeline.activeCount}</p>
                <p className="text-xs text-gray-500">projects in progress or approved</p>
                {/* Projects are fetched unscoped, because a project can be
                    organization-wide with no site at all. Saying so is the
                    honest alternative to silently presenting an org-wide count
                    under a filtered heading. */}
                {scopeIsFiltered && (
                  <p className="text-xs text-amber-700 mt-1">
                    Organization-wide — not filtered to {scopeLabel}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">Landing in {currentYear}</p>
                <p className="text-base font-semibold text-emerald-700">
                  {fmtMetric(pipelineMetric as GoalMetric, pipeline.currentYear)}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {fmtMetric(pipelineMetric as GoalMetric, pipeline.annualised)} at full run-rate
                </p>
                {pipeline.future > 0 && (
                  <p className="text-xs text-gray-400">
                    {fmtMetric(pipelineMetric as GoalMetric, pipeline.future)} still to come
                  </p>
                )}
              </div>
            </div>

            {/* Gap to the nearest goal for this metric: the pipeline number
                only means something against what it is meant to deliver. */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              {scopeIsFiltered ? (
                <p className="text-xs text-gray-500">
                  Gap to target is hidden under a reporting scope: the pipeline is
                  organization-wide but current emissions here are filtered, and
                  comparing the two would overstate coverage.
                </p>
              ) : pipelineGap ? (
                <>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                    <p className="text-xs text-gray-500 truncate">
                      vs. <span className="text-gray-700 font-medium">{pipelineGap.goal.name}</span>
                    </p>
                    <p className={`text-sm font-semibold ${pipelineGap.gap.gapValue > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {pipelineGap.gap.coveragePct.toFixed(0)}% covered
                    </p>
                  </div>
                  <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 mb-2">
                    <div
                      className="bg-emerald-500"
                      style={{ width: `${Math.min(100, (pipelineGap.gap.achievedValue / Math.max(pipelineGap.gap.requiredReductionValue, 1)) * 100)}%` }}
                    />
                    <div
                      className="bg-emerald-300"
                      style={{ width: `${Math.min(100, (pipelineGap.gap.pipelineValue / Math.max(pipelineGap.gap.requiredReductionValue, 1)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    {pipelineGap.gap.gapValue > 0 ? (
                      <>
                        <strong className="text-amber-700">
                          {fmtMetric(pipelineMetric as GoalMetric, pipelineGap.gap.gapValue)}
                        </strong>{' '}
                        still unidentified to reach {pipelineGap.goal.target_year}
                      </>
                    ) : (
                      <span className="text-emerald-700">
                        Fully covered by achieved reductions and identified projects
                      </span>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-xs text-gray-400">
                  No {GOAL_METRIC_LABELS[pipelineMetric as GoalMetric].toLowerCase()} goal with a base
                  year value to measure this pipeline against.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Supplier surveys */}
        <CardLink href="/suppliers">
        <Card className={CLICKABLE_CARD}>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-1">
                  Supplier Survey Responses
                  <ArrowUpRight size={13} className="text-gray-300 group-hover:text-emerald-600 transition-colors" />
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {surveyStats.submitted}
                  <span className="text-base font-normal text-gray-400"> / {surveyStats.total}</span>
                </p>
                {/* Counts invitations, not suppliers: one supplier can be invited
                    to several surveys, so "suppliers responded" overstated the base. */}
                <p className="text-xs text-gray-500">survey invitations answered</p>
              </div>
              <div className="text-right">
                {surveyStats.total > 0 ? (
                  <>
                    <p className="text-base font-semibold text-gray-900">
                      {Math.round((surveyStats.submitted / surveyStats.total) * 100)}%
                    </p>
                    <p className="text-xs text-gray-400">response rate</p>
                    <Badge variant={surveyStats.submitted === surveyStats.total ? 'default' : 'warning'} className="mt-1">
                      {surveyStats.submitted === surveyStats.total ? 'Complete' : `${surveyStats.total - surveyStats.submitted} pending`}
                    </Badge>
                  </>
                ) : (
                  <p className="text-xs text-gray-400">No active surveys</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        </CardLink>
      </div>
    </div>
  );
}
