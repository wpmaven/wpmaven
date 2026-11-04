/**
 * The page's language in a component (lib/language): the component draws
 * again when the host changes it.
 */
import { useSyncExternalStore } from 'react';
import { getLanguage, onLanguageChange, type Language } from './language';

export function useLanguage(): Language {
  return useSyncExternalStore(onLanguageChange, getLanguage, getLanguage);
}
