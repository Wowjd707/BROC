'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InfoBubble } from '@/components/ui/info-bubble';
import { COLUMN_LABELS, type EntryFamily } from '@/lib/staged-import-core';
import {
  scope1CategoriesFor, metricsForFamily, suggestScope,
  type MetricCatalogEntry,
} from '@/lib/import-cascade-core';
import { SOURCE_LABELS, sourceLabel } from '@/lib/source-labels';
import { AlertTriangle, Check, CircleSlash, Bot, User as UserIcon } from 'lucide-react';

interface ReviewRow {
  id: string;
  lineNumber: number;
  raw: Record<string, string>;
  resolved: Record<string, string | null>;
  status: string;
  error: string | null;
}

interface Adjustment {
  id: string;
  rowId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  origin: 'auto' | 'user';
  reason: string | null;
  adjustedAt: string;
  adjustedBy: string | null;
}

interface Props {
  batch: {
    id: string; family: EntryFamily; filename: string | null;
    status: string; rowCount: number; committedCount: number;
  };
  columns: string[];
  rows: ReviewRow[];
  adjustments: Adjustment[];
  sites: { id: string; name: string }[];
  catalog: MetricCatalogEntry[];
}

/** Fields the reviewer may set from a dropdown, per family. */
const CHOICE_FIELDS = new Set([
  'site', 'scope', 'source_type', 'scope1_category', 'metric', 'unit', 'accounting_method',
]);

