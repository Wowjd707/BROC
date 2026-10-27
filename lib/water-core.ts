/**
 * Water balance: withdrawal, discharge, consumption.
 *
 * Water entries share one metric family but measure different flows: water
 * taken in (withdrawal), water sent out (discharge) and water reused on site
 * (recycled). They cannot be summed together. Adding discharges to withdrawals
 * — which every view once did — reported 1,000 m³ in and 800 m³ out as
 * 1,800 m³ of "consumption" when the consumption was 200 m³.
 *
 * Definitions follow GRI 303-3/4/5 and ESRS E3-4:
 *   withdrawal  = water drawn from surface water, groundwater, or a third party
 *                 (municipal supply); rainwater collected counts as surface water
 *   discharge   = effluent returned to surface water, groundwater, sewer or a
 *                 third party
 *   consumption = withdrawal − discharge. Both standards also adjust for a
 *                 change in stored water; nothing here records storage, so it
 *                 is taken as zero and the methodology note says so.
 *   recycled    = reused on site: reported separately, never withdrawal.
 *
 * Every view that shows "water use" (dashboard, KPIs, goals) reads withdrawal.
 * A new water source type must be added to WATER_SOURCE_CLASS, or it is
 * counted as unclassified and left out of every total.
 */

export type WaterClass = 'withdrawal' | 'discharge' | 'recycled';

export const WATER_SOURCE_CLASS: Record<string, WaterClass> = {
  municipal_consumption: 'withdrawal', // third-party (municipal) supply
  groundwater:           'withdrawal',
  surface_water:         'withdrawal',
  stormwater:            'withdrawal', // rainwater collected: surface water under GRI 303
  municipal_discharge:   'discharge',
  treated_discharge:     'discharge',
  recycled_water:        'recycled',
};

export function waterClassOf(sourceType: string | null | undefined): WaterClass | null {
  return (sourceType && WATER_SOURCE_CLASS[sourceType]) || null;
}

export interface WaterBalance {
  withdrawal: number;
  discharge: number;
  /** withdrawal − discharge; null when there is no withdrawal to measure from. */
  consumption: number | null;
  recycled: number;
  /** Rows whose source type is not classified; excluded from every figure. */
  unclassified: number;
}

/** Sum water rows (canonical unit: US gallons) into a balance. */
export function waterBalance(
  rows: { source_type: string | null; quantity_normalized: number }[],
  weight: (row: { source_type: string | null; quantity_normalized: number }) => number = () => 1,
): WaterBalance {
  let withdrawal = 0;
  let discharge = 0;
  let recycled = 0;
  let unclassified = 0;
  for (const r of rows) {
    const q = r.quantity_normalized * weight(r);
    const c = waterClassOf(r.source_type);
    if (c === 'withdrawal') withdrawal += q;
    else if (c === 'discharge') discharge += q;
    else if (c === 'recycled') recycled += q;
    else unclassified += q;
  }
  const hasWithdrawal = rows.some((r) => waterClassOf(r.source_type) === 'withdrawal');
  return {
    withdrawal,
    discharge,
    consumption: hasWithdrawal ? withdrawal - discharge : null,
    recycled,
    unclassified,
  };
}

/** Total withdrawal from a set of EHS rows (non-water rows are ignored). */
export function waterWithdrawal(
  rows: { metric_type?: string; source_type: string | null; quantity_normalized: number | null }[],
): number {
  return rows.reduce(
    (s, r) => (r.metric_type !== undefined && r.metric_type !== 'water') || waterClassOf(r.source_type) !== 'withdrawal'
      ? s
      : s + (r.quantity_normalized ?? 0),
    0,
  );
}
