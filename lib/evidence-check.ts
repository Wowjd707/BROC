import 'server-only';
import { createServerClient } from './supabase/server';
import { applyScope } from './scope-filter';
import { fetchAll } from './fetch-all';
import { sourceLabel } from './source-labels';
import {
  getUnitsForSource, normalizeEmissionInput, normalizeEhsInput, WASTE_UNITS, WATER_UNITS,
} from './conversions';
import { unreadableReason, type CheckOutcome, type Normalizer } from './evidence-check-core';
import { shiftMonth } from './anomaly-core';

/**
 * Server side of "check against the document": which entries can be checked,
 * in what units, and what was found last time.
 */

export type CheckableRecordType = 'emission_entry' | 'ehs_entry';

export interface CheckableEntry {
  recordType: CheckableRecordType;
  recordId: string;
  siteId: string;
  siteName: string;
  label: string;
  entryDate: string;
  quantity: number;
  unit: string;
  attachments: { id: string; fileName: string; reason: string | null }[];
  latestCheck: {
    outcome: CheckOutcome;
    summary: string;
    fileName: string;
    checkedAt: string;
    model: string;
  } | null;
}

export interface DocumentCheckList {
  month: string;
  entries: CheckableEntry[];
  /** Entries in the month with no document at all — an assurance gap of its own. */
  withoutDocuments: number;
}

const SCOPE_LABEL: Record<string, string> = { scope1: 'Scope 1', scope2: 'Scope 2' };

/** Only quantities with a unit conversion can be checked; counts and hours cannot. */
const EHS_CHECKABLE = new Set(['water', 'waste']);

export interface EntryKindInfo {
  label: string;
  unitCodes: { code: string; label: string }[];
  normalize: Normalizer;
}

/**
 * What an entry is and how to compare quantities for it. Null for kinds that
 * have no document to read against (social and governance counts).
 */
export function entryKindInfo(
  recordType: CheckableRecordType,
  row: { scope?: string; metric_type?: string; source_type: string },
): EntryKindInfo | null {
  if (recordType === 'emission_entry') {
    const scope = row.scope === 'scope2' ? 'scope2' : 'scope1';
    const units = getUnitsForSource(scope, row.source_type);
    const codes = new Set(units.map((u) => u.value));
    return {
      label: `${sourceLabel(row.source_type)} (${SCOPE_LABEL[scope]})`,
      unitCodes: units.map((u) => ({ code: u.value, label: u.label })),
      normalize: (q, u) => {
        if (!codes.has(u)) return null;
        try { return normalizeEmissionInput(q, u, scope, row.source_type).quantityNormalized; } catch { return null; }
      },
    };
  }
  const metric = row.metric_type ?? '';
  if (!EHS_CHECKABLE.has(metric)) return null;
  const units = metric === 'water' ? WATER_UNITS : WASTE_UNITS;
  const codes = new Set(units.map((u) => u.value));
  return {
    label: `${sourceLabel(row.source_type)} (${metric})`,
    unitCodes: units.map((u) => ({ code: u.value, label: u.label })),
    normalize: (q, u) => {
      if (!codes.has(u)) return null;
      try { return normalizeEhsInput(q, u, metric).quantityNormalized; } catch { return null; }
    },
  };
}

interface EmissionRow { id: string; site_id: string; scope: string; source_type: string; entry_date: string; quantity: number; unit: string }
interface EhsRow { id: string; site_id: string | null; metric_type: string; source_type: string; entry_date: string; quantity: number; unit: string }

