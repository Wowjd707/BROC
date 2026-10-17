import { describe, it, expect } from 'vitest';
import { extractNumbers, findUngroundedFigures, describeUngrounded } from './grounding';

describe('extractNumbers', () => {
  it('reads plain, separated and decimal figures', () => {
    expect(extractNumbers('1,234.5 and 60 and 0.25').map((n) => n.value))
      .toEqual([1234.5, 60, 0.25]);
  });

  it('ignores framework and requirement codes', () => {
    // E1-6 and 305-1 are identifiers, not quantities. Flagging them would bury
    // the findings that matter.
    expect(extractNumbers('Disclosure E1-6 and GRI 305-1 under ESRS 2')).toEqual([]);
  });

  it('ignores scope and category labels', () => {
    expect(extractNumbers('Scope 1, Scope 2 and Category 15 emissions')).toEqual([]);
  });

  it('ignores ISO dates', () => {
    expect(extractNumbers('effective 2025-01-01')).toEqual([]);
  });

  it('still finds a real figure alongside identifiers', () => {
    expect(extractNumbers('Scope 1 emissions were 1,240 tCO2e').map((n) => n.value))
      .toEqual([1240]);
  });
});

describe('findUngroundedFigures', () => {
  const context = '- Scope 1: 1234.56 tCO₂e\n- Scope 2 (market-based): 800 tCO₂e';

  it('accepts a figure quoted exactly', () => {
    expect(findUngroundedFigures('Scope 2 emissions were 800 tCO₂e.', context)).toEqual([]);
  });

  it('accepts a figure rounded for prose', () => {
    // Rounding is what prose does. Flagging it would train the reviewer to
    // ignore the warning entirely.
    expect(findUngroundedFigures('Scope 1 emissions were 1,235 tCO₂e.', context)).toEqual([]);
    expect(findUngroundedFigures('Scope 1 emissions were 1234.6 tCO₂e.', context)).toEqual([]);
  });

  it('flags a figure that appears nowhere in the data', () => {
    const found = findUngroundedFigures('Emissions fell to 640 tCO₂e.', context);
    expect(found).toHaveLength(1);
    expect(found[0].text).toBe('640');
  });

  it('flags a derived figure too, which is the intended behaviour', () => {
    // The check cannot distinguish a fabrication from a correct derivation, so
    // it surfaces both and the wording says "verify" rather than "wrong".
    const found = findUngroundedFigures('A 35% reduction was achieved.', context);
    expect(found.map((f) => f.value)).toEqual([35]);
  });

  it('reports each distinct figure once', () => {
    const found = findUngroundedFigures('640 then 640 again, and 900.', context);
    expect(found.map((f) => f.value)).toEqual([640, 900]);
  });

  it('does not flag requirement codes in the draft', () => {
    expect(findUngroundedFigures('As required under E1-6 and GRI 305-1.', context)).toEqual([]);
  });

  it('flags everything when the model was given no data', () => {
    // The case that matters most: a requirement with no platform data behind
    // it, where any figure in the draft is unsupported by construction.
    const found = findUngroundedFigures('Emissions were 4,200 tCO₂e.', '- No platform data.');
    expect(found.map((f) => f.value)).toEqual([4200]);
  });

  it('is quiet on prose with no figures', () => {
    expect(findUngroundedFigures('The undertaking has not yet measured this.', context))
      .toEqual([]);
  });

  it('handles an empty draft', () => {
    expect(findUngroundedFigures('', context)).toEqual([]);
  });
});

describe('describeUngrounded', () => {
  it('says nothing when everything is grounded', () => {
    expect(describeUngrounded([])).toBeNull();
  });

  it('asks the reader to verify rather than asserting an error', () => {
    // The claim has to match what the check can actually support.
    const message = describeUngrounded([{ text: '640', value: 640 }])!;
    expect(message).toContain('640');
    expect(message).toMatch(/verify/i);
    expect(message).not.toMatch(/wrong|incorrect|hallucinat|fabricat/i);
  });

  it('lists several figures in one sentence', () => {
    const message = describeUngrounded([
      { text: '640', value: 640 },
      { text: '1,900', value: 1900 },
    ])!;
    expect(message).toContain('640');
    expect(message).toContain('1,900');
  });
});
