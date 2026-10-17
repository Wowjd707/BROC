'use client';

import { BulkImportDialog } from '@/components/forms/BulkImportDialog';
import { SITE_IMPORT_HEADERS } from '@/lib/site-import-core';

/**
 * Bulk site upload.
 *
 * Two of its optional columns change reported figures rather than just the
 * record — a missing zip silently moves electricity onto the national average,
 * and ownership and control decide whether a site counts at all — so the import
 * reports them per row afterwards rather than letting somebody find out from a
 * report.
 */
export function SiteImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BulkImportDialog
      open={open}
      onClose={onClose}
      title="Import sites"
      intro={
        <>
          Only the site name is required. Two optional columns change your numbers rather
          than just the record — the template explains both, and the import tells you which
          sites they affect.
        </>
      }
      templateHref="/api/sites/template"
      templateTitle="Download the site template"
      templateHint="A spreadsheet with your business units already in the dropdowns"
      importHref="/api/sites/import"
      columns={SITE_IMPORT_HEADERS}
    />
  );
}
