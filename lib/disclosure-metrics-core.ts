/**
 * Platform metrics that can satisfy a framework disclosure requirement.
 *
 * A requirement row carries a `metric_key`; this module defines what those keys
 * mean and how to compute them from inventory data. Keeping the definitions in
 * one place is what lets the *same* underlying data answer TCFD, IFRS S2,
 * ESRS E1 and GRI 305 without recomputing anything per framework.
 *
 * Pure and dependency-free so it is unit-testable.
 */

import {
  deriveRates,
  type SocialInputs,
  type HoursBasis,
  type DerivedRate,
} from './social-metrics-core';

/** Every metric key the resolver understands. Used to validate imports. */
export const METRIC_KEYS = [
  'scope1_total',
  'scope2_location',
  'scope2_market',
  'scope2_both',
  'scope3_total',
  'scope3_by_category',
  'ghg_all_scopes',
  'ghg_intensity',
  'energy_consumption',
  'water_consumption',
  'water_withdrawal',
  'water_discharge',
  'waste_total',
  'ghg_outside_scopes',
  'targets',
  // Social — GRI 403/401/404, ESRS S1
  'safety_trir',
  'safety_dart',
  'safety_lost_time_rate',
  'safety_fatalities',
  'workforce_headcount',
  'workforce_turnover',
  'training_hours_per_employee',
  // Governance — GRI 2/205, ESRS G1
  'governance_board_independence',
  'governance_corruption_incidents',
] as const;

export type MetricKey =
  | 'scope1_total'
  | 'scope2_location'
  | 'scope2_market'
  | 'scope2_both'
  | 'scope3_total'
  | 'scope3_by_category'
  | 'ghg_all_scopes'
  | 'ghg_intensity'
  | 'energy_consumption'
  | 'water_consumption'
  | 'water_withdrawal'
  | 'water_discharge'
  | 'waste_total'
  | 'ghg_outside_scopes'
  | 'targets'
  | 'safety_trir'
  | 'safety_dart'
  | 'safety_lost_time_rate'
  | 'safety_fatalities'
  | 'workforce_headcount'
  | 'workforce_turnover'
  | 'training_hours_per_employee'
  | 'governance_board_independence'
  | 'governance_corruption_incidents';

export interface MetricValue {
  label: string;
  value: number | null;
  unit: string;
  /** Sub-values for composite metrics (e.g. Scope 3 by category). */
  breakdown?: { label: string; value: number; unit: string }[];
  /** Set when the platform holds no data for this metric. */
  missing?: boolean;
  /**
   * Methodology that must travel with the figure into the basis of
   * preparation — currently the hours basis of an injury rate, which GRI 403-9
   * requires the reporter to state. A rate printed without it is unassurable.
   */
  methodologyNote?: string;
}

export interface InventoryInput {
  scope1Kg: number;
  scope2LocationKg: number;
  scope2MarketKg: number;
  scope3Kg: number;
  scope3ByCategory: { categoryNumber: number; name: string; co2eKg: number }[];
  energyKwh: number;
  /** Water drawn in (US gallons). See lib/water-core.ts for the classification. */
  waterWithdrawalGallons: number;
  /** Water discharged (US gallons). */
  waterDischargeGallons: number;
  /** Withdrawal − discharge; null when no withdrawal was recorded. */
  waterConsumptionGallons: number | null;
  wasteKg: number;
  /**
   * Whether any rows fed each figure. Distinguishes "nothing recorded" from a
   * genuine zero (a site that discharged no water, a year with no Scope 1).
   * Optional: absent, a zero sum is read as missing, as before.
   */
  presence?: Partial<Record<'scope1' | 'scope2' | 'scope3' | 'energy' | 'waterWithdrawal' | 'waterDischarge' | 'waste', boolean>>;
  /**
   * Emissions reported separately from the scopes (GHG Protocol Corporate
   * Standard ch. 4 and 9): biogenic CO₂ from burning biomass, and Montreal
   * Protocol gases such as HCFC-22. Never part of any scope total.
   */
  outsideScopes?: { biogenicCo2Kg: number; montrealGasesKg: number };
  /**
   * Scope 2 kWh by the rung of the market-based hierarchy that priced it
   * (contractual, residual_mix, grid_average, self_generated, heat_supplier,
   * legacy). The basis of preparation discloses the grid-average share.
   */
  scope2MarketBasisKwh?: Record<string, number>;
  /** Denominator for intensity, e.g. floor area or revenue. Null when unknown. */
  intensityDenominator: number | null;
  intensityDenominatorUnit: string;
  /**
   * How many active sites have no denominator recorded.
   *
   * Needed because the numerator covers every site while the denominator only
   * covers those with a floor area, so an incomplete denominator inflates the
   * ratio rather than shrinking it — silently, and in the direction that looks
   * worse. Optional so existing callers and fixtures stay valid.
   */
  intensityDenominatorMissingSites?: number;
  /** e.g. "Revenue", "Headcount (FTE)". Names what intensity is divided by. */
  intensityDenominatorLabel?: string;
  /** Share of the inventory resting on estimates, for disclosure. */
  dataQuality?: {
    measured: number; calculated: number; estimated: number;
    total: number; estimatedPercent: number;
  };
  /** The organizational boundary actually applied to Scope 1 and 2. */
  consolidation?: {
    approach: string;
    partialSiteCount: number;
    excludedSiteCount: number;
  };
  targets: {
    name: string;
    targetYear: number;
    targetReductionPct: number | null;
    status: string;
    /** 'absolute' | 'intensity' | 'net_zero' | 'sbti_15c' — an intensity percentage is a cut in the ratio. */
    goalType?: string;
  }[];
  /**
   * Raw social and governance counts for the reporting year. Optional so that
   * every existing caller and test fixture stays valid; absent means the S and
   * G metrics resolve as missing, which is the correct reading of an
   * organization that has not entered any.
   */
  social?: SocialInputs;
  /** Hours basis for injury rates. Defaults to the OSHA 200,000. */
  hoursBasis?: HoursBasis;
}