export function ImportReviewClient({ batch, columns, rows, adjustments, sites, catalog }: Props) {
  const router = useRouter();
  const [local, setLocal] = useState<ReviewRow[]>(rows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ committed: number; skipped: number; failures: { line: number; message: string }[] } | null>(null);

  const adjustmentsByRow = useMemo(() => {
    const m = new Map<string, Adjustment[]>();
    for (const a of adjustments) {
      if (!m.has(a.rowId)) m.set(a.rowId, []);
      m.get(a.rowId)!.push(a);
    }
    return m;
  }, [adjustments]);

  const needsReview = local.filter((r) => r.status === 'needs_review').length;
  const errored = local.filter((r) => r.status === 'error').length;
  const ready = local.filter((r) => r.status === 'valid').length;
  const committed = batch.status === 'committed';

  async function setField(row: ReviewRow, field: string, value: string) {
    setError('');
    const res = await fetch('/api/imports/row', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowId: row.id, field, value }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? 'Could not save that change.');
      return;
    }
    setLocal((prev) => prev.map((r) =>
      r.id === row.id
        ? { ...r, resolved: { ...r.resolved, [field]: value }, status: 'valid' }
        : r,
    ));
  }

  async function commit() {
    setBusy(true); setError('');
    const res = await fetch('/api/imports/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId: batch.id }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? 'Commit failed.'); return; }
    setResult(await res.json());
    router.refresh();
  }

  async function discard() {
    setBusy(true);
    await fetch('/api/imports/discard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId: batch.id }),
    });
    setBusy(false);
    router.push('/data');
  }

  /** The options a field offers, given what the row already says. */
  function optionsFor(row: ReviewRow, field: string): { value: string; label: string }[] {
    switch (field) {
      case 'site':
        return sites.map((s) => ({ value: s.name, label: s.name }));
      case 'scope':
        return [
          { value: 'scope1', label: 'Scope 1 — owned or controlled' },
          { value: 'scope2', label: 'Scope 2 — purchased energy' },
        ];
      case 'source_type':
        return Object.keys(SOURCE_LABELS).map((k) => ({ value: k, label: sourceLabel(k) }));
      case 'scope1_category':
        return scope1CategoriesFor(row.resolved.source_type ?? '')
          .map((c) => ({ value: c, label: c.replace(/_/g, ' ') }));
      case 'metric':
        return metricsForFamily(
          batch.family as Exclude<EntryFamily, 'emissions'>,
          catalog,
        ).map((m) => ({ value: m.sourceType, label: m.label }));
      case 'unit': {
        const metric = catalog.find((m) => m.sourceType === row.resolved.metric);
        return metric ? [{ value: metric.canonicalUnit, label: metric.canonicalUnit }] : [];
      }
      case 'accounting_method':
        return [
          { value: 'location_based', label: 'Location-based' },
          { value: 'market_based', label: 'Market-based' },
        ];
      default:
        return [];
    }
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Review import</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {batch.filename ?? 'Uploaded file'} · {batch.rowCount} rows · {batch.family}
          </p>
        </div>
        <InfoBubble label="How this screen works" title="Nothing is saved until you commit">
          <p className="mb-2">
            Each row keeps what your file said alongside what it will be stored as. Where the
            two differ, the change is listed under the row with who made it.
          </p>
          <p className="mb-2">
            A value marked <strong>auto</strong> was proposed by the system and has not been
            confirmed by anyone. A value marked <strong>you</strong> was chosen by a person.
            Both are recorded permanently.
          </p>
          <p>
            Scope is never set for you on a fuel. Diesel is Scope 1 only when it burns in
            equipment you own or control — the same fuel in a contractor&apos;s truck is Scope 3
            and must not enter this total.
          </p>
        </InfoBubble>
      </div>

      {committed ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 mb-6 text-sm text-emerald-900">
          This batch was committed — {batch.committedCount} of {batch.rowCount} rows were written.
          The rows below are kept as the record of what was imported and what was changed first.
        </div>
      ) : (
        <div className="flex gap-3 mb-6">
          <Stat label="Ready" value={ready} tone="emerald" />
          <Stat label="Needs review" value={needsReview} tone="amber" />
          <Stat label="Cannot import" value={errored} tone="red" />
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 mb-6 text-sm">
          <p className="font-medium text-gray-900">
            {result.committed} rows written, {result.skipped} left unconfirmed.
          </p>
          {result.failures.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-red-700">
              {result.failures.map((f) => <li key={f.line}>Row {f.line}: {f.message}</li>)}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <div className="space-y-3">
        {local.map((row) => {
          const rowAdjustments = adjustmentsByRow.get(row.id) ?? [];
          const scopeHint = batch.family === 'emissions' && row.resolved.source_type
            ? suggestScope(row.resolved.source_type)
            : null;

          return (
            <div
              key={row.id}
              className={`rounded-lg border bg-white ${
                row.status === 'error' ? 'border-red-200'
                  : row.status === 'needs_review' ? 'border-amber-200'
                    : 'border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
                <span className="text-xs text-gray-400">Row {row.lineNumber}</span>
                <StatusBadge status={row.status} />
                {row.error && <span className="text-xs text-red-700">{row.error}</span>}
              </div>

              <div className="px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                {columns.map((col) => {
                  const value = row.resolved[col] ?? '';
                  const fileValue = row.raw[col] ?? '';
                  const changed = (fileValue || '') !== (value || '');
                  const editable = !committed && CHOICE_FIELDS.has(col);
                  const options = editable ? optionsFor(row, col) : [];

                  return (
                    <div key={col} className="space-y-1">
                      <label className="text-[11px] uppercase tracking-wide text-gray-400">
                        {COLUMN_LABELS[col] ?? col}
                      </label>

                      {editable && options.length > 0 ? (
                        <Select value={value} onValueChange={(v) => setField(row, col, v)}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Choose…" />
                          </SelectTrigger>
                          <SelectContent>
                            {options.map((o) => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-sm text-gray-900 truncate" title={value}>
                          {value || <span className="text-gray-300">—</span>}
                        </p>
                      )}

                      {changed && (
                        <p className="text-[11px] text-amber-700">
                          file said {fileValue || '(blank)'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {scopeHint?.requiresConfirmation && !committed && (
                <p className="px-4 pb-3 text-xs text-amber-800 flex gap-1.5">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  {scopeHint.reason}
                </p>
              )}

              {rowAdjustments.length > 0 && (
                <div className="border-t border-gray-100 px-4 py-2 space-y-1">
                  {rowAdjustments.map((a) => (
                    <p key={a.id} className="text-[11px] text-gray-500 flex items-center gap-1.5">
                      {a.origin === 'auto'
                        ? <Bot size={11} className="text-gray-400" />
                        : <UserIcon size={11} className="text-emerald-600" />}
                      <span className="font-medium">{COLUMN_LABELS[a.field] ?? a.field}</span>
                      <span>{a.oldValue ?? '(blank)'} → {a.newValue ?? '(blank)'}</span>
                      <span className="text-gray-400">
                        · {a.origin === 'auto' ? 'auto, unconfirmed' : a.adjustedBy ?? 'you'}
                        {' · '}{new Date(a.adjustedAt).toLocaleString()}
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!committed && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
          <Button variant="outline" onClick={discard} disabled={busy}>Discard this batch</Button>
          <div className="flex items-center gap-3">
            {needsReview > 0 && (
              <span className="text-xs text-amber-700">
                {needsReview} row{needsReview === 1 ? '' : 's'} still unconfirmed — they will be left staged.
              </span>
            )}
            <Button onClick={commit} disabled={busy || ready === 0}>
              {busy ? 'Writing…' : `Import ${ready} row${ready === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'red' }) {
  const tones = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    red: 'bg-red-50 border-red-200 text-red-800',
  };
  return (
    <div className={`flex-1 rounded-lg border px-4 py-3 ${tones[tone]}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'committed') return <Badge variant="default"><Check size={11} className="mr-1" />Imported</Badge>;
  if (status === 'error') return <Badge variant="destructive"><CircleSlash size={11} className="mr-1" />Cannot import</Badge>;
  if (status === 'needs_review') return <Badge variant="warning"><AlertTriangle size={11} className="mr-1" />Needs review</Badge>;
  if (status === 'skipped') return <Badge variant="secondary">Skipped</Badge>;
  return <Badge variant="default">Ready</Badge>;
}
