'use client';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from './dialog';
import { Button } from './button';

interface ConfirmDialogProps {
  open: boolean;
  /** Called on any dismissal. Provide this or `onCancel`. */
  onOpenChange?: (open: boolean) => void;
  /** Convenience dismissal handler; invoked when the dialog closes. */
  onCancel?: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'default';
  onConfirm: () => void;
  loading?: boolean;
}

export function ConfirmDialog({
  open, onOpenChange, onCancel, title, description,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  variant = 'destructive', onConfirm, loading,
}: ConfirmDialogProps) {
  const handleOpenChange = (next: boolean) => {
    onOpenChange?.(next);
    if (!next) onCancel?.();
  };
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={loading}>
            {loading ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
