import React, {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState,
} from 'react';
import { TourOverlay, stepIsUsed } from './TourOverlay';
import { CLOSED, currentStep, tourReducer, type TourPhase } from './machine';
import {
  collapsedPlacement, placeTour, scrollDelta, spotFor, type Placement, type Rect, type Viewport,
} from './placement';
import {
  TOUR_LABELS, actionsFor, arrival, asTourRecord, closingSave, lookup, makeTourRecord, memoryTourStore, opensKeyboard,
  ownsKeys, persists, showMeSteps, tabLoop, targetSelectors, tourKeyAction, type FocusedControl,
} from './rules';
import type {
  TourApi, TourCurrent, TourDefinition, TourEnd, TourInsets, TourLabels, TourRecord, TourShowMeOptions,
  TourStartOptions, TourStatus, TourStep, TourStepAction, TourStore,
} from './types';

/**
 * The guided tour (0.9.0): the dashboard's in-house tour, made app-agnostic
 * so the plugin and the dashboard run the same engine with their own steps
 * and their own storage. 0.10.0 brings the rest of the dashboard's: step
 * actions, variants, Later until the element is done, the phone's slim bar,
 * insets, Show me, and tours that save nothing.
 *
 *  - Steps point at elements by their `data-tour` value (or a selector). A
 *    step can need a page: the provider asks the app to open it
 *    (onNeedPage) and waits for the app's `page` to say it is there, then
 *    for the element.
 *  - A step that waits for a click lets the element take it, and moves on
 *    with it. On the last step the click finishes the tour, so an app can
 *    hand over to the next tour (onEnd's `clicked`).
 *  - The element speaks for itself while its step is up: the variant it
 *    reads as (other words), whether it is done (a `later` step's Later
 *    turns to Next), and which of the step's actions apply. Read again
 *    whenever its attributes change.
 *  - Progress goes to the app's TourStore at every step shown, and when the
 *    tour ends (done or skipped; left: the step after the one left). A tour
 *    none of whose steps had anything to show saves nothing, so it is
 *    offered again. A Show me run saves nothing, nor does a tour defined
 *    with `persist: false` (its record lasts as long as the page).
 *  - Nothing moves on a clock: only the person and the screen move it.
 *  - Keyboard: Escape ends it, the arrow keys go forward and back, Enter
 *    goes forward from the card. Focus goes to the card's forward button (or
 *    to the element a step waits for a click on, or the first text field of
 *    an interactive step on a computer) and back where it was when the tour
 *    ends. Reduced motion: no animation, no smooth scroll.
 *  - It scrolls the element into view with room for the card, clear of the
 *    app's bands (insets), only when it first shows or when the page changes
 *    shape under it; never while someone types in a step they use, and
 *    never for an element in a fixed or sticky box.
 *  - On a phone (`compact`): a used step has no dim, the focus stays on the
 *    card, and while a field that raises the keyboard has the focus the
 *    card is a slim bar clear of it.
 *
 * Outside a provider useTour() is a set of no-ops, so a screen rendered on
 * its own (a test) needs none.
 */

const NOOP: TourApi = {
  start: () => undefined,
  startOnce: () => undefined,
  showMe: () => undefined,
  stop: () => undefined,
  current: null,
  record: () => undefined,
  loaded: false,
  open: false,
};

const TourContext = createContext<TourApi>(NOOP);

/** The tour's controls and state: start, startOnce, showMe, stop, current, record. */
export const useTour = (): TourApi => useContext(TourContext);

