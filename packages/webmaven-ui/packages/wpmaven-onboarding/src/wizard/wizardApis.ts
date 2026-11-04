import { useHost } from '../host/HostContext';
import type { WizardHost } from '../host/types';
import { createOnboardingApi, type OnboardingApi } from '../api/onboarding';
import { createStoreCurrencyApi, type StoreCurrencyApi } from '../api/storeCurrency';

/** The calls the wizard makes, on its host's transport. */
export interface WizardApis {
  onboarding: OnboardingApi;
  storeCurrency: StoreCurrencyApi;
}

const byTransport = new WeakMap<object, WizardApis>();

/**
 * The wizard's calls for a host. One instance per transport: a site's
 * session id lives in the onboarding api's memory, so every part of the
 * wizard must reach the same one. A host keeps its transport for the
 * wizard's life.
 */
export function wizardApisFor(host: Pick<WizardHost, 'transport' | 'identity'>): WizardApis {
  let apis = byTransport.get(host.transport);
  if (!apis) {
    const onboarding = createOnboardingApi(host.transport, host.identity);
    apis = { onboarding, storeCurrency: createStoreCurrencyApi(host.transport, onboarding) };
    byTransport.set(host.transport, apis);
  }
  return apis;
}

/** The wizard's calls, from the host it is rendered for. */
export function useWizardApis(): WizardApis {
  return wizardApisFor(useHost());
}
