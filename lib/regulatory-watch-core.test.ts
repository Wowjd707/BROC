import { describe, it, expect } from 'vitest';
import {
  normaliseForComparison, toLines, fingerprint, diffLines, changedCharacters,
  changeRatio, isMeaningfulChange, evaluateSource, describeDiff, buildDiffExcerpt,
  sanitisePatch, previewPatch, PATCHABLE_FIELDS, MIN_CHANGE_RATIO,
  type FetchResult, type SnapshotLike,
} from './regulatory-watch-core';

const snapshot = (excerpt: string, hash?: string): SnapshotLike => ({
  content_hash: hash ?? fingerprint(normaliseForComparison(excerpt)),
  excerpt: normaliseForComparison(excerpt),
  fetched_at: '2026-08-01T00:00:00Z',
});
const ok = (body: string): FetchResult => ({ ok: true, body });

/** A body long enough that small edits fall under the ratio floor. */
function longBody(sentences: number, extra = ''): string {
  const base = Array.from({ length: sentences },
    (_, i) => `Paragraph ${i} of the published guidance with some ordinary wording.`).join(' ');
  return `<html><body>${base} ${extra}</body></html>`;
}

describe('normaliseForComparison', () => {
  it('strips tags and collapses whitespace', () => {
    expect(normaliseForComparison('<p>Hello   <b>world</b></p>')).toBe('Hello world');
  });

  it('removes script and style bodies entirely', () => {
    // An inline analytics blob carries a fresh nonce per request and would
    // otherwise dominate every diff.
    const html = '<style>.a{color:red}</style><script>var t=17362518;</script><p>Real text</p>';
    expect(normaliseForComparison(html)).toBe('Real text');
  });

  it('decodes the entities that cause pointless churn', () => {
    expect(normaliseForComparison('<p>A&nbsp;&amp;&nbsp;B</p>')).toBe('A & B');
  });

  it('decodes each entity once, so escaped entity text stays literal', () => {
    // `&amp;lt;` is the page saying "&lt;", not "<".
    expect(normaliseForComparison('<p>Use &amp;lt;b&amp;gt; for bold</p>')).toBe('Use &lt;b&gt; for bold');
  });

  it('removes script and style bodies even with loosely written closing tags', () => {
    const html = '<script>var a=1;</script ><style>.a{}</style foo><!-- note --!><p>Real text</p>';
    expect(normaliseForComparison(html)).toBe('Real text');
  });

  it('makes two cosmetically different renderings of the same text identical', () => {
    const a = '<div><p>The  deadline is 30 December 2026.</p></div>';
    const b = '<section>\n  <span>The deadline is 30 December 2026.</span>\n</section>';
    expect(normaliseForComparison(a)).toBe(normaliseForComparison(b));
  });
});

describe('fingerprint', () => {
  it('is stable for identical input', () => {
    expect(fingerprint('abc')).toBe(fingerprint('abc'));
  });
  it('differs for different input', () => {
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'));
  });
  it('handles empty input without throwing', () => {
    expect(typeof fingerprint('')).toBe('string');
  });
});

describe('toLines', () => {
  it('splits on sentence boundaries and drops empties', () => {
    expect(toLines('One. Two.  Three.')).toEqual(['One.', 'Two.', 'Three.']);
  });
});

