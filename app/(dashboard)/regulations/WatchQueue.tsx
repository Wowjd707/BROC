'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  RefreshCw, ExternalLink, ChevronDown, Check, X, TriangleAlert, Bot, Binary,
} from 'lucide-react';
import { previewPatch, type ProposedPatch } from '@/lib/regulatory-watch-core';
import { CONFIDENCE_META, type Confidence } from '@/lib/regulatory-core';

export interface Proposal {
  id: string;
  item_code: string;
  item_name: string;
  source_url: string;
  change_kind: 'first_seen' | 'changed' | 'fetch_failed';
  detected_summary: string;
  diff_excerpt: string | null;
  ai_summary: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  ai_ungrounded: { text: string; value: number }[];
  proposed_patch: ProposedPatch;
  created_at: string;
  current: Record<string, unknown>;
}

export interface WatchRun {
  started_at: string;
  finished_at: string | null;
  status: string;
  sources_checked: number;
  sources_changed: number;
  sources_failed: number;
  ai_used: boolean;
  ai_model: string | null;
}

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

const KIND_META: Record<Proposal['change_kind'], { label: string; variant: BadgeVariant }> = {
  changed:      { label: 'Source changed',  variant: 'warning' },
  fetch_failed: { label: 'Could not fetch', variant: 'destructive' },
  first_seen:   { label: 'New baseline',    variant: 'secondary' },
};

