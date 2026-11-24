'use client';

import type { ReactNode } from 'react';
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

/**
 * Header, scrolling body and footer for content inside DrawerContent, so long
 * drawers scroll on short screens and their actions stay in reach. The footer
 * wraps rather than overflowing: on a phone a row of four buttons does not
 * fit, and an action pushed off-screen is an action nobody can take.
 */
export function DrawerShell({ title, subtitle, children, footer }: {
  title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <>
      <DialogHeader className="px-4 sm:px-6 py-4 sm:py-5 border-b border-gray-100 pr-12">
        <DialogTitle>{title}</DialogTitle>
        {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
      </DialogHeader>
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">{children}</div>
      {footer && (
        <div className="px-4 sm:px-6 py-3 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-gray-100 flex flex-wrap justify-end gap-2 sm:gap-3">
          {footer}
        </div>
      )}
    </>
  );
}
