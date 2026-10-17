/**
 * Evidence attachments — pure path building and validation.
 *
 * An assurance provider inspecting a reported figure asks for the document
 * behind it. This module governs how those documents are named and located.
 *
 * The file name is attacker-influenced input that becomes part of a storage
 * path, so it is sanitized rather than trusted: path separators, traversal
 * segments, control characters and bidirectional overrides are all removed
 * before it goes anywhere near the object key. The sanitized name is what gets
 * stored and displayed, so the name in the UI always denotes the same bytes as
 * the path — a display name that differs from the stored one is exactly how a
 * deceptive attachment gets clicked.
 *
 * Pure and dependency-free so it is unit-testable.
 */

// ─── What can carry evidence ─────────────────────────────────────────────────

/**
 * Kept in sync with the CHECK constraint `evidence_attachments_record_type_allowed`
 * (migration 019, widened in 037). Every record that carries a reported figure,
 * or a judgement a reported figure depends on, belongs here.
 */
export const EVIDENCE_RECORD_TYPES = [
  'emission_entry',
  'ehs_entry',
  'scope3_entry',
  'custom_emission_factor',
  'disclosure_response',
  'supplier',
  'site',
  'goal',
  'project',
  'business_metric_value',
  'materiality_assessment',
] as const;

export type EvidenceRecordType = (typeof EVIDENCE_RECORD_TYPES)[number];

/**
 * The table each record type lives in, for server-side existence checks.
 *
 * `as const satisfies` rather than a plain `Record<…, string>` annotation: the
 * literal types are what let the query builder accept these names, while
 * `satisfies` still fails the build if a record type is ever added without a
 * table. Every table here carries an `id` and is RLS-scoped by organization.
 */
export const EVIDENCE_RECORD_TABLES = {
  emission_entry: 'emission_entries',
  ehs_entry: 'ehs_entries',
  scope3_entry: 'scope3_entries',
  custom_emission_factor: 'custom_emission_factors',
  disclosure_response: 'disclosure_responses',
  supplier: 'suppliers',
  site: 'sites',
  goal: 'goals',
  project: 'projects',
  business_metric_value: 'business_metric_values',
  materiality_assessment: 'materiality_assessments',
} as const satisfies Record<EvidenceRecordType, string>;

export function isEvidenceRecordType(value: string): value is EvidenceRecordType {
  return (EVIDENCE_RECORD_TYPES as readonly string[]).includes(value);
}

// ─── Limits ──────────────────────────────────────────────────────────────────
// Mirrors the bucket configuration in migration 019. Validating client-side too
// turns a rejected upload into a sentence instead of an opaque storage error.

export const EVIDENCE_BUCKET = 'evidence';
export const MAX_EVIDENCE_BYTES = 26_214_400; // 25 MiB

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic',
  'text/csv', 'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

/** `accept` attribute for the file input — the same set, in extension form. */
export const EVIDENCE_ACCEPT_ATTRIBUTE =
  '.pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.csv,.txt,.xls,.xlsx,.doc,.docx';

export function isAllowedMimeType(contentType: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(contentType.toLowerCase().trim());
}

// ─── File name sanitization ──────────────────────────────────────────────────

const MAX_NAME_LENGTH = 120;

/**
 * Characters that are invisible or reorder rendered text. A name containing
 * U+202E reads as `invoice[gnp.exe]` while actually ending in `.exe`, so these
 * are stripped rather than escaped.
 */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Anything outside this set is replaced. Unicode letters and digits are kept
 * deliberately: the primary market for CSRD reporting is European, and folding
 * `facture été.pdf` to `facture _t_.pdf` would mangle a majority of real
 * filenames. What is excluded is what actually causes trouble — path
 * separators, shell and Windows metacharacters, and quotes.
 */
const UNSAFE = /[^\p{L}\p{N}._\-() ]/gu;

/**
 * Reduce an uploaded file name to something safe to place in a storage path.
 *
 * Traversal is defeated structurally by taking only the last path segment, so
 * `../../secrets.pdf` becomes `secrets.pdf` — there is no sequence of dots and
 * slashes that survives, because separators are gone before anything else runs.
 */
export function sanitizeFileName(raw: string): string {
  // Basename only: kill every directory component, POSIX or Windows.
  const base = raw.split(/[/\\]/).pop() ?? '';

  let name = base
    .replace(INVISIBLE, '')
    .replace(UNSAFE, '_')
    .replace(/\s+/g, ' ')
    .replace(/_{2,}/g, '_')
    .trim();

  // Leading dots hide the file; trailing dots and spaces are invalid on Windows
  // and silently stripped by some filesystems, which would break the path.
  name = name.replace(/^\.+/, '').replace(/[. ]+$/, '');

  if (name.length > MAX_NAME_LENGTH) name = truncatePreservingExtension(name);
  if (!name) return 'file';
  return name;
}

