'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatDate } from '@/lib/utils';
import {
  buildStoragePath,
  validateUpload,
  formatBytes,
  EVIDENCE_BUCKET,
  EVIDENCE_ACCEPT_ATTRIBUTE,
  MAX_EVIDENCE_BYTES,
  type EvidenceRecordType,
} from '@/lib/evidence-core';
import { Paperclip, Upload, Download, Trash2, FileText } from 'lucide-react';

interface Attachment {
  id: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  description: string | null;
  created_at: string;
  storage_path: string;
}

interface Props {
  recordType: EvidenceRecordType;
  recordId: string;
  organizationId: string;
  canEdit: boolean;
  /** Lets a parent keep an attachment count badge in step with reality. */
  onCountChange?: (count: number) => void;
}

/**
 * Attach, retrieve and detach the source documents behind a record.
 *
 * Files go straight from the browser to Supabase Storage under the policies in
 * migration 019 — the bytes never pass through the application server, which
 * keeps large scans workable on hosts that cap request bodies. Reads use a
 * short-lived signed URL rather than a public object, so a document is only
 * reachable by someone who currently holds a session in the owning org.
 */
export function EvidencePanel({ recordType, recordId, organizationId, canEdit, onCountChange }: Props) {
  // One client for the component's lifetime. createClient() returns a fresh
  // object per call, and an unstable identity in a dependency array below would
  // re-run the fetch on every render.
  const [supabase] = useState(() => createClient());
  const fileRef = useRef<HTMLInputElement>(null);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [description, setDescription] = useState('');
  const [deleting, setDeleting] = useState<Attachment | null>(null);

  // Callers pass an inline arrow, so this changes identity every render. Held
  // in a ref rather than a dependency: as a dependency it would re-trigger the
  // fetch, which sets state, which renders again — without end.
  const onCountChangeRef = useRef(onCountChange);
  useEffect(() => { onCountChangeRef.current = onCountChange; });

  const fetchAttachments = useCallback(async (): Promise<Attachment[]> => {
    const { data, error: err } = await supabase
      .from('evidence_attachments')
      .select('id, file_name, content_type, size_bytes, description, created_at, storage_path')
      .eq('record_type', recordType)
      .eq('record_id', recordId)
      .order('created_at', { ascending: false });

    if (err) throw new Error(err.message);
    return (data as Attachment[]) ?? [];
  }, [supabase, recordType, recordId]);

  const apply = useCallback((rows: Attachment[]) => {
    setAttachments(rows);
    onCountChangeRef.current?.(rows.length);
  }, []);

  useEffect(() => {
    // Guarded against a response arriving after the record changed, which would
    // otherwise show one record's documents under another's.
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchAttachments();
        if (!cancelled) apply(rows);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load evidence.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchAttachments, apply]);

  const refresh = useCallback(async () => {
    try {
      apply(await fetchAttachments());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reload evidence.');
    }
  }, [fetchAttachments, apply]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');

    const validation = validateUpload({
      fileName: file.name,
      sizeBytes: file.size,
      contentType: file.type,
    });
    if (!validation.ok) {
      setError(validation.error);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setUploading(true);
    const storagePath = buildStoragePath({
      organizationId,
      recordType,
      recordId,
      fileName: file.name,
      uniqueId: crypto.randomUUID(),
    });

    const { error: uploadError } = await supabase
      .storage.from(EVIDENCE_BUCKET)
      .upload(storagePath, file, { contentType: file.type, upsert: false });

    if (uploadError) {
      setUploading(false);
      setError(uploadError.message);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    const res = await fetch('/api/evidence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordType,
        recordId,
        storagePath,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        description,
      }),
    });

    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';

    if (!res.ok) {
      // The object landed but nothing references it. Take it back out rather
      // than leaving an invisible orphan behind a failed attach.
      await supabase.storage.from(EVIDENCE_BUCKET).remove([storagePath]);
      let message = 'Could not record the attachment.';
      try { message = (await res.json()).error ?? message; } catch { /* keep default */ }
      setError(message);
      return;
    }

    setDescription('');
    await refresh();
  }

  async function download(attachment: Attachment) {
    setError('');
    // Signed on demand and short-lived: a copied link stops working quickly,
    // which matters when the document is a utility bill with an account number.
    const { data, error: err } = await supabase
      .storage.from(EVIDENCE_BUCKET)
      .createSignedUrl(attachment.storage_path, 60);

    if (err || !data?.signedUrl) {
      setError(err?.message ?? 'Could not open that document.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function confirmDelete() {
    if (!deleting) return;
    setError('');
    const res = await fetch(`/api/evidence?id=${encodeURIComponent(deleting.id)}`, {
      method: 'DELETE',
    });
    setDeleting(null);
    if (!res.ok) {
      let message = 'Could not remove the attachment.';
      try { message = (await res.json()).error ?? message; } catch { /* keep default */ }
      setError(message);
      return;
    }
    await refresh();
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-sm text-gray-400 py-4 text-center">Loading evidence…</p>
      ) : attachments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center">
          <FileText size={20} className="mx-auto mb-1.5 text-gray-300" />
          <p className="text-sm text-gray-500">No supporting documents attached.</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Attach the invoice, meter reading or certificate this figure came from.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-3 py-2.5">
              <Paperclip size={14} className="mt-1 shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <button
                  onClick={() => download(a)}
                  className="text-sm text-emerald-700 hover:underline text-left break-all"
                >
                  {a.file_name}
                </button>
                {a.description && (
                  <p className="text-xs text-gray-600 mt-0.5">{a.description}</p>
                )}
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {a.size_bytes != null ? formatBytes(a.size_bytes) : '—'} · attached {formatDate(a.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => download(a)}
                  title="Open"
                  className="p-1.5 text-gray-400 hover:text-emerald-700"
                >
                  <Download size={14} />
                </button>
                {canEdit && (
                  <button
                    onClick={() => setDeleting(a)}
                    title="Remove"
                    className="p-1.5 text-gray-400 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="space-y-2">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional note — what this document shows"
            disabled={uploading}
          />
          <input
            ref={fileRef}
            type="file"
            accept={EVIDENCE_ACCEPT_ATTRIBUTE}
            onChange={onFile}
            className="hidden"
            id={`evidence-file-${recordId}`}
          />
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={14} className="mr-1.5" />
              {uploading ? 'Uploading…' : 'Attach document'}
            </Button>
            <span className="text-xs text-gray-400">
              PDF, image, spreadsheet or document · up to {formatBytes(MAX_EVIDENCE_BYTES)}
            </span>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <ConfirmDialog
        open={!!deleting}
        title="Remove this document?"
        description={
          `"${deleting?.file_name ?? ''}" will be deleted. The audit log keeps a permanent record ` +
          'that it was attached and removed, by whom and when — but the file itself cannot be recovered.'
        }
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

/** The panel in a dialog — how every list view opens it. */
export function EvidenceDialog({
  open, onClose, title, ...panel
}: Props & { open: boolean; onClose: () => void; title: string }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supporting evidence</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-gray-500 -mt-2 mb-1">{title}</p>
        <EvidencePanel {...panel} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * A row-level evidence affordance: paperclip, attached count, and its own
 * dialog.
 *
 * Self-contained so a list view adds evidence by dropping this into a cell,
 * with no dialog state of its own. The count starts from the page's bulk fetch
 * — one query for the whole table rather than one per row — and thereafter
 * tracks what the dialog does. A visible count is the point: scanning a table
 * should show which figures are supported and which rest on an unverifiable
 * number.
 */
export function EvidenceCell({
  recordType, recordId, title, organizationId, canEdit, initialCount = 0,
}: {
  recordType: EvidenceRecordType;
  recordId: string;
  title: string;
  /** Null when the profile lookup failed; the cell then renders nothing. */
  organizationId: string | null;
  canEdit: boolean;
  initialCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(initialCount);

  if (!organizationId) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={count > 0 ? `${count} document${count === 1 ? '' : 's'} attached` : 'Attach supporting evidence'}
        className={`p-1.5 rounded inline-flex items-center gap-1 transition-colors ${
          count > 0
            ? 'text-emerald-600 hover:bg-emerald-50'
            : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'
        }`}
      >
        <Paperclip size={14} />
        {count > 0 && <span className="text-[11px] font-medium">{count}</span>}
      </button>

      {open && (
        <EvidenceDialog
          open
          onClose={() => setOpen(false)}
          title={title}
          recordType={recordType}
          recordId={recordId}
          organizationId={organizationId}
          canEdit={canEdit}
          onCountChange={setCount}
        />
      )}
    </>
  );
}
