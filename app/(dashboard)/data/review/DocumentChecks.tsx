'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileSearch, Loader2, Paperclip } from 'lucide-react';
import { CHECK_OUTCOME_LABELS, type CheckOutcome } from '@/lib/evidence-check-core';
import type { DocumentCheckList, CheckableEntry } from '@/lib/evidence-check';

const OUTCOME_BADGE: Record<CheckOutcome, 'default' | 'destructive' | 'warning' | 'secondary'> = {
  match: 'default',
  mismatch: 'destructive',
  unit_slip: 'destructive',
  needs_review: 'warning',
  unreadable: 'secondary',
};

/** Sequential, and capped, so one click cannot run up a large model bill. */
const BATCH_LIMIT = 25;

/**
 * Entries in the review month that have a document attached, and whether each
 * matches it. The model reads the document; the platform compares
 * (lib/evidence-check-core.ts). Results are saved to evidence_checks.
 */
export function DocumentChecks({
  list, aiEnabled, canCheck,
}: { list: DocumentCheckList; aiEnabled: boolean; canCheck: boolean }) {
  const [checks, setChecks] = useState<Record<string, CheckableEntry['latestCheck']>>(
    () => Object.fromEntries(list.entries.map((e) => [e.recordId, e.latestCheck])),
  );
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);

  const checkable = (e: CheckableEntry) => e.attachments.some((a) => !a.reason);
  const enabled = aiEnabled && canCheck;

  async function check(e: CheckableEntry) {
    setRunning((s) => new Set(s).add(e.recordId));
    setErrors((x) => {
      const next = { ...x };
      delete next[e.recordId];
      return next;
    });
    try {
      const res = await fetch('/api/ai/evidence-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recordType: e.recordType, recordId: e.recordId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`);
      setChecks((c) => ({
        ...c,
        [e.recordId]: { outcome: json.outcome, summary: json.summary, fileName: json.fileName, checkedAt: json.checkedAt, model: json.model },
      }));
      if (json.recordError) setErrors((x) => ({ ...x, [e.recordId]: json.recordError }));
    } catch (err) {
      setErrors((x) => ({ ...x, [e.recordId]: err instanceof Error ? err.message : 'Check failed.' }));
    } finally {
      setRunning((s) => { const n = new Set(s); n.delete(e.recordId); return n; });
    }
  }

  async function checkUnchecked() {
    const todo = list.entries.filter((e) => checkable(e) && !checks[e.recordId]).slice(0, BATCH_LIMIT);
    setBatch({ done: 0, total: todo.length });
    for (const [i, e] of todo.entries()) {
      await check(e);
      setBatch({ done: i + 1, total: todo.length });
    }
    setBatch(null);
  }

  const unchecked = list.entries.filter((e) => checkable(e) && !checks[e.recordId]).length;
  const counts = Object.values(checks).reduce<Record<string, number>>((acc, c) => {
    if (c) acc[c.outcome] = (acc[c.outcome] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5">
              <FileSearch size={15} className="text-emerald-600" /> Document checks · {list.month}
            </p>
            <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">
              The AI reads the bill or invoice attached to each entry and reports what it says, without being told what
              was entered. BROC then compares the two and keeps a record of every check. A difference is a prompt to
              look, not a verdict: one bill can cover several entries.
            </p>
          </div>
          {enabled && unchecked > 0 && (
            <Button size="sm" variant="outline" onClick={checkUnchecked} disabled={batch !== null}>
              {batch ? <><Loader2 size={13} className="mr-1.5 animate-spin" />Checking {batch.done} of {batch.total}</>
                : `Check ${Math.min(unchecked, BATCH_LIMIT)} unchecked`}
            </Button>
          )}
        </div>

        {!aiEnabled && (
          <p className="text-xs text-gray-500 rounded-md bg-gray-50 border border-gray-100 px-3 py-2">
            Turn on the optional AI layer (AI_PROVIDER, AI_API_KEY) to check entries against their documents.
            Any provider that reads PDFs and images works.
          </p>
        )}

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
          <span>{list.entries.length} with a document</span>
          {list.withoutDocuments > 0 && (
            <span className="text-amber-700">{list.withoutDocuments} with no document attached</span>
          )}
          {(Object.keys(CHECK_OUTCOME_LABELS) as CheckOutcome[]).filter((o) => counts[o]).map((o) => (
            <span key={o}>{counts[o]} {CHECK_OUTCOME_LABELS[o].toLowerCase()}</span>
          ))}
        </div>

        {list.entries.length > 0 && (
          <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg">
            {list.entries.map((e) => {
              const c = checks[e.recordId];
              const isRunning = running.has(e.recordId);
              const readable = checkable(e);
              return (
                <div key={e.recordId} className="px-3 py-2.5 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      {e.siteName} · {e.label}
                      <span className="text-gray-500"> · {e.entryDate} · {e.quantity.toLocaleString()} {e.unit}</span>
                    </p>
                    <p className="text-xs text-gray-400 inline-flex items-center gap-1 mt-0.5">
                      <Paperclip size={11} /> {e.attachments.map((a) => a.fileName).join(', ')}
                    </p>
                    {!readable && <p className="text-xs text-gray-500 mt-1">{e.attachments[0]?.reason}</p>}
                    {c && (
                      <p className="text-xs text-gray-700 mt-1">
                        <Badge variant={OUTCOME_BADGE[c.outcome]} className="mr-1.5">{CHECK_OUTCOME_LABELS[c.outcome]}</Badge>
                        {c.summary}
                        <span className="text-gray-400"> · {c.fileName}, {new Date(c.checkedAt).toLocaleDateString()}</span>
                      </p>
                    )}
                    {errors[e.recordId] && <p className="text-xs text-red-600 mt-1">{errors[e.recordId]}</p>}
                  </div>
                  {enabled && readable && (
                    <Button size="sm" variant="ghost" onClick={() => check(e)} disabled={isRunning || batch !== null}>
                      {isRunning ? <Loader2 size={13} className="animate-spin" /> : c ? 'Check again' : 'Check'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