describe('diffLines', () => {
  it('reports added and removed passages', () => {
    const d = diffLines('A. B. C.', 'A. C. D.');
    expect(d.added).toEqual(['D.']);
    expect(d.removed).toEqual(['B.']);
    expect(d.unchangedCount).toBe(2);
  });

  it('treats reordering as no change', () => {
    // A navigation menu that reshuffles is not regulatory news.
    const d = diffLines('A. B. C.', 'C. A. B.');
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('counts changed characters across both directions', () => {
    const d = diffLines('AAAA.', 'BBBBBB.');
    expect(changedCharacters(d)).toBe(12);
  });
});

describe('isMeaningfulChange', () => {
  it('suppresses a tiny edit to a long page', () => {
    const before = normaliseForComparison(longBody(400));
    const after = normaliseForComparison(longBody(400, 'Minor.'));
    expect(isMeaningfulChange(diffLines(before, after))).toBe(false);
  });

  it('flags a substantial addition to a long page', () => {
    // Ratio alone would miss this; the absolute floor catches it.
    const added = Array.from({ length: 12 },
      (_, i) => `New obligation number ${i} applies from 30 December 2026 for large operators.`).join(' ');
    const before = normaliseForComparison(longBody(400));
    const after = normaliseForComparison(longBody(400, added));
    expect(isMeaningfulChange(diffLines(before, after))).toBe(true);
  });

  it('suppresses a large proportional change that is still trivially small', () => {
    // A short page where one word moved: proportionally enormous, substantively
    // nothing. The absolute floor is what stops this reaching a reviewer.
    const d = diffLines('Short page.', 'Short pages.');
    expect(changeRatio(d)).toBeGreaterThan(MIN_CHANGE_RATIO);
    expect(isMeaningfulChange(d)).toBe(false);
  });
});

describe('evaluateSource', () => {
  it('records a first fetch as the baseline, not as a change', () => {
    const r = evaluateSource(ok('<p>Anything</p>'), null);
    expect(r.outcome).toBe('first_seen');
    expect(r.summary).toMatch(/baseline/i);
  });

  it('reports no change when the normalised content matches', () => {
    const body = '<div><p>The  deadline is 30 December 2026.</p></div>';
    const prev = snapshot(body);
    const r = evaluateSource(ok('<section>The deadline is 30 December 2026.</section>'), prev);
    expect(r.outcome).toBe('unchanged');
  });

  it('flags a substantive change', () => {
    const before = longBody(60);
    const after = longBody(60, Array.from({ length: 10 },
      (_, i) => `Newly inserted requirement ${i} with meaningful additional length here.`).join(' '));
    const r = evaluateSource(ok(after), snapshot(before));
    expect(r.outcome).toBe('changed');
    expect(r.summary).toMatch(/Source changed/);
  });

  it('updates the baseline silently for a cosmetic change', () => {
    const r = evaluateSource(ok(longBody(400, 'Tiny.')), snapshot(longBody(400)));
    expect(r.outcome).toBe('below_threshold');
    expect(r.hash).not.toBe('');
  });

  it('never reports a failed fetch as unchanged', () => {
    // ECHA returns 403 and EUR-Lex serves metadata rather than article text.
    // Reporting either as "no change" would assert something nobody verified.
    const r = evaluateSource({ ok: false, status: 403, error: 'Forbidden' }, snapshot('<p>x</p>'));
    expect(r.outcome).toBe('fetch_failed');
    expect(r.summary).toMatch(/not evidence that nothing changed/i);
    expect(r.error).toBe('Forbidden');
  });

  it('treats a body-less success as a failed fetch', () => {
    const r = evaluateSource({ ok: true }, null);
    expect(r.outcome).toBe('fetch_failed');
  });
});

describe('describeDiff and buildDiffExcerpt', () => {
  it('describes both directions', () => {
    expect(describeDiff(diffLines('A. B.', 'A. C.'))).toMatch(/1 passage added, 1 removed/);
  });
  it('marks added and removed lines and truncates', () => {
    const d = diffLines('A. B.', 'A. C.');
    const ex = buildDiffExcerpt(d);
    expect(ex).toContain('+ C.');
    expect(ex).toContain('- B.');
    expect(buildDiffExcerpt(diffLines('', 'X'.repeat(500) + '.'), 100)).toMatch(/truncated/);
  });
});

describe('sanitisePatch', () => {
  it('keeps allowed fields', () => {
    const { patch, rejectedKeys } = sanitisePatch({
      status_summary: 'Updated.', stage: 'applying',
    });
    expect(patch).toEqual({ status_summary: 'Updated.', stage: 'applying' });
    expect(rejectedKeys).toEqual([]);
  });

  it('strips the reviewer’s signature fields and says so', () => {
    // These are what make the freshness badge mean "a person checked this".
    const { patch, rejectedKeys } = sanitisePatch({
      status_summary: 'Updated.',
      confidence: 'confirmed',
      last_verified: '2026-09-04',
      sources: [{ url: 'https://evil.example' }],
      code: 'HIJACK',
    });
    expect(patch).toEqual({ status_summary: 'Updated.' });
    expect(rejectedKeys.sort()).toEqual(['code', 'confidence', 'last_verified', 'sources']);
  });

  it('accepts a null milestone date, because "no date announced" is real', () => {
    expect(sanitisePatch({ next_milestone_date: null }).patch).toEqual({ next_milestone_date: null });
  });

  it('refuses a malformed date rather than storing it', () => {
    const { patch, rejectedKeys } = sanitisePatch({ next_milestone_date: 'end of 2027' });
    expect(patch).toEqual({});
    expect(rejectedKeys).toEqual(['next_milestone_date']);
  });

  it('keeps only string key points', () => {
    expect(sanitisePatch({ key_points: ['ok', 42, null, 'fine'] }).patch)
      .toEqual({ key_points: ['ok', 'fine'] });
  });

  it('rejects key_points that is not an array', () => {
    expect(sanitisePatch({ key_points: 'a string' }).rejectedKeys).toEqual(['key_points']);
  });

  it('returns an empty patch for junk input', () => {
    expect(sanitisePatch(null).patch).toEqual({});
    expect(sanitisePatch('nope').patch).toEqual({});
    expect(sanitisePatch([1, 2]).patch).toEqual({});
  });

  it('never allows a field outside the allowlist', () => {
    const everything = Object.fromEntries(
      ['confidence', 'last_verified', 'sources', 'code', 'category', 'jurisdiction', 'is_active']
        .map((k) => [k, 'x']),
    );
    expect(Object.keys(sanitisePatch(everything).patch)).toEqual([]);
  });

  it('exposes exactly the six patchable fields', () => {
    expect([...PATCHABLE_FIELDS].sort()).toEqual([
      'key_points', 'next_milestone', 'next_milestone_date',
      'next_milestone_note', 'stage', 'status_summary',
    ]);
  });
});

describe('previewPatch', () => {
  it('lists only fields that actually differ', () => {
    const rows = previewPatch(
      { status_summary: 'Old.', stage: 'in_force' },
      { status_summary: 'New.', stage: 'in_force' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ field: 'status_summary', before: 'Old.', after: 'New.' });
  });

  it('renders arrays and nulls readably', () => {
    const rows = previewPatch(
      { key_points: ['a'], next_milestone_date: '2026-12-30' },
      { key_points: ['a', 'b'], next_milestone_date: null },
    );
    expect(rows.find((r) => r.field === 'key_points')!.after).toBe('• a\n• b');
    expect(rows.find((r) => r.field === 'next_milestone_date')!.after).toBe('—');
  });
});
