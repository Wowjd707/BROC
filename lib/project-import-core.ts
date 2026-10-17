/**
 * Pure mapping and validation for bulk project uploads.
 *
 * The savings columns are the ones to be careful with, for a reason the schema
 * does not enforce. `pipeline_inclusion_status` decides whether a project's
 * numbers enter the reduction pipeline, and its default is `excluded` — so a
 * project imported with savings filled in and that column blank is stored
 * correctly and counts for nothing. That is the right default, since an idea
 * with an optimistic estimate should not move a reported forecast, but it is
 * silent. So a row carrying savings while excluded is warned about.
 *
 * Units are canonical and unconverted, per migration 021: carbon in kg CO₂e,
 * water in US gallons, waste in kg, all per year. A project's savings are
 * therefore directly comparable to entry totals with no conversion step.
 */

export const PROJECT_IMPORT_COLUMNS = [
  'name', 'category', 'status', 'site', 'goal',
  'estimated_co2e_kg', 'actual_co2e_kg',
  'estimated_water_gal', 'estimated_waste_kg',
  'estimated_cost_usd', 'start_date', 'target_completion_date',
  'pipeline_status', 'description',
] as const;

export type ProjectImportColumn = (typeof PROJECT_IMPORT_COLUMNS)[number];

export const PROJECT_COLUMN_LABELS: Record<ProjectImportColumn, string> = {
  name: 'Project Name',
  category: 'Category',
  status: 'Status',
  site: 'Site',
  goal: 'Goal',
  estimated_co2e_kg: 'Estimated CO2e Saving Kg Per Year',
  actual_co2e_kg: 'Actual CO2e Saving Kg Per Year',
  estimated_water_gal: 'Estimated Water Saving Gal Per Year',
  estimated_waste_kg: 'Estimated Waste Saving Kg Per Year',
  estimated_cost_usd: 'Estimated Cost USD',
  start_date: 'Start Date',
  target_completion_date: 'Target Completion Date',
  pipeline_status: 'Pipeline Inclusion',
  description: 'Description',
};

export const PROJECT_IMPORT_HEADERS: string[] =
  PROJECT_IMPORT_COLUMNS.map((c) => PROJECT_COLUMN_LABELS[c]);

export const PROJECT_EXAMPLE_ROW_NOTE = 'Example row — delete before uploading';

/** Matches the CHECK on projects.category. */
export const PROJECT_CATEGORIES = [
  'energy_efficiency', 'renewable_energy', 'fleet', 'refrigerants',
  'waste', 'water', 'process', 'other',
] as const;

export const PROJECT_CATEGORY_LABELS: Record<string, string> = {
  energy_efficiency: 'Energy efficiency',
  renewable_energy: 'Renewable energy',
  fleet: 'Fleet',
  refrigerants: 'Refrigerants',
  waste: 'Waste',
  water: 'Water',
  process: 'Process',
  other: 'Other',
};

export const PROJECT_STATUSES = [
  'idea', 'approved', 'in_progress', 'completed', 'cancelled',
] as const;

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  idea: 'Idea',
  approved: 'Approved',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const PIPELINE_STATUSES = ['excluded', 'forecasted', 'realized'] as const;

export const PIPELINE_STATUS_LABELS: Record<string, string> = {
  excluded: 'Excluded — does not count toward the pipeline',
  forecasted: 'Forecasted — counts as an expected saving',
  realized: 'Realized — counts as an achieved saving',
};

/**
 * Header spellings that do not survive `lib/csv.ts`.
 *
 * Most of these labels carry a numeral or a unit, so almost none round-trips:
 * "Estimated CO2e Saving Kg Per Year" becomes estimated_co2e_saving_kg_per_year.
 * Every one of them is optional, so a missing alias would import the project
 * with no savings at all — a reduction pipeline quietly reading zero.
 */
