import { describe, it, expect } from 'vitest';
import { csvCell, rowsToCsv } from './csv-export';

describe('csvCell', () => {
  it('neutralises cells Excel would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe(`"'=HYPERLINK(""http://x"",""click"")"`);
    expect(csvCell('+cmd')).toBe(`'+cmd`);
    expect(csvCell('-2+3')).toBe(`'-2+3`);
    expect(csvCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(csvCell('\tx')).toBe(`'\tx`);
  });

  it('leaves numbers, including negative ones, as numbers', () => {
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell('-12.5')).toBe('-12.5');
    expect(csvCell('+3')).toBe('+3');
    expect(csvCell('1e-3')).toBe('1e-3');
    expect(csvCell(0)).toBe('0');
  });

  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('cr\rhere')).toBe('"cr\rhere"');
  });

  it('renders null and undefined as empty', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('passes ordinary text through untouched', () => {
    expect(csvCell('Steelcore Industries')).toBe('Steelcore Industries');
  });
});

describe('rowsToCsv', () => {
  it('joins headers and rows', () => {
    expect(rowsToCsv(['a', 'b'], [[1, '=x'], [null, 'y']])).toBe("a,b\n1,'=x\n,y");
  });
});
