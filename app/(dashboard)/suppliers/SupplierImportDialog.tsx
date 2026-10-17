'use client';

import { BulkImportDialog } from '@/components/forms/BulkImportDialog';
import { SUPPLIER_IMPORT_HEADERS } from '@/lib/supplier-import-core';

/**
 * Bulk supplier upload.
 *
 * Commits directly rather than staging for review, unlike the metrics importer.
 * A supplier row carries no factor, scope or unit, so nothing in it can land in
 * the wrong total — the worst case is a name to correct, which the list already
 * lets you do.
 */
export function SupplierImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BulkImportDialog
      open={open}
      onClose={onClose}
      title="Import suppliers"
      intro={
        <>
          Only the supplier name is required. A supplier with no contact email is stored
          fine, but cannot be sent a survey invitation until one is added.
        </>
      }
      templateHref="/api/suppliers/template"
      templateTitle="Download the supplier template"
      templateHint="A spreadsheet with tier, country and industry already in the dropdowns"
      importHref="/api/suppliers/import"
      columns={SUPPLIER_IMPORT_HEADERS}
    />
  );
}
