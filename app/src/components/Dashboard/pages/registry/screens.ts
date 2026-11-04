import { CORE_SCREENS } from './core.screens';
import { EDITOR_SCREENS } from './editor.screens';
import { ONBOARDING_SCREENS } from './onboarding.screens';
import { PARITY_SCREENS } from './parity.screens';
import { STORE_SCREENS } from './store.screens';
import type { PageScreens } from './types';

/** The component of every page id, from every workstream's file. */
export const PAGE_SCREENS: PageScreens = {
  ...CORE_SCREENS,
  ...EDITOR_SCREENS,
  ...STORE_SCREENS,
  ...PARITY_SCREENS,
  ...ONBOARDING_SCREENS,
};
