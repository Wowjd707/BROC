import { describe, it, expect } from 'vitest';
import {
  cbamFactorToKg,
  mapSurveyUnit,
  declarationFromCbamFactor,
  declarationFromSurveyAnswers,
  scoreSupplier,
  scoreBand,
  type CbamFactorRow,
} from './supplier-data-core';

describe('cbamFactorToKg', () => {
  it('converts tCO2e to kg CO2e', () => {
    expect(cbamFactorToKg(2.123)).toBeCloseTo(2123, 6);
  });
});

describe('mapSurveyUnit', () => {
  it('maps known survey units to engine units', () => {
    expect(mapSurveyUnit('metric_tons')).toBe('tonnes');
    expect(mapSurveyUnit('MWh')).toBe('MWh');
    expect(mapSurveyUnit('kg')).toBe('kg');
  });
  it('returns null for unmapped units', () => {
    expect(mapSurveyUnit('other')).toBeNull();
    expect(mapSurveyUnit('')).toBeNull();
  });
});

describe('declarationFromCbamFactor', () => {
  const row: CbamFactorRow = {
    supplier_id: 's1',
    supplier_name: 'Steelcore Industries',
    commodity_name: 'Hot-rolled coil',
    emission_factor: 2.1,
    factor_unit: 'tonne',
    factor_source: 'Declaration 2025-01-15',
    created_at: '2025-01-15T00:00:00Z',
  };

  it('converts to kg per tonne and cites the supplier declaration', () => {
    const d = declarationFromCbamFactor(row);
    expect(d.intensityKgCo2e).toBeCloseTo(2100, 6);
    expect(d.unit).toBe('tonnes');
    expect(d.source).toBe('cbam_factor');
    expect(d.sourceLabel).toContain('Declaration 2025-01-15');
    expect(d.dataYear).toBe(2025);
  });

  it('falls back to the supplier name when no source is recorded', () => {
    const d = declarationFromCbamFactor({ ...row, factor_source: null });
    expect(d.sourceLabel).toContain('Steelcore Industries');
  });

  it('keeps MWh for electricity factors', () => {
    const d = declarationFromCbamFactor({ ...row, factor_unit: 'MWh' });
    expect(d.unit).toBe('MWh');
  });
});

describe('declarationFromSurveyAnswers', () => {
  const answers = {
    q1: 'Hot-rolled coil steel',
    q2_unit: 'metric_tons',
    q3_co2e_intensity: '2140',
    q6_verified: 'yes',
    q7_verification: 'BV-2024-DE-8821',
  };

  it('builds a verified declaration', () => {
    const d = declarationFromSurveyAnswers('s1', 'Steelcore', answers, '2025-02-01T00:00:00Z');
    expect(d).not.toBeNull();
    expect(d!.intensityKgCo2e).toBe(2140);
    expect(d!.unit).toBe('tonnes');
    expect(d!.verified).toBe(true);
    expect(d!.sourceLabel).toContain('BV-2024-DE-8821');
    expect(d!.dataYear).toBe(2025);
  });

  it('marks self-declared when not verified', () => {
    const d = declarationFromSurveyAnswers('s1', 'Steelcore', { ...answers, q6_verified: 'no' }, null);
    expect(d!.verified).toBe(false);
    expect(d!.sourceLabel).toContain('self-declared');
  });

  it('returns null when the intensity is missing or invalid', () => {
    expect(declarationFromSurveyAnswers('s1', 'X', { ...answers, q3_co2e_intensity: '' }, null)).toBeNull();
    expect(declarationFromSurveyAnswers('s1', 'X', { ...answers, q3_co2e_intensity: 'n/a' }, null)).toBeNull();
    expect(declarationFromSurveyAnswers('s1', 'X', { ...answers, q3_co2e_intensity: '-5' }, null)).toBeNull();
  });

  it('returns null when the unit cannot be mapped', () => {
    expect(declarationFromSurveyAnswers('s1', 'X', { ...answers, q2_unit: 'other' }, null)).toBeNull();
  });
});

describe('scoreSupplier', () => {
  const base = { supplierId: 's1', supplierName: 'Acme', currentYear: 2026 };

  it('scores a fully-disclosing verified supplier at 100', () => {
    const s = scoreSupplier({
      ...base,
      invited: true,
      responded: true,
      declaration: {
        supplierId: 's1', supplierName: 'Acme', source: 'survey_response',
        sourceLabel: 'x', intensityKgCo2e: 100, unit: 'tonnes',
        product: null, dataYear: 2025, verified: true, declaredAt: null,
      },
    });
    expect(s.score).toBe(100);
    expect(s.components.every(c => c.met)).toBe(true);
  });

  it('scores an un-engaged supplier at 0', () => {
    const s = scoreSupplier({ ...base, invited: false, responded: false, declaration: null });
    expect(s.score).toBe(0);
  });

  it('gives partial credit for responding without a factor', () => {
    const s = scoreSupplier({ ...base, invited: true, responded: true, declaration: null });
    expect(s.score).toBe(30); // invited 10 + responded 20
  });

  it('drops the recency component for stale data', () => {
    const s = scoreSupplier({
      ...base,
      invited: true,
      responded: true,
      declaration: {
        supplierId: 's1', supplierName: 'Acme', source: 'cbam_factor',
        sourceLabel: 'x', intensityKgCo2e: 100, unit: 'tonnes',
        product: null, dataYear: 2019, verified: false, declaredAt: null,
      },
    });
    expect(s.components.find(c => c.label === 'Data from last 2 years')!.met).toBe(false);
    expect(s.score).toBe(70); // 10 + 20 + 40
  });

  it('exposes a transparent component breakdown summing to the score', () => {
    const s = scoreSupplier({ ...base, invited: true, responded: true, declaration: null });
    expect(s.components.reduce((t, c) => t + c.points, 0)).toBe(s.score);
    expect(s.components.reduce((t, c) => t + c.max, 0)).toBe(100);
  });
});

describe('scoreBand', () => {
  it('bands scores for prioritisation', () => {
    expect(scoreBand(100)).toBe('strong');
    expect(scoreBand(80)).toBe('strong');
    expect(scoreBand(50)).toBe('partial');
    expect(scoreBand(10)).toBe('weak');
    expect(scoreBand(0)).toBe('none');
  });
});
