'use client';

import type { ReactNode } from 'react';
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

/**
 * Header, scrolling body and footer for content inside DrawerContent, so long
 * drawers scroll on short screens and their actions stay in reach.
 */
export function DrawerShell({ title, subtitle, children, footer }: {
  title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <>
      <DialogHeader className="px-6 py-5 border-b border-gray-100 pr-12">
        <DialogTitle>{title}</DialogTitle>
        {subtitle && <DialogDescription>{subtitle}</DialogDescription>}
      </DialogHeader>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">{children}</div>
      {footer && <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">{footer}</div>}
    </>
  );
}
