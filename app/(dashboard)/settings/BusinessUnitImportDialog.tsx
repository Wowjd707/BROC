'use client';

import { BulkImportDialog } from '@/components/forms/BulkImportDialog';
import { UNIT_IMPORT_HEADERS } from '@/lib/business-unit-import-core';

/**
 * Bulk business-unit upload.
 *
 * The hierarchy is the only part that is not obvious, so the intro says the one
 * thing somebody needs to know before filling the file in: the order of rows
 * does not matter, because parents are matched by name after every row exists.
 */
export function BusinessUnitImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BulkImportDialog
      open={open}
      onClose={onClose}
      title="Import business units"
      intro={
        <>
          Only the unit name is required. List them in any order — a unit can name a parent
          that appears further down the file, or one you already have.
        </>
      }
      templateHref="/api/business-units/template"
      templateTitle="Download the business unit template"
      templateHint="A spreadsheet showing a parent, a child and a grandchild"
      importHref="/api/business-units/import"
      columns={UNIT_IMPORT_HEADERS}
      skippedLabel="Already listed"
    />
  );
}
