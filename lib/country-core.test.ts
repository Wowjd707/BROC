import { describe, it, expect } from 'vitest';
import { toIso2, isUsSite } from './country-core';

describe('toIso2', () => {
  it('maps the column default and common spellings', () => {
    expect(toIso2('USA')).toBe('US');
    expect(toIso2('United States')).toBe('US');
    expect(toIso2('Germany')).toBe('DE');
    expect(toIso2('DEU')).toBe('DE');
    expect(toIso2('UK')).toBe('GB');
    expect(toIso2(' no ')).toBe('NO');
    expect(toIso2('The Netherlands')).toBe('NL');
  });
  it('returns null rather than guessing', () => {
    expect(toIso2('Atlantis')).toBeNull();
    expect(toIso2('')).toBeNull();
    expect(toIso2(null)).toBeNull();
  });
});

describe('isUsSite', () => {
  it('treats blank as the US default and anything else by its code', () => {
    expect(isUsSite('USA')).toBe(true);
    expect(isUsSite(null)).toBe(true);
    expect(isUsSite('Poland')).toBe(false);
    expect(isUsSite('Atlantis')).toBe(false);
  });
});
