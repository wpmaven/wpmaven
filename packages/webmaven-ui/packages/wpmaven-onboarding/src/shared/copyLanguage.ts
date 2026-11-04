/**
 * The setup screens in the reader's language (as many languages as a
 * script can produce).
 *
 * English is the source and stays byte for byte what it was: each copy
 * module keeps its English object (`X_EN`, exported) and exports
 * `localized(X_EN, '<namespace>')` (webmaven-ui), which reads the page
 * language's text from that language's catalog and the English otherwise.
 * The catalogs are data, one JSON file per language (src/i18n/fr.json,
 * shipped as dist/i18n/fr.json), shaped { "<namespace>": { ...the English
 * object's keys... } }: a text for a text, a template ({0}, {1}... for the
 * arguments) or plural forms ({ "one", "other" }, picked by the first
 * argument) for a function. The host gives a catalog to addTranslations and
 * sets the page's language (host.locale).
 *
 * src/i18n/budgets.json says, for every one-line label and clamped title,
 * how many characters fit at the narrowest width ("namespace.key": n,
 * measured in a real browser by the text-fit check): a translation longer than that
 * ends in an ellipsis (its full words in a title), so the translation script
 * asks for one that fits.
 */
import type { Language } from '@yotako/webmaven-ui';
import { getLanguage, localeTag } from '@yotako/webmaven-ui';

/**
 * The tag a module formatted with before (its hard-coded 'en-US' or
 * 'en-GB') on an English page, so English reads exactly as it did; the
 * page language's tag otherwise ("fr").
 */
export function formatTag(englishTag: string, lang: Language = getLanguage()): string {
  return lang === 'en' ? englishTag : localeTag(lang);
}
