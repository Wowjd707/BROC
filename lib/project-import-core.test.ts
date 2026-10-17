import { describe, it, expect } from 'vitest';
import {
  mapProjectRow, canonicalizeProjectRow,
  PROJECT_IMPORT_HEADERS, PROJECT_COLUMN_LABELS,
} from './project-import-core';

const none = new Set<string>();

const row = (over: Record<string, string> = {}): Record<string, string> => ({
  name: 'LED retrofit, Riverside', category: 'energy_efficiency', ...over,
});

describe('headers', () => {
  it('are spaced and capitalized, with no underscores', () => {
    expect(PROJECT_IMPORT_HEADERS[0]).toBe('Project Name');
    for (const h of PROJECT_IMPORT_HEADERS) expect(h).not.toMatch(/_/);
  });
});

describe('canonicalizeProjectRow', () => {
  it('maps the unit-bearing labels, none of which round-trip', () => {
    // Every savings label carries a numeral and a unit, so almost none survives
    // normalization. They are all optional, so a missing alias would import the
    // project with no savings and leave the reduction pipeline reading zero.
    const r = canonicalizeProjectRow({
      estimated_co2e_saving_kg_per_year: '1000',
      estimated_water_saving_gal_per_year: '2000',
      estimated_waste_saving_kg_per_year: '300',
      pipeline_inclusion: 'forecasted',
    });
    expect(r.estimated_co2e_kg).toBe('1000');
    expect(r.estimated_water_gal).toBe('2000');
    expect(r.estimated_waste_kg).toBe('300');
    expect(r.pipeline_status).toBe('forecasted');
  });

  it('accepts the database column names too', () => {
    // Somebody exporting from the table rather than the template.
    expect(canonicalizeProjectRow({ estimated_co2e_reduction_kg_per_year: '5' })
      .estimated_co2e_kg).toBe('5');
  });
});

describe('mapProjectRow', () => {
  it('maps a full row', () => {
    const r = mapProjectRow(row({
      status: 'In progress',
      site: 'Riverside Plant',
      goal: 'Halve Scope 1 and 2 by 2032',
      estimated_co2e_kg: '48,000',
      estimated_cost_usd: '$120,000',
      start_date: '2026-03-01',
      target_completion_date: '2026-09-30',
      pipeline_status: 'forecasted',
    }), none);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.project).toMatchObject({
        category: 'energy_efficiency',
        status: 'in_progress',
        siteName: 'Riverside Plant',
        goalName: 'Halve Scope 1 and 2 by 2032',
        estimatedCo2eKg: 48000,
        estimatedCostUsd: 120000,
        pipelineStatus: 'forecasted',
      });
    }
  });

  it('rejects a row with no name', () => {
    const r = mapProjectRow(row({ name: '' }), none);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(PROJECT_COLUMN_LABELS.name);
  });

  it('requires a category rather than guessing one', () => {
    // The column is NOT NULL with no default, and "other" would be a guess that
    // quietly miscategorises the reduction pipeline.
    const r = mapProjectRow(row({ category: '' }), none);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(PROJECT_COLUMN_LABELS.category);
  });

  it('resolves category and status by label or key', () => {
    const a = mapProjectRow(row({ category: 'Renewable energy', status: 'Completed', actual_co2e_kg: '10' }), none);
    if (a.ok) {
      expect(a.project.category).toBe('renewable_energy');
      expect(a.project.status).toBe('completed');
    }
  });

  it('rejects a category outside the vocabulary', () => {
    // The column has a CHECK, so this would otherwise arrive as a database error
    // naming a constraint rather than a row.
    expect(mapProjectRow(row({ category: 'Insulation' }), none).ok).toBe(false);
  });

  it('defaults status to idea and pipeline to excluded', () => {
    const r = mapProjectRow(row(), none);
    if (r.ok) {
      expect(r.project.status).toBe('idea');
      expect(r.project.pipelineStatus).toBe('excluded');
    }
  });

  describe('numbers and dates', () => {
    it('strips currency and separators', () => {
      const r = mapProjectRow(row({ estimated_cost_usd: '$ 1,250,000' }), none);
      if (r.ok) expect(r.project.estimatedCostUsd).toBe(1250000);
    });

    it('rejects a negative saving', () => {
      expect(mapProjectRow(row({ estimated_co2e_kg: '-5' }), none).ok).toBe(false);
    });

    it('requires ISO dates', () => {
      expect(mapProjectRow(row({ start_date: '01/03/2026' }), none).ok).toBe(false);
    });

    it('refuses a completion date before the start', () => {
      const r = mapProjectRow(row({
        start_date: '2026-09-01', target_completion_date: '2026-03-01',
      }), none);
      expect(r.ok).toBe(false);
    });
  });

  describe('the pipeline warning', () => {
    it('warns when savings are recorded but excluded from the pipeline', () => {
      // The quiet one. pipeline_inclusion_status defaults to excluded, so a
      // project imported with savings and that column blank is stored correctly
      // and counts for nothing, with nothing on screen saying so.
      const r = mapProjectRow(row({ estimated_co2e_kg: '48000' }), none);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.project.pipelineStatus).toBe('excluded');
        expect(r.project.warnings.some(w => /will not count/i.test(w))).toBe(true);
      }
    });

    it('does not warn when the project is deliberately in the pipeline', () => {
      const r = mapProjectRow(
        row({ estimated_co2e_kg: '48000', pipeline_status: 'forecasted' }), none);
      if (r.ok) expect(r.project.warnings.some(w => /will not count/i.test(w))).toBe(false);
    });

    it('does not warn when there are no savings to exclude', () => {
      const r = mapProjectRow(row(), none);
      if (r.ok) expect(r.project.warnings.some(w => /will not count/i.test(w))).toBe(false);
    });

    it('counts water and waste savings, not only carbon', () => {
      const r = mapProjectRow(row({ estimated_water_gal: '500000' }), none);
      if (r.ok) expect(r.project.warnings.some(w => /will not count/i.test(w))).toBe(true);
    });
  });

  it('warns about a completed project with an estimate but no actual', () => {
    // Reporting an achieved reduction needs the achieved figure, not the
    // forecast it replaced.
    const r = mapProjectRow(row({
      status: 'completed', estimated_co2e_kg: '48000', pipeline_status: 'realized',
    }), none);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.warnings.some(w => /no actual saving/i.test(w))).toBe(true);
  });

  it('flags a project already on the list', () => {
    const r = mapProjectRow(row(), new Set(['led retrofit, riverside']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect('duplicate' in r && r.duplicate).toBe(true);
  });
});
