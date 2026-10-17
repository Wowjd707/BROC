'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { requirementImportTemplate, REQUIREMENT_IMPORT_COLUMNS } from '@/lib/requirement-import-core';
import { METRIC_KEYS } from '@/lib/disclosure-metrics-core';
import type { ImportSummary } from '@/lib/import-core';
import { Upload, Download } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RequirementImportDialog({ open, onClose }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState('');

  function reset() {
    setFileName(''); setCsv(''); setSummary(null); setError('');
    if (fileRef.current) fileRef.current.value = '';
  }
  function close() { reset(); onClose(); }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setSummary(null);
    setError('');
    setCsv(await file.text());
  }

  function downloadTemplate() {
    const blob = new Blob([requirementImportTemplate()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'disclosure_requirements_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runImport() {
    if (!csv.trim()) { setError('Choose a CSV file first.'); return; }
    setImporting(true);
    setError('');
    setSummary(null);

    const res = await fetch('/api/frameworks/requirements/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv }),
    });

    setImporting(false);

    if (!res.ok) {
      let message = 'Import failed.';
      try { message = (await res.json()).error ?? message; } catch { /* keep default */ }
      setError(message);
      return;
    }

    const result: ImportSummary = await res.json();
    setSummary(result);
    if (result.imported > 0) router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import disclosure requirements</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <p className="text-gray-600">
            Add datapoint-level detail to a framework, or amend it after a standard is revised —
            without a code change. Rows are matched on framework + requirement code, so re-importing
            a corrected file updates in place rather than duplicating.
          </p>
          <code className="block text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 overflow-x-auto">
            {REQUIREMENT_IMPORT_COLUMNS.join(', ')}
          </code>

          <div className="text-xs text-gray-500 space-y-1">
            <p>
              <strong>metric_key</strong> links a requirement to a figure the platform computes, so
              it answers itself. Valid keys:
            </p>
            <code className="block bg-gray-50 border border-gray-200 rounded px-2 py-1.5 overflow-x-auto">
              {METRIC_KEYS.join(', ')}
            </code>
            <p>Leave it blank for narrative disclosures. Validation is all-or-nothing.</p>
            <p className="pt-1">
              <strong>topic_codes</strong> puts the requirement behind your double materiality
              assessment — <code>E1</code>, or <code>E1;E5</code> for several (semicolons, since
              commas separate CSV columns). Blank leaves existing links alone; <code>none</code>
              clears them and makes the requirement unconditional. An unlinked requirement is always
              required, so leaving this out over-demands rather than silently dropping a disclosure.
            </p>
          </div>

          <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 text-emerald-700 hover:underline">
            <Download size={14} /> Download template
          </button>

          <div className="border-2 border-dashed border-gray-200 rounded-lg p-5 text-center">
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" id="req-csv-file" />
            <label htmlFor="req-csv-file" className="cursor-pointer inline-flex flex-col items-center gap-1.5 text-gray-500">
              <Upload size={22} />
              <span className="text-sm">{fileName || 'Choose a CSV file'}</span>
            </label>
          </div>

          {summary && (
            <div className="space-y-3">
              {summary.imported > 0 ? (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
                  <p className="text-xs text-emerald-600 font-medium">Imported</p>
                  <p className="text-2xl font-semibold text-emerald-800">{summary.imported} requirements</p>
                </div>
              ) : (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                  <p className="text-sm font-medium text-red-800">
                    Nothing imported — {summary.failed} row{summary.failed === 1 ? '' : 's'} failed validation.
                  </p>
                </div>
              )}
              {summary.errors.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {summary.errors.map((e, i) => (
                    <div key={i} className="flex gap-3 px-3 py-2 text-xs">
                      <span className="text-gray-400 shrink-0">{e.line > 0 ? `Row ${e.line}` : 'File'}</span>
                      <span className="text-red-700">{e.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>{summary?.imported ? 'Close' : 'Cancel'}</Button>
          {!summary?.imported && (
            <Button onClick={runImport} disabled={importing || !csv}>
              {importing ? 'Importing…' : 'Import'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