/** Entries dated in `month`, with their documents and their latest check. */
export async function loadDocumentCheckList(scopeSiteIds: string[] | null, month: string): Promise<DocumentCheckList> {
  const supabase = await createServerClient();
  const start = `${month}-01`;
  const end = `${shiftMonth(month, 1)}-01`;

  const [{ data: sites }, { data: emissions }, { data: ehs }] = await Promise.all([
    supabase.from('sites').select('id, name'),
    fetchAll((from, to) => applyScope(
      supabase.from('emission_entries')
        .select('id, site_id, scope, source_type, entry_date, quantity, unit')
        .is('deleted_at', null).gte('entry_date', start).lt('entry_date', end),
      scopeSiteIds,
    ).order('id').range(from, to)),
    fetchAll((from, to) => applyScope(
      supabase.from('ehs_entries')
        .select('id, site_id, metric_type, source_type, entry_date, quantity, unit')
        .is('deleted_at', null).in('metric_type', [...EHS_CHECKABLE]).gte('entry_date', start).lt('entry_date', end),
      scopeSiteIds,
    ).order('id').range(from, to)),
  ]);

  const siteName = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]));
  const base: Omit<CheckableEntry, 'attachments' | 'latestCheck'>[] = [];
  for (const r of (emissions ?? []) as EmissionRow[]) {
    const info = entryKindInfo('emission_entry', r);
    if (!info) continue;
    base.push({ recordType: 'emission_entry', recordId: r.id, siteId: r.site_id, siteName: siteName.get(r.site_id) ?? 'Unknown site', label: info.label, entryDate: r.entry_date, quantity: Number(r.quantity), unit: r.unit });
  }
  for (const r of (ehs ?? []) as EhsRow[]) {
    if (!r.site_id) continue;
    const info = entryKindInfo('ehs_entry', r);
    if (!info) continue;
    base.push({ recordType: 'ehs_entry', recordId: r.id, siteId: r.site_id, siteName: siteName.get(r.site_id) ?? 'Unknown site', label: info.label, entryDate: r.entry_date, quantity: Number(r.quantity), unit: r.unit });
  }

  const ids = base.map((b) => b.recordId);
  const attachments = new Map<string, CheckableEntry['attachments']>();
  const latest = new Map<string, NonNullable<CheckableEntry['latestCheck']>>();

  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const [{ data: files }, { data: checks }] = await Promise.all([
      fetchAll((from, to) => supabase.from('evidence_attachments')
        .select('id, record_id, file_name, content_type, size_bytes, created_at')
        .in('record_type', ['emission_entry', 'ehs_entry']).in('record_id', chunk)
        .order('created_at').range(from, to)),
      // Missing table (migration 042 not applied) reads as "never checked".
      fetchAll((from, to) => supabase.from('evidence_checks')
        .select('record_id, outcome, summary, file_name, checked_at, model')
        .in('record_id', chunk).order('checked_at', { ascending: false }).range(from, to)),
    ]);
    for (const f of (files ?? []) as { id: string; record_id: string; file_name: string; content_type: string | null; size_bytes: number | null }[]) {
      const list = attachments.get(f.record_id) ?? [];
      list.push({ id: f.id, fileName: f.file_name, reason: unreadableReason(f.content_type, f.file_name, f.size_bytes) });
      attachments.set(f.record_id, list);
    }
    for (const c of (checks ?? []) as { record_id: string; outcome: CheckOutcome; summary: string; file_name: string; checked_at: string; model: string }[]) {
      if (!latest.has(c.record_id)) {
        latest.set(c.record_id, { outcome: c.outcome, summary: c.summary, fileName: c.file_name, checkedAt: c.checked_at, model: c.model });
      }
    }
  }

  const entries: CheckableEntry[] = [];
  let withoutDocuments = 0;
  for (const b of base) {
    const files = attachments.get(b.recordId);
    if (!files?.length) { withoutDocuments++; continue; }
    entries.push({ ...b, attachments: files, latestCheck: latest.get(b.recordId) ?? null });
  }
  entries.sort((a, b) => a.siteName.localeCompare(b.siteName) || a.label.localeCompare(b.label) || a.entryDate.localeCompare(b.entryDate));
  return { month, entries, withoutDocuments };
}
