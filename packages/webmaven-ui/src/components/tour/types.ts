/**
 * The guided tour's shapes, shared by the engine and the apps (0.9.0;
 * actions, variants, the phone's slim bar, insets, Show me and tours that
 * save nothing in 0.10.0).
 *
 * Each app keeps its steps and its storage: the kit draws the tour, moves
 * through it and asks the app's TourStore to read and write how far someone
 * got. No runtime code here.
 */

/** Where the card goes first; it takes the next side that fits when it does not. */
export type TourPlacementSide = 'auto' | 'below' | 'above' | 'right' | 'left';

/** Other words for a step, for the variant its element reads as (TourProvider's `variantOf`). */
export interface TourStepVariant {
  title?: string;
  body?: string;
}

/** What a step's action is given when it is pressed. */
export interface TourActionContext {
  tourId: string;
  step: TourStep;
  /** The step's element, as it was found on screen. */
  element: HTMLElement;
  /** Moves on, as the forward button does. */
  next: () => void;
  /**
   * Closes the tour to go and do the thing now (outcome 'left'). The
   * progress saved is the step after this one, where a later run picks up.
   */
  leave: () => void;
  /** Closes the tour, its progress kept (outcome 'paused'). */
  stop: () => void;
}

/** A button a step adds to its card, before the forward one ("Set it up now"). */
export interface TourStepAction {
  key: string;
  label: string;
  /**
   * primary: the positive way on, and the forward button then reads Later
   * (quiet), since moving on is putting it off. quiet (default): an outline
   * button beside Next.
   */
  tone?: 'primary' | 'quiet';
  /**
   * Shown only while this says yes, asked with the step's element when it
   * shows and again whenever the element's attributes change. Default: always.
   */
  when?: (element: HTMLElement) => boolean;
  onSelect: (ctx: TourActionContext) => void;
  testId?: string;
}

export interface TourStep {
  /** Unique inside its tour: it is what the saved record names. */
  id: string;
  /**
   * The element the step explains, by its `data-tour` value. Several: the
   * first one on screen wins (the sidebar's entry, else the top bar's).
   */
  anchor?: string | readonly string[];
  /**
   * The element by CSS selectors instead (or as well: tried after the
   * anchors), for an element the app cannot give a `data-tour` value.
   */
  selector?: string | readonly string[];
  title: string;
  /** One or two short sentences, in the owner's words. */
  body: string;
  /** The side the card goes first (default 'auto': below, above, right, then left). */
  placement?: TourPlacementSide;
  /**
   * 'click': the step waits for a click on its element and moves on with it.
   * The element takes clicks while the step is up, and the card has no Next.
   * On the last step the click finishes the tour (TourEnd.clicked).
   */
  waitFor?: 'click';
  /**
   * The page the step needs, in the app's own words ('home', '/team').
   * When the app's `page` is another one, the provider asks onNeedPage to
   * open it and looks for the element once it is there.
   */
  page?: string;
  /** The page's name for the card while it opens: "Opening {screen}…". */
  screen?: string;
  /**
   * CSS selectors present once the page has loaded. With one of them on
   * screen and none of the anchors, the step has nothing to show here and
   * is passed. Without any, the element is there at once or not at all.
   */
  ready?: readonly string[];
  /**
   * The element is used, not only read: it takes clicks and typing while
   * the step is up, and the card is not modal. A step that waits for a
   * click is always used. On a computer the focus goes to the element's
   * first text field.
   */
  interactive?: boolean;
  /**
   * The forward button reads Later (quiet) until the element says it is done
   * (TourProvider's `doneOf`: its `data-tour-done` by default), then Next
   * (or Done) with `doneText` said on the card. Later always moves on: the
   * tour never waits for the person.
   */
  later?: boolean;
  /** Said once the element is done ("Saved"). */
  doneText?: string;
  /** Other words for the same step, by the variant its element reads as. */
  variants?: Readonly<Record<string, TourStepVariant>>;
  /** Buttons the card adds before the forward one, each with its own callback. */
  actions?: readonly TourStepAction[];
}

export interface TourDefinition {
  /** The app's name for the tour: what the store files the record under. */
  id: string;
  /**
   * Bumped when the tour changes enough to be offered again: a record of
   * another version reads as never started.
   */
  version: number;
  steps: readonly TourStep[];
  /**
   * false: the tour saves nothing. Its record is never read from or written
   * to the store, and lasts as long as the page: a short tour that must not
   * count as the real one (offered before a plan, say).
   */
  persist?: boolean;
}

