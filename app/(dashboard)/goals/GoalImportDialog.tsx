'use client';

import { BulkImportDialog } from '@/components/forms/BulkImportDialog';
import { GOAL_IMPORT_HEADERS } from '@/lib/goal-import-core';

/**
 * Bulk goal upload.
 *
 * The intro names the one thing about this file that would otherwise surprise
 * somebody: an SBTi target ignores the Reduction Percent column, because that
 * figure is derived from the baseline rather than chosen.
 */
export function GoalImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <BulkImportDialog
      open={open}
      onClose={onClose}
      title="Import goals"
      intro={
        <>
          Which goal types are valid depends on the metric — SBTi and Net Zero apply to
          greenhouse gas only. An SBTi target is computed from your baseline, so the
          Reduction Percent column is ignored for one.
        </>
      }
      templateHref="/api/goals/template"
      templateTitle="Download the goal template"
      templateHint="Goal Type narrows to what is valid for the metric you pick"
      importHref="/api/goals/import"
      columns={GOAL_IMPORT_HEADERS}
    />
  );
}
