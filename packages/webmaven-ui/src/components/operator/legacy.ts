import type { OperatorPresence } from './OperatorAvatar';

/**
 * The onboarding wizard's portrait states. Kept so the wizard (and its
 * published types) keep their vocabulary; a screen built today passes an
 * OperatorPresence instead.
 */
export type OperatorState = 'still' | 'idle' | 'entering' | 'speaking' | 'working';

/** speaking and working turn the arc; entering, idle and still are a still portrait. */
export function presenceFromState(state: OperatorState | undefined): OperatorPresence {
  return state === 'working' || state === 'speaking' ? 'working' : 'still';
}