/** Trim the stem, not the extension — the extension is what opens the file. */
function truncatePreservingExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  // No extension, or one implausibly long to be real: just cut.
  if (dot <= 0 || name.length - dot > 12) return name.slice(0, MAX_NAME_LENGTH);

  const ext = name.slice(dot);
  return name.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
}

// ─── Storage paths ───────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoragePathInput {
  organizationId: string;
  recordType: EvidenceRecordType;
  recordId: string;
  fileName: string;
  /** Distinguishes repeat uploads of the same name. A UUID in practice. */
  uniqueId: string;
}

/**
 * Build the object key.
 *
 * Layout is `{organization_id}/{record_type}/{record_id}/{uniqueId}-{file}`.
 * The organization id leads because storage RLS enforces tenant isolation by
 * comparing the first path segment — so the identifiers that form it are
 * checked to be UUIDs here. A non-UUID could otherwise carry a `/` and shift
 * every later segment, moving the object out of the org's prefix.
 */
export function buildStoragePath(input: StoragePathInput): string {
  if (!UUID.test(input.organizationId)) {
    throw new Error('organizationId must be a UUID to form a tenant-scoped storage path.');
  }
  if (!UUID.test(input.recordId)) {
    throw new Error('recordId must be a UUID to form a storage path.');
  }
  if (!UUID.test(input.uniqueId)) {
    throw new Error('uniqueId must be a UUID to form a storage path.');
  }
  if (!isEvidenceRecordType(input.recordType)) {
    throw new Error(`Unknown evidence record type "${input.recordType}".`);
  }

  const safeName = sanitizeFileName(input.fileName);
  return `${input.organizationId}/${input.recordType}/${input.recordId}/${input.uniqueId}-${safeName}`;
}

/** The organization id a path is scoped to — what storage RLS compares. */
export function organizationIdFromPath(path: string): string | null {
  const first = path.split('/')[0];
  return first && UUID.test(first) ? first : null;
}

/**
 * Key for an attachment-count map. A list view needs counts for a page of
 * records at once, so they are fetched in one query and indexed rather than
 * queried per row.
 */
export function evidenceCountKey(recordType: string, recordId: string): string {
  return `${recordType}:${recordId}`;
}

/** Index `{record_type, record_id}` rows into counts per record. */
export function countEvidenceByRecord(
  rows: { record_type: string; record_id: string }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = evidenceCountKey(row.record_type, row.record_id);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// ─── Upload validation ───────────────────────────────────────────────────────

export interface UploadCandidate {
  fileName: string;
  sizeBytes: number;
  contentType: string;
}

export type UploadValidation = { ok: true } | { ok: false; error: string };

export function validateUpload(file: UploadCandidate): UploadValidation {
  if (!Number.isFinite(file.sizeBytes) || file.sizeBytes <= 0) {
    return { ok: false, error: 'The file is empty.' };
  }
  if (file.sizeBytes > MAX_EVIDENCE_BYTES) {
    return {
      ok: false,
      error: `${formatBytes(file.sizeBytes)} exceeds the ${formatBytes(MAX_EVIDENCE_BYTES)} limit for a single document.`,
    };
  }
  if (!isAllowedMimeType(file.contentType)) {
    return {
      ok: false,
      error: `${file.contentType || 'That file type'} is not accepted. Evidence must be a PDF, image, spreadsheet, or document.`,
    };
  }
  return { ok: true };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

// ─── Orphaned evidence ───────────────────────────────────────────────────────

export interface EvidenceRowRef {
  id: string;
  record_type: string;
  record_id: string;
  storage_path: string;
}

/**
 * Attachments whose record no longer exists.
 *
 * The attachment is polymorphic (record_type, record_id) with no foreign key,
 * so hard-deleting a project, supplier or custom factor cannot cascade to its
 * documents. This decides which rows are left pointing at nothing, given the
 * ids that DO still exist per record type. A row of a type missing from
 * `existing` is never reported: absence of evidence about a table is not
 * evidence its records are gone.
 */
export function findOrphanedEvidence(
  rows: readonly EvidenceRowRef[],
  existing: Partial<Record<string, ReadonlySet<string>>>,
): EvidenceRowRef[] {
  return rows.filter((r) => {
    const ids = existing[r.record_type];
    return ids !== undefined && !ids.has(r.record_id);
  });
}