const HEADER_ALIASES: Record<string, ProjectImportColumn> = {
  project_name: 'name',
  project: 'name',
  estimated_co2e_saving_kg_per_year: 'estimated_co2e_kg',
  estimated_co2e_reduction_kg_per_year: 'estimated_co2e_kg',
  estimated_co2e: 'estimated_co2e_kg',
  actual_co2e_saving_kg_per_year: 'actual_co2e_kg',
  actual_co2e_reduction_kg_per_year: 'actual_co2e_kg',
  actual_co2e: 'actual_co2e_kg',
  estimated_water_saving_gal_per_year: 'estimated_water_gal',
  estimated_water_reduction_gal_per_year: 'estimated_water_gal',
  estimated_waste_saving_kg_per_year: 'estimated_waste_kg',
  estimated_waste_reduction_kg_per_year: 'estimated_waste_kg',
  estimated_cost: 'estimated_cost_usd',
  cost: 'estimated_cost_usd',
  pipeline_inclusion: 'pipeline_status',
  pipeline_inclusion_status: 'pipeline_status',
  pipeline: 'pipeline_status',
  site_name: 'site',
  goal_name: 'goal',
};

export function canonicalizeProjectRow(row: Record<string, string>): Record<string, string> {
  const out = { ...row };
  for (const [alias, canonical] of Object.entries(HEADER_ALIASES)) {
    if (out[alias] !== undefined && out[canonical] === undefined) {
      out[canonical] = out[alias];
    }
  }
  return out;
}

export interface MappedProject {
  name: string;
  category: string;
  status: string;
  /** Names, resolved to ids by the server. */
  siteName: string | null;
  goalName: string | null;
  estimatedCo2eKg: number | null;
  actualCo2eKg: number | null;
  estimatedWaterGal: number | null;
  estimatedWasteKg: number | null;
  estimatedCostUsd: number | null;
  startDate: string | null;
  targetCompletionDate: string | null;
  pipelineStatus: string;
  description: string | null;
  warnings: string[];
}

export type ProjectRowResult =
  | { ok: true; project: MappedProject }
  | { ok: false; error: string }
  | { ok: false; error: string; duplicate: true };