const KG_PER_TONNE = 1000;
const M3_PER_US_GALLON = 0.003785411784;

function tonnes(kg: number): number {
  return kg / KG_PER_TONNE;
}

/**
 * Missing means no rows fed the figure. When the inventory says whether rows
 * existed, a recorded zero is a value (a disclosure of zero); otherwise a zero
 * sum is read as missing, which is the conservative reading.
 */
function isMissing(present: boolean | undefined, value: number): boolean {
  return present === undefined ? value === 0 : !present;
}

/**
 * Resolve a metric key against the inventory. Returns `missing: true` rather
 * than a zero when the platform genuinely holds no data — a disclosure that
 * reports 0 when it means "not measured" is a misstatement, and the coverage
 * view needs to tell those apart.
 */
export function resolveMetric(key: string, inv: InventoryInput): MetricValue | null {
  switch (key as MetricKey) {
    case 'scope1_total':
      return {
        label: 'Scope 1 (direct) GHG emissions',
        value: tonnes(inv.scope1Kg),
        unit: 'tCO₂e',
        missing: isMissing(inv.presence?.scope1, inv.scope1Kg),
      };

    case 'scope2_location':
      return {
        label: 'Scope 2 (location-based)',
        value: tonnes(inv.scope2LocationKg),
        unit: 'tCO₂e',
        missing: isMissing(inv.presence?.scope2, inv.scope2LocationKg),
      };

    case 'scope2_market':
      return {
        label: 'Scope 2 (market-based)',
        value: tonnes(inv.scope2MarketKg),
        unit: 'tCO₂e',
        missing: isMissing(inv.presence?.scope2, inv.scope2MarketKg),
      };

    case 'scope2_both':
      return {
        label: 'Scope 2 GHG emissions',
        value: tonnes(inv.scope2LocationKg),
        unit: 'tCO₂e',
        breakdown: [
          { label: 'Location-based', value: tonnes(inv.scope2LocationKg), unit: 'tCO₂e' },
          { label: 'Market-based', value: tonnes(inv.scope2MarketKg), unit: 'tCO₂e' },
        ],
        missing: isMissing(inv.presence?.scope2, inv.scope2LocationKg + inv.scope2MarketKg),
      };

    case 'scope3_total':
      return {
        label: 'Scope 3 (other indirect) GHG emissions',
        value: tonnes(inv.scope3Kg),
        unit: 'tCO₂e',
        missing: isMissing(inv.presence?.scope3, inv.scope3Kg),
      };

    case 'scope3_by_category':
      return {
        label: 'Scope 3 by category',
        value: tonnes(inv.scope3Kg),
        unit: 'tCO₂e',
        breakdown: inv.scope3ByCategory
          .filter((c) => c.co2eKg > 0)
          .map((c) => ({ label: `${c.categoryNumber}. ${c.name}`, value: tonnes(c.co2eKg), unit: 'tCO₂e' })),
        missing: isMissing(inv.presence?.scope3, inv.scope3Kg),
      };

    case 'ghg_all_scopes': {
      // ESRS E1-6 (§44) requires total GHG emissions on BOTH a location-based
      // and a market-based Scope 2 basis. The headline is location-based, as
      // before; both totals are in the breakdown.
      const total = inv.scope1Kg + inv.scope2LocationKg + inv.scope3Kg;
      const totalMarket = inv.scope1Kg + inv.scope2MarketKg + inv.scope3Kg;
      return {
        label: 'Gross GHG emissions, all scopes',
        value: tonnes(total),
        unit: 'tCO₂e',
        breakdown: [
          { label: 'Scope 1', value: tonnes(inv.scope1Kg), unit: 'tCO₂e' },
          { label: 'Scope 2 (location-based)', value: tonnes(inv.scope2LocationKg), unit: 'tCO₂e' },
          { label: 'Scope 2 (market-based)', value: tonnes(inv.scope2MarketKg), unit: 'tCO₂e' },
          { label: 'Scope 3', value: tonnes(inv.scope3Kg), unit: 'tCO₂e' },
          { label: 'Total (location-based)', value: tonnes(total), unit: 'tCO₂e' },
          { label: 'Total (market-based)', value: tonnes(totalMarket), unit: 'tCO₂e' },
        ],
        missing: total === 0 && totalMarket === 0
          && !inv.presence?.scope1 && !inv.presence?.scope2 && !inv.presence?.scope3,
      };
    }

    case 'ghg_outside_scopes': {
      const o = inv.outsideScopes ?? { biogenicCo2Kg: 0, montrealGasesKg: 0 };
      const total = o.biogenicCo2Kg + o.montrealGasesKg;
      return {
        label: 'Emissions reported outside the scopes',
        value: tonnes(total),
        unit: 'tCO₂e',
        breakdown: [
          { label: 'Biogenic CO₂ from biomass combustion', value: tonnes(o.biogenicCo2Kg), unit: 'tCO₂' },
          { label: 'Montreal Protocol gases (e.g. HCFC-22)', value: tonnes(o.montrealGasesKg), unit: 'tCO₂e' },
        ],
        missing: total === 0,
        methodologyNote:
          'Reported separately from Scopes 1–3 as the GHG Protocol Corporate Standard requires '
          + '(GRI 305-1(c) and ESRS E1-6 for biogenic CO₂). Not included in any scope total.',
      };
    }

    case 'ghg_intensity': {
      const total = inv.scope1Kg + inv.scope2LocationKg;
      if (!inv.intensityDenominator || inv.intensityDenominator <= 0) {
        return {
          label: 'GHG emissions intensity',
          value: null,
          unit: `tCO₂e per ${inv.intensityDenominatorUnit}`,
          missing: true,
        };
      }
      // Every site's emissions over some sites' floor area is not an intensity,
      // it is an overstatement — three 100,000 sq ft sites with one area left
      // blank reports 0.015 rather than 0.010 tCO₂e/sq ft. Reported as missing
      // rather than computed, per the standing decision that a metric says
      // "not measured" instead of guessing.
      const missingSites = inv.intensityDenominatorMissingSites ?? 0;
      if (missingSites > 0) {
        return {
          label: 'GHG emissions intensity (Scope 1+2)',
          value: null,
          unit: `tCO₂e per ${inv.intensityDenominatorUnit}`,
          missing: true,
          methodologyNote:
            `Not calculated: ${missingSites} active site${missingSites === 1 ? ' has' : 's have'} no `
            + `${inv.intensityDenominatorUnit} recorded, so the denominator covers less of the `
            + `organization than the emissions figure does. Add the missing values in Settings.`,
        };
      }
      return {
        label: 'GHG emissions intensity (Scope 1+2)',
        value: tonnes(total) / inv.intensityDenominator,
        unit: `tCO₂e per ${inv.intensityDenominatorUnit}`,
        breakdown: [
          { label: 'Location-based', value: tonnes(total) / inv.intensityDenominator, unit: `tCO₂e per ${inv.intensityDenominatorUnit}` },
          { label: 'Market-based', value: tonnes(inv.scope1Kg + inv.scope2MarketKg) / inv.intensityDenominator, unit: `tCO₂e per ${inv.intensityDenominatorUnit}` },
        ],
        missing: total === 0,
        // Names the denominator explicitly. An intensity figure whose divisor
        // is ambiguous cannot be compared to anyone else's, or to last year's.
        methodologyNote: inv.intensityDenominatorLabel
          ? `Denominator: ${inv.intensityDenominatorLabel} `
            + `(${inv.intensityDenominator.toLocaleString('en-US')} ${inv.intensityDenominatorUnit}).`
          : undefined,
      };
    }

    // Reported in the units the frameworks specify — ESRS E1-5 asks for MWh,
    // ESRS E3-4 for m³ (GRI 303 for megalitres), ESRS E5 and GRI 306 for
    // tonnes — not the platform's storage units (kWh, US gallons, kg). A CSRD
    // report stating water in US gallons is not comparable with anyone's.
    case 'energy_consumption':
      return {
        label: 'Total energy consumption',
        value: inv.energyKwh / 1000,
        unit: 'MWh',
        missing: isMissing(inv.presence?.energy, inv.energyKwh),
        methodologyNote:
          'Electricity and other purchased energy, plus fuel combusted on site converted at '
          + '1 MMBtu = 293.07 kWh (higher heating value, as stored).',
      };

    case 'water_consumption':
      // Withdrawal minus discharge (GRI 303-5, ESRS E3-4). Summing every water
      // row reported discharges as if they were consumed.
      return {
        label: 'Water consumption',
        value: inv.waterConsumptionGallons == null ? null : inv.waterConsumptionGallons * M3_PER_US_GALLON,
        unit: 'm³',
        breakdown: inv.waterConsumptionGallons == null ? undefined : [
          { label: 'Withdrawal', value: inv.waterWithdrawalGallons * M3_PER_US_GALLON, unit: 'm³' },
          { label: 'Discharge', value: inv.waterDischargeGallons * M3_PER_US_GALLON, unit: 'm³' },
        ],
        missing: inv.waterConsumptionGallons == null,
        methodologyNote:
          'Consumption = withdrawal − discharge. Change in water storage is not recorded and is taken as zero.',
      };

    case 'water_withdrawal':
      return {
        label: 'Total water withdrawal',
        value: inv.waterWithdrawalGallons * M3_PER_US_GALLON,
        unit: 'm³',
        missing: isMissing(inv.presence?.waterWithdrawal, inv.waterWithdrawalGallons),
      };

    case 'water_discharge':
      return {
        label: 'Total water discharge',
        value: inv.waterDischargeGallons * M3_PER_US_GALLON,
        unit: 'm³',
        missing: isMissing(inv.presence?.waterDischarge, inv.waterDischargeGallons),
      };

    case 'waste_total':
      return {
        label: 'Total waste generated',
        value: tonnes(inv.wasteKg),
        unit: 't',
        missing: isMissing(inv.presence?.waste, inv.wasteKg),
      };

    case 'targets':
      return {
        label: 'Climate targets',
        value: inv.targets.length,
        unit: inv.targets.length === 1 ? 'target' : 'targets',
        // A target with no reduction percentage (an absolute or intensity
        // target set as a value) is counted but not given a made-up 0%.
        breakdown: inv.targets
          .filter((t) => t.targetReductionPct != null)
          .map((t) => ({
            label: `${t.name} (by ${t.targetYear})`,
            value: t.targetReductionPct as number,
            unit: t.goalType === 'intensity' ? '% intensity reduction' : '% reduction',
          })),
        missing: inv.targets.length === 0,
      };

    // ── Social and governance ────────────────────────────────────────────
    // Every rate below is derived from raw counts at read time, never stored.
    // See social-metrics-core.ts for why.

    case 'safety_trir':
      return derivedMetric(inv, 'trir', 'Total recordable incident rate (TRIR)');

    case 'safety_dart':
      return derivedMetric(inv, 'dart', 'Days away, restricted, or transferred (DART) rate');

    case 'safety_lost_time_rate':
      return derivedMetric(inv, 'ltir', 'Lost-time injury rate');

    case 'safety_fatalities':
      // A count, not a rate — and one where zero is a real disclosure that
      // must be distinguishable from "not tracked".
      return countMetric(
        'Work-related fatalities',
        inv.social?.fatalities,
        'fatalities',
      );

    case 'workforce_headcount':
      return countMetric('Total employees', inv.social?.headcount, 'employees');

    case 'workforce_turnover':
      return derivedMetric(inv, 'turnover_total', 'Employee turnover rate');

    case 'training_hours_per_employee':
      return derivedMetric(inv, 'training_hours_per_employee', 'Average training hours per employee');

    case 'governance_board_independence':
      return derivedMetric(inv, 'board_independence', 'Board independence');

    case 'governance_corruption_incidents':
      // GRI 205-3. Zero confirmed incidents is an answer; no data is not.
      return countMetric(
        'Confirmed incidents of corruption',
        inv.social?.corruptionIncidentsConfirmed,
        'incidents',
      );

    default:
      return null;
  }
}

