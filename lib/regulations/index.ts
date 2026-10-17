/**
 * Pre-built question sets for each regulation type.
 * These are loaded by the supplier survey public page and the survey preview.
 */

export type QuestionType = 'text' | 'number' | 'select' | 'yes_no' | 'date' | 'file_or_text';

export interface SurveyQuestion {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  unit?: string;
  options?: { value: string; label: string }[];
  helpText?: string;
  /** If true, only show when a prior question has a specific answer */
  showWhen?: { questionId: string; answer: string };
}

export interface RegulationQuestionSet {
  regulationType: string;
  title: string;
  description: string;
  questions: SurveyQuestion[];
}

// ─── CBAM ────────────────────────────────────────────────────────────────────
export const CBAM_QUESTIONS: RegulationQuestionSet = {
  regulationType: 'cbam',
  title: 'Carbon Border Adjustment Mechanism (CBAM) Disclosure',
  description:
    'Please answer the following questions about the carbon content of products you supply. This information is required for EU CBAM compliance reporting.',
  questions: [
    {
      id: 'q1',
      label: 'What product(s) do you supply to us?',
      type: 'text',
      required: true,
      helpText: 'Describe the specific product or product category (e.g., hot-rolled coil steel, cement clinker).',
    },
    {
      id: 'q2_quantity',
      label: 'What is the annual production/supply volume of this product?',
      type: 'number',
      required: true,
    },
    {
      id: 'q2_unit',
      label: 'Unit of production volume',
      type: 'select',
      required: true,
      options: [
        { value: 'metric_tons', label: 'Metric Tons (t)' },
        { value: 'kg', label: 'Kilograms (kg)' },
        { value: 'mwh', label: 'MWh' },
        { value: 'units', label: 'Units / Pieces' },
        { value: 'cubic_meters', label: 'Cubic Meters (m³)' },
        { value: 'other', label: 'Other' },
      ],
    },
    {
      id: 'q3_co2e_intensity',
      label: 'What is the direct carbon intensity of production? (kg CO₂e per unit of product)',
      type: 'number',
      required: true,
      helpText: 'Direct emissions from your production process per unit of product output. Use the same unit as your production volume above.',
    },
    {
      id: 'q4_fuel',
      label: 'What is the primary fuel / energy source used in production?',
      type: 'select',
      required: true,
      options: [
        { value: 'electricity', label: 'Grid Electricity' },
        { value: 'natural_gas', label: 'Natural Gas' },
        { value: 'coal', label: 'Coal' },
        { value: 'oil', label: 'Oil / Heavy Fuel Oil' },
        { value: 'biomass', label: 'Biomass' },
        { value: 'renewable', label: 'Renewable Energy (on-site)' },
        { value: 'mixed', label: 'Mixed / Multiple Sources' },
        { value: 'other', label: 'Other' },
      ],
    },
    {
      id: 'q5_country',
      label: 'Country of production',
      type: 'text',
      required: true,
      helpText: 'Country where the product is manufactured.',
    },
    {
      id: 'q6_verified',
      label: 'Do you have third-party verified emissions data for this product?',
      type: 'yes_no',
      required: true,
    },
    {
      id: 'q7_verification',
      label: 'Please provide the verification statement, certificate number, or link.',
      type: 'file_or_text',
      required: false,
      showWhen: { questionId: 'q6_verified', answer: 'yes' },
    },
  ],
};

