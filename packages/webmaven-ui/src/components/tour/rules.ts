/**
 * The tour's decisions, as plain functions so they are tested without a
 * browser: what a key does, how a step reaches its page, whether its
 * element is there, which saved record still counts. TourProvider only wires
 * them to the page.
 *
 * No runtime imports.
 */
import type {
  TourDefinition, TourLabels, TourOutcome, TourRecord, TourStatus, TourStep, TourStepAction, TourStore,
} from './types';

// ── Words ──────────────────────────────────────────────────────────────────

export const TOUR_LABELS: TourLabels = {
  next: 'Next',
  back: 'Back',
  skip: 'Skip tour',
  done: 'Done',
  later: 'Later',
  notNow: 'Not now',
  progress: (index, total) => `${index + 1} of ${total}`,
  opening: (screen) => (screen ? `Opening ${screen}…` : 'One moment…'),
};

/** What the element says about itself while its step is up. */
export interface TourStepState {
  /** It is done (a `later` step's Next). */
  done?: boolean;
  /** A primary action shows beside it: moving on is putting it off. */
  deferred?: boolean;
}

/**
 * The card's forward button: what it says and how loud it is, or null when
 * the step waits for a click instead. Later (quiet) while a `later` step's
 * element is not done, or while a primary action shows; else Next, or Done
 * on the last step.
 */
export function forwardButton(
  step: Pick<TourStep, 'waitFor' | 'later'>,
  last: boolean,
  labels: TourLabels = TOUR_LABELS,
  at: TourStepState = {},
): { label: string; tone: 'primary' | 'quiet' } | null {
  if (step.waitFor === 'click') return null;
  if ((step.later && !at.done) || at.deferred) return { label: labels.later, tone: 'quiet' };
  return { label: last ? labels.done : labels.next, tone: 'primary' };
}

/** What the card's forward button says, or null when the step waits for a click instead. */
export function forwardLabel(
  step: Pick<TourStep, 'waitFor' | 'later'>,
  last: boolean,
  labels: TourLabels = TOUR_LABELS,
  at: TourStepState = {},
): string | null {
  return forwardButton(step, last, labels, at)?.label ?? null;
}

/** The step's words for its element's variant, or its own. */
export function stepWords(step: Pick<TourStep, 'title' | 'body' | 'variants'>, variant: string | null | undefined): { title: string; body: string } {
  const v = variant ? step.variants?.[variant] : undefined;
  return { title: v?.title || step.title, body: v?.body || step.body };
}

// ── Records ────────────────────────────────────────────────────────────────

const STATUSES: readonly TourStatus[] = ['in_progress', 'skipped', 'done'];

/**
 * A record this tour version can use, or null. A record of another version
 * reads as never started, which is what lets a rewritten tour be offered
 * again; anything malformed reads the same.
 */
export function asTourRecord(raw: unknown, version: number): TourRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== version) return null;
  if (typeof r.status !== 'string' || !(STATUSES as readonly string[]).includes(r.status)) return null;
  if (typeof r.step !== 'string' || r.step === '') return null;
  if (typeof r.at !== 'string' || !Number.isFinite(Date.parse(r.at))) return null;
  return { v: version, status: r.status as TourStatus, step: r.step, at: r.at };
}

export function makeTourRecord(version: number, status: TourStatus, step: string, now: Date = new Date()): TourRecord {
  return { v: version, status, step, at: now.toISOString() };
}

/** Whether a tour's records go to the store (`persist: false`: kept for this page only). */
export function persists(def: Pick<TourDefinition, 'persist'>): boolean {
  return def.persist !== false;
}

/**
 * What a run saves as it closes: done and skipped as they are; left as in
 * progress (on the step after the one it left, where a later run picks up);
 * nothing for a pause (its in-progress record stands), an empty run or a
 * Show me run.
 */
export function closingSave(outcome: TourOutcome, single: boolean): TourStatus | null {
  if (single) return null;
  if (outcome === 'done' || outcome === 'skipped') return outcome;
  if (outcome === 'left') return 'in_progress';
  return null;
}

/** The one step a Show me run opens, or none when the tour has no such step. */
export function showMeSteps(steps: readonly TourStep[], stepId: string): TourStep[] {
  return steps.filter((s) => s.id === stepId).slice(0, 1);
}

/** A step's actions that apply to its element now; one whose `when` throws does not. */
export function actionsFor(step: Pick<TourStep, 'actions'>, element: HTMLElement): TourStepAction[] {
  return (step.actions ?? []).filter((a) => {
    try { return !a.when || a.when(element); } catch { return false; }
  });
}

/** A store that keeps records for this page only: for tests, and for an app with nowhere to save. */
export function memoryTourStore(seed: Record<string, TourRecord | null> = {}): TourStore {
  const data = new Map<string, TourRecord | null>(Object.entries(seed));
  return {
    async read(tourId: string) { return data.get(tourId) ?? null; },
    async write(tourId: string, record: TourRecord) { data.set(tourId, record); return record; },
  };
}

// ── Finding the element ────────────────────────────────────────────────────

const listOf = (v: string | readonly string[] | undefined): string[] =>
  (v === undefined ? [] : typeof v === 'string' ? [v] : [...v]).filter((a) => typeof a === 'string' && a !== '');

/** The anchors of a step, in the order they are tried. */
export function anchorsOf(step: Pick<TourStep, 'anchor'>): string[] {
  return listOf(step.anchor);
}

