import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { EditOperation, EditResult, EditView, SiteMap } from '../../types/edits';
import type { EditorAddress } from '../../utils/editorAddress';
import { createEditFlow, type EditFlowState, type EditFlowStore } from '../genstudio/useEditOperation';
import { planQuickEdit, planTypedEdit, type ElementLook, type ElementPlan, type ElementRect, type ElementSelection, type OwnItem } from './elementEdit';
import type { QuickEngine } from './quickActions';
import { PUBLISHING, WORKING } from './labels';
import { storeAppData } from '../../components/Dashboard/store/shared/storeContext';

/**
 * The editor window's change, through the edit engine:
 *
 *   idle -> working -> result (preview shown) -> Apply: live at once, with its undo
 *                           \-> Retry: another version / Discard: back to the live page
 *   idle -> typed (the owner's words typed on the page) -> Apply: live at once
 *   idle -> asked (advice: the question went to the chat)
 *
 * Each change belongs to its part (2026-10-19): the owner can click another
 * part, scroll away or open another page while it is prepared, and ask more
 * changes meanwhile. A change keeps working under its glass; once prepared
 * it waits for the owner's approval (a badge by its part), and opening it
 * brings the window back on its part, its preview shown, as if the owner
 * had stayed.
 */
export type QuickPhase = 'idle' | 'working' | 'result' | 'typed' | 'applying' | 'asked' | 'error';

/** Where a change was asked: its page, and how to open that page again. */
export interface JobPlace {
  /** The page's key (placeKey of its address). */
  where: string;
  url: string;
  item?: EditorAddress;
  /** The page's name, for a change shown while another page is open. */
  title: string;
}

/** One change of the window, on one part of one page. */
export interface QuickJob {
  id: string;
  /** The part in the frame (found again by its words when the page loads again). */
  uid: string;
  sel: ElementSelection;
  place: JobPlace;
  /** The part on the page shown now (its box in the frame), or null while the frame shows another page or has not found it yet. */
  spot: { rect: ElementRect; look?: ElementLook } | null;
  /** Its page loaded again without the part (it changed since): the change waits in the tray. */
  lost: boolean;
  flow: EditFlowStore;
  /** What its glass says ("Shortening"). */
  doing: string;
  long: boolean;
  lastPrompt: string;
  lastRun: { engine: QuickEngine | 'image'; prompt: string; doing: string } | null;
  /** The preview the frame shows for it (its operation id). */
  shown: string | null;
}

export interface JobView { job: QuickJob; state: EditFlowState }

