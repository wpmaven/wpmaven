import React from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'default';
}

export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel, variant = 'default' }: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="wpm-dialog-overlay" onClick={onCancel}>
      <div className="wpm-dialog" onClick={e => e.stopPropagation()}>
        <h3 className="wpm-dialog__title">{title}</h3>
        <p className="wpm-dialog__message">{message}</p>
        <div className="wpm-dialog__actions">
          <button className="wpm-btn wpm-btn--secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className={`wpm-btn ${variant === 'danger' ? 'wpm-btn--danger' : 'wpm-btn--primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
