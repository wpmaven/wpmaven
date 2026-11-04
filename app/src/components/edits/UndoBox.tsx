import React from 'react';
import { Button } from '@yotako/webmaven-ui';
import type { UndoState } from '../../hooks/useUndoEdit';

/**
 * The undo's question and its answer: what it takes back (and what else,
 * when later changes depend on it), then Undo or Keep. Used by History in
 * the editor and by the chat's change cards.
 */
export function UndoBox({
  state, onConfirm, onCancel, onShowPreview,
}: {
  state: UndoState;
  onConfirm: (opts?: { force?: boolean }) => void;
  onCancel: () => void;
  onShowPreview?: (url: string) => void;
}) {
  if (state.phase === 'idle' || !state.target) return null;
  const also = state.preview?.undo?.alsoUndoes ?? [];
  const forceCodes = new Set(['DRIFT', 'CHECK_BROKEN']);
  const previewUrl = state.preview?.preview?.url;

  if (state.phase === 'preparing') {
    return (
      <div className="wm-undo" role="status" aria-live="polite" data-testid="undo-box" data-phase="preparing" style={BOX}>
        <span style={{ fontSize: 13 }}>Checking what undoing {'“'}{state.target.summary}{'”'} takes back.</span>
      </div>
    );
  }
  if (state.phase === 'done') {
    return (
      <div className="wm-undo" role="status" data-testid="undo-box" data-phase="done" style={{ ...BOX, borderColor: 'color-mix(in srgb, var(--cyan) 45%, transparent)' }}>
        <span data-testid="edit-result" data-ok="true" data-operation-id={state.result?.operationId ?? ''} style={{ fontSize: 13 }}>
          {state.result?.summary || 'Undone. Your site is as it was before that change.'}
        </span>
      </div>
    );
  }
  if (state.phase === 'failed') {
    return (
      <div className="wm-undo" role="alert" data-testid="undo-box" data-phase="failed" data-code={state.error?.code ?? ''} style={{ ...BOX, borderColor: 'color-mix(in srgb, var(--rose) 45%, transparent)' }}>
        <span style={{ fontSize: 13 }}>{state.error?.message ?? 'This change cannot be undone.'}</span>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={onCancel}>Close</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="wm-undo" role="alertdialog" aria-label="Undo this change?" data-testid="undo-box" data-phase={state.phase} style={BOX}>
      <strong style={{ fontSize: 13 }}>Undo {'“'}{state.target.summary}{'”'}?</strong>
      {also.length > 0 ? (
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>
          <p style={{ margin: '0 0 4px' }}>Later changes to the same part of your site depend on it, so this also undoes:</p>
          <ul data-testid="undo-also" style={{ margin: 0, paddingLeft: 18 }}>
            {also.map((a) => <li key={a.operationId}>{a.summary || 'A later change'}</li>)}
          </ul>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>Nothing else changes.</p>
      )}
      {state.error && <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--rose)' }}>{state.error.message}</p>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {previewUrl && onShowPreview && (
          <button type="button" onClick={() => onShowPreview(previewUrl)} style={LINK}>See the site after the undo</button>
        )}
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={state.phase === 'undoing'}>Keep it</Button>
        <Button
          data-testid="undo-confirm"
          variant="primary"
          size="sm"
          isLoading={state.phase === 'undoing'}
          disabled={state.phase === 'undoing'}
          onClick={() => onConfirm({ force: !!state.error && forceCodes.has(state.error.code) })}
        >
          {state.error && forceCodes.has(state.error.code) ? 'Undo anyway' : also.length ? `Undo all ${also.length + 1}` : 'Undo'}
        </Button>
      </div>
    </div>
  );
}

const BOX: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--purple) 40%, var(--glass-border))',
  background: 'color-mix(in srgb, var(--purple) 5%, var(--bg))',
  color: 'var(--text)',
};

const LINK: React.CSSProperties = {
  border: 0,
  background: 'none',
  padding: 0,
  color: 'var(--purple)',
  font: '500 12px "Inter", sans-serif',
  cursor: 'pointer',
};