/**
 * Resolve one derived rate into a MetricValue, carrying its hours basis into
 * the methodology note so the report can state it.
 */
function derivedMetric(inv: InventoryInput, rateKey: string, label: string): MetricValue {
  const rates: DerivedRate[] = deriveRates(inv.social ?? {}, inv.hoursBasis ?? 200_000);
  const found = rates.find((r) => r.key === rateKey);

  if (!found || found.missing || found.value === null) {
    return { label, value: null, unit: found?.unit ?? '', missing: true };
  }

  return {
    label,
    value: found.value,
    unit: found.unit,
    missing: false,
    methodologyNote: found.hoursBasis
      ? `${found.formula}. Basis: ${found.hoursBasis.toLocaleString('en-US')} hours worked.`
      : found.formula,
  };
}

/**
 * A raw count. Distinguishes an absent value from a genuine zero: "no
 * confirmed incidents of corruption" is a meaningful disclosure and must not
 * be rendered the same way as "we do not track this".
 */
function countMetric(label: string, value: number | null | undefined, unit: string): MetricValue {
  if (value == null || !Number.isFinite(value)) {
    return { label, value: null, unit, missing: true };
  }
  return { label, value, unit, missing: false };
}

// ─── Coverage ────────────────────────────────────────────────────────────────

