/**
 * Regulatory watch — deterministic change detection.
 *
 * Everything in this file runs before any model is involved, and most runs
 * never reach a model at all. That ordering is the whole design: detection is
 * arithmetic, summarisation is language, and only the second is a job for an
 * LLM. `lib/ai/tasks.ts` forbids asking a model what a standard requires, and
 * the way to honour that while still automating the chore is to let the model
 * describe a diff it was handed rather than report a status it recalled.
 *
 * ─── The failure mode this is actually built against ────────────────────────
 *
 * Not missed changes. Noise.
 *
 * A watcher that flags all twenty-one sources every month is worse than no
 * watcher, because the reviewer learns in two runs that the queue is
 * meaningless and stops opening it — and then a real change goes by unread.
 * Government pages rotate banners, embed build stamps, and reorder navigation
 * on every request, so comparing raw bytes reports change constantly and
 * signifies nothing.
 *
 * Hence: normalise hard, then require a change to clear both an absolute and a
 * proportional floor before it earns a reviewer's attention.
 *
 * Pure and dependency-free so it is unit-testable.
 */

// ─── Normalisation ───────────────────────────────────────────────────────────

/**
 * Reduce a fetched page to comparable text.
 *
 * Script and style bodies are removed entirely rather than tag-stripped: an
 * inline analytics blob carries a fresh nonce on every request and would
 * dominate the diff.
 */
