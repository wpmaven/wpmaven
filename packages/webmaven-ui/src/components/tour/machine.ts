/**
 * The tour as a state machine, with no timers in it.
 *
 * Only two things move a tour: the person (next, back, skip, a click on the
 * element a step waits for, a step's action that leaves to do the thing
 * now) and the screen (the element turned up, or the
 * page finished loading without it). Nothing advances on a clock, so a step
 * never arrives before its screen has settled and never leaves before it
 * was read.
 *
 *   closed    not on screen
 *   locating  on the way to a step: its page is opening, or loading
 *   showing   the step's element is lit and the card is up
 *
 * No runtime imports: the unit tests drive this directly.
 */
import type { TourOutcome, TourStep } from './types';

export type TourPhase = 'closed' | 'locating' | 'showing';

export interface TourMachineState {
  phase: TourPhase;
  /** The tour this run belongs to (kept once closed, for its outcome). */
  tourId: string | null;
  /** The steps still in this run; a step found absent is removed. */
  steps: readonly TourStep[];
  index: number;
  /** Which way the person was going, so an absent step is passed that way. */
  dir: 1 | -1;
  /** A step of this run has been on screen: an empty run saves nothing. */
  shown: boolean;
  outcome: TourOutcome | null;
  /** The run ended on the click its last step waited for. */
  clicked: boolean;
  /** A Show me run: one step on its own, which saves nothing. */
  single: boolean;
}

export type TourAction =
  | { type: 'open'; tourId: string; steps: readonly TourStep[]; startAt?: string | null; single?: boolean }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'skip' }
  /** The element a waitFor step waits for was clicked. */
  | { type: 'clicked' }
  /** The last step that waits for a click, closed without it. */
  | { type: 'finish' }
  | { type: 'found' }
  | { type: 'lost' }
  | { type: 'absent' }
  | { type: 'pause' }
  /** A step's action went to do the thing now: the run closes on the step after it. */
  | { type: 'leave' };

export const CLOSED: TourMachineState = {
  phase: 'closed', tourId: null, steps: [], index: 0, dir: 1, shown: false, outcome: null, clicked: false, single: false,
};

function close(state: TourMachineState, outcome: TourOutcome): TourMachineState {
  // Nothing was ever on screen: the run leaves no trace.
  const final = state.shown || outcome === 'skipped' || outcome === 'paused' || outcome === 'left' ? outcome : 'empty';
  return { ...state, phase: 'closed', outcome: final };
}

export function tourReducer(state: TourMachineState, action: TourAction): TourMachineState {
  switch (action.type) {
    case 'open': {
      // One tour at a time: a second start is ignored while one is up.
      if (state.phase !== 'closed') return state;
      const single = !!action.single;
      if (action.steps.length === 0) return { ...CLOSED, tourId: action.tourId, outcome: 'empty', single };
      const at = action.startAt ? action.steps.findIndex((s) => s.id === action.startAt) : 0;
      return {
        phase: 'locating',
        tourId: action.tourId,
        steps: action.steps,
        index: at >= 0 ? at : 0,
        dir: 1,
        shown: false,
        outcome: null,
        clicked: false,
        single,
      };
    }
    case 'next': {
      if (state.phase === 'closed') return state;
      if (state.index >= state.steps.length - 1) return close(state, 'done');
      return { ...state, phase: 'locating', index: state.index + 1, dir: 1 };
    }
    case 'clicked': {
      if (state.phase !== 'showing' || state.steps[state.index]?.waitFor !== 'click') return state;
      if (state.index >= state.steps.length - 1) return { ...close(state, 'done'), clicked: true };
      return { ...state, phase: 'locating', index: state.index + 1, dir: 1 };
    }
    case 'finish':
      return state.phase === 'closed' ? state : close(state, 'done');
    case 'back': {
      if (state.phase === 'closed' || state.index === 0) return state;
      return { ...state, phase: 'locating', index: state.index - 1, dir: -1 };
    }
    case 'skip':
      return state.phase === 'closed' ? state : close(state, 'skipped');
    case 'pause':
      return state.phase === 'closed' ? state : close(state, 'paused');
    case 'leave':
      // The index moves to the next step, so what is saved (and where a later
      // run picks up) is what comes after this one; the last stays where it is.
      if (state.phase === 'closed') return state;
      return close({ ...state, index: Math.min(state.index + 1, state.steps.length - 1) }, 'left');
    case 'found':
      return state.phase === 'locating' ? { ...state, phase: 'showing', shown: true } : state;
    case 'lost':
      return state.phase === 'showing' ? { ...state, phase: 'locating' } : state;
    case 'absent': {
      if (state.phase !== 'locating') return state;
      const steps = state.steps.filter((_, i) => i !== state.index);
      if (steps.length === 0) return close({ ...state, steps, index: 0 }, 'done');
      if (state.dir === 1) {
        // The next step slid into this index. Past the end: the tour is over.
        if (state.index >= steps.length) return close({ ...state, steps, index: steps.length - 1 }, 'done');
        return { ...state, steps, phase: 'locating' };
      }
      // Going back and the first step is gone: go forward to what is left.
      if (state.index === 0) return { ...state, steps, index: 0, dir: 1, phase: 'locating' };
      return { ...state, steps, index: state.index - 1, phase: 'locating' };
    }
    default:
      return state;
  }
}

export function currentStep(state: TourMachineState): TourStep | null {
  return state.phase === 'closed' ? null : state.steps[state.index] ?? null;
}