function resolve(
  value: string,
  keys: readonly string[],
  labels: Record<string, string>,
): string | undefined {
  const lower = value.trim().toLowerCase();
  if (keys.includes(lower)) return lower;
  for (const [key, label] of Object.entries(labels)) {
    if (label.toLowerCase() === lower) return key;
    // The pipeline labels carry an explanation after a dash; match the word too.
    const short = label.split('—')[0].trim().toLowerCase();
    if (short && short === lower) return key;
  }
  return undefined;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function mapProjectRow(
  input: Record<string, string>,
  existingNames: Set<string>,
): ProjectRowResult {
  const row = canonicalizeProjectRow(input);
  const text = (key: ProjectImportColumn): string => (row[key] ?? '').trim();
  const warnings: string[] = [];

  const name = text('name');
  if (!name) return { ok: false, error: `Missing ${PROJECT_COLUMN_LABELS.name}.` };

  if (existingNames.has(name.toLowerCase())) {
    return { ok: false, duplicate: true, error: `${name} is already one of your projects.` };
  }

  // Category has no default in the schema and is NOT NULL, so it is required
  // here rather than guessed. "other" would be a guess.
  const categoryRaw = text('category');
  if (!categoryRaw) {
    return { ok: false, error: `Missing ${PROJECT_COLUMN_LABELS.category}.` };
  }
  const category = resolve(categoryRaw, PROJECT_CATEGORIES, PROJECT_CATEGORY_LABELS);
  if (!category) {
    return {
      ok: false,
      error: `Unknown ${PROJECT_COLUMN_LABELS.category} "${categoryRaw}". Expected one of: `
        + Object.values(PROJECT_CATEGORY_LABELS).join(', ') + '.',
    };
  }

  let status = 'idea';
  const statusRaw = text('status');
  if (statusRaw) {
    const resolved = resolve(statusRaw, PROJECT_STATUSES, PROJECT_STATUS_LABELS);
    if (!resolved) {
      return {
        ok: false,
        error: `Unknown ${PROJECT_COLUMN_LABELS.status} "${statusRaw}". Expected one of: `
          + Object.values(PROJECT_STATUS_LABELS).join(', ') + '.',
      };
    }
    status = resolved;
  }

  let pipelineStatus = 'excluded';
  const pipelineRaw = text('pipeline_status');
  if (pipelineRaw) {
    const resolved = resolve(pipelineRaw, PIPELINE_STATUSES, PIPELINE_STATUS_LABELS);
    if (!resolved) {
      return {
        ok: false,
        error: `Unknown ${PROJECT_COLUMN_LABELS.pipeline_status} "${pipelineRaw}". `
          + 'Expected excluded, forecasted or realized.',
      };
    }
    pipelineStatus = resolved;
  }

  const numeric = (key: ProjectImportColumn): number | null | 'bad' => {
    const raw = text(key);
    if (!raw) return null;
    const parsed = Number(raw.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(parsed) || parsed < 0) return 'bad';
    return parsed;
  };

  const values: Partial<Record<ProjectImportColumn, number | null>> = {};
  for (const key of [
    'estimated_co2e_kg', 'actual_co2e_kg', 'estimated_water_gal',
    'estimated_waste_kg', 'estimated_cost_usd',
  ] as ProjectImportColumn[]) {
    const v = numeric(key);
    if (v === 'bad') {
      return {
        ok: false,
        error: `${PROJECT_COLUMN_LABELS[key]} must be a number that is not negative, got "${text(key)}".`,
      };
    }
    values[key] = v;
  }

  const date = (key: ProjectImportColumn): string | null | 'bad' => {
    const raw = text(key);
    if (!raw) return null;
    return ISO_DATE.test(raw) ? raw : 'bad';
  };

  const startDate = date('start_date');
  if (startDate === 'bad') {
    return {
      ok: false,
      error: `${PROJECT_COLUMN_LABELS.start_date} must be YYYY-MM-DD, got "${text('start_date')}".`,
    };
  }
  const targetDate = date('target_completion_date');
  if (targetDate === 'bad') {
    return {
      ok: false,
      error: `${PROJECT_COLUMN_LABELS.target_completion_date} must be YYYY-MM-DD, got `
        + `"${text('target_completion_date')}".`,
    };
  }
  if (startDate && targetDate && targetDate < startDate) {
    return {
      ok: false,
      error: `${PROJECT_COLUMN_LABELS.target_completion_date} (${targetDate}) is before `
        + `${PROJECT_COLUMN_LABELS.start_date} (${startDate}).`,
    };
  }

  const hasSavings = [
    values.estimated_co2e_kg, values.actual_co2e_kg,
    values.estimated_water_gal, values.estimated_waste_kg,
  ].some((v) => v !== null && v !== undefined && v > 0);

  // The quiet one. A project with savings and pipeline_inclusion_status left at
  // its default is stored correctly and counts for nothing, and nothing on
  // screen says so.
  if (hasSavings && pipelineStatus === 'excluded') {
    warnings.push(
      `${name}: has savings figures but ${PROJECT_COLUMN_LABELS.pipeline_status} is "excluded", `
      + 'so they will not count toward the reduction pipeline. Set it to forecasted or realized '
      + 'if they should.',
    );
  }

  if (status === 'completed' && (values.actual_co2e_kg ?? 0) === 0
      && (values.estimated_co2e_kg ?? 0) > 0) {
    warnings.push(
      `${name}: marked completed with an estimate but no actual saving. Reporting an achieved `
      + 'reduction needs the actual figure.',
    );
  }

  return {
    ok: true,
    project: {
      name, category, status,
      siteName: text('site') || null,
      goalName: text('goal') || null,
      estimatedCo2eKg: values.estimated_co2e_kg ?? null,
      actualCo2eKg: values.actual_co2e_kg ?? null,
      estimatedWaterGal: values.estimated_water_gal ?? null,
      estimatedWasteKg: values.estimated_waste_kg ?? null,
      estimatedCostUsd: values.estimated_cost_usd ?? null,
      startDate: startDate ?? null,
      targetCompletionDate: targetDate ?? null,
      pipelineStatus,
      description: text('description') || null,
      warnings,
    },
  };
}

export interface ProjectImportSummary {
  imported: number;
  skipped: number;
  failed: number;
  errors: { line: number; message: string }[];
  warnings: { line: number; message: string }[];
}
