'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { headersFor, type EntryFamily } from '@/lib/staged-import-core';
import { Upload, Download, FileSpreadsheet } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * The family has to be chosen, not detected.
 *
 * No file reliably says which it is: an export called "utilities.csv" could be
 * electricity or water, and guessing wrong files a water reading as an
 * emission — a mistake that is invisible afterwards because both are just rows
 * with a quantity and a date.
 */
const FAMILIES: { value: EntryFamily; label: string; hint: string }[] = [
  { value: 'emissions',  label: 'Emissions',  hint: 'Fuel, electricity, refrigerants — Scope 1 and 2' },
  { value: 'water',      label: 'Water',      hint: 'Consumption and discharge by source' },
  { value: 'waste',      label: 'Waste',      hint: 'Landfill, recycling, composting, hazardous' },
  { value: 'social',     label: 'Social',     hint: 'Safety, workforce and training metrics' },
  { value: 'governance', label: 'Governance', hint: 'Board composition, ethics and grievance metrics' },
];

export function ImportDialog({ open, onClose }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [family, setFamily] = useState<EntryFamily>('emissions');
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [workbook, setWorkbook] = useState('');
  const [staging, setStaging] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setFileName(''); setCsv(''); setWorkbook(''); setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function close() { reset(); onClose(); }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError('');
    setCsv(''); setWorkbook('');

    // A .xlsx is a zip; reading it as text corrupts it. Base64 so the upload
    // keeps one JSON shape for both kinds of file.
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

  // Built on the server, because the dropdowns hold this organization's own
  // sites and metrics — a file bundled with the app could not.
  function downloadTemplate() {
    window.location.assign(`/api/imports/template?family=${family}`);
  }

  async function stage() {
    if (!csv.trim() && !workbook) { setError('Choose a file first.'); return; }
    setStaging(true);
    setError('');

    const res = await fetch('/api/imports/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        workbook
          ? { family, filename: fileName, workbook }
          : { family, filename: fileName, csv },
      ),
    });

    setStaging(false);

    if (!res.ok) {
      let message = 'Could not read that file.';
      try { message = (await res.json()).error ?? message; } catch { /* keep default */ }
      setError(message);
      return;
    }

    const { batchId } = await res.json();
    close();
    // Nothing has been written yet — the review screen is where it is decided.
    router.push(`/data/import/${batchId}`);
  }

  const active = FAMILIES.find((f) => f.value === family)!;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk import metrics data</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">What kind of data is this?</label>
            <Select value={family} onValueChange={(v) => setFamily(v as EntryFamily)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FAMILIES.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">{active.hint}</p>
          </div>

          <p className="text-gray-600">
            Nothing is saved yet. The file is checked and held for review, and you confirm
            anything it could not work out before a single row is written.
          </p>

          <button
            onClick={downloadTemplate}
            className="w-full flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-left hover:bg-emerald-100 transition-colors"
          >
            <FileSpreadsheet size={20} className="text-emerald-700 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-emerald-900">
                Download the {active.label.toLowerCase()} template
              </span>
              <span className="block text-xs text-emerald-700 mt-0.5">
                A spreadsheet with your sites and metrics already in the dropdowns
              </span>
            </span>
            <Download size={16} className="text-emerald-700 ml-auto shrink-0" />
          </button>

          <div className="border-2 border-dashed border-gray-200 rounded-lg p-5 text-center">
            <input ref={fileRef} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={onFile} className="hidden" id="import-file" />
            <label htmlFor="import-file" className="cursor-pointer inline-flex flex-col items-center gap-1.5 text-gray-500">
              <Upload size={22} />
              <span className="text-sm">{fileName || 'Choose your filled-in file'}</span>
            </label>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* The spreadsheet is the path people should take; a plain file with
              these columns still works, so it stays available without competing
              with the template for attention. */}
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-700">
              Prefer a plain CSV? These are the columns.
            </summary>
            <code className="block mt-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 overflow-x-auto">
              {headersFor(family).join(', ')}
            </code>
            <p className="mt-2">
              A CSV cannot carry the dropdowns, so anything it gets wrong is caught at the
              review step instead of as you type.
            </p>
          </details>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button onClick={stage} disabled={staging || (!csv && !workbook)}>
            {staging ? 'Checking…' : 'Check and review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
