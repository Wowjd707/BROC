'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ArrowRight, Wrench, Ban, CircleCheck } from 'lucide-react';
import {
  STATUS_META,
  type RegimeReadiness, type EvaluatedCapability,
} from '@/lib/capability-readiness-core';

type BadgeVariant = React.ComponentProps<typeof Badge>['variant'];

/**
 * "What does this platform do about this regime, and how far along are we."
 *
 * Every figure comes from the organization's own data. Deliberately phrased as
 * data coverage — "3 of 5 sites have data" — never as compliance, because
 * whether an obligation is met is legal judgement about their facts and this
 * tool does not make it.
 */
export function CapabilityPanel({
  readiness, reportingYear,
}: {
  readiness: RegimeReadiness;
  reportingYear: number;
}) {
  const { capabilities, biggestGap, nothingBuilt } = readiness;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          What this platform does for it
        </p>
        <span className="text-xs text-gray-400">Data coverage, FY {reportingYear}</span>
      </div>

      {nothingBuilt ? (
        <p className="text-sm text-gray-600">
          Nothing in this platform addresses this regime directly — see the notes below.
        </p>
      ) : biggestGap ? (
        <NextAction gap={biggestGap} />
      ) : (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex gap-2">
          <CircleCheck size={15} className="text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-900">
            Every capability this platform offers for this regime has data behind it.
            That is a statement about your data, not about whether you are compliant.
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {capabilities.map((c) => <CapabilityRowView key={c.capability_key} cap={c} />)}
      </ul>
    </div>
  );
}

/** The one thing worth doing next, given prominence because it is the point. */
function NextAction({ gap }: { gap: EvaluatedCapability }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs font-medium text-amber-800 uppercase tracking-wide mb-1">
        Biggest gap
      </p>
      <p className="text-sm text-gray-900">
        <span className="font-medium">{gap.label}</span> — {gap.result.detail}
      </p>
      {gap.route && (
        <Link
          href={gap.route}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 hover:underline mt-1.5"
        >
          Go and close it <ArrowRight size={13} />
        </Link>
      )}
    </div>
  );
}

function CapabilityRowView({ cap }: { cap: EvaluatedCapability }) {
  const meta = STATUS_META[cap.result.status];
  const isAbsence = cap.result.status === 'not_built' || cap.result.status === 'no_action';

  return (
    <li className="flex gap-3 text-sm">
      <span className="flex-shrink-0 mt-0.5">
        {cap.result.status === 'not_built'
          ? <Wrench size={14} className="text-purple-400" />
          : cap.result.status === 'no_action'
            ? <Ban size={14} className="text-gray-300" />
            : <StatusDot status={cap.result.status} />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          {cap.label ? (
            cap.route ? (
              <Link href={cap.route} className="font-medium text-gray-900 hover:text-emerald-700">
                {cap.label}
              </Link>
            ) : (
              <span className="font-medium text-gray-900">{cap.label}</span>
            )
          ) : (
            <span className="font-medium text-gray-500">
              {cap.result.status === 'not_built' ? 'Gap in this platform' : 'No action needed'}
            </span>
          )}
          <Badge variant={meta.variant as BadgeVariant}>{meta.label}</Badge>
          {cap.necessity === 'required' && !isAbsence && (
            <span className="text-xs text-gray-400">core to this regime</span>
          )}
        </div>
        <p className={cn('mt-0.5', isAbsence ? 'text-gray-600' : 'text-gray-500')}>
          {isAbsence ? cap.description : cap.result.detail}
        </p>
        {!isAbsence && (
          <p className="text-xs text-gray-400 mt-0.5">{cap.description}</p>
        )}
      </div>
    </li>
  );
}

function StatusDot({ status }: { status: 'ready' | 'partial' | 'absent' | 'unknown' }) {
  const colour =
    status === 'ready' ? 'bg-emerald-500'
      : status === 'partial' ? 'bg-amber-400'
        : status === 'absent' ? 'bg-red-400'
          : 'bg-gray-300';
  return <span className={cn('block w-2.5 h-2.5 rounded-full mt-1', colour)} />;
}
