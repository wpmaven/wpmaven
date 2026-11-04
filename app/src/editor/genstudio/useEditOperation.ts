import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { EditOperation, EditResult } from '../../types/edits';
import { editsApi, EditsRequestError, failureOf, isWorking, notPreparedText, requestFailedText, settleEdit } from '../../services/edits';

/**
 * One change in the editor, from the owner's instruction to the live site:
 *
 *   idle -> previewing -> previewed -> publishing -> published
 *                    \-> failed       \-> previewed again (refused, the preview stays: Try again)
 *
 * A design change is prepared on the server (20 to 90 seconds) and polled;
 * a data change answers at once. Publishing waits for the API, so its answer
 * is the final row: published, or the preview kept with the reason it did
 * not go out (DRIFT, CHECK_BROKEN, ...). Leaving the panel stops the polling;
 * the change itself goes on and shows in History.
 */
export type EditPhase = 'idle' | 'previewing' | 'previewed' | 'publishing' | 'published' | 'failed';

export interface EditFlowError {
  code: string;
  message: string;
  /** What failed: making the preview, or publishing it. */
  stage: 'preview' | 'publish';
}

export interface EditFlowState {
  phase: EditPhase;
  operation: EditOperation | null;
  /** The previewed row (kept when a publish is refused). */
  preview: EditResult | null;
  /** The outcome of the last publish (published, or refused). */
  result: EditResult | null;
  /** The latest answer while the API works (where the change waits in line). */
  progress: EditResult | null;
  error: EditFlowError | null;
  /** The versions of this change waiting to be compared (the first one, then each other version); preview is the one shown. */
  versions: EditResult[];
}

const IDLE: EditFlowState = { phase: 'idle', operation: null, preview: null, result: null, progress: null, error: null, versions: [] };

/** The most versions of one change kept to compare (the API refuses a fourth). */
export const MAX_VERSIONS = 3;

const STILL_WORKING = 'Your change is taking longer than usual. It shows in History when it is ready.';

function errorFrom(err: unknown, stage: 'preview' | 'publish'): EditFlowError {
  if (err instanceof EditsRequestError) return { code: err.code || 'REQUEST', message: err.message, stage };
  return { code: 'REQUEST', message: requestFailedText(), stage };
}

export interface EditOperationApi {
  state: EditFlowState;
  /** Prepare a preview; `refine` builds on the current unpublished preview. */
  preview: (operation: EditOperation, opts?: { refine?: boolean }) => Promise<EditResult | null>;
  /** Another version of the same change, from the same start as the one shown, composed differently. */
  anotherVersion: () => Promise<EditResult | null>;
  /** Show one of the versions (its preview, summary and checks). */
  showVersion: (index: number) => void;
  /** Publish the current preview; `force` publishes over outside changes or a broken check. */
  publish: (opts?: { force?: boolean }) => Promise<EditResult | null>;
  /** A data change straight to the site (no separate preview step). */
  publishNow: (operation: EditOperation) => Promise<EditResult | null>;
  discard: () => Promise<void>;
  share: () => Promise<EditResult | null>;
  /** Forget this change on screen (the API keeps its row). */
  reset: () => void;
}

/** The ways a waited request can end without an answer while the API goes on (the plugin's wait, the browser's, the line). */
const UNANSWERED = new Set(['SITE_UNREACHABLE', 'TIMEOUT', 'NETWORK']);

