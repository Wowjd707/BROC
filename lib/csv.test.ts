import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvToObjects } from './csv';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with commas and quotes', () => {
    expect(parseCsv('name,note\n"Acme, Inc.","He said ""hi"""')).toEqual([
      ['name', 'note'],
      ['Acme, Inc.', 'He said "hi"'],
    ]);
  });

  it('handles newlines inside quotes', () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ]);
  });

  it('handles CRLF line endings and a trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM', () => {
    expect(parseCsv('﻿a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops fully-empty lines', () => {
    expect(parseCsv('a\n\n1\n')).toEqual([['a'], ['1']]);
  });
});

describe('parseCsvToObjects', () => {
  it('normalizes headers and keys rows', () => {
    const { headers, rows } = parseCsvToObjects('Entry Date,Quantity\n2025-01-01, 100 ');
    expect(headers).toEqual(['entry_date', 'quantity']);
    expect(rows).toEqual([{ entry_date: '2025-01-01', quantity: '100' }]);
  });

  it('returns empty for empty input', () => {
    expect(parseCsvToObjects('')).toEqual({ headers: [], rows: [] });
  });

  it('fills missing trailing cells with empty strings', () => {
    const { rows } = parseCsvToObjects('a,b,c\n1,2');
    expect(rows[0]).toEqual({ a: '1', b: '2', c: '' });
  });
});