export type TourStatus = 'in_progress' | 'skipped' | 'done';

/** How far someone got in one tour: what the store keeps. */
export interface TourRecord {
  /** The tour's version when it was written. */
  v: number;
  status: TourStatus;
  /** The step it was on (the last one shown when it ended). */
  step: string;
  /** ISO time; a store that stamps its own sends its own back. */
  at: string;
}

/**
 * Where an app keeps the records, one per tour and per person: the plugin's
 * user meta, the dashboard's account. Both calls are async and may fail:
 * a read that fails leaves the tour unknown (it never starts by itself), a
 * write that fails is dropped (the tour goes on).
 */
export interface TourStore {
  /** The saved record, or null when this person never started the tour. */
  read(tourId: string): Promise<TourRecord | null>;
  /** Saves the record; may answer with the record as it was stored. */
  write(tourId: string, record: TourRecord): Promise<TourRecord | null | void>;
}

/**
 * How a tour closed:
 *   done     the last step's Done (or its click), or nothing left after it
 *   skipped  Skip tour, or Escape
 *   paused   the app stopped it, or its page was left while a step was up
 *   left     a step's action went to do the thing now: the progress saved is
 *            the step after it
 *   empty    none of its steps had anything to show: nothing is saved
 */
export type TourOutcome = 'done' | 'skipped' | 'paused' | 'left' | 'empty';

/** What onEnd is told when a tour closes. */
export interface TourEnd {
  tourId: string;
  outcome: TourOutcome;
  /** The step it closed on (null for an empty tour; for 'left', the step after the one it left). */
  stepId: string | null;
  /** The last step waited for a click on its element, and got it. */
  clicked: boolean;
  /**
   * A Show me run: one step on its own, which saved nothing. Always set by
   * the engine; optional so an end built by hand (a test) needs no change.
   */
  single?: boolean;
}

/** The tour on screen, as useTour() tells it. */
export interface TourCurrent {
  tourId: string;
  stepId: string;
  /** 0-based. */
  index: number;
  total: number;
  /** locating: its page is opening or loading; showing: the element is lit. */
  phase: 'locating' | 'showing';
  /** A Show me run (one step on its own). */
  single: boolean;
}

export interface TourStartOptions {
  /** Open at this step instead of the first. */
  at?: string;
  /**
   * This run's steps instead of the definition's: worked out when it opens,
   * from what the account has now (a step only some accounts get).
   */
  steps?: readonly TourStep[];
}

export interface TourShowMeOptions {
  /** Where the step is looked for, instead of the definition's steps. */
  steps?: readonly TourStep[];
}

export interface TourApi {
  /** Opens a tour (ignored while another one is on screen). */
  start: (tourId: string, options?: TourStartOptions) => void;
  /**
   * Opens a tour only for someone who never started it: it waits for the
   * record, and does nothing when the record could not be read.
   */
  startOnce: (tourId: string, options?: TourStartOptions) => void;
  /**
   * One step of a tour on its own ("Show me"): no progress, no Skip tour,
   * and nothing saved (ignored while another tour is on screen).
   */
  showMe: (tourId: string, stepId: string, options?: TourShowMeOptions) => void;
  /** Closes the tour on screen; its progress is kept (outcome 'paused'). */
  stop: () => void;
  current: TourCurrent | null;
  /** The saved record: undefined while it is read or when it could not be, null when never started. */
  record: (tourId: string) => TourRecord | null | undefined;
  /** Every tour's record has been read, or could not be. */
  loaded: boolean;
  open: boolean;
}

/** The engine's words. English by default; an app passes its own. */
export interface TourLabels {
  next: string;
  back: string;
  skip: string;
  done: string;
  /** The forward button of a step put off for now (a `later` step, or one with a primary action). */
  later: string;
  /** The last step that waits for a click: closing it without the click. */
  notNow: string;
  /** "2 of 7". */
  progress: (index: number, total: number) => string;
  /** The card while a step's page opens. */
  opening: (screen: string | null) => string;
}

/**
 * Bands the tour keeps clear of, in px from the screen's edges: `top`, a
 * sticky header (an element scrolled to stays below it); `bottom`, a
 * floating button (the card stays above it).
 */
export interface TourInsets {
  top?: number;
  bottom?: number;
}
