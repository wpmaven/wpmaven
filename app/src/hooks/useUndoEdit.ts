import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditResult } from '../types/edits';
import { editsApi, EditsRequestError, failureOf, isWorking, requestFailedText, settleEdit } from '../services/edits';

/**
 * Undo a published change: WPMaven first prepares the undo and says what
 * else it takes back (later changes to the same part of the site), and only
 * the owner's confirmation publishes it. An undo is
 * itself a change in History, so undoing it again is a redo.
 *
 *   idle -> preparing -> confirm -> undoing -> done
 *                    \-> failed
 */
export type UndoPhase = 'idle' | 'preparing' | 'confirm' | 'undoing' | 'done' | 'failed';

export interface UndoState {
  phase: UndoPhase;
  /** The change being undone. */
  target: { operationId: string; summary: string } | null;
  /** The undo's own preview: what it reverts (undo.alsoUndoes lists the others). */
  preview: EditResult | null;
  /** The published undo. */
  result: EditResult | null;
  error: { code: string; message: string } | null;
}

const IDLE: UndoState = { phase: 'idle', target: null, preview: null, result: null, error: null };

function messageOf(err: unknown): { code: string; message: string } {
  if (err instanceof EditsRequestError) return { code: err.code || 'REQUEST', message: err.message };
  return { code: 'REQUEST', message: requestFailedText() };
}

export function useUndoEdit(api: Pick<typeof editsApi, 'undo' | 'get' | 'discard'> = editsApi) {
  const [state, setState] = useState<UndoState>(IDLE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const abortRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; abortRef.current?.abort(); };
  }, []);
  const set = useCallback((patch: Partial<UndoState>) => { if (alive.current) setState((s) => ({ ...s, ...patch })); }, []);

  /** Prepare the undo of a change and show what it takes back. */
  const start = useCallback(async (target: { operationId: string; summary: string }) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    set({ ...IDLE, phase: 'preparing', target });
    try {
      const first = await api.undo(target.operationId, { mode: 'preview', wait: false });
      const r = isWorking(first.status) ? await settleEdit(first, { signal: controller.signal, get: api.get }) : first;
      if (r.status === 'previewed' && r.ok !== false) {
        set({ phase: 'confirm', preview: r });
        return r;
      }
      set({ phase: 'failed', error: failureOf(r) ?? { code: 'NOT_UNDOABLE', message: 'This change cannot be undone.' } });
      return r;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return null;
      set({ phase: 'failed', error: messageOf(err) });
      return null;
    }
  }, [api, set]);

  /** The owner confirmed: publish the undo exactly as prepared. */
  const confirm = useCallback(async (opts: { force?: boolean } = {}) => {
    const { target, preview } = stateRef.current;
    if (!target || !preview?.previewId) return null;
    set({ phase: 'undoing', error: null });
    try {
      const first = await api.undo(target.operationId, { mode: 'publish', previewId: preview.previewId, wait: true, ...(opts.force ? { force: true } : {}) });
      const r = isWorking(first.status) ? await settleEdit(first, { get: api.get }) : first;
      if (r.status === 'published' && r.ok) {
        set({ phase: 'done', result: r });
        return r;
      }
      set({ phase: r.status === 'previewed' ? 'confirm' : 'failed', result: r, error: failureOf(r) ?? { code: 'APPLY_FAILED', message: 'The undo did not finish. Your site is as it was.' } });
      return r;
    } catch (err) {
      set({ phase: 'confirm', error: messageOf(err) });
      return null;
    }
  }, [api, set]);

  /** Keep the change: the prepared undo is dropped. */
  const cancel = useCallback(async () => {
    abortRef.current?.abort();
    const id = stateRef.current.preview?.operationId;
    set({ ...IDLE });
    if (id) {
      try { await api.discard(id); } catch { /* it expires by itself */ }
    }
  }, [api, set]);

  const reset = useCallback(() => { abortRef.current?.abort(); set({ ...IDLE }); }, [set]);

  return { state, start, confirm, cancel, reset };
}