export function WatchQueue({
  proposals, lastRun, isAdmin, aiConfigured, aiModel,
}: {
  proposals: Proposal[];
  lastRun: WatchRun | null;
  isAdmin: boolean;
  aiConfigured: boolean;
  aiModel: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);

  async function runWatch() {
    setRunning(true);
    try {
      const res = await fetch('/api/regulatory/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) { toast(body.error ?? 'The watch run failed.', 'error'); return; }
      toast(
        `Checked ${body.sourcesChecked} sources · ${body.sourcesChanged} changed · ${body.sourcesFailed} unreachable`,
        body.sourcesChanged > 0 || body.sourcesFailed > 0 ? 'warning' : 'success',
      );
      router.refresh();
    } catch {
      toast('Could not reach the server.', 'error');
    } finally {
      setRunning(false);
    }
  }

  if (!isAdmin && proposals.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Source watch
            {proposals.length > 0 && (
              <span className="ml-2 text-amber-700">{proposals.length} awaiting review</span>
            )}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">
            Detection is a content hash compared against the last check — no model is
            involved, and nothing here is applied until you approve it.
            {aiConfigured
              ? ` ${aiModel ?? 'A model'} drafts a summary of each diff; it is never asked what a regulation now requires.`
              : ' No AI provider is configured, so summaries are the deterministic diff only — the queue works exactly the same, with more reading.'}
          </p>
        </div>
        {isAdmin && (
          <Button variant="outline" onClick={runWatch} disabled={running}>
            <RefreshCw size={14} className={cn(running && 'animate-spin')} />
            {running ? 'Checking sources…' : 'Check sources now'}
          </Button>
        )}
      </div>

      {lastRun && (
        <p className="text-xs text-gray-400">
          Last run {new Date(lastRun.started_at).toLocaleString()} · {lastRun.sources_checked} checked ·{' '}
          {lastRun.sources_changed} changed · {lastRun.sources_failed} unreachable
          {lastRun.status === 'failed' && <span className="text-red-600"> · run failed</span>}
        </p>
      )}

      {proposals.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-gray-500 text-center">
            Nothing awaiting review.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </section>
  );
}

function ProposalCard({ proposal, isAdmin }: { proposal: Proposal; isAdmin: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [showDiff, setShowDiff] = useState(false);
  const [confidence, setConfidence] = useState<Confidence | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const kind = KIND_META[proposal.change_kind];
  const patchRows = previewPatch(proposal.current, proposal.proposed_patch);
  const hasPatch = patchRows.length > 0;

  async function review(action: 'approve' | 'reject') {
    if (action === 'approve' && !confidence) {
      toast('Choose a confidence rating before approving.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/regulatory/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: proposal.id,
          action,
          confidence: action === 'approve' ? confidence : undefined,
          note: note || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) { toast(body.error ?? 'Could not record that.', 'error'); return; }
      toast(
        action === 'approve'
          ? `Applied to ${proposal.item_code} and stamped as verified today.`
          : 'Rejected.',
        'success',
      );
      router.refresh();
    } catch {
      toast('Could not reach the server.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3">

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">{proposal.item_name}</h3>
              <span className="font-mono text-xs text-gray-400">{proposal.item_code}</span>
              <Badge variant={kind.variant}>{kind.label}</Badge>
            </div>
            {/* The source link is the point of the whole card. Approving without
                opening it is the one way to defeat this design, so it is the
                most prominent thing here after the heading. */}
            <a
              href={proposal.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline mt-1"
            >
              Read the source
              <ExternalLink size={11} />
            </a>
          </div>
          <span className="text-xs text-gray-400">
            {new Date(proposal.created_at).toLocaleDateString()}
          </span>
        </div>

        {/* Deterministic first, and labelled as such. This is the part no model
            touched, and it is what a reviewer should trust most. */}
        <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1.5 mb-1">
            <Binary size={12} /> Detected
          </p>
          <p className="text-sm text-gray-700">{proposal.detected_summary}</p>
        </div>

        {proposal.ai_summary && (
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
            <p className="text-xs font-medium text-blue-800 uppercase tracking-wide flex items-center gap-1.5 mb-1">
              <Bot size={12} /> Drafted by {proposal.ai_model ?? 'the configured model'}
            </p>
            <p className="text-sm text-gray-700">{proposal.ai_summary}</p>
            <p className="text-xs text-blue-700/80 mt-2">
              A summary of the diff below, not a statement of law. Confirm against the source.
            </p>
          </div>
        )}

        {proposal.ai_ungrounded.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex gap-2">
            <TriangleAlert size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900">
              <p className="font-medium">
                Figures in the summary that are not in the fetched text
              </p>
              <p className="mt-1 font-mono text-xs">
                {proposal.ai_ungrounded.map((u) => u.text).join(' · ')}
              </p>
              <p className="text-xs text-amber-800 mt-1">
                Not necessarily wrong — a correctly derived figure lands here too. Worth a glance.
              </p>
            </div>
          </div>
        )}

        {proposal.diff_excerpt && (
          <div>
            <button
              type="button"
              onClick={() => setShowDiff((v) => !v)}
              className="inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:text-emerald-800 font-medium"
            >
              <ChevronDown size={14} className={cn('transition-transform', showDiff && 'rotate-180')} />
              {showDiff ? 'Hide the diff' : 'Show what changed on the page'}
            </button>
            {showDiff && (
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-gray-100 whitespace-pre-wrap">
                {proposal.diff_excerpt}
              </pre>
            )}
          </div>
        )}

        {hasPatch && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Suggested edit
            </p>
            <div className="space-y-2">
              {patchRows.map((row) => (
                <div key={row.field} className="text-sm">
                  <p className="font-mono text-xs text-gray-500 mb-1">{row.field}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="rounded border border-gray-200 bg-white p-2 text-gray-500 whitespace-pre-wrap">
                      {row.before}
                    </div>
                    <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-gray-900 whitespace-pre-wrap">
                      {row.after}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isAdmin && (
          <div className="border-t border-gray-100 pt-3 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label htmlFor={`conf-${proposal.id}`}>Confidence after your review</Label>
                <select
                  id={`conf-${proposal.id}`}
                  value={confidence}
                  onChange={(e) => setConfidence(e.target.value as Confidence | '')}
                  className="mt-1 flex h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900"
                >
                  <option value="">Choose…</option>
                  {(['confirmed', 'high', 'medium', 'low'] as const).map((c) => (
                    <option key={c} value={c}>{CONFIDENCE_META[c].label}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <Label htmlFor={`note-${proposal.id}`}>Note</Label>
                <Input
                  id={`note-${proposal.id}`}
                  value={note}
                  className="mt-1"
                  placeholder="Optional — what you checked, or why you rejected it"
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => review('approve')} disabled={busy || !confidence}>
                <Check size={14} />
                {hasPatch ? 'Apply and mark verified' : 'Mark verified'}
              </Button>
              <Button variant="outline" onClick={() => review('reject')} disabled={busy}>
                <X size={14} /> Reject
              </Button>
              <p className="text-xs text-gray-500">
                Approving stamps <span className="font-mono">last_verified</span> with today —
                it should mean you read the source.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