/** A page's key: its address without the editor's own parameters, so a reload and a later visit are the same page. */
export function placeKey(url: string): string {
  try {
    const u = new URL(url, window.location.href);
    for (const k of [...u.searchParams.keys()]) if (/^(webmaven_|wme)/.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url;
  }
}

export interface QuickEditCallbacks {
  /** Show the engine's preview in the frame. */
  showPreview: (result: EditResult) => void;
  /** Back to the live page (reloaded). */
  showLive: () => void;
  /** A change went live: the toast with its undo, the site map read again. `focused`: the window is on its part. */
  onApplied: (result: EditResult, focused: boolean, job: QuickJob) => void;
  /** Ask the chat about the element (advice). */
  onAsk: (text: string) => void;
  /** The page in the frame, for a new change. */
  place: () => Omit<JobPlace, 'where'>;
  /** The view the owner looks at: it rides with the window's instruction, as context. */
  view?: EditView;
}

export interface QuickEditApi {
  phase: QuickPhase;
  /** The preview on screen (its summary, its checks). */
  preview: EditResult | null;
  error: string | null;
  lastPrompt: string;
  /** A long change (a designed section rewritten) is on its way. */
  long: boolean;
  /** What the glass over the element says while the change is prepared ("Shortening"). */
  doing: string;
  typed: { before: string; after: string } | null;
  run: (engine: QuickEngine | 'image', prompt: string, doing?: string) => Promise<void>;
  retry: () => Promise<void>;
  apply: () => Promise<void>;
  discard: () => Promise<void>;
  setTyped: (before: string, after: string) => void;
  /**
   * An operation the window built itself for a post's or a product's own
   * part (2026-10-19): published at once (a price, a picture from the
   * library), or previewed first (AI), then Apply.
   */
  send: (operation: EditOperation, how: 'publish' | 'preview', doing?: string) => Promise<void>;
  /** The post or the product the selection belongs to, as the window read it (a picture's target needs it). */
  setOwn: (own: OwnItem | null) => void;
  /** The window leaves its part (closed, or another part chosen): its change goes on, its preview leaves the frame. */
  leave: () => void;
  reset: () => void;
  /** Every change of the window, on every page, and the one the window is on. */
  jobs: JobView[];
  current: QuickJob | null;
  /** The change asked on this part of this page, if any. */
  jobAt: (uid: string) => QuickJob | null;
  /** The frame shows a page again: its changes' parts are looked for anew. */
  unplace: () => void;
  /** A change's part found on the page shown (by its id, or by its words after a reload), or not found (uid null). */
  place: (id: string, uid: string | null, rect?: ElementRect, look?: ElementLook) => void;
  /** The frame's parts moved (a scroll, a resize): the changes' parts follow. */
  follow: (positions: Record<string, ElementRect>) => void;
}

const IDLE_STATE: EditFlowState = { phase: 'idle', operation: null, preview: null, result: null, progress: null, error: null, versions: [] };

let jobCount = 0;

export function useQuickEdit(sel: ElementSelection | null, siteMap: SiteMap | null, cb: QuickEditCallbacks, where: string): QuickEditApi {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const jobsRef = useRef<Map<string, QuickJob>>(new Map());
  const [asked, setAsked] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [typed, setTypedState] = useState<{ before: string; after: string; plan: ElementPlan } | null>(null);
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const ownRef = useRef<OwnItem | null>(null);
  const setOwn = useCallback((own: OwnItem | null) => { ownRef.current = own; }, []);
  const unsubs = useRef<Map<string, () => void>>(new Map());

  const jobAt = useCallback((uid: string): QuickJob | null => {
    for (const j of jobsRef.current.values()) if (j.place.where === where && j.uid === uid) return j;
    return null;
  }, [where]);
  const current = sel ? jobAt(sel.uid) : null;
  const currentRef = useRef(current);
  currentRef.current = current;

  const addJob = useCallback((s: ElementSelection): QuickJob => {
    jobCount += 1;
    const job: QuickJob = {
      id: `job-${jobCount}`, uid: s.uid, sel: s, place: { where, ...cbRef.current.place() },
      spot: { rect: s.rect, ...(s.look ? { look: s.look } : {}) },
      lost: false, flow: createEditFlow(), doing: WORKING, long: false, lastPrompt: '', lastRun: null, shown: null,
    };
    jobsRef.current.set(job.id, job);
    unsubs.current.set(job.id, job.flow.subscribe(bump));
    bump();
    return job;
  }, [where]);

  const dropJob = useCallback((job: QuickJob) => {
    unsubs.current.get(job.id)?.();
    unsubs.current.delete(job.id);
    jobsRef.current.delete(job.id);
    bump();
  }, []);

  // Leaving the editor: nothing waits for the changes any more (they go on, and show in History).
  useEffect(() => () => {
    for (const j of jobsRef.current.values()) j.flow.stop();
  }, []);

  /** A change went live: it leaves the list; the window closes when it was on it. */
  const applied = useCallback((job: QuickJob, r: EditResult) => {
    const focused = currentRef.current?.id === job.id;
    // Its preview is the live page now: nothing to take back off the frame.
    job.shown = null;
    dropJob(job);
    cbRef.current.onApplied(r, focused, job);
  }, [dropJob]);

  const leave = useCallback(() => {
    setAsked(false);
    setLocalError(null);
    setTypedState(null);
    const job = currentRef.current;
    if (!job || !jobsRef.current.has(job.id)) return;
    if (job.shown) {
      job.shown = null;
      cbRef.current.showLive();
    }
    // A change still on its way, or waiting for approval, stays; one the owner saw fail, or never started, goes.
    const phase = job.flow.getState().phase;
    if (phase === 'idle' || phase === 'failed' || phase === 'published') dropJob(job);
  }, [dropJob]);

  const run = useCallback(async (engine: QuickEngine | 'image', prompt: string, words = WORKING) => {
    if (!sel || !prompt.trim()) return;
    setLocalError(null);
    setAsked(false);
    setTypedState(null);
    const plan = planQuickEdit(sel, engine, prompt, siteMap, cbRef.current.view, ownRef.current);
    if (plan.kind === 'chat') {
      cbRef.current.onAsk(plan.text);
      setAsked(true);
      return;
    }
    if (plan.kind === 'none') {
      setLocalError(plan.reason === 'problem' ? plan.problem : 'no-place');
      return;
    }
    const job = currentRef.current ?? addJob(sel);
    // A follow-up works on the preview the owner is looking at.
    const st = job.flow.getState();
    const refine = st.phase === 'previewed' && !!st.preview;
    Object.assign(job, { doing: words, long: plan.long, lastPrompt: prompt, lastRun: { engine, prompt, doing: words } });
    await job.flow.preview(plan.operation, { refine });
  }, [sel, siteMap, addJob]);

  const retry = useCallback(async () => {
    const job = currentRef.current;
    if (!job) return;
    if (job.flow.getState().preview) {
      await job.flow.anotherVersion();
      return;
    }
    if (job.lastRun) await run(job.lastRun.engine, job.lastRun.prompt, job.lastRun.doing);
  }, [run]);

  const apply = useCallback(async () => {
    setLocalError(null);
    let job = currentRef.current;
    let r: EditResult | null = null;
    if (typed) {
      if (typed.plan.kind !== 'operation' || !sel) return;
      job = job ?? addJob(sel);
      job.doing = PUBLISHING;
      r = await job.flow.publishNow(typed.plan.operation);
      if (r && r.ok && r.status === 'published' && currentRef.current?.id === job.id) setTypedState(null);
    } else {
      if (!job) return;
      job.doing = PUBLISHING;
      r = await job.flow.publish();
    }
    if (r && r.ok && r.status === 'published') applied(job, r);
  }, [typed, sel, addJob, applied]);

  const discard = useCallback(async () => {
    setTypedState(null);
    setAsked(false);
    setLocalError(null);
    const job = currentRef.current;
    if (!job) return;
    const hadPreview = !!job.shown;
    job.shown = null;
    dropJob(job);
    const gone = job.flow.discard();
    if (hadPreview) cbRef.current.showLive();
    await gone;
  }, [dropJob]);

  const send = useCallback(async (operation: EditOperation, how: 'publish' | 'preview', words = WORKING) => {
    if (!sel) return;
    setLocalError(null);
    setAsked(false);
    setTypedState(null);
    const job = currentRef.current ?? addJob(sel);
    Object.assign(job, { lastPrompt: '', long: false, lastRun: null, doing: how === 'publish' ? PUBLISHING : words });
    if (how === 'publish') {
      const r = await job.flow.publishNow(operation);
      if (r && r.ok && r.status === 'published') applied(job, r);
      return;
    }
    await job.flow.preview(operation);
  }, [sel, addJob, applied]);

  const setTyped = useCallback((before: string, after: string) => {
    if (!sel) return;
    // An own value (an item number, a size, a date) is written as the store keeps it: the record read, the store's size unit.
    const plan = planTypedEdit(sel, before, after, siteMap, { own: ownRef.current, sizeUnit: storeAppData().units?.dimension ?? '' });
    if (plan.kind === 'none') {
      setLocalError(plan.reason === 'problem' ? plan.problem : 'no-place');
      return;
    }
    // Words typed over a change that failed: the failed one goes.
    const job = currentRef.current;
    if (job && job.flow.getState().phase === 'failed') dropJob(job);
    setAsked(false);
    setLocalError(null);
    setTypedState({ before, after, plan });
  }, [sel, siteMap, dropJob]);

  // The window on a prepared change: its preview shows, once per version (a change prepared while the owner was elsewhere, when they open it).
  const st = current ? current.flow.getState() : IDLE_STATE;
  const previewId = st.phase === 'previewed' ? st.preview?.operationId ?? null : null;
  useEffect(() => {
    const job = currentRef.current;
    const p = job?.flow.getState().preview;
    if (!job || !previewId || !p || job.shown === previewId) return;
    job.shown = previewId;
    cbRef.current.showPreview(p);
  }, [current?.id, previewId]);

  const unplace = useCallback(() => {
    for (const j of jobsRef.current.values()) {
      j.spot = null;
      j.lost = false;
    }
    bump();
  }, []);

  const place = useCallback((id: string, uid: string | null, rect?: ElementRect, look?: ElementLook) => {
    const job = jobsRef.current.get(id);
    if (!job) return;
    if (!uid || !rect) {
      job.spot = null;
      job.lost = true;
      bump();
      return;
    }
    const seen = look ?? job.spot?.look ?? job.sel.look;
    job.uid = uid;
    job.lost = false;
    job.spot = { rect, ...(seen ? { look: seen } : {}) };
    bump();
  }, []);

  const follow = useCallback((positions: Record<string, ElementRect>) => {
    let moved = false;
    for (const j of jobsRef.current.values()) {
      if (j.place.where !== where || !j.spot) continue;
      const r = positions[j.uid];
      if (r && (r.top !== j.spot.rect.top || r.left !== j.spot.rect.left || r.width !== j.spot.rect.width || r.height !== j.spot.rect.height)) {
        j.spot = { ...j.spot, rect: r };
        moved = true;
      }
    }
    if (moved) bump();
  }, [where]);

  let phase: QuickPhase = 'idle';
  if (st.phase === 'previewing') phase = 'working';
  else if (st.phase === 'publishing') phase = 'applying';
  else if (typed) phase = 'typed';
  else if (st.phase === 'previewed') phase = 'result';
  else if (st.phase === 'failed' || localError) phase = 'error';
  else if (asked) phase = 'asked';

  return {
    phase,
    preview: st.preview,
    error: localError ?? st.error?.message ?? null,
    lastPrompt: current?.lastPrompt ?? '',
    long: current?.long ?? false,
    doing: current?.doing ?? WORKING,
    typed: typed ? { before: typed.before, after: typed.after } : null,
    run,
    retry,
    apply,
    discard,
    setTyped,
    send,
    setOwn,
    leave,
    reset: leave,
    jobs: [...jobsRef.current.values()].map((job) => ({ job, state: job.flow.getState() })),
    current,
    jobAt,
    unplace,
    place,
    follow,
  };
}