const newKey = () => `wm-pub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * A publish the owner waits for, by a key of its own. When the wait runs out before the answer (lived:
 * the plugin stopped waiting at 90 s, the window said "WPMaven did not answer", and the API published
 * the change three seconds later), the same request is asked again by its key without waiting: the API
 * answers that change's row, and the flow follows it to its real end.
 */
export async function waitedPublish(api: Pick<typeof editsApi, 'request'>, input: Parameters<typeof editsApi.request>[0]): Promise<EditResult> {
  const key = input.idempotencyKey ?? newKey();
  try {
    return await api.request({ ...input, idempotencyKey: key });
  } catch (err) {
    if (!(err instanceof EditsRequestError) || !UNANSWERED.has(err.code)) throw err;
    const { wait: _wait, ...rest } = input;
    try {
      return await api.request({ ...rest, idempotencyKey: key });
    } catch {
      throw err;
    }
  }
}

type EditsApi = Pick<typeof editsApi, 'request' | 'get' | 'discard' | 'share'>;

/**
 * One change's flow outside React (2026-10-19): the editor window keeps
 * several at once, one per part the owner asked a change for, each going
 * on while the owner works elsewhere. useEditOperation is one of them,
 * held by a component.
 */
export interface EditFlowStore extends Omit<EditOperationApi, 'state'> {
  getState: () => EditFlowState;
  subscribe: (listener: () => void) => () => void;
  /** Stop listening: the polling stops and the state stays as it is (the change itself goes on and shows in History). */
  stop: () => void;
  /** Listen again (a component mounted again). */
  resume: () => void;
}

export function createEditFlow(apiOf: () => EditsApi = () => editsApi): EditFlowStore {
  let state: EditFlowState = IDLE;
  let stopped = false;
  let abort: AbortController | null = null;
  const listeners = new Set<() => void>();

  const update = (patch: Partial<EditFlowState>) => {
    if (stopped) return;
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const freshSignal = () => {
    abort?.abort();
    abort = new AbortController();
    return abort.signal;
  };

  const settle = async (first: EditResult, signal: AbortSignal) => {
    if (!isWorking(first.status)) return first;
    return settleEdit(first, { signal, get: apiOf().get, onUpdate: (r) => update({ progress: r }) });
  };

  const preview = async (operation: EditOperation, opts: { refine?: boolean } = {}) => {
    const api = apiOf();
    const signal = freshSignal();
    const base = opts.refine ? state.preview?.previewId : undefined;
    // A new change or a refinement leaves the other versions behind: discarded (the one shown stays, as before).
    const left = state.versions.filter((v) => v.operationId !== state.preview?.operationId);
    update({ phase: 'previewing', operation, result: null, error: null, progress: null, versions: [], ...(opts.refine ? {} : { preview: null }) });
    for (const v of left) if (v.operationId) void api.discard(v.operationId).catch(() => undefined);
    try {
      const first = await api.request({ operation, mode: 'preview', ...(base ? { basePreviewId: base } : {}) });
      update({ progress: first });
      const r = await settle(first, signal);
      if (r.status === 'previewed' && r.ok) {
        update({ phase: 'previewed', preview: r, progress: null, versions: [r] });
        return r;
      }
      const f = isWorking(r.status) ? { code: 'SLOW', message: STILL_WORKING } : failureOf(r) ?? { code: 'ENGINE', message: notPreparedText() };
      update({ phase: 'failed', error: { ...f, stage: 'preview' }, progress: null, preview: null, result: r.operationId ? r : null });
      return r;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return null;
      update({ phase: 'failed', error: errorFrom(err, 'preview'), progress: null });
      return null;
    }
  };

  const anotherVersion = async () => {
    const api = apiOf();
    const { operation, preview: shown, versions } = state;
    if (!operation || !shown?.previewId || versions.length >= MAX_VERSIONS) return null;
    const signal = freshSignal();
    update({ phase: 'previewing', error: null, result: null, progress: null });
    try {
      const first = await api.request({ operation, mode: 'preview', variantOf: shown.previewId });
      update({ progress: first });
      const r = await settle(first, signal);
      if (r.status === 'previewed' && r.ok) {
        update({ phase: 'previewed', preview: r, progress: null, versions: [...state.versions, r] });
        return r;
      }
      // The versions on screen stay: the new one did not come.
      const f = isWorking(r.status) ? { code: 'SLOW', message: STILL_WORKING } : failureOf(r) ?? { code: 'ENGINE', message: notPreparedText() };
      update({ phase: 'previewed', preview: shown, error: { ...f, stage: 'preview' }, progress: null });
      return r;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return null;
      update({ phase: 'previewed', preview: shown, error: errorFrom(err, 'preview'), progress: null });
      return null;
    }
  };

  const showVersion = (index: number) => {
    const v = state.versions[index];
    if (v && state.phase === 'previewed') update({ preview: v, error: null, result: null });
  };

  const publish = async (opts: { force?: boolean } = {}) => {
    const api = apiOf();
    const { operation, preview: shown } = state;
    if (!operation || !shown?.previewId) return null;
    const signal = freshSignal();
    update({ phase: 'publishing', error: null, result: null, progress: null });
    try {
      const first = await waitedPublish(api, { operation, mode: 'publish', previewId: shown.previewId, ...(opts.force ? { force: true } : {}), wait: true });
      const r = await settle(first, signal);
      if (r.status === 'published' && r.ok) {
        // The API discards the other versions with this publish.
        update({ phase: 'published', result: r, progress: null, versions: [] });
        return r;
      }
      const f = isWorking(r.status) ? { code: 'SLOW', message: STILL_WORKING } : failureOf(r) ?? { code: 'APPLY_FAILED', message: 'Publishing did not finish. Nothing on your site changed.' };
      // A refused publish keeps its preview: the owner can try again or discard it.
      const kept = r.status === 'previewed';
      const keptRow = kept ? { ...shown, ...r, previewId: r.previewId ?? shown.previewId } : shown;
      update({
        phase: kept ? 'previewed' : 'failed',
        preview: keptRow,
        versions: state.versions.map((v) => (v.operationId === shown.operationId ? keptRow : v)),
        result: r,
        error: { ...f, stage: 'publish' },
        progress: null,
      });
      return r;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return null;
      update({ phase: 'previewed', error: errorFrom(err, 'publish'), progress: null });
      return null;
    }
  };

  const publishNow = async (operation: EditOperation) => {
    const api = apiOf();
    const signal = freshSignal();
    update({ phase: 'publishing', operation, preview: null, result: null, error: null, progress: null });
    try {
      const first = await waitedPublish(api, { operation, mode: 'publish', wait: true });
      const r = await settle(first, signal);
      if (r.status === 'published' && r.ok) {
        update({ phase: 'published', result: r, progress: null });
        return r;
      }
      const f = isWorking(r.status) ? { code: 'SLOW', message: STILL_WORKING } : failureOf(r) ?? { code: 'APPLY_FAILED', message: 'This change did not go through. Nothing on your site changed.' };
      update({ phase: 'failed', result: r, error: { ...f, stage: 'publish' }, progress: null });
      return r;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return null;
      update({ phase: 'failed', error: errorFrom(err, 'publish'), progress: null });
      return null;
    }
  };

  const discard = async () => {
    const api = apiOf();
    abort?.abort();
    const ids = new Set([state.preview?.operationId, ...state.versions.map((v) => v.operationId)].filter(Boolean) as string[]);
    update({ ...IDLE });
    for (const id of ids) {
      try { await api.discard(id); } catch { /* the preview expires by itself */ }
    }
  };

  const share = async () => {
    const id = state.preview?.operationId;
    if (!id) return null;
    try {
      const r = await apiOf().share(id);
      if (r.preview) update({ preview: { ...(state.preview as EditResult), preview: r.preview } });
      return r;
    } catch (err) {
      update({ error: { ...errorFrom(err, 'preview'), code: 'SHARE' } });
      return null;
    }
  };

  const reset = () => {
    abort?.abort();
    update({ ...IDLE });
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    stop: () => {
      stopped = true;
      abort?.abort();
    },
    resume: () => { stopped = false; },
    preview, anotherVersion, showVersion, publish, publishNow, discard, share, reset,
  };
}

export function useEditOperation(api: EditsApi = editsApi): EditOperationApi {
  const apiRef = useRef(api);
  apiRef.current = api;
  const [flow] = useState(() => createEditFlow(() => apiRef.current));
  useEffect(() => {
    flow.resume();
    return () => flow.stop();
  }, [flow]);
  const state = useSyncExternalStore(flow.subscribe, flow.getState, flow.getState);
  return useMemo(() => ({
    state,
    preview: flow.preview,
    anotherVersion: flow.anotherVersion,
    showVersion: flow.showVersion,
    publish: flow.publish,
    publishNow: flow.publishNow,
    discard: flow.discard,
    share: flow.share,
    reset: flow.reset,
  }), [state, flow]);
}