// ─── EUDR ────────────────────────────────────────────────────────────────────
export const EUDR_QUESTIONS: RegulationQuestionSet = {
  regulationType: 'eudr',
  title: 'EU Deforestation Regulation (EUDR) Due Diligence',
  description:
    'The EU Deforestation Regulation (EUDR) requires that products sold in the EU have not contributed to deforestation after December 31, 2020. Please complete this disclosure.',
  questions: [
    {
      id: 'q1_commodity',
      label: 'What commodity or product do you supply?',
      type: 'select',
      required: true,
      options: [
        { value: 'cattle', label: 'Cattle / Beef / Leather' },
        { value: 'cocoa', label: 'Cocoa' },
        { value: 'coffee', label: 'Coffee' },
        { value: 'palm_oil', label: 'Palm Oil' },
        { value: 'soy', label: 'Soy' },
        { value: 'wood', label: 'Wood / Timber / Pulp / Paper' },
        { value: 'rubber', label: 'Rubber' },
        { value: 'derived', label: 'Derived products from above' },
        { value: 'other', label: 'Other' },
      ],
    },
    {
      id: 'q2_origin',
      label: 'Country and region of origin',
      type: 'text',
      required: true,
      helpText: 'E.g., "Pará State, Brazil" or "Central Kalimantan, Indonesia".',
    },
    {
      id: 'q3_gps',
      label: 'GPS coordinates or polygon of the production area',
      type: 'text',
      required: false,
      helpText: 'Provide latitude/longitude coordinates or a polygon in GeoJSON format. Required for EUDR operator compliance.',
    },
    {
      id: 'q4_deforestation_free',
      label:
        'Do you have documented evidence that this product is deforestation-free after December 31, 2020?',
      type: 'yes_no',
      required: true,
    },
    {
      id: 'q5_documentation',
      label: 'What documentation exists to support this?',
      type: 'select',
      required: true,
      options: [
        { value: 'satellite', label: 'Satellite monitoring data' },
        { value: 'certification', label: 'Third-party certification (FSC, RSPO, etc.)' },
        { value: 'government', label: 'Government declaration / land registry' },
        { value: 'audit', label: 'Independent audit report' },
        { value: 'other', label: 'Other documentation' },
        { value: 'none', label: 'No documentation available' },
      ],
    },
    {
      id: 'q6_certification',
      label: 'Certification name and certificate number (if applicable)',
      type: 'text',
      required: false,
      showWhen: { questionId: 'q5_documentation', answer: 'certification' },
    },
    {
      id: 'q7_due_diligence',
      label:
        'Are you able to provide a EUDR Due Diligence Statement if requested by a customer or EU authority?',
      type: 'yes_no',
      required: true,
    },
  ],
};

// ─── PFAS ────────────────────────────────────────────────────────────────────
export const PFAS_QUESTIONS: RegulationQuestionSet = {
  regulationType: 'pfas',
  title: 'PFAS (Per- and Polyfluoroalkyl Substances) Disclosure',
  description:
    'This survey collects information about the presence of PFAS substances in products and components you supply, in support of our compliance with applicable PFAS regulations.',
  questions: [
    {
      id: 'q1_intentional_pfas',
      label: 'Do any products or components you supply contain intentionally added PFAS?',
      type: 'yes_no',
      required: true,
    },
    {
      id: 'q2_pfas_list',
      label: 'If yes, list the specific PFAS substances present.',
      type: 'text',
      required: false,
      showWhen: { questionId: 'q1_intentional_pfas', answer: 'yes' },
      helpText: 'Include CAS numbers where available.',
    },
    {
      id: 'q3_incidental_pfas',
      label:
        'Are any PFAS present incidentally (as contaminants or processing aids)?',
      type: 'yes_no',
      required: true,
    },
    {
      id: 'q4_phaseout_plan',
      label: 'Do you have a PFAS phase-out plan?',
      type: 'select',
      required: true,
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
        { value: 'na', label: 'Not Applicable (no PFAS in our products)' },
      ],
    },
    {
      id: 'q5_phaseout_date',
      label: 'Target phase-out completion date',
      type: 'date',
      required: false,
      showWhen: { questionId: 'q4_phaseout_plan', answer: 'yes' },
    },
    {
      id: 'q6_compliance',
      label:
        'Are your products compliant with applicable PFAS regulations in your country/region of sale?',
      type: 'yes_no',
      required: true,
    },
    {
      id: 'q7_contact',
      label: 'Contact name and email for follow-up questions',
      type: 'text',
      required: true,
      helpText: 'E.g., "Jane Smith, jsmith@company.com"',
    },
  ],
};

