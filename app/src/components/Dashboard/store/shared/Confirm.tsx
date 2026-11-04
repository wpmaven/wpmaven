import React, { useEffect, useRef } from 'react';
import ConfirmDialog from '../../ui/ConfirmDialog';

interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  /** The cancel button's words ("Cancel" by default, "Keep it" for a trash). */
  cancelLabel?: string;
}

/**
 * The app's confirm dialog with its keyboard: focus moves to the confirm
 * button and back, Escape cancels (and only the dialog, not a drawer under
 * it).
 */
export default function Confirm({ open, title, message, confirmLabel, onConfirm, onCancel, danger, cancelLabel = 'Cancel' }: ConfirmProps) {
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLButtonElement>('.wpm-dialog__actions button:last-child')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      cancel.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      before?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div ref={box} role="alertdialog" aria-modal="true" aria-label={title}>
      <ConfirmDialog
        open
        title={title}
        message={message}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
        onCancel={onCancel}
        variant={danger ? 'danger' : 'default'}
      />
    </div>
  );
}
