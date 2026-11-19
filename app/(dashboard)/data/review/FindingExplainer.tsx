'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react';

interface Explanation {
  explanation: string;
  thingsToCheck: string[];
  followUpSubject: string | null;
  followUpBody: string | null;
  model: string;
  warning: string | null;
}

/**
 * "Explain and draft follow-up" for one Data Review finding.
 *
 * Sends only the finding's id; the server rebuilds the finding and its numbers
 * (app/api/ai/review-finding). The result is never saved — the reviewer copies
 * the note into their own mail and edits it there.
 */
export function FindingExplainer({ findingId, asOf, scope }: { findingId: string; asOf: string; scope: string | null }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<Explanation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run() {
    setState('loading');
    setError(null);
    try {
      const res = await fetch('/api/ai/review-finding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ findingId, asOf, scope }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`);
      setResult(json as Explanation);
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setState('error');
    }
  }

  async function copyNote() {
    if (!result?.followUpBody) return;
    const text = result.followUpSubject ? `Subject: ${result.followUpSubject}\n\n${result.followUpBody}` : result.followUpBody;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the text is on screen to select by hand */
    }
  }

  if (state === 'idle' || state === 'error') {
    return (
      <div className="space-y-1.5">
        <Button size="sm" variant="outline" onClick={run}>
          <Sparkles size={13} className="mr-1.5 text-emerald-600" />
          Explain and draft follow-up
        </Button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <p className="text-xs text-gray-500 inline-flex items-center gap-1.5">
        <Loader2 size={13} className="animate-spin" /> Asking the model…
      </p>
    );
  }

  if (!result) return null;
  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-3 space-y-3">
      <div>
        <p className="text-[11px] font-medium text-emerald-800 uppercase tracking-wide mb-1">What this means</p>
        <p className="text-sm text-gray-700">{result.explanation}</p>
      </div>
      {result.thingsToCheck.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-emerald-800 uppercase tracking-wide mb-1">Things to check</p>
          <ul className="list-disc pl-5 text-sm text-gray-700 space-y-0.5">
            {result.thingsToCheck.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </div>
      )}
      {result.followUpBody && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] font-medium text-emerald-800 uppercase tracking-wide">Follow-up note</p>
            <button onClick={copyNote} className="text-xs text-gray-600 hover:text-gray-900 inline-flex items-center gap-1">
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="rounded-md bg-white border border-gray-100 px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap">
            {result.followUpSubject && <p className="font-medium mb-1">{result.followUpSubject}</p>}
            {result.followUpBody}
          </div>
        </div>
      )}
      {result.warning && (
        <p className="text-xs text-amber-700 inline-flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {result.warning}
        </p>
      )}
      <p className="text-[11px] text-gray-400">
        Written by {result.model} from the numbers above. It does not know the cause; the site does. Nothing was saved.
      </p>
    </div>
  );
}
