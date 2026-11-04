/**
 * The React context the wizard's state and actions travel in, on its own so
 * a card the rest of the dashboard also draws (BuildLimitCard, from the
 * shared entry) can read the wizard when it is inside one without bringing
 * the whole provider (OnboardingContext.tsx) along.
 */
import { createContext, useContext } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const OnboardingStateContext = createContext<any>(null);

/** The wizard's state when drawn inside it, else null (a shared card drawn on its own). */
export function useOptionalOnboarding() {
  return useContext(OnboardingStateContext);
}
