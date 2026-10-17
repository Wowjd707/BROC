import { describe, it, expect } from 'vitest';
import {
  sourceLabel, SOURCE_LABELS,
  isDivertedWaste, DIVERTED_WASTE_SOURCES,
  isRenewableElectricity, isElectricitySource,
} from './source-labels';

/**
 * The source types the entry drawers actually write. Every classifier below is
 * tested against THESE strings rather than against plausible-looking ones.
 *
 * That distinction is the whole point of this file. Three separate KPI
 * calculations were written against invented vocabularies — `'recycled'`,
 * `'composted'`, `'waste_to_energy'`, `accounting_method === 'market'` — none
 * of which this platform has ever stored. Each silently reported 0.0% forever.
 * A classifier that is never tested against real stored values is a classifier
 * that can be wrong indefinitely without anyone noticing.
 */
const WASTE_SOURCE_TYPES_WRITTEN_BY_THE_APP = [
  'non_hazardous_landfilled',
  'non_hazardous_recycled',
  'non_hazardous_recycled_metals',
  'non_hazardous_recycled_paper',
  'non_hazardous_recycled_plastics',
  'non_hazardous_composted',
  'non_hazardous_incinerated',
  'non_hazardous_incinerated_energy',
  'non_hazardous_other',
  'non_hazardous',
  'hazardous',
  'hazardous_treated',
  'hazardous_incinerated',
  'hazardous_landfilled',
  'hazardous_other',
];

describe('sourceLabel', () => {
  it('labels a known source', () => {
    expect(sourceLabel('natural_gas')).toBe('Natural Gas');
  });
  it('falls back to a readable form, never an empty label', () => {
    expect(sourceLabel('some_new_stream')).toBe('some new stream');
  });
  it('has a label for every waste source the app writes', () => {
    for (const t of WASTE_SOURCE_TYPES_WRITTEN_BY_THE_APP) {
      expect(sourceLabel(t), t).not.toBe('');
    }
  });
});

describe('isDivertedWaste', () => {
  it('counts recycling, composting and energy recovery', () => {
    expect(isDivertedWaste('non_hazardous_recycled')).toBe(true);
    expect(isDivertedWaste('non_hazardous_recycled_metals')).toBe(true);
    expect(isDivertedWaste('non_hazardous_recycled_paper')).toBe(true);
    expect(isDivertedWaste('non_hazardous_recycled_plastics')).toBe(true);
    expect(isDivertedWaste('non_hazardous_composted')).toBe(true);
    expect(isDivertedWaste('non_hazardous_incinerated_energy')).toBe(true);
  });

  it('does not count landfill or incineration without energy recovery', () => {
    expect(isDivertedWaste('non_hazardous_landfilled')).toBe(false);
    expect(isDivertedWaste('hazardous_landfilled')).toBe(false);
    expect(isDivertedWaste('non_hazardous_incinerated')).toBe(false);
  });

  it('does not count unclassified streams as diverted', () => {
    // Guessing in the generous direction would flatter the diversion rate.
    expect(isDivertedWaste('non_hazardous_other')).toBe(false);
    expect(isDivertedWaste('hazardous_other')).toBe(false);
    expect(isDivertedWaste('non_hazardous')).toBe(false);
    expect(isDivertedWaste('hazardous')).toBe(false);
  });

  it('handles null and undefined', () => {
    expect(isDivertedWaste(null)).toBe(false);
    expect(isDivertedWaste(undefined)).toBe(false);
  });

  it('every diverted source is one the app can actually write', () => {
    // The regression guard. If a classifier lists a value no drawer produces,
    // the metric it feeds is dead on arrival and nothing else will say so.
    for (const t of DIVERTED_WASTE_SOURCES) {
      expect(WASTE_SOURCE_TYPES_WRITTEN_BY_THE_APP, t).toContain(t);
    }
  });

  it('classifies a realistic mix to a correct rate', () => {
    const rows = [
      { source_type: 'non_hazardous_landfilled', kg: 100_000 },
      { source_type: 'non_hazardous_recycled', kg: 300_000 },
      { source_type: 'non_hazardous_composted', kg: 100_000 },
    ];
    const total = rows.reduce((s, r) => s + r.kg, 0);
    const diverted = rows.filter((r) => isDivertedWaste(r.source_type))
      .reduce((s, r) => s + r.kg, 0);
    expect((diverted / total) * 100).toBeCloseTo(80, 10);
  });
});

describe('isRenewableElectricity / isElectricitySource', () => {
  it('recognises both renewable instruments', () => {
    expect(isRenewableElectricity('renewable_purchased')).toBe(true);
    expect(isRenewableElectricity('renewable_generated')).toBe(true);
  });

  it('does not treat grid electricity as renewable', () => {
    expect(isRenewableElectricity('electricity')).toBe(false);
  });

  it('counts grid and renewable together as the electricity denominator', () => {
    expect(isElectricitySource('electricity')).toBe(true);
    expect(isElectricitySource('renewable_purchased')).toBe(true);
    expect(isElectricitySource('district_heating')).toBe(false);
    expect(isElectricitySource('natural_gas')).toBe(false);
  });

  it('gives a full renewable supply 100%, not 0%', () => {
    // The previous implementation gated on accounting_method === 'market',
    // a value the CHECK constraint makes impossible, so this was always 0.
    const rows = [
      { source_type: 'renewable_purchased', kwh: 8_000_000 },
      { source_type: 'renewable_generated', kwh: 2_000_000 },
    ];
    const total = rows.filter((r) => isElectricitySource(r.source_type))
      .reduce((s, r) => s + r.kwh, 0);
    const renew = rows.filter((r) => isRenewableElectricity(r.source_type))
      .reduce((s, r) => s + r.kwh, 0);
    expect((renew / total) * 100).toBe(100);
  });

  it('every renewable label exists in SOURCE_LABELS', () => {
    expect(SOURCE_LABELS.renewable_purchased).toBeTruthy();
    expect(SOURCE_LABELS.renewable_generated).toBeTruthy();
  });
});
