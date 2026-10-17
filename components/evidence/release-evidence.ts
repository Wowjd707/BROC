import type { EvidenceRecordType } from '@/lib/evidence-core';

/**
 * Call after a record that can carry evidence has been hard-deleted, so its
 * documents do not stay behind in storage, unlinked. Returns an error message
 * for the caller to surface, or null. The record's deletion has already
 * happened either way.
 */
export async function releaseEvidence(
  recordType: EvidenceRecordType,
  recordId: string,
): Promise<string | null> {
  try {
    const res = await fetch('/api/evidence/orphans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordType, recordId }),
    });
    if (res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return (body as { error?: string }).error ?? 'Its supporting documents could not be removed.';
  } catch {
    return 'Its supporting documents could not be removed.';
  }
}
