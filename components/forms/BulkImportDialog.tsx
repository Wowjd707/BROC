'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, Download, FileSpreadsheet, AlertTriangle } from 'lucide-react';

/**
 * The shared shell for a bulk upload: download a template, choose a filled-in
 * file, see what happened.
 *
 * Extracted when the third of these appeared. Suppliers, sites and business
 * units differ in their copy and in whether they report warnings, and in nothing
 * else — three copies of the base64 encoding, the counts and the error list
 * would be three places to fix the next thing found wrong with any of them.
 *
 * The one piece of behaviour worth keeping here rather than per-caller is the
 * distinction the counts draw. **Skipped is not failed.** Skipped means the row
 * was understood and deliberately not applied, almost always because the record
 * already exists; failed means the row could not be read. Collapsing them would
 * turn "your list is already up to date" into "twelve errors".
 */

export interface BulkImportSummaryShape {
  imported: number;
  skipped: number;
  failed: number;
  errors: { line: number; message: string }[];
  /** Rows that landed but are worth looking at. Omitted where none can arise. */
  warnings?: { line: number; message: string }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Dialog heading, e.g. "Import sites". */
  title: string;
  /** One or two sentences above the template link. */
  intro: React.ReactNode;
  templateHref: string;
  templateTitle: string;
  templateHint: string;
  importHref: string;
  /** Column headers, shown under the CSV disclosure. */
  columns: string[];
  /** Label for the count of rows that were understood but not applied. */
  skippedLabel?: string;
}

export function BulkImportDialog({
  open, onClose, title, intro,
  templateHref, templateTitle, templateHint,
  importHref, columns, skippedLabel = 'Already listed',
}: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [workbook, setWorkbook] = useState('');
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<BulkImportSummaryShape | null>(null);
  const [error, setError] = useState('');

  function reset() {
    setFileName(''); setCsv(''); setWorkbook(''); setSummary(null); setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function close() { reset(); onClose(); }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(''); setSummary(null);
    setCsv(''); setWorkbook('');

    // A .xlsx is a zip; reading it as text corrupts it. Chunked because
    // String.fromCharCode on a whole file overflows the argument limit.
    if (/\.xlsx$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      setWorkbook(btoa(binary));
      return;
    }
    setCsv(await file.text());
  }

  async function runImport() {
    if (!csv.trim() && !workbook) { setError('Choose a file first.'); return; }
    setImporting(true);
    setError('');
    setSummary(null);

    const res = await fetch(importHref, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workbook ? { workbook } : { csv }),
    });

    setImporting(false);

    if (!res.ok) {
      let message = 'Import failed.';
      try { message = (await res.json()).error ?? message; } catch { /* keep default */ }
      setError(message);
      return;
    }

    const result: BulkImportSummaryShape = await res.json();
    setSummary(result);
    if (result.imported > 0) router.refresh();
  }

  const inputId = `bulk-import-${importHref.replace(/\W+/g, '-')}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <p className="text-gray-600">{intro}</p>

          <a
            href={templateHref}
            className="w-full flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-left hover:bg-emerald-100 transition-colors"
          >
            <FileSpreadsheet size={20} className="text-emerald-700 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-emerald-900">{templateTitle}</span>
              <span className="block text-xs text-emerald-700 mt-0.5">{templateHint}</span>
            </span>
            <Download size={16} className="text-emerald-700 ml-auto shrink-0" />
          </a>

          <div className="border-2 border-dashed border-gray-200 rounded-lg p-5 text-center">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={onFile}
              className="hidden"
              id={inputId}
            />
            <label htmlFor={inputId} className="cursor-pointer inline-flex flex-col items-center gap-1.5 text-gray-500">
              <Upload size={22} />
              <span className="text-sm">{fileName || 'Choose your filled-in file'}</span>
            </label>
          </div>

          {summary && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <Stat label="Added" value={summary.imported} tone="emerald" />
                <Stat label={skippedLabel} value={summary.skipped} tone="gray" />
                <Stat label="Could not read" value={summary.failed} tone="red" />
              </div>

              {summary.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {summary.errors.map((e, i) => (
                    <div key={i} className="flex gap-3 px-3 py-2 text-xs">
                      <span className="text-gray-400 shrink-0">Row {e.line}</span>
                      <span className="text-gray-700">{e.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {summary.warnings && summary.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50">
                  <p className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-900 border-b border-amber-100">
                    <AlertTriangle size={13} />
                    Imported, but worth checking
                  </p>
                  <div className="max-h-40 overflow-y-auto divide-y divide-amber-100">
                    {summary.warnings.map((w, i) => (
                      <div key={i} className="flex gap-3 px-3 py-2 text-xs">
                        <span className="text-amber-500 shrink-0">Row {w.line}</span>
                        <span className="text-amber-900">{w.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-700">
              Prefer a plain CSV? These are the columns.
            </summary>
            <code className="block mt-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 overflow-x-auto">
              {columns.join(', ')}
            </code>
          </details>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>{summary ? 'Close' : 'Cancel'}</Button>
          {!summary && (
            <Button onClick={runImport} disabled={importing || (!csv && !workbook)}>
              {importing ? 'Importing…' : 'Import'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'gray' | 'red' }) {
  const tones = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    gray: 'bg-gray-50 border-gray-200 text-gray-700',
    red: 'bg-red-50 border-red-200 text-red-800',
  };
  return (
    <div className={`flex-1 rounded-lg border px-3 py-2.5 ${tones[tone]}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}
