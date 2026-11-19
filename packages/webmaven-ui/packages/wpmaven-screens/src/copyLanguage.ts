/**
 * The shared screens in the reader's language, so the dashboard and the
 * plugin read in the same language as the rest of the products, the setup
 * screens' pattern (@yotako/wpmaven-onboarding).
 *
 * English is the source and stays byte for byte what it was: each copy
 * module keeps its English object (`X_EN`, exported) and exports
 * `localized(X_EN, 'screens<Name>')` (webmaven-ui 0.12.1 or later), which
 * reads the page language's text from that language's catalog and the
 * English otherwise. A text is read when a screen draws, never kept from the
 * moment a module loaded. The catalogs are data, one JSON file per language
 * (src/i18n/fr.json, shipped as dist/i18n/fr.json), shaped
 * { "screens<Name>": { ...the English object's keys... } }: a text for a
 * text, a template ({0}, {1}... for the arguments) or plural forms
 * ({ "one", "other" }, picked by the first argument) for a function. Every
 * namespace starts with "screens", so these catalogs never collide with the
 * setup screens' or the dashboard's ("dash...") when a host merges them.
 * The host gives a catalog to addTranslations and sets the page's language.
 * French is written by hand; the other languages are made by a translation
 * script from the English and the French. Every copy module is listed in
 * src/__tests__/helpers/copyPairs.ts.
 */
import type { Language } from '@yotako/webmaven-ui';
import { getLanguage, localeTag } from '@yotako/webmaven-ui';

/**
 * The tag a module formatted dates and numbers with before (its hard-coded
 * 'en-US') on an English page, so English reads exactly as it did; the page
 * language's tag otherwise ("fr").
 */
export function formatTag(englishTag: string, lang: Language = getLanguage()): string {
  return lang === 'en' ? englishTag : localeTag(lang);
}

/**
 * A number in the page's language, with the options given; on an English
 * page, the text the module wrote before (`english`, its own formatting:
 * "1234.50" from toFixed(2)), so English reads exactly as it did.
 */
export function formatKept(
  n: number,
  english: (n: number) => string,
  options?: Intl.NumberFormatOptions,
  lang: Language = getLanguage(),
): string {
  return lang === 'en' ? english(n) : new Intl.NumberFormat(localeTag(lang), options).format(n);
}