export interface RequirementLike {
  id: string;
  response_type: string;
  metric_key: string | null;
}

export interface ResponseLike {
  requirement_id: string;
  status: string;
  narrative: string | null;
}

export type RequirementState =
  | 'satisfied_by_data'    // a linked metric has a value
  | 'answered'             // narrative supplied / marked complete
  | 'in_progress'
  | 'not_material'         // scoped out by hand, on this requirement
  | 'excluded_immaterial'  // scoped out by the double materiality assessment
  | 'outstanding';

export function requirementState(
  req: RequirementLike,
  response: ResponseLike | undefined,
  metric: MetricValue | null,
  /**
   * False when the double materiality assessment concluded every topic this
   * requirement maps to is not material. Defaults to true, so frameworks with
   * no topic links and organizations with no assessment behave as before.
   */
  applicable: boolean = true,
): RequirementState {
  if (response?.status === 'not_material') return 'not_material';

  // A completed disclosure outranks the gate. Reporting beyond the material
  // scope is voluntary disclosure, which ESRS permits and which an
  // organization that did the work plainly intends — silently demoting it to
  // "excluded" would discard a finished answer.
  if (response?.status === 'complete') return 'answered';

  // A draft does not outrank the gate: an in-progress narrative on a topic
  // since concluded immaterial is exactly the work the assessment says can
  // stop. The draft itself is retained and still editable.
  if (!applicable) return 'excluded_immaterial';

  if (response?.status === 'in_progress') return 'in_progress';

  // A metric-backed requirement with real data counts as covered even before
  // anyone writes narrative — the number is already reportable.
  if (metric && !metric.missing && metric.value != null) return 'satisfied_by_data';

  if (response?.narrative && response.narrative.trim().length > 0) return 'in_progress';
  return 'outstanding';
}