export function normaliseForComparison(raw: string): string {
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    // Entities that survive tag-stripping and would otherwise show up as diff
    // churn when a CMS changes how it escapes text.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Non-empty, trimmed lines — the unit the diff works in. */
export function toLines(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ─── Fingerprint ─────────────────────────────────────────────────────────────

/**
 * cyrb53 — a fast, well-distributed 53-bit string hash.
 *
 * Deliberately not a crypto hash. This detects change, it does not defend
 * against a forged page, and a dependency-free pure function keeps this module
 * testable and portable. Collisions at 53 bits are not a practical concern for
 * a few dozen documents.
 */
export function fingerprint(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

// ─── Diff ────────────────────────────────────────────────────────────────────

export interface LineDiff {
  added: string[];
  removed: string[];
  /** Lines present in both, used only to size the change. */
  unchangedCount: number;
}

/**
 * Set-based line diff. Order changes are deliberately invisible: a navigation
 * menu that reshuffles is not regulatory news, and a positional diff would
 * report the whole page as changed when one item moved.
 */
export function diffLines(before: string, after: string): LineDiff {
  const beforeLines = toLines(before);
  const afterLines = toLines(after);
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  return {
    added: afterLines.filter((l) => !beforeSet.has(l)),
    removed: beforeLines.filter((l) => !afterSet.has(l)),
    unchangedCount: afterLines.filter((l) => beforeSet.has(l)).length,
  };
}

/** Characters added plus removed. */
export function changedCharacters(diff: LineDiff): number {
  const sum = (lines: string[]) => lines.reduce((n, l) => n + l.length, 0);
  return sum(diff.added) + sum(diff.removed);
}

/** Changed lines as a share of the after-document. 0 when nothing changed. */
export function changeRatio(diff: LineDiff): number {
  const total = diff.added.length + diff.unchangedCount;
  if (total === 0) return diff.removed.length > 0 ? 1 : 0;
  return (diff.added.length + diff.removed.length) / (total + diff.removed.length);
}

/**
 * Both floors must be cleared. Either alone misfires:
 *
 *  • Absolute only — a one-word tweak to a 200-word page is proportionally
 *    enormous and would be suppressed by a character count that a long page
 *    passes trivially.
 *  • Ratio only — a 40,000-word page can gain a whole new paragraph of
 *    obligations while barely moving the ratio.
 */
export const MIN_CHANGED_CHARACTERS = 120;
export const MIN_CHANGE_RATIO = 0.01;

export function isMeaningfulChange(diff: LineDiff): boolean {
  return changedCharacters(diff) >= MIN_CHANGED_CHARACTERS
    && changeRatio(diff) >= MIN_CHANGE_RATIO;
}

// ─── Outcomes ────────────────────────────────────────────────────────────────

export type WatchOutcome = 'first_seen' | 'unchanged' | 'changed' | 'below_threshold' | 'fetch_failed';

export interface FetchResult {
  ok: boolean;
  /** Raw body when ok. */
  body?: string;
  /** Why not, when not ok. Shown to the reviewer verbatim. */
  error?: string;
  status?: number;
}

export interface SnapshotLike {
  content_hash: string;
  excerpt: string | null;
  fetched_at: string;
}

export interface EvaluatedSource {
  outcome: WatchOutcome;
  normalised: string;
  hash: string;
  diff: LineDiff | null;
  /** Deterministic, model-free description. Always populated. */
  summary: string;
  error: string | null;
}

const EMPTY_DIFF: LineDiff = { added: [], removed: [], unchangedCount: 0 };

/**
 * Classify one source against its last snapshot.
 *
 * A failed fetch is its own outcome and never collapses into "unchanged".
 * Several sources in the seed genuinely resist automated fetching — ECHA
 * returns 403, EUR-Lex serves metadata instead of article text — and reporting
 * those as "no change" would quietly assert something nobody verified. The
 * reviewer is told to go and look.
 */
export function evaluateSource(
  fetched: FetchResult,
  previous: SnapshotLike | null,
): EvaluatedSource {
  if (!fetched.ok || typeof fetched.body !== 'string') {
    const detail = fetched.error ?? `HTTP ${fetched.status ?? 'error'}`;
    return {
      outcome: 'fetch_failed',
      normalised: '', hash: '', diff: null, error: detail,
      summary: `Could not fetch this source (${detail}). This is not evidence that nothing changed — check it by hand.`,
    };
  }

  const normalised = normaliseForComparison(fetched.body);
  const hash = fingerprint(normalised);

  if (!previous) {
    return {
      outcome: 'first_seen', normalised, hash, diff: null, error: null,
      summary: 'First time this source has been fetched. Recorded as the baseline; no change to review.',
    };
  }

  if (previous.content_hash === hash) {
    return {
      outcome: 'unchanged', normalised, hash, diff: EMPTY_DIFF, error: null,
      summary: 'No change since the last check.',
    };
  }

  const diff = diffLines(previous.excerpt ?? '', normalised);

  if (!isMeaningfulChange(diff)) {
    return {
      outcome: 'below_threshold', normalised, hash, diff, error: null,
      summary: `Page changed, but only cosmetically (${changedCharacters(diff)} characters). Baseline updated without raising a proposal.`,
    };
  }

  return {
    outcome: 'changed', normalised, hash, diff, error: null,
    summary: describeDiff(diff),
  };
}

/** Deterministic prose. This is what a reviewer reads when no model is configured. */
export function describeDiff(diff: LineDiff): string {
  const parts: string[] = [];
  if (diff.added.length > 0) {
    parts.push(`${diff.added.length} passage${diff.added.length === 1 ? '' : 's'} added`);
  }
  if (diff.removed.length > 0) {
    parts.push(`${diff.removed.length} removed`);
  }
  const head = parts.length > 0 ? parts.join(', ') : 'content reordered';
  return `Source changed: ${head} (${changedCharacters(diff)} characters).`;
}

/** Bounded before/after text for storage and for the model's DATA section. */
export function buildDiffExcerpt(diff: LineDiff, maxChars = 4000): string {
  const lines: string[] = [];
  for (const l of diff.added) lines.push(`+ ${l}`);
  for (const l of diff.removed) lines.push(`- ${l}`);
  let out = '';
  for (const line of lines) {
    if (out.length + line.length + 1 > maxChars) { out += '\n… (truncated)'; break; }
    out += (out ? '\n' : '') + line;
  }
  return out;
}

export function excerptForSnapshot(normalised: string, maxChars = 20_000): string {
  return normalised.length <= maxChars ? normalised : normalised.slice(0, maxChars);
}

// ─── Patch safety ────────────────────────────────────────────────────────────

/**
 * The only fields a proposal may suggest changing.
 *
 * `confidence`, `last_verified` and `sources` are absent by design and the
 * database enforces it too (migration 025). They are the reviewer's signature:
 * `last_verified` is what the tracker's whole freshness mechanism rests on, and
 * if anything but a human approval could stamp it, the badge would stop meaning
 * "a person checked this" and the decay logic in `regulatory-core.ts` would be
 * measuring nothing.
 */
export const PATCHABLE_FIELDS = [
  'status_summary',
  'key_points',
  'stage',
  'next_milestone',
  'next_milestone_date',
  'next_milestone_note',
] as const;

export type PatchableField = (typeof PATCHABLE_FIELDS)[number];

/**
 * What a patched field may hold. Narrow on purpose: `sanitisePatch` guarantees
 * it, so downstream code never has to re-check, and the values are exactly the
 * JSON-serialisable shapes the column types accept.
 */
export type PatchValue = string | null | string[];
export type ProposedPatch = Partial<Record<PatchableField, PatchValue>>;

export interface SanitisedPatch {
  patch: ProposedPatch;
  /** Keys stripped, so the UI can say what was refused rather than hide it. */
  rejectedKeys: string[];
}

/**
 * Strip anything not on the allowlist.
 *
 * Belt and braces against the database CHECK: a model asked for JSON will
 * occasionally return a helpful extra field, and silently persisting one would
 * be the exact failure this design exists to prevent.
 */
export function sanitisePatch(raw: unknown): SanitisedPatch {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { patch: {}, rejectedKeys: [] };
  }
  const allowed = new Set<string>(PATCHABLE_FIELDS);
  const patch: ProposedPatch = {};
  const rejectedKeys: string[] = [];

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(key)) { rejectedKeys.push(key); continue; }
    if (value === undefined) continue;
    if (key === 'key_points') {
      if (Array.isArray(value)) {
        patch.key_points = value.filter((v): v is string => typeof v === 'string');
      } else {
        rejectedKeys.push(key);
      }
      continue;
    }
    if (key === 'next_milestone_date') {
      // Null is meaningful — "no date announced" — so it is allowed through,
      // but a malformed date is refused rather than stored.
      if (value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))) {
        patch.next_milestone_date = value;
      } else {
        rejectedKeys.push(key);
      }
      continue;
    }
    if (typeof value === 'string' || value === null) {
      patch[key as PatchableField] = value;
    } else {
      rejectedKeys.push(key);
    }
  }
  return { patch, rejectedKeys };
}

/** Field-by-field preview of what approving would change. */
export interface PatchPreviewRow {
  field: PatchableField;
  before: string;
  after: string;
}

export function previewPatch(
  current: Record<string, unknown>,
  patch: ProposedPatch,
): PatchPreviewRow[] {
  const render = (v: unknown): string => {
    if (v === null || v === undefined) return '—';
    if (Array.isArray(v)) return v.map((x) => `• ${String(x)}`).join('\n');
    return String(v);
  };
  const rows: PatchPreviewRow[] = [];
  for (const field of PATCHABLE_FIELDS) {
    if (!(field in patch)) continue;
    const before = render(current[field]);
    const after = render(patch[field]);
    if (before !== after) rows.push({ field, before, after });
  }
  return rows;
}
