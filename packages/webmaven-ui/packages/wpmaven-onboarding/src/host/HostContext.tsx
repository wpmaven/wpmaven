import { createContext, useContext, type ReactNode } from 'react';
import type { WizardHost } from './types';

/** The host of the wizard being rendered (exported for the node tests' hook harness). */
export const HostContext = createContext<WizardHost | null>(null);

/** Makes the host reachable from every part of the wizard (OnboardingWizard renders it). */
export function HostProvider({ host, children }: { host: WizardHost; children: ReactNode }) {
  return <HostContext.Provider value={host}>{children}</HostContext.Provider>;
}

/** The host of the wizard being rendered. Throws outside OnboardingWizard. */
export function useHost(): WizardHost {
  const host = useContext(HostContext);
  if (!host) throw new Error('The onboarding wizard needs a host: render it through <OnboardingWizard host={...} />.');
  return host;
}

/** The host when there is one: the shared components also render outside the wizard (the dashboard's other screens). */
export function useOptionalHost(): WizardHost | null {
  return useContext(HostContext);
}
