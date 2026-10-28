/**
 * Turning supplier-provided disclosures into usable Scope 3 Category 1 inputs.
 *
 * Two sources already exist in the platform and, until now, fed nothing:
 *   * cbam_supplier_factors  — supplier-declared factors for CBAM commodities
 *   * supplier survey responses — CBAM disclosure surveys carrying a declared
 *     carbon intensity per unit of product
 *
 * Both are *primary* data: they come from the supplier rather than an industry
 * average, which is exactly the data-quality upgrade every framework asks for
 * on Category 1. This module normalizes them to a common shape and scores each
 * supplier's data so engagement can be prioritised.
 *
 * Pure and dependency-free so it is unit-testable.
 */

export type DeclarationSource = 'cbam_factor' | 'survey_response';

export interface SupplierDeclaration {
  supplierId: string | null;
  supplierName: string;
  source: DeclarationSource;
  /** Provenance string written to the entry's factor_source — never invented. */
  sourceLabel: string;
  /** kg CO2e per `unit`. */
  intensityKgCo2e: number;
  unit: string;
  product: string | null;
  dataYear: number | null;
  verified: boolean;
  declaredAt: string | null;
}

/** CBAM factors are declared in tCO2e per tonne (or per MWh); Scope 3 works in kg. */
export function cbamFactorToKg(tco2ePerUnit: number): number {
  return tco2ePerUnit * 1000;
}

/** Map survey unit choices onto the units the Scope 3 engine understands. */
const SURVEY_UNIT_MAP: Record<string, string> = {
  metric_tons: 'tonnes',
  kg: 'kg',
  mwh: 'MWh',
  units: 'units',
  cubic_meters: 'm3',
};

export function mapSurveyUnit(unit: string): string | null {
  return SURVEY_UNIT_MAP[unit.trim().toLowerCase()] ?? null;
}

export interface CbamFactorRow {
  supplier_id: string | null;
  supplier_name: string;
  commodity_name: string;
  emission_factor: number;   // tCO2e per factor_unit
  factor_unit: string;       // 'tonne' | 'MWh'
  factor_source: string | null;
  created_at: string;
}

/** Normalize a supplier-declared CBAM factor into a Category 1 declaration. */
export function declarationFromCbamFactor(row: CbamFactorRow): SupplierDeclaration {
  return {
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    source: 'cbam_factor',
    sourceLabel: row.factor_source?.trim()
      ? `Supplier CBAM declaration — ${row.factor_source.trim()}`
      : `Supplier CBAM declaration — ${row.supplier_name}`,
    intensityKgCo2e: cbamFactorToKg(Number(row.emission_factor)),
    unit: row.factor_unit === 'MWh' ? 'MWh' : 'tonnes',
    product: row.commodity_name,
    dataYear: row.created_at ? new Date(row.created_at).getUTCFullYear() : null,
    verified: false, // CBAM factor rows carry no verification flag of their own
    declaredAt: row.created_at ?? null,
  };
}

/**
 * Normalize a CBAM survey response into a declaration. Returns null when the
 * response lacks a usable intensity or unit — a partial disclosure must not be
 * silently turned into a number.
 */
export function declarationFromSurveyAnswers(
  supplierId: string | null,
  supplierName: string,
  answers: Record<string, string>,
  submittedAt: string | null,
): SupplierDeclaration | null {
  // A blank answer must not become a declared zero — Number('') is 0, which
  // would silently understate the supplier's emissions. Absent means absent.
  const rawIntensity = (answers.q3_co2e_intensity ?? '').trim();
  if (!rawIntensity) return null;
  const intensity = Number(rawIntensity);
  if (!Number.isFinite(intensity) || intensity < 0) return null;

  const unit = mapSurveyUnit(answers.q2_unit ?? '');
  if (!unit) return null;

  const verified = (answers.q6_verified ?? '').trim().toLowerCase() === 'yes';
  const verificationRef = (answers.q7_verification ?? '').trim();

  return {
    supplierId,
    supplierName,
    source: 'survey_response',
    // The survey asks for DIRECT intensity: narrower than the cradle-to-gate
    // boundary a Scope 3 Category 1 factor assumes (the supplier's purchased
    // energy and inputs are missing). Said in the label so the figure is never
    // read as full scope. The reference is clipped so the label fits
    // scope3_entries.factor_source (VARCHAR 255).
    sourceLabel: verified && verificationRef
      ? `Supplier CBAM survey response (third-party verified: ${verificationRef.slice(0, 120)}; direct emissions only, partial cradle-to-gate)`
      : 'Supplier CBAM survey response (self-declared; direct emissions only, partial cradle-to-gate)',
    intensityKgCo2e: intensity,
    unit,
    product: (answers.q1 ?? '').trim() || null,
    dataYear: submittedAt ? new Date(submittedAt).getUTCFullYear() : null,
    verified,
    declaredAt: submittedAt,
  };
}

// ─── Supplier data-quality scoring ───────────────────────────────────────────

export interface ScoreComponent {
  label: string;
  points: number;
  max: number;
  met: boolean;
}

export interface SupplierScore {
  supplierId: string | null;
  supplierName: string;
  score: number;      // 0-100
  components: ScoreComponent[];
}

export interface SupplierScoreInput {
  supplierId: string | null;
  supplierName: string;
  invited: boolean;
  responded: boolean;
  declaration: SupplierDeclaration | null;
  /** Reporting year used to judge recency. */
  currentYear: number;
}

/**
 * Transparent, component-based supplier data score. Deliberately not a black
 * box — the UI shows the breakdown, so a supplier manager can see exactly what
 * would raise the score, and an assurer can see what it means.
 */
export function scoreSupplier(input: SupplierScoreInput): SupplierScore {
  const d = input.declaration;
  const recent =
    d?.dataYear != null && input.currentYear - d.dataYear <= 2;

  const components: ScoreComponent[] = [
    { label: 'Invited to disclose',        max: 10, met: input.invited,         points: 0 },
    { label: 'Responded',                  max: 20, met: input.responded,       points: 0 },
    { label: 'Provided emission factor',   max: 40, met: d != null,             points: 0 },
    { label: 'Third-party verified',       max: 20, met: d?.verified === true,  points: 0 },
    { label: 'Data from last 2 years',     max: 10, met: recent === true,       points: 0 },
  ].map((c) => ({ ...c, points: c.met ? c.max : 0 }));

  return {
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    score: components.reduce((s, c) => s + c.points, 0),
    components,
  };
}

/** Supplier data-quality band, for at-a-glance prioritisation. */
export function scoreBand(score: number): 'strong' | 'partial' | 'weak' | 'none' {
  if (score >= 80) return 'strong';
  if (score >= 50) return 'partial';
  if (score > 0)   return 'weak';
  return 'none';
}
