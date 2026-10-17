'use client';

import { BulkImportDialog } from '@/components/forms/BulkImportDialog';
import { PROJECT_IMPORT_HEADERS } from '@/lib/project-import-core';

/**
 * Bulk project upload.
 *
 * The intro leads with Pipeline Inclusion because it is the one field here that
 * is easy to leave blank and hard to notice: savings against an excluded project
 * are stored exactly as written and count toward nothing.
 */
export function ProjectImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BulkImportDialog
      open={open}
      onClose={onClose}
      title="Import projects"
      intro={
        <>
          Savings only reach the reduction pipeline when Pipeline Inclusion is set to
          forecasted or realized. It defaults to excluded, so the import lists every row
          where that would quietly leave savings out.
        </>
      }
      templateHref="/api/projects/template"
      templateTitle="Download the project template"
      templateHint="A spreadsheet with your sites and goals already in the dropdowns"
      importHref="/api/projects/import"
      columns={PROJECT_IMPORT_HEADERS}
    />
  );
}