/**
 * Coverage percentage for a framework. Requirements scoped out — by hand
 * ('not_material') or by the materiality assessment ('excluded_immaterial') —
 * are excluded from the denominator. Deliberately scoping something out is a
 * valid reporting decision, not a gap; leaving them in the denominator would
 * cap a fully-complete CSRD statement well below 100% purely because the
 * undertaking's assessment found fewer topics material.
 */
export function coveragePercent(states: RequirementState[]): number {
  const applicable = states.filter(
    (s) => s !== 'not_material' && s !== 'excluded_immaterial',
  );
  if (applicable.length === 0) return 0;
  const covered = applicable.filter(
    (s) => s === 'satisfied_by_data' || s === 'answered',
  ).length;
  return (covered / applicable.length) * 100;
}

// ─── Provenance ──────────────────────────────────────────────────────────────

/**
 * The document a stored factor source names, for the report's list of factor
 * sources. Entry-level detail is stripped — the site's grid basis
 * ("eGRID2023 (ZIP 28202)") and the grid-average note on a market-based
 * figure — so the list carries one line per document, not per ZIP. Notes that
 * describe the factor itself ("AIB_2023 (direct CO2)") are kept. Returns null
 * for nothing, and for a location source that was never recorded (rows saved
 * before migration 039 carry a "derived:" placeholder).
 */
export function provenanceSourceName(source: string | null | undefined): string | null {
  if (!source) return null;
  let s = source.trim();
  if (!s || s.startsWith('derived:')) return null;
  s = s.replace(/\s+—\s+grid average used for market-based:.*$/, '');
  s = s.replace(/\s+\((ZIP |eGRID subregion |US national average|country )[^)]*\)\s*$/, '');
  return s.trim() || null;
}
