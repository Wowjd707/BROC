'use client';

import { useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, Download, FileText, AlertTriangle } from 'lucide-react';
import {
  planBusinessMetricImport, businessMetricImportTemplate, valueKey,
  BUSINESS_METRIC_IMPORT_COLUMNS,
  type MappedMetricValue, type MetricImportPlan,
} from '@/lib/business-metric-import-core';
import type { createClient } from '@/lib/supabase/client';

interface ValueRow {
  metric_key: string;
  reporting_year: number;
  site_id: string | null;
  as_of_date: string | null;
  value: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  metricKeys: string[];
  sites: { id: string; name: string }[];
  existingValues: ValueRow[];
  year: number;
  // The page already holds a browser Supabase client; reuse it so the import
  // writes under the same RLS identity as single-figure entry. Typed off the
  // factory rather than structurally: `.insert()` returns a chainable builder,
  // not a Promise, so a hand-written shape drifts from the real client.
  supabase: ReturnType<typeof createClient>;
  onImported: () => void;
}

/**
 * Bulk-load business metric figures from a CSV.
 *
 * Two-step on purpose: the file is parsed and checked in the browser first, and
 * nothing is written until the person has seen what will happen. These are
 * denominators — every intensity figure the organization reports is an emissions
 * total divided by one of them — so "23 figures will be added, 2 already exist,
 * 1 row is wrong" is worth reading before it becomes true.
 */
export function MetricValueImportDialog({
  open, onClose, metricKeys, sites, existingValues, year, supabase, onImported,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [plan, setPlan] = useState<MetricImportPlan | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<number | null>(null);

  const ctx = useMemo(() => ({
    knownMetricKeys: new Set(metricKeys),
    siteIdByName: new Map(sites.map((s) => [s.name.toLowerCase(), s.id])),
    existingKeys: new Set(
      existingValues.map((v) => `${v.metric_key}|${v.reporting_year}|${v.site_id ?? ''}|${v.as_of_date ?? ''}`),
    ),
  }), [metricKeys, sites, existingValues]);

  function reset() {
    setFileName(''); setCsv(''); setPlan(null); setError(''); setDone(null);
    setReplaceExisting(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  function close() { reset(); onClose(); }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(''); setDone(null);
    const text = await file.text();
    setCsv(text);
    setPlan(planBusinessMetricImport(text, ctx, year));
  }

  function downloadTemplate() {
    const blob = new Blob([businessMetricImportTemplate(year)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'business_metric_values_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Rows that duplicate a stored figure are skipped by default. There is no
  // unique constraint on business_metric_values, so inserting one anyway does
  // not fail — it quietly doubles a `sum` metric, and every intensity figure
  // built on it. Skipping is the safe default; overriding is a deliberate click.
  const toWrite: MappedMetricValue[] = useMemo(() => {
    if (!plan) return [];
    if (replaceExisting) return plan.rows;
    return plan.rows.filter((r) => !ctx.existingKeys.has(valueKey(r)));
  }, [plan, replaceExisting, ctx]);

  async function runImport() {
    if (!plan || toWrite.length === 0) return;
    setImporting(true);
    setError('');

    // Chunked so a large file does not hit a single oversized request.
    const CHUNK = 200;
    let written = 0;
    for (let i = 0; i < toWrite.length; i += CHUNK) {
      const slice = toWrite.slice(i, i + CHUNK);
      const { error: insertError } = await supabase.from('business_metric_values').insert(slice);
      if (insertError) {
        setImporting(false);
        setError(
          written > 0
            ? `${written} figure(s) were saved, then the import failed: ${insertError.message}`
            : insertError.message,
        );
        if (written > 0) onImported();
        return;
      }
      written += slice.length;
    }

    setImporting(false);
    setDone(written);
    onImported();
  }

  const skipped = plan ? plan.rows.length - toWrite.length : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import business metric figures</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            One row per figure. Leave <code className="text-xs bg-gray-100 px-1 rounded">site</code> blank
            for an organization-wide number. Columns:{' '}
            <span className="text-xs text-gray-600">{BUSINESS_METRIC_IMPORT_COLUMNS.join(', ')}</span>
          </p>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download size={14} className="mr-1.5" /> Template
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <FileText size={14} className="mr-1.5" /> Choose CSV
            </Button>
            {fileName && <span className="text-sm text-gray-600 truncate">{fileName}</span>}
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
          </div>

          {plan && done === null && (
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm space-y-1">
                <p className="text-gray-900 font-medium">
                  {toWrite.length} figure{toWrite.length === 1 ? '' : 's'} will be saved
                </p>
                {skipped > 0 && (
                  <p className="text-gray-600">
                    {skipped} row{skipped === 1 ? '' : 's'} already recorded for that metric, year, site
                    and date — skipped.
                  </p>
                )}
                {plan.errors.length > 0 && (
                  <p className="text-amber-700">
                    {plan.errors.length} row{plan.errors.length === 1 ? '' : 's'} cannot be read and
                    will be left out.
                  </p>
                )}
              </div>

              {skipped > 0 && (
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={replaceExisting}
                    onChange={(e) => setReplaceExisting(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Save them anyway.
                    <span className="block text-xs text-amber-700 mt-0.5">
                      These will be additional figures, not corrections — for a metric that sums
                      across the year that double-counts, and every intensity figure using it moves.
                    </span>
                  </span>
                </label>
              )}

              {plan.errors.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm font-medium text-amber-900 flex items-center gap-1.5 mb-1.5">
                    <AlertTriangle size={14} /> Rows that could not be read
                  </p>
                  <ul className="text-xs text-amber-900 space-y-1 max-h-40 overflow-y-auto">
                    {plan.errors.slice(0, 25).map((e, i) => (
                      <li key={i}>
                        {e.line > 0 ? <strong>Row {e.line}: </strong> : null}{e.message}
                      </li>
                    ))}
                    {plan.errors.length > 25 && (
                      <li className="text-amber-700">…and {plan.errors.length - 25} more.</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          {done !== null && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-sm text-emerald-900">
                {done} figure{done === 1 ? '' : 's'} saved.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>{done !== null ? 'Close' : 'Cancel'}</Button>
          {done === null && (
            <Button onClick={runImport} disabled={importing || !plan || toWrite.length === 0}>
              <Upload size={14} className="mr-1.5" />
              {importing ? 'Saving…' : `Save ${toWrite.length} figure${toWrite.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
