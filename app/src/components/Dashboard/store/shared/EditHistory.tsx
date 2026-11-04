import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { editFailure, errorSentence, storeApi } from '../../../../services/storeApi';
import type { StoreEditResult } from '../../../../types/store';
import { ErrorLine, shortDate } from './ui';

const STATUS_WORDS: Record<string, string> = {
  undone: 'Undone',
  failed: 'Did not go through',
  previewed: 'Waiting to be published',
  discarded: 'Dropped',
  expired: 'Expired',
};

interface Pending {
  item: StoreEditResult;
  previewId: string;
  also: Array<{ operationId: string; summary: string }>;
}

/**
 * The changes WPMaven made to one object (ref "post:12", "product:31",
 * "media:73"), newest first, each with Undo while it can be undone. An undo
 * that also takes back later changes lists them and asks first.
 */
export default function EditHistory({ target, refreshKey = 0, onUndone }: {
  target: string;
  /** Change it to read the history again (after a save). */
  refreshKey?: number;
  onUndone?: (undo: StoreEditResult) => void;
}) {
  const [items, setItems] = useState<StoreEditResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    let live = true;
    storeApi.history(target, 10).then(
      (h) => live && setItems(Array.isArray(h?.items) ? h.items : []),
      (e) => {
        if (!live) return;
        setItems([]);
        setError(errorSentence(e, 'The history could not be read. Try again.'));
      },
    );
    return () => {
      live = false;
    };
  }, [target]);

  useEffect(() => load(), [load, refreshKey]);

  const undo = async (item: StoreEditResult, previewId?: string) => {
    setBusy(item.operationId);
    setError(null);
    setDone(null);
    try {
      const answer = await storeApi.undo(item.operationId, previewId ? { previewId } : {});
      const failure = editFailure(answer);
      if (failure?.code === 'CONFIRM_REQUIRED' && answer.previewId) {
        setPending({ item, previewId: answer.previewId, also: answer.undo?.alsoUndoes ?? [] });
      } else if (failure) {
        setError(failure.message);
      } else {
        setPending(null);
        setDone(answer.summary || 'Undone.');
        onUndone?.(answer);
        load();
      }
    } catch (e) {
      setError(errorSentence(e, 'The undo did not go through. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="wm-history" aria-label="History" data-testid="edit-history">
      <h3 className="wm-store-panel__title">History</h3>
      {items === null && <p className="wm-store-muted">Reading the history.</p>}
      {items?.length === 0 && !error && <p className="wm-store-muted">No changes yet.</p>}
      {!!items?.length && (
        <ul className="wm-history__list">
          {items.map((item) => (
            <li key={item.operationId} className="wm-history__item">
              <span className="wm-history__when">{shortDate(item.publishedAt || item.createdAt)}</span>
              <span className="wm-history__what">
                {item.summary || 'A change'}
                {STATUS_WORDS[item.status] && <span className="wm-store-muted"> ({STATUS_WORDS[item.status]})</span>}
              </span>
              {item.undoable && item.status === 'published' && (
                <Button variant="ghost" size="sm" onClick={() => undo(item)} isLoading={busy === item.operationId} disabled={!!busy}>
                  Undo
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {pending && (
        <div className="wm-store-note" role="alertdialog" aria-label="Undo later changes too">
          <p className="wm-history__ask">Undoing this also undoes these later changes:</p>
          <ul className="wm-history__also">
            {pending.also.map((a) => <li key={a.operationId}>{a.summary}</li>)}
          </ul>
          <div className="wm-store-badges">
            <Button size="sm" variant="primary" onClick={() => undo(pending.item, pending.previewId)} isLoading={busy === pending.item.operationId} autoFocus>
              Undo all of them
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Keep them</Button>
          </div>
        </div>
      )}
      {done && <p className="wm-store-muted" role="status">{done}</p>}
      <ErrorLine message={error} />
    </section>
  );
}