/** Every CSS selector a step's element is looked for with, in order: its anchors, then its selectors. */
export function targetSelectors(step: Pick<TourStep, 'anchor' | 'selector'>): string[] {
  return [...anchorsOf(step).map(anchorSelector), ...listOf(step.selector)];
}

/** The CSS selector of a data-tour value, quotes and backslashes escaped. */
export function anchorSelector(anchor: string): string {
  return `[data-tour="${anchor.replace(/["\\]/g, '\\$&')}"]`;
}

export type Arrival = 'go' | 'wait' | 'unreachable' | 'here';

/**
 * On the way to a step's page. `asked` is the page the app was on when the
 * provider asked it to open the step's page (null: not asked yet).
 *   here         on the step's page, or the step needs none: look for the element
 *   go           ask the app to open the page
 *   wait         asked; the app has not moved yet
 *   unreachable  asked, and the app went somewhere else (or cannot be asked): pass the step
 */
export function arrival(
  needs: string | undefined,
  page: string | undefined,
  asked: string | null | undefined,
  canAsk: boolean,
): Arrival {
  if (!needs || needs === page) return 'here';
  if (!canAsk) return 'unreachable';
  if (asked === null || asked === undefined) return 'go';
  return asked === (page ?? '') ? 'wait' : 'unreachable';
}

export type Lookup = 'found' | 'absent' | 'wait';

/**
 * On the step's page: its element is there (found), or the page has
 * finished loading without it (absent), or it is still loading (wait). A
 * step with no ready marker is there at once or not at all.
 */
export function lookup(targetPresent: boolean, readyMarkers: number, readyPresent: boolean): Lookup {
  if (targetPresent) return 'found';
  if (readyMarkers === 0 || readyPresent) return 'absent';
  return 'wait';
}

// ── Keyboard ───────────────────────────────────────────────────────────────

/** The focused element, as much of it as the keyboard rules read. */
export interface FocusedControl {
  tagName: string;
  type?: string | null;
  isContentEditable?: boolean;
  role?: string | null;
}

// A radio is not typed in, but its arrow keys move through its group: it keeps them.
const NOT_TYPING_INPUTS = new Set(['button', 'submit', 'reset', 'checkbox', 'image', 'file', 'hidden', 'color']);
const ARROW_ROLES = new Set([
  'textbox', 'searchbox', 'combobox', 'listbox', 'menu', 'menubar', 'radiogroup', 'radio', 'slider', 'spinbutton', 'tablist', 'tab', 'tree', 'grid',
]);

/**
 * The focused control uses the arrow keys and Escape itself: a field being
 * typed in, a list, a radio group. The tour's keys stand aside for it.
 */
export function ownsKeys(el: FocusedControl | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  if (el.isContentEditable) return true;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NOT_TYPING_INPUTS.has((el.type ?? 'text').toLowerCase());
  return !!el.role && ARROW_ROLES.has(el.role);
}

const KEYBOARD_INPUTS = new Set(['text', 'email', 'tel', 'url', 'search', 'number', 'password', 'time', 'date', 'datetime-local', 'month', 'week']);

/** A field that brings up a phone's on-screen keyboard (or its date and time pickers) while focused. */
export function opensKeyboard(el: FocusedControl | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  if (el.isContentEditable || tag === 'TEXTAREA') return true;
  return tag === 'INPUT' && KEYBOARD_INPUTS.has((el.type ?? 'text').toLowerCase());
}

export type TourKey = 'next' | 'back' | 'skip' | null;

/**
 * What a key press does to the tour. The arrow keys go forward and back,
 * Enter goes forward when nothing has the focus, and Escape ends the tour,
 * except while the focused control uses those keys. On a step the person
 * uses, Escape belongs to whatever has the focus in the page (a menu the
 * element opened): it ends the tour only from the card, or with nothing
 * focused. A step that waits for a click never moves forward by a key.
 */
export function tourKeyAction(
  key: string,
  at: { ownsKeys: boolean; inCard: boolean; nothingFocused: boolean; used: boolean; waitsForClick: boolean },
): TourKey {
  if (at.ownsKeys) return null;
  if (key === 'ArrowRight') return at.waitsForClick ? null : 'next';
  if (key === 'Enter') return at.nothingFocused && !at.waitsForClick ? 'next' : null;
  if (key === 'ArrowLeft') return 'back';
  if (key === 'Escape') return !at.used || at.inCard || at.nothingFocused ? 'skip' : null;
  return null;
}

export type TabSpot = 'card-first' | 'card-last' | 'target-first' | 'target-last';

/**
 * Tab on a step the person uses: the card is not modal, and Tab goes round
 * the card and the lit element, so the keyboard reaches what they are asked
 * to use. From the card's last control Tab goes to the element's first, and
 * from the element's last back to the card; Shift+Tab the other way. null:
 * the browser's own Tab (inside either one).
 */
export function tabLoop(from: { region: 'card' | 'target'; edge: 'first' | 'last' | 'both' | 'middle' }, shift: boolean): TabSpot | null {
  const leavesForward = !shift && (from.edge === 'last' || from.edge === 'both');
  const leavesBack = shift && (from.edge === 'first' || from.edge === 'both');
  if (from.region === 'card') {
    if (leavesForward) return 'target-first';
    if (leavesBack) return 'target-last';
    return null;
  }
  if (leavesForward) return 'card-first';
  if (leavesBack) return 'card-last';
  return null;
}
