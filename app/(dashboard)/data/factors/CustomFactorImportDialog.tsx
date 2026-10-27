'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  customFactorImportTemplate, CUSTOM_FACTOR_IMPORT_COLUMNS,
} from '@/lib/custom-factor-import-core';
import type { ImportSummary } from '@/lib/import-core';
import { Upload, Download } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CustomFactorImportDialog({ open, onClose }: Props) {
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
    const blob = new Blob([customFactorImportTemplate()], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'custom_emission_factor_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runImport() {
    if (!csv.trim()) { setError('Choose a CSV file first.'); return; }
    setImporting(true);
    setError('');
    setSummary(null);

    const res = await fetch('/api/factors/custom/import', {
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
          <DialogTitle>Import custom emission factors</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <p className="text-gray-600">
            Load a whole vintage of your own measured or supplier-specific factors at once. Every
            row must cite a source and data year, the same rule the form applies.
          </p>
          <code className="block text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 overflow-x-auto">
            {CUSTOM_FACTOR_IMPORT_COLUMNS.join(', ')}
          </code>

          <div className="text-xs text-gray-500 space-y-1.5">
            <p>
              <strong>factor_key</strong> is the fuel type for <code>scope1</code>, the refrigerant
              code for <code>refrigerant</code>, and the <strong>site name</strong> for{' '}
              <code>scope2_location</code> (grid average), <code>scope2_residual</code> (residual
              mix) and <code>scope2_heat</code> (purchased heat or steam, per kWh thermal). Spelling is matched loosely (<code>Natural Gas</code>{' '}
              finds <code>natural_gas</code>), but a key that matches nothing is rejected — a factor
              keyed to something the platform does not recognise would never be applied.
            </p>
            <p>
              <strong>unit</strong> is derived from the category (MMBtu, kWh, kg) and only needs to
              be present if you want it checked. A stated unit that contradicts the category fails
              the import rather than being corrected silently.
            </p>
            <p>
              <strong>To supersede last year&apos;s factors</strong>, import the new vintage with a
              later <code>effective_from</code>. Existing rows are never modified, so entries
              already calculated keep the factor they were calculated with.
            </p>
          </div>

          <p className="text-xs text-gray-500">
            Validation is all-or-nothing: if any row fails, nothing is imported.
          </p>

          <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 text-emerald-700 hover:underline">
            <Download size={14} /> Download template
          </button>

          <div className="border-2 border-dashed border-gray-200 rounded-lg p-5 text-center">
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" id="custom-factor-csv-file" />
            <label htmlFor="custom-factor-csv-file" className="cursor-pointer inline-flex flex-col items-center gap-1.5 text-gray-500">
              <Upload size={22} />
              <span className="text-sm">{fileName || 'Choose a CSV file'}</span>
            </label>
          </div>

          {summary && (
            <div className="space-y-3">
              {summary.imported > 0 ? (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
                  <p className="text-xs text-emerald-600 font-medium">Imported</p>
                  <p className="text-2xl font-semibold text-emerald-800">{summary.imported} factors</p>
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