// ─── General Carbon ───────────────────────────────────────────────────────────
export const GENERAL_CARBON_QUESTIONS: RegulationQuestionSet = {
  regulationType: 'general_carbon',
  title: 'General Carbon Footprint Disclosure',
  description:
    'This survey gathers information about your organization\'s greenhouse gas emissions and carbon reduction efforts to support our Scope 3 supply chain reporting.',
  questions: [
    {
      id: 'q1_measure',
      label: 'Do you measure your Scope 1 and Scope 2 greenhouse gas emissions?',
      type: 'yes_no',
      required: true,
    },
    {
      id: 'q2_emissions',
      label:
        'What were your total Scope 1 + Scope 2 emissions in the most recent reporting year?',
      type: 'number',
      required: false,
      unit: 'metric tons CO₂e',
      showWhen: { questionId: 'q1_measure', answer: 'yes' },
    },
    {
      id: 'q3_verified',
      label: 'Do you have a third-party verified GHG inventory?',
      type: 'yes_no',
      required: true,
    },
    {
      id: 'q4_target',
      label: 'Do you have a carbon reduction target?',
      type: 'yes_no',
      required: true,
    },
    {
      id: 'q5_target_description',
      label: 'Please describe your carbon reduction target.',
      type: 'text',
      required: false,
      showWhen: { questionId: 'q4_target', answer: 'yes' },
      helpText: 'E.g., "50% absolute reduction in Scope 1+2 by 2030 from 2020 baseline" or "Net zero by 2050".',
    },
    {
      id: 'q6_renewable',
      label: 'Do you purchase or generate renewable energy?',
      type: 'yes_no',
      required: true,
    },
    {
      id: 'q6_renewable_pct',
      label: 'What percentage of your electricity consumption is renewable?',
      type: 'number',
      required: false,
      unit: '%',
      showWhen: { questionId: 'q6_renewable', answer: 'yes' },
    },
    {
      id: 'q7_share_inventory',
      label: 'Are you willing to share your GHG inventory report with us?',
      type: 'yes_no',
      required: true,
    },
  ],
};

// ─── Registry ────────────────────────────────────────────────────────────────
export const QUESTION_SETS: Record<string, RegulationQuestionSet> = {
  cbam:            CBAM_QUESTIONS,
  eudr:            EUDR_QUESTIONS,
  pfas:            PFAS_QUESTIONS,
  general_carbon:  GENERAL_CARBON_QUESTIONS,
};

export function getQuestionSet(regulationType: string): RegulationQuestionSet | null {
  return QUESTION_SETS[regulationType] ?? null;
}

export const REGULATION_LABELS: Record<string, string> = {
  cbam:           'CBAM',
  eudr:           'EUDR',
  pfas:           'PFAS',
  general_carbon: 'General Carbon',
  custom:         'Custom',
};

/**
 * What to call a survey's regulation on screen.
 *
 * For the four named regimes this is just the label. For a custom survey it is
 * whatever the team typed, because "Custom" tells a supplier nothing about what
 * they are being asked to disclose — and the supplier is the one person in this
 * flow who cannot ask a follow-up question.
 *
 * Falls back to the raw type rather than to an empty string, so an unrecognised
 * value shows as itself instead of vanishing. A badge that renders blank reads
 * as a layout bug; one reading `eudr_v2` reads as data needing attention.
 */
export function regulationLabel(
  regulationType: string,
  customRegulationName?: string | null,
): string {
  if (regulationType === 'custom') {
    const named = customRegulationName?.trim();
    if (named) return named;
    // Only reachable for rows predating migration 036's constraint.
    return REGULATION_LABELS.custom;
  }
  return REGULATION_LABELS[regulationType] ?? regulationType;
}
