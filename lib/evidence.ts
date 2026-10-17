import 'server-only';
import { createServerClient } from './supabase/server';
import {
  countEvidenceByRecord,
  findOrphanedEvidence,
  EVIDENCE_BUCKET,
  EVIDENCE_RECORD_TABLES,
  EVIDENCE_RECORD_TYPES,
  type EvidenceRecordType,
  type EvidenceRowRef,
} from './evidence-core';

/**
 * Server-side helpers every page with an evidence column shares.
 *
 * Two mistakes were repeated page by page before this existed, so they are
 * fixed once here:
 *
 *  - **The wrong organization.** Pages passed `users.organization_id` (the
 *    home organization) to the upload panel, which builds the storage path from
 *    it. Storage RLS compares that path against `auth_org_id()` — the ACTIVE
 *    organization — so in practice mode every upload was refused. See
 *    `lib/org-context.ts` for the two-organization model.
 *
 *  - **Unbounded counts.** Each page fetched every attachment row of a type in
 *    the organization to count them. PostgREST caps a response (1,000 rows by
 *    default), so past that point the paperclip counts silently undercounted —
 *    showing "no evidence" against figures that had it. Counts are now fetched
 *    for exactly the records on screen.
 */

/** The organization an evidence upload must be scoped to: the active one. */
export function evidenceOrganizationId(
  profile: { organization_id: string; active_organization_id?: string | null } | null | undefined,
): string | null {
  if (!profile) return null;
  return profile.active_organization_id ?? profile.organization_id;
}

/**
 * Keeps each `in.(…)` filter comfortably inside URL length limits. 150 UUIDs
 * is about 5.6 kB of query string.
 */
const ID_CHUNK = 150;

/**
 * Attachment counts for the given records, keyed by `evidenceCountKey`.
 *
 * Failure returns an empty map rather than throwing: a missing count renders
 * as an empty paperclip, which still opens the panel and shows the truth.
 */
export async function loadEvidenceCounts(
  recordType: EvidenceRecordType,
  recordIds: readonly string[],
): Promise<Record<string, number>> {
  const ids = [...new Set(recordIds)];
  if (ids.length === 0) return {};

  const supabase = await createServerClient();
  const rows: { record_type: string; record_id: string }[] = [];

  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from('evidence_attachments')
      .select('record_type, record_id')
      .eq('record_type', recordType)
      .in('record_id', ids.slice(i, i + ID_CHUNK));
    if (error) return {};
    rows.push(...(data ?? []));
  }

  return countEvidenceByRecord(rows);
}

/** Several record types at once, merged into one map. */
export async function loadEvidenceCountsFor(
  groups: readonly { recordType: EvidenceRecordType; ids: readonly string[] }[],
): Promise<Record<string, number>> {
  const maps = await Promise.all(groups.map((g) => loadEvidenceCounts(g.recordType, g.ids)));
  return Object.assign({}, ...maps);
}

// ─── Removing evidence whose record is gone ─────────────────────────────────

export interface EvidenceRemoval {
  /** Attachment rows deleted (each one recorded in audit_log by trigger). */
  rowsRemoved: number;
  /** Stored files removed. Less than rowsRemoved means some files remain. */
  filesRemoved: number;
}

/**
 * Delete attachment rows and then their files, under the caller's RLS.
 *
 * Rows first, for the same reason as the single-attachment DELETE route: a
 * row whose file is gone renders as available and 404s, while a file whose
 * row is gone costs storage and nothing else.
 */
async function removeEvidenceRows(rows: readonly EvidenceRowRef[]): Promise<EvidenceRemoval> {
  if (rows.length === 0) return { rowsRemoved: 0, filesRemoved: 0 };
  const supabase = await createServerClient();

  let rowsRemoved = 0;
  const paths: string[] = [];
  for (let i = 0; i < rows.length; i += ID_CHUNK) {
    const chunk = rows.slice(i, i + ID_CHUNK);
    const { data } = await supabase
      .from('evidence_attachments')
      .delete()
      .in('id', chunk.map((r) => r.id))
      .select('storage_path');
    rowsRemoved += data?.length ?? 0;
    paths.push(...(data ?? []).map((d) => d.storage_path));
  }

  let filesRemoved = 0;
  for (let i = 0; i < paths.length; i += ID_CHUNK) {
    const { data } = await supabase.storage.from(EVIDENCE_BUCKET).remove(paths.slice(i, i + ID_CHUNK));
    filesRemoved += data?.length ?? 0;
  }
  return { rowsRemoved, filesRemoved };
}

/**
 * Remove the documents attached to one record that has just been deleted.
 *
 * Refuses while the record still exists, so this can never be used to strip
 * evidence from a live figure — removing evidence from a live record goes
 * through the per-attachment DELETE, one deliberate act at a time.
 */
export async function removeEvidenceForDeletedRecord(
  recordType: EvidenceRecordType,
  recordId: string,
): Promise<{ ok: true; data: EvidenceRemoval } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  const { data: stillThere } = await supabase
    .from(EVIDENCE_RECORD_TABLES[recordType]).select('id').eq('id', recordId).maybeSingle();
  if (stillThere) {
    return { ok: false, error: 'That record still exists, so its documents were left in place.' };
  }

  const { data: rows, error } = await supabase
    .from('evidence_attachments')
    .select('id, record_type, record_id, storage_path')
    .eq('record_type', recordType)
    .eq('record_id', recordId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, data: await removeEvidenceRows(rows ?? []) };
}

/**
 * Find and remove every attachment in the organization whose record is gone —
 * for documents left behind before deletes cleaned up after themselves, or by a
 * delete made directly in SQL.
 */
export async function sweepOrphanedEvidence(): Promise<EvidenceRemoval & { orphansFound: number }> {
  const supabase = await createServerClient();
  const orphans: EvidenceRowRef[] = [];

  for (const recordType of EVIDENCE_RECORD_TYPES) {
    const { data: rows } = await supabase
      .from('evidence_attachments')
      .select('id, record_type, record_id, storage_path')
      .eq('record_type', recordType)
      .limit(10_000);
    if (!rows || rows.length === 0) continue;

    const ids = [...new Set(rows.map((r) => r.record_id))];
    const existing = new Set<string>();
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const { data, error } = await supabase
        .from(EVIDENCE_RECORD_TABLES[recordType])
        .select('id')
        .in('id', ids.slice(i, i + ID_CHUNK));
      // A failed lookup must not read as "every record is gone".
      if (error) throw new Error(`Could not check ${recordType} records: ${error.message}`);
      for (const r of data ?? []) existing.add(r.id);
    }
    orphans.push(...findOrphanedEvidence(rows, { [recordType]: existing }));
  }

  const removed = await removeEvidenceRows(orphans);
  return { orphansFound: orphans.length, ...removed };
}

/**
 * Remove every stored file in the caller's ACTIVE organization's evidence.
 * Used before the practice workspace is reset: deleting the sandbox
 * organization cascades its attachment rows away, and with them the only
 * record of where its files were.
 */
export async function removeAllEvidenceFilesInActiveOrg(): Promise<number> {
  const supabase = await createServerClient();
  const { data: rows } = await supabase
    .from('evidence_attachments').select('storage_path').limit(10_000);
  const paths = (rows ?? []).map((r) => r.storage_path);
  let removed = 0;
  for (let i = 0; i < paths.length; i += ID_CHUNK) {
    const { data } = await supabase.storage.from(EVIDENCE_BUCKET).remove(paths.slice(i, i + ID_CHUNK));
    removed += data?.length ?? 0;
  }
  return removed;
}