export interface TourProviderProps {
  /** Every tour the app has; their records are read once, when the provider mounts. */
  tours: readonly TourDefinition[];
  /**
   * Where the records live. Without one, they last as long as the page. A
   * new store (someone else signed in) reads them again: keep it stable.
   */
  store?: TourStore;
  /** The app's page now, in the same words as the steps' `page`. */
  page?: string;
  /** Opens a page a step needs. Without it, a step on another page is passed. */
  onNeedPage?: (page: string) => void;
  /** A tour opened. */
  onStart?: (tourId: string) => void;
  /** A tour closed: how, on which step, and whether its last step got the click it waited for. */
  onEnd?: (end: TourEnd) => void;
  labels?: Partial<TourLabels>;
  zIndex?: { read?: number; used?: number };
  /**
   * The app's bands: a sticky header at the top, a floating button at the
   * bottom. A function is asked for each step's element (an element inside
   * the header has no top band to keep clear of).
   */
  insets?: TourInsets | ((element: HTMLElement) => TourInsets);
  /**
   * A phone, as a media query ('(max-width: 639px)'): there a used step has
   * no dim, only the ring; the focus stays on the card; and while a field
   * that raises the keyboard has the focus, the card is a slim bar clear of
   * it. Off without one.
   */
  compact?: string;
  /** The variant a step's element reads as (the step's `variants`). Default: its `data-tour-variant`. */
  variantOf?: (step: TourStep, element: HTMLElement) => string | null | undefined;
  /** Whether a step's element is done (a `later` step). Default: it has `data-tour-done`. */
  doneOf?: (step: TourStep, element: HTMLElement) => boolean;
  children?: React.ReactNode;
}

// ── The page, read ─────────────────────────────────────────────────────────

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The overflow values that cut what sticks out of a box (an unset value cuts nothing). */
const CLIPS = /^(hidden|clip|auto|scroll|overlay)$/;
/** The overflow values of a box that scrolls. */
const SCROLLS = /^(auto|scroll|overlay)$/;

/**
 * On screen, not merely in the document: it has a box, nothing hides it,
 * no ancestor that clips is folded to nothing (a closed sidebar), and it is
 * not pushed off the side of the screen (a slide-over).
 */
export function isShown(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 && r.height <= 0) return false;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  if (r.right <= 0 || (vw > 0 && r.left >= vw)) return false;
  const view = el.ownerDocument.defaultView ?? window;
  if (view.getComputedStyle(el).visibility === 'hidden') return false;
  for (let a = el.parentElement; a && a !== el.ownerDocument.body; a = a.parentElement) {
    const cs = view.getComputedStyle(a);
    const clips = CLIPS.test(cs.overflowX || cs.overflow || '') || CLIPS.test(cs.overflowY || cs.overflow || '');
    if (clips && (a.clientWidth === 0 || a.clientHeight === 0)) return false;
  }
  return true;
}

function firstShown(selectors: readonly string[]): HTMLElement | null {
  for (const sel of selectors) {
    let list: HTMLElement[] = [];
    try { list = Array.from(document.querySelectorAll<HTMLElement>(sel)); } catch { list = []; }
    const el = list.find(isShown);
    if (el) return el;
  }
  return null;
}

function present(selectors: readonly string[]): boolean {
  return selectors.some((sel) => {
    try { return document.querySelector(sel) !== null; } catch { return false; }
  });
}

