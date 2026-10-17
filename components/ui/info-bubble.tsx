'use client';

import * as React from 'react';
import { Popover, PopoverTrigger, PopoverContent } from './popover';
import { cn } from '@/lib/utils';

/**
 * A small "i" that opens a panel of explanatory text.
 *
 * Click, not hover. Hover tooltips do not exist on touch devices and cannot be
 * reached from the keyboard without extra work, and the things this component
 * holds — how to read a rating, what a colour means, the scope of a legal
 * disclaimer — are text a reader may want to sit with rather than glimpse.
 *
 * Use it for context a reader can choose to open. Do not use it to hide
 * something they must see: a warning behind a click is a warning nobody read.
 */
export function InfoBubble({
  label,
  title,
  tone = 'neutral',
  triggerText,
  align = 'start',
  className,
  children,
}: {
  /** Accessible name for the trigger — required, since the glyph carries none. */
  label: string;
  title?: string;
  tone?: 'neutral' | 'caution';
  /** Optional visible text beside the glyph. */
  triggerText?: string;
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: React.ReactNode;
}) {
  const caution = tone === 'caution';

  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full text-[11px] font-semibold transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
          triggerText ? 'px-2.5 py-1' : '',
          caution
            ? 'text-amber-800 hover:text-amber-900 focus-visible:ring-amber-400'
            : 'text-gray-500 hover:text-gray-900 focus-visible:ring-gray-400',
          triggerText && (caution
            ? 'border border-amber-200 bg-amber-50 hover:bg-amber-100'
            : 'border border-gray-200 bg-gray-50 hover:bg-gray-100'),
          className,
        )}
      >
        <span
          aria-hidden
          className={cn(
            'inline-flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center',
            'rounded-full border-[1.3px] text-[10px] font-extrabold leading-none',
            caution ? 'border-amber-400 text-amber-700' : 'border-gray-400 text-gray-500',
          )}
        >
          i
        </span>
        {triggerText}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn('w-80', caution && 'border-amber-200 bg-amber-50')}
      >
        {title && (
          <p className={cn(
            'text-xs font-semibold mb-1.5',
            caution ? 'text-amber-900' : 'text-gray-900',
          )}>
            {title}
          </p>
        )}
        <div className={cn(
          'text-xs leading-relaxed space-y-2',
          caution ? 'text-amber-900' : 'text-gray-600',
        )}>
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
