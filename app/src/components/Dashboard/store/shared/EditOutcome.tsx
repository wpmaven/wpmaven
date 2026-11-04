import React, { useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { editFailure, errorSentence, storeApi } from '../../../../services/storeApi';
import type { StoreEditResult } from '../../../../types/store';

interface EditOutcomeProps {
  result: StoreEditResult | null;
  /** Called with the undo's result once it is done. */
  onUndone?: (undo: StoreEditResult) => void;
  /** Hide the Undo button (a preview, or a screen that shows history instead). */
  noUndo?: boolean;
}

interface Pending {
  previewId: string;
  also: Array<{ operationId: string; summary: string }>;
}

/**
 * The line after a change: what WPMaven changed (the operation's own
 * summary) with Undo, or why it did not happen, in the account's words. An
 * undo that also takes back later changes lists them and asks first.
 */
export default function EditOutcome({ result, onUndone, noUndo }: EditOutcomeProps) {
  const [undoing, setUndoing] = useState(false);
  const [undo, setUndo] = useState<StoreEditResult | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  if (!result) return null;
  const failure = editFailure(result);
  const done = !failure && result.mode === 'publish';

  const runUndo = async (previewId?: string) => {
    setUndoing(true);
    setUndoError(null);
    try {
      const answer = await storeApi.undo(result.operationId, previewId ? { previewId } : {});
      const f = editFailure(answer);
      if (f?.code === 'CONFIRM_REQUIRED' && answer.previewId) {
        setPending({ previewId: answer.previewId, also: answer.undo?.alsoUndoes ?? [] });
      } else if (f) {
        setUndoError(f.message);
      } else {
        setPending(null);
        setUndo(answer);
        onUndone?.(answer);
      }
    } catch (error) {
      setUndoError(errorSentence(error, 'The undo did not go through. Try again.'));
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div
      className={`wm-store-outcome ${failure ? 'wm-store-outcome--failed' : 'wm-store-outcome--ok'}`}
      role="status"
      data-testid="store-edit-result"
      data-ok={failure ? 'false' : 'true'}
      data-operation-id={result.operationId}
      data-code={failure?.code}
    >
      <span className="wm-store-outcome__text">
        {failure ? failure.message : undo ? (undo.summary || 'Undone.') : (result.summary || 'Saved.')}
      </span>
      {done && !undo && !pending && !noUndo && result.undoable && (
        <Button variant="ghost" size="sm" onClick={() => void runUndo()} isLoading={undoing} data-testid="store-edit-undo">
          Undo
        </Button>
      )}
      {pending && (
        <div className="wm-store-outcome__confirm" role="alertdialog" aria-label="Undo later changes too">
          <p className="wm-store-outcome__ask">Undoing this also undoes these later changes:</p>
          <ul>
            {pending.also.map((a) => <li key={a.operationId}>{a.summary}</li>)}
          </ul>
          <div className="wm-store-badges">
            <Button size="sm" variant="primary" onClick={() => void runUndo(pending.previewId)} isLoading={undoing} autoFocus data-testid="store-edit-undo-all">
              Undo all of them
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Keep them</Button>
          </div>
        </div>
      )}
      {undoError && <span className="wm-store-outcome__error">{undoError}</span>}
    </div>
  );
}