/** In a fixed or sticky box (a header, a floating button): scrolling the page does not bring it any nearer. */
function pinned(el: Element): boolean {
  const view = el.ownerDocument.defaultView ?? window;
  for (let a: Element | null = el; a && a !== el.ownerDocument.body; a = a.parentElement) {
    const p = view.getComputedStyle(a).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
}

/** Scrolls the box the element scrolls in (the nearest one that scrolls, else the window). */
function scrollAround(el: Element, dy: number, smooth: boolean): void {
  const view = el.ownerDocument.defaultView ?? window;
  const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';
  for (let a = el.parentElement; a && a !== el.ownerDocument.body && a !== el.ownerDocument.documentElement; a = a.parentElement) {
    const cs = view.getComputedStyle(a);
    if (SCROLLS.test(cs.overflowY || cs.overflow || '') && a.scrollHeight > a.clientHeight + 1) {
      if (typeof a.scrollBy === 'function') a.scrollBy({ top: dy, behavior });
      else a.scrollTop += dy;
      return;
    }
  }
  if (typeof view.scrollBy === 'function') view.scrollBy({ top: dy, behavior });
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function viewport(insets: TourInsets): Viewport {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: window.innerHeight,
    topInset: Math.max(0, insets.top ?? 0),
    bottomInset: Math.max(0, insets.bottom ?? 0),
  };
}

function describe(t: EventTarget | null | undefined): FocusedControl | null {
  if (!t || !(t instanceof HTMLElement)) return null;
  return {
    tagName: t.tagName,
    type: t instanceof HTMLInputElement ? t.type : null,
    isContentEditable: t.isContentEditable,
    role: t.getAttribute('role'),
  };
}

function focusables(root: Element): HTMLElement[] {
  const inside = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  const self = root instanceof HTMLElement && root.matches(FOCUSABLE) ? [root] : [];
  return [...self, ...inside].filter((el) => el.getClientRects().length > 0);
}

/** The first field of the element someone is asked to fill in, if it has one. */
function firstField(root: Element): HTMLElement | null {
  const fields = Array.from(root.querySelectorAll<HTMLElement>('input:not([disabled]), textarea:not([disabled])'));
  return fields.find((el) => opensKeyboard(describe(el)) && el.getClientRects().length > 0) ?? null;
}

function edgeOf(items: HTMLElement[], active: Element | null): 'first' | 'last' | 'both' | 'middle' {
  const first = items[0] === active;
  const last = items[items.length - 1] === active;
  if (first && last) return 'both';
  if (first) return 'first';
  if (last) return 'last';
  return 'middle';
}

function useMediaQuery(query: string | undefined): boolean {
  const [hit, setHit] = useState(() => !!query && typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    if (!query) { setHit(false); return undefined; }
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const on = () => setHit(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);
  return hit;
}

const defaultVariantOf = (_step: TourStep, el: HTMLElement) => el.getAttribute('data-tour-variant');
const defaultDoneOf = (_step: TourStep, el: HTMLElement) => el.hasAttribute('data-tour-done');

/** What the element says about itself while its step is up. */
interface ElementSays { variant: string | null; done: boolean; actions: readonly TourStepAction[] }
const SAYS_NOTHING: ElementSays = { variant: null, done: false, actions: [] };

/** Layout effects do nothing in a server render (the unit tests); this is the same effect without the warning. */
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// ── The provider ───────────────────────────────────────────────────────────

export const TourProvider: React.FC<TourProviderProps> = ({
  tours, store, page, onNeedPage, onStart, onEnd, labels, zIndex, insets, compact, variantOf, doneOf, children,
}) => {
  const words = useMemo<TourLabels>(() => ({ ...TOUR_LABELS, ...labels }), [labels]);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const phone = useMediaQuery(compact);
  const [state, dispatch] = useReducer(tourReducer, CLOSED);

  // The app's callbacks and data, read at the moment they are needed, so a
  // new function or array on every render never restarts anything.
  const [fallbackStore] = useState<TourStore>(() => memoryTourStore());
  const storeRef = useRef<TourStore>(store ?? fallbackStore);
  storeRef.current = store ?? fallbackStore;
  const toursRef = useRef(tours);
  toursRef.current = tours;
  const needPageRef = useRef(onNeedPage);
  needPageRef.current = onNeedPage;
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  const variantOfRef = useRef(variantOf);
  variantOfRef.current = variantOf;
  const doneOfRef = useRef(doneOf);
  doneOfRef.current = doneOf;
  const definition = useCallback((tourId: string | null) => toursRef.current.find((t) => t.id === tourId) ?? null, []);

  // ── Records: read once per set of tours, and again for a new store ─────
  const [known, setKnown] = useState<Record<string, TourRecord | null>>({});
  const [loaded, setLoaded] = useState(false);
  const written = useRef<Set<string>>(new Set());
  const toursKey = tours.map((t) => `${t.id}@${t.version}${t.persist === false ? ':page' : ''}`).join('|');
  const activeStore = store ?? fallbackStore;
  const readFrom = useRef<TourStore | null>(null);
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    // Another store is another person's records (someone else signed in):
    // nothing this page knew or wrote counts for them.
    if (readFrom.current !== null && readFrom.current !== activeStore) {
      written.current = new Set();
      setKnown({});
    }
    readFrom.current = activeStore;
    const list = toursRef.current;
    void Promise.all(list.map(async (t): Promise<[string, TourRecord | null | undefined]> => {
      // A tour that saves nothing has nothing to read: never started, as far as this page knows.
      if (!persists(t)) return [t.id, null];
      try {
        return [t.id, asTourRecord(await storeRef.current.read(t.id), t.version)];
      } catch {
        return [t.id, undefined];
      }
    })).then((entries) => {
      if (!alive) return;
      setKnown((prev) => {
        const next: Record<string, TourRecord | null> = {};
        for (const [id, rec] of entries) if (rec !== undefined) next[id] = rec;
        // What this page wrote meanwhile is newer than what was read.
        for (const id of written.current) if (id in prev) next[id] = prev[id];
        return next;
      });
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [toursKey, activeStore]);

  // Writes go one after another, so a quick Next, Next cannot land out of order.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const lastSaved = useRef<string | null>(null);
  const save = useCallback((tourId: string, status: TourStatus, stepId: string) => {
    const def = definition(tourId);
    if (!def) return;
    const key = `${tourId}:${status}:${stepId}`;
    if (lastSaved.current === key) return;
    lastSaved.current = key;
    const rec = makeTourRecord(def.version, status, stepId);
    written.current.add(tourId);
    setKnown((k) => ({ ...k, [tourId]: rec }));
    // persist: false keeps it for this page only.
    if (!persists(def)) return;
    chain.current = chain.current
      .then(() => storeRef.current.write(tourId, rec))
      .catch(() => undefined);
  }, [definition]);

  // ── Opening ─────────────────────────────────────────────────────────────
  const start = useCallback((tourId: string, options?: TourStartOptions) => {
    const def = definition(tourId);
    if (!def) return;
    dispatch({ type: 'open', tourId, steps: options?.steps ?? def.steps, startAt: options?.at ?? null });
  }, [definition]);

  const showMe = useCallback((tourId: string, stepId: string, options?: TourShowMeOptions) => {
    const def = definition(tourId);
    if (!def) return;
    const one = showMeSteps(options?.steps ?? def.steps, stepId);
    if (one.length === 0) return;
    dispatch({ type: 'open', tourId, steps: one, single: true });
  }, [definition]);

  const stop = useCallback(() => dispatch({ type: 'pause' }), []);

  // startOnce waits for the records; the latest call wins.
  const [pendingOnce, setPendingOnce] = useState<{ tourId: string; options?: TourStartOptions; n: number } | null>(null);
  const startOnce = useCallback((tourId: string, options?: TourStartOptions) => (
    setPendingOnce((p) => ({ tourId, options, n: (p?.n ?? 0) + 1 }))
  ), []);
  useEffect(() => {
    if (!pendingOnce || !loaded) return;
    setPendingOnce(null);
    // Another tour on screen: this one is not queued behind it.
    if (state.phase !== 'closed') return;
    if (!(pendingOnce.tourId in known) || known[pendingOnce.tourId] !== null) return;
    start(pendingOnce.tourId, pendingOnce.options);
  }, [pendingOnce, loaded, known, state.phase, start]);

  // ── Opened and closed ───────────────────────────────────────────────────
  const restoreFocus = useRef<HTMLElement | null>(null);
  const prevPhase = useRef<TourPhase>('closed');
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = state.phase;
    if (was === 'closed' && state.phase !== 'closed' && state.tourId) {
      lastSaved.current = null;
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      restoreFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
      onStartRef.current?.(state.tourId);
      return;
    }
    if (was !== 'closed' && state.phase === 'closed' && state.tourId && state.outcome) {
      const stepId = state.steps[state.index]?.id ?? null;
      // Done and skipped as they are; left: in progress on the step after it.
      // 'paused' keeps the in_progress record written at its last step;
      // 'empty' and a Show me run write nothing.
      const status = closingSave(state.outcome, state.single);
      if (stepId && status) save(state.tourId, status, stepId);
      const back = restoreFocus.current;
      restoreFocus.current = null;
      if (!state.clicked && state.outcome !== 'left' && back && back.isConnected) back.focus({ preventScroll: true });
      onEndRef.current?.({
        tourId: state.tourId,
        outcome: state.outcome,
        stepId: state.outcome === 'empty' ? null : stepId,
        clicked: state.clicked,
        single: state.single,
      });
    }
  }, [state, save]);

  const step = currentStep(state);
  const stepId = step?.id ?? null;
  const stepKey = state.tourId && stepId ? `${state.tourId}:${stepId}` : null;
  const isOpen = state.phase !== 'closed';
  const used = !!step && stepIsUsed(step);
  const waits = step?.waitFor === 'click';

  // Saved at every step shown; a Show me run saves nothing.
  useEffect(() => {
    if (state.phase === 'showing' && state.tourId && stepId && !state.single) save(state.tourId, 'in_progress', stepId);
  }, [state.phase, state.tourId, stepId, state.single, save]);

  // ── Going to the step's page, and finding its element ──────────────────
  const target = useRef<HTMLElement | null>(null);
  // The page the app was on when it was asked to open the step's page.
  const asked = useRef<{ key: string; from: string } | null>(null);
  useEffect(() => {
    if (!step || !stepKey || state.phase !== 'locating') return undefined;
    const from = asked.current?.key === stepKey ? asked.current.from : null;
    const how = arrival(step.page, page, from, !!needPageRef.current);
    if (how === 'wait') return undefined;
    if (how === 'unreachable') {
      asked.current = null;
      dispatch({ type: 'absent' });
      return undefined;
    }
    if (how === 'go') {
      asked.current = { key: stepKey, from: page ?? '' };
      needPageRef.current?.(step.page as string);
      return undefined;
    }
    asked.current = null;

    const selectors = targetSelectors(step);
    const ready = step.ready ?? [];
    const tryFind = (): boolean => {
      const el = firstShown(selectors);
      const found = lookup(!!el, ready.length, !el && present(ready));
      if (found === 'wait') return false;
      if (el) target.current = el;
      dispatch({ type: found === 'found' ? 'found' : 'absent' });
      return true;
    };
    if (tryFind()) return undefined;
    // Still loading: look again whenever the page changes. No clock.
    const watcher = new MutationObserver(() => { if (tryFind()) watcher.disconnect(); });
    watcher.observe(document.body, { childList: true, subtree: true, attributes: true });
    return () => watcher.disconnect();
  }, [step, stepKey, state.phase, page]);

  // The step's page was left while it was up: the tour steps aside.
  useEffect(() => {
    if (state.phase !== 'showing' || !step?.page) return;
    if (page !== step.page) dispatch({ type: 'pause' });
  }, [page, state.phase, step]);

  // ── What the element says about itself ─────────────────────────────────
  // Its variant, whether it is done, and which actions apply; read before
  // paint (the card never shows the wrong button for a frame) and again
  // whenever its attributes change.
  const [says, setSays] = useState<ElementSays>(SAYS_NOTHING);
  useIsoLayoutEffect(() => {
    const el = target.current;
    if (state.phase !== 'showing' || !el || !step) { setSays(SAYS_NOTHING); return undefined; }
    const read = () => setSays({
      variant: (variantOfRef.current ?? defaultVariantOf)(step, el) ?? null,
      done: !!(doneOfRef.current ?? defaultDoneOf)(step, el),
      actions: actionsFor(step, el),
    });
    read();
    const watch = new MutationObserver(read);
    watch.observe(el, { attributes: true });
    return () => watch.disconnect();
    // Only when a step shows or changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, stepKey]);

  // ── Typing on a phone ───────────────────────────────────────────────────
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!isOpen) { setTyping(false); return undefined; }
    const into = (e: FocusEvent) => setTyping(opensKeyboard(describe(e.target)));
    // focusout comes first when moving between two fields: the next one decides.
    const outOf = (e: FocusEvent) => setTyping(opensKeyboard(describe(e.relatedTarget)));
    setTyping(opensKeyboard(describe(document.activeElement)));
    document.addEventListener('focusin', into);
    document.addEventListener('focusout', outOf);
    return () => {
      document.removeEventListener('focusin', into);
      document.removeEventListener('focusout', outOf);
    };
  }, [isOpen]);
  const slim = phone && used && state.phase === 'showing' && typing;

  // ── Placing the spotlight and the card ─────────────────────────────────
  const cardRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const scrolledFor = useRef<string | null>(null);
  const lastTop = useRef<number | null>(null);

  /*
   * Measures and places. It scrolls only for the tour's own reasons: when a
   * step first shows, and when the page changes shape under it (sections
   * arriving one by one push the element down). A scroll the person makes is
   * followed, never undone. While someone types in a step they use, the page
   * is never scrolled under them, and on a phone the card is the slim bar.
   */
  const measure = useCallback((why: 'show' | 'layout' | 'scroll') => {
    const el = target.current;
    const card = cardRef.current;
    if (!el || !card || !step || !stepKey) return;
    // Folded away or gone (a scroll alone never hides it: it is followed).
    if (!el.isConnected || (why !== 'scroll' && !isShown(el))) { dispatch({ type: 'lost' }); return; }
    const given = insetsRef.current;
    const vp = viewport((typeof given === 'function' ? given(el) : given) ?? {});
    const cardHeight = card.offsetHeight;
    if (slim) {
      const vv = window.visualViewport;
      const area = vv ? { top: vv.offsetTop, height: vv.height, width: vv.width } : { top: 0, height: vp.height, width: vp.width };
      const active = document.activeElement;
      const field = active && active !== document.body ? rectOf(active) : null;
      setPlacement(collapsedPlacement(spotFor(rectOf(el), vp), cardHeight, area, field));
      return;
    }
    const rect = rectOf(el);
    const firstLook = scrolledFor.current !== stepKey;
    // Moved without a scroll in between: the page changed shape around it.
    const pushed = why === 'layout' && lastTop.current !== null && Math.abs(rect.top - lastTop.current) > 1;
    if ((firstLook || pushed) && !(used && typing) && !pinned(el)) {
      const dy = scrollDelta(rect, cardHeight, vp, step.placement);
      if (dy !== 0) scrollAround(el, dy, !reducedMotion && firstLook);
    }
    scrolledFor.current = stepKey;
    lastTop.current = rectOf(el).top;
    setPlacement(placeTour(rectOf(el), cardHeight, vp, step.placement));
  }, [step, stepKey, reducedMotion, slim, used, typing]);

  useIsoLayoutEffect(() => {
    if (state.phase !== 'showing') {
      setPlacement(null);
      if (state.phase === 'closed') { scrolledFor.current = null; lastTop.current = null; }
      return undefined;
    }
    measure('show');
    const onScroll = () => measure('scroll');
    const onLayout = () => measure('layout');
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onLayout);
    // A phone's keyboard shrinks the visible area without resizing the window.
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onLayout);
    vv?.addEventListener('scroll', onScroll);
    const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(onLayout) : null;
    if (sizes) {
      if (target.current) sizes.observe(target.current);
      sizes.observe(document.body);
    }
    // The element was replaced (the page drew it again): find it again.
    const gone = new MutationObserver(() => {
      if (target.current && !target.current.isConnected) dispatch({ type: 'lost' });
    });
    gone.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onLayout);
      vv?.removeEventListener('resize', onLayout);
      vv?.removeEventListener('scroll', onScroll);
      sizes?.disconnect();
      gone.disconnect();
    };
  }, [state.phase, stepKey, measure]);

  // ── The click a step waits for ─────────────────────────────────────────
  useEffect(() => {
    const el = target.current;
    if (state.phase !== 'showing' || !waits || !el) return undefined;
    // Before the element's own handlers, which may open another page: the
    // tour has moved on (or ended) by the time that page draws.
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Node && el.contains(e.target)) dispatch({ type: 'clicked' });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [state.phase, stepKey, waits]);

  // ── Keyboard and focus ─────────────────────────────────────────────────
  const next = useCallback(() => dispatch({ type: 'next' }), []);
  const back = useCallback(() => dispatch({ type: 'back' }), []);
  const skip = useCallback(() => dispatch({ type: 'skip' }), []);
  const finish = useCallback(() => dispatch({ type: 'finish' }), []);
  const leave = useCallback(() => dispatch({ type: 'leave' }), []);

  // A step's own button: its callback, with the element and the ways on.
  const onAction = useCallback((action: TourStepAction) => {
    const el = target.current;
    if (!el || !step || !state.tourId) return;
    action.onSelect({ tourId: state.tourId, step, element: el, next, leave, stop });
  }, [step, state.tourId, next, leave, stop]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const inCard = !!t && !!cardRef.current?.contains(t);
      const action = tourKeyAction(e.key, {
        ownsKeys: ownsKeys(describe(t)),
        inCard,
        nothingFocused: !t || t === document.body || t === document.documentElement,
        used,
        waitsForClick: waits,
      });
      if (action === 'skip') { e.preventDefault(); skip(); }
      else if (action === 'next') { e.preventDefault(); next(); }
      else if (action === 'back') { e.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, used, waits, next, back, skip]);

  // The focus at every step: the element a step waits for a click on (Enter
  // clicks it), or the first text field of a step someone uses on a computer
  // (on a phone a focused field would fold the card into the slim bar before
  // its words are read); else the card's forward button, so Enter moves on
  // and a screen reader reads the new card.
  useEffect(() => {
    if (!isOpen) return;
    const el = target.current;
    if (state.phase === 'showing' && el) {
      if (waits) {
        const own = focusables(el)[0];
        if (own) { own.focus({ preventScroll: true }); return; }
      } else if (used && !phone) {
        const field = firstField(el);
        if (field) { field.focus({ preventScroll: true }); return; }
      }
    }
    const card = cardRef.current;
    const primary = card?.querySelector<HTMLElement>('[data-tour-primary]') ?? card?.querySelector<HTMLElement>('button');
    primary?.focus({ preventScroll: true });
    // Only when a step changes or shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, stepKey, state.phase, waits, used]);

  // Tab on the card: a read step keeps it inside the card (it is modal); a
  // used step goes on to the element.
  const onCardKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    if (!used) {
      const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    const el = target.current;
    const into = el ? focusables(el) : [];
    const to = tabLoop({ region: 'card', edge: edgeOf(focusables(e.currentTarget), document.activeElement) }, e.shiftKey);
    if (!to || into.length === 0) return;
    e.preventDefault();
    (to === 'target-first' ? into[0] : into[into.length - 1]).focus();
  }, [used]);

  // And from the element's own last control, back round to the card.
  useEffect(() => {
    const el = target.current;
    if (!used || state.phase !== 'showing' || !el) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const to = tabLoop({ region: 'target', edge: edgeOf(focusables(el), document.activeElement) }, e.shiftKey);
      const card = cardRef.current ? focusables(cardRef.current) : [];
      if (!to || card.length === 0) return;
      e.preventDefault();
      (to === 'card-first' ? card[0] : card[card.length - 1]).focus();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [used, state.phase, stepKey]);

  // ── What the app reads ──────────────────────────────────────────────────
  const current = useMemo<TourCurrent | null>(() => (
    isOpen && state.tourId && step
      ? {
          tourId: state.tourId,
          stepId: step.id,
          index: state.index,
          total: state.steps.length,
          phase: state.phase as 'locating' | 'showing',
          single: state.single,
        }
      : null
  ), [isOpen, state.tourId, step, state.index, state.steps.length, state.phase, state.single]);

  const record = useCallback((tourId: string): TourRecord | null | undefined => (
    Object.prototype.hasOwnProperty.call(known, tourId) ? known[tourId] : undefined
  ), [known]);

  const api = useMemo<TourApi>(() => ({
    start, startOnce, showMe, stop, current, record, loaded, open: isOpen,
  }), [start, startOnce, showMe, stop, current, record, loaded, isOpen]);

  return (
    <TourContext.Provider value={api}>
      {children}
      {step && state.phase !== 'closed' && (
        <TourOverlay
          step={step}
          index={state.index}
          total={state.steps.length}
          phase={state.phase}
          placement={placement}
          reducedMotion={reducedMotion}
          labels={words}
          onNext={next}
          onBack={back}
          onSkip={skip}
          onNotNow={finish}
          cardRef={cardRef}
          onKeyDown={onCardKey}
          zIndex={zIndex}
          done={says.done}
          variant={says.variant}
          actions={says.actions}
          onAction={onAction}
          compact={phone}
          slim={slim}
          single={state.single}
        />
      )}
    </TourContext.Provider>
  );
};

export default TourProvider;
