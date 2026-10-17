import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  sanitizeFileName,
  buildStoragePath,
  organizationIdFromPath,
  validateUpload,
  formatBytes,
  isAllowedMimeType,
  isEvidenceRecordType,
  countEvidenceByRecord,
  findOrphanedEvidence,
  evidenceCountKey,
  EVIDENCE_RECORD_TYPES,
  EVIDENCE_RECORD_TABLES,
  MAX_EVIDENCE_BYTES,
  type EvidenceRecordType,
} from './evidence-core';

const ORG = '11111111-1111-4111-8111-111111111111';
const REC = '22222222-2222-4222-8222-222222222222';
const UID = '33333333-3333-4333-8333-333333333333';

describe('sanitizeFileName', () => {
  it('keeps an ordinary name intact', () => {
    expect(sanitizeFileName('Invoice 2025-03.pdf')).toBe('Invoice 2025-03.pdf');
    expect(sanitizeFileName('meter_reading (final).csv')).toBe('meter_reading (final).csv');
  });

  // ─── Traversal ───────────────────────────────────────────────────────────
  it('strips every directory component, POSIX or Windows', () => {
    expect(sanitizeFileName('../../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('..\\..\\Windows\\system32\\config')).toBe('config');
    expect(sanitizeFileName('/absolute/path/bill.pdf')).toBe('bill.pdf');
  });

  it('cannot be made to emit a separator or a traversal segment', () => {
    const hostile = [
      '../../secrets.pdf',
      '....//....//x.pdf',
      'a/../../b.pdf',
      '..%2f..%2fx.pdf',
      '.././.././x.pdf',
      '..',
      '...',
      './.',
    ];
    for (const input of hostile) {
      const out = sanitizeFileName(input);
      expect(out, input).not.toContain('/');
      expect(out, input).not.toContain('\\');
      expect(out, input).not.toMatch(/(^|[^A-Za-z0-9])\.\.($|[^A-Za-z0-9])/);
    }
  });

  it('never returns an empty name', () => {
    // An empty object key would be rejected by storage with a useless error.
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('...')).toBe('file');
    expect(sanitizeFileName('///')).toBe('file');
    expect(sanitizeFileName('   ')).toBe('file');
  });

  // ─── Deceptive names ─────────────────────────────────────────────────────
  it('removes bidirectional overrides used to disguise an extension', () => {
    // U+202E reverses what follows, so this renders as "invoice exe.pdf".
    const out = sanitizeFileName('invoice\u202Efdp.exe');
    expect(out).not.toContain('\u202E');
    expect(out).toBe('invoicefdp.exe');
  });

  it('removes control characters and zero-width joiners', () => {
    expect(sanitizeFileName('bill\u0000.pdf')).toBe('bill.pdf');
    expect(sanitizeFileName('bi\u200Bll.pdf')).toBe('bill.pdf');
    expect(sanitizeFileName('report\r\n.pdf')).toBe('report.pdf');
    expect(sanitizeFileName('\uFEFFreport.pdf')).toBe('report.pdf');
  });

  it('strips leading dots so the file is not hidden', () => {
    expect(sanitizeFileName('.htaccess')).toBe('htaccess');
    expect(sanitizeFileName('.env')).toBe('env');
  });

  it('strips trailing dots and spaces that filesystems silently drop', () => {
    expect(sanitizeFileName('report.pdf.')).toBe('report.pdf');
    expect(sanitizeFileName('report.pdf   ')).toBe('report.pdf');
  });

  it('replaces characters unsafe in an object key', () => {
    expect(sanitizeFileName('a?b*c:d"e<f>g|h.pdf')).toBe('a_b_c_d_e_f_g_h.pdf');
    expect(sanitizeFileName('bill;rm -rf.pdf')).toBe('bill_rm -rf.pdf');
  });

  it('keeps non-ASCII letters, which most real filenames in this market have', () => {
    // Folding these to underscores would mangle a majority of EU filenames.
    expect(sanitizeFileName('facture été.pdf')).toBe('facture été.pdf');
    expect(sanitizeFileName('Stromrechnung Öl.pdf')).toBe('Stromrechnung Öl.pdf');
    expect(sanitizeFileName('账单.pdf')).toBe('账单.pdf');
  });

  // ─── Length ──────────────────────────────────────────────────────────────
  it('truncates a long name but keeps the extension', () => {
    const out = sanitizeFileName('a'.repeat(400) + '.pdf');
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('truncates a long name with no real extension', () => {
    const out = sanitizeFileName('b'.repeat(400));
    expect(out.length).toBe(120);
  });

  it('does not treat a long tail after a dot as an extension', () => {
    // "name.<300 chars>" — the tail is not an extension worth preserving.
    const out = sanitizeFileName('name.' + 'c'.repeat(300));
    expect(out.length).toBe(120);
  });
});

describe('buildStoragePath', () => {
  const base = {
    organizationId: ORG,
    recordType: 'emission_entry' as EvidenceRecordType,
    recordId: REC,
    uniqueId: UID,
    fileName: 'Invoice.pdf',
  };

  it('leads with the organization id, which is what storage RLS compares', () => {
    expect(buildStoragePath(base)).toBe(`${ORG}/emission_entry/${REC}/${UID}-Invoice.pdf`);
    expect(organizationIdFromPath(buildStoragePath(base))).toBe(ORG);
  });

  it('sanitizes the file name into the path', () => {
    const path = buildStoragePath({ ...base, fileName: '../../../etc/passwd' });
    expect(path).toBe(`${ORG}/emission_entry/${REC}/${UID}-passwd`);
    expect(path.split('/')).toHaveLength(4);
  });

  it('keeps the object inside the org prefix for any hostile file name', () => {
    for (const name of ['../../x.pdf', 'a/b/c.pdf', '..\\..\\x.pdf', '']) {
      const path = buildStoragePath({ ...base, fileName: name });
      expect(path.startsWith(`${ORG}/`), name).toBe(true);
      expect(path.split('/'), name).toHaveLength(4);
    }
  });

  it('refuses a non-UUID identifier rather than building a shiftable path', () => {
    // A slash in the org id would move the object out of the tenant prefix.
    expect(() => buildStoragePath({ ...base, organizationId: `${ORG}/../other` })).toThrow(/UUID/);
    expect(() => buildStoragePath({ ...base, organizationId: 'not-a-uuid' })).toThrow(/UUID/);
    expect(() => buildStoragePath({ ...base, recordId: '../..' })).toThrow(/UUID/);
    expect(() => buildStoragePath({ ...base, uniqueId: 'x' })).toThrow(/UUID/);
  });

  it('refuses an unknown record type', () => {
    expect(() => buildStoragePath({ ...base, recordType: 'wat' as EvidenceRecordType }))
      .toThrow(/record type/);
  });
});

describe('organizationIdFromPath', () => {
  it('returns null when the first segment is not a UUID', () => {
    expect(organizationIdFromPath('evidence/foo.pdf')).toBeNull();
    expect(organizationIdFromPath('')).toBeNull();
  });
});

describe('record types', () => {
  it('maps every record type to a table', () => {
    for (const t of EVIDENCE_RECORD_TYPES) {
      expect(EVIDENCE_RECORD_TABLES[t], t).toBeTruthy();
    }
    expect(Object.keys(EVIDENCE_RECORD_TABLES)).toHaveLength(EVIDENCE_RECORD_TYPES.length);
  });

  // The list and the database CHECK constraint are two copies of one fact. If
  // they drift, the UI offers an attach button whose upload the database then
  // refuses — or the API rejects a type the database would accept. Read the
  // most recent migration that (re)defines the constraint and compare.
  it('matches the CHECK constraint in the latest migration that defines it', () => {
    const dir = path.resolve(__dirname, '..', 'supabase', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().reverse();
    const defining = files
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .find((sql) => /ADD CONSTRAINT evidence_attachments_record_type_allowed/.test(sql));
    expect(defining, 'no migration defines the constraint').toBeTruthy();

    const clause = defining!.split('ADD CONSTRAINT evidence_attachments_record_type_allowed')[1];
    const list = clause.slice(clause.indexOf('IN ('), clause.indexOf('))'));
    const inDatabase = [...list.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
    expect(inDatabase).toEqual([...EVIDENCE_RECORD_TYPES].sort());
  });

  it('rejects anything not on the list', () => {
    expect(isEvidenceRecordType('emission_entry')).toBe(true);
    expect(isEvidenceRecordType('users')).toBe(false);
    expect(isEvidenceRecordType('')).toBe(false);
  });
});

describe('countEvidenceByRecord', () => {
  it('counts per record and keeps record types distinct', () => {
    const counts = countEvidenceByRecord([
      { record_type: 'emission_entry', record_id: REC },
      { record_type: 'emission_entry', record_id: REC },
      { record_type: 'ehs_entry', record_id: REC },
    ]);
    expect(counts[evidenceCountKey('emission_entry', REC)]).toBe(2);
    expect(counts[evidenceCountKey('ehs_entry', REC)]).toBe(1);
  });

  it('is empty rather than undefined for no attachments', () => {
    expect(countEvidenceByRecord([])).toEqual({});
  });
});

describe('validateUpload', () => {
  const ok = { fileName: 'bill.pdf', sizeBytes: 1024, contentType: 'application/pdf' };

  it('accepts a normal document', () => {
    expect(validateUpload(ok)).toEqual({ ok: true });
  });

  it('rejects an empty file', () => {
    expect(validateUpload({ ...ok, sizeBytes: 0 })).toMatchObject({ ok: false });
  });

  it('rejects a file over the limit and says both sizes', () => {
    const result = validateUpload({ ...ok, sizeBytes: MAX_EVIDENCE_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('25 MB');
  });

  it('accepts a file exactly at the limit', () => {
    expect(validateUpload({ ...ok, sizeBytes: MAX_EVIDENCE_BYTES })).toEqual({ ok: true });
  });

  it('rejects an executable regardless of what it is named', () => {
    expect(validateUpload({ ...ok, fileName: 'bill.pdf', contentType: 'application/x-msdownload' }))
      .toMatchObject({ ok: false });
  });

  it('matches mime types case-insensitively', () => {
    expect(isAllowedMimeType('APPLICATION/PDF')).toBe(true);
    expect(isAllowedMimeType(' image/png ')).toBe(true);
    expect(isAllowedMimeType('image/svg+xml')).toBe(false); // scriptable
  });
});

describe('formatBytes', () => {
  it('scales and rounds readably', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    // A decimal below 10, a whole number above it — 25.0 MB is noise.
    expect(formatBytes(MAX_EVIDENCE_BYTES)).toBe('25 MB');
    expect(formatBytes(1024 * 1024 * 5.5)).toBe('5.5 MB');
    expect(formatBytes(1024 * 1024 * 100)).toBe('100 MB');
  });

  it('does not invent a size it does not have', () => {
    expect(formatBytes(NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('findOrphanedEvidence', () => {
  const row = (record_type: string, record_id: string, id = record_id + '-a') =>
    ({ id, record_type, record_id, storage_path: `o/${record_type}/${record_id}/x.pdf` });

  it('reports rows whose record is gone', () => {
    const rows = [row('project', 'p1'), row('project', 'p2'), row('supplier', 's1')];
    const out = findOrphanedEvidence(rows, {
      project: new Set(['p1']),
      supplier: new Set(['s1']),
    });
    expect(out.map((r) => r.record_id)).toEqual(['p2']);
  });

  it('never reports a type it was not told about', () => {
    const out = findOrphanedEvidence([row('goal', 'g1')], { project: new Set() });
    expect(out).toEqual([]);
  });
});
