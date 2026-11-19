/**
 * "Site languages" on the confirm step (multilingual sites, design 9,
 * phase 6): the line, the Change panel and the question of an unclear
 * place, in the page's language (namespace "siteLanguages"). Each language
 * is named in the page's language with its own name beside it ("Catalan
 * (Català)"). Pure, so the tests read the same words.
 *
 * Notes for the translator: "main language" is the language the site opens
 * in, at its own address; the others have an address of their own. A
 * "local business" is any business of the place, not only a shop.
 */
import { localeTag, localized } from '@yotako/webmaven-ui';
import type { DecidedSiteLanguage, SiteLanguagesState } from '../../../host/types';

export const SITE_LANGUAGES_COPY_EN = {
  /** The line: "Site languages: Spanish (Español), main · Catalan (Català)". {0} lists the languages. */
  line: (names: string) => `Site languages: ${names}`,
  /** After the main language's name on the line and in the panel. */
  main: 'main',
  change: 'Change',
  panelTitle: 'Your site\'s languages',
  panelLead: 'Your site opens in its main language. Each other language has its own address, and visitors switch on every page.',
  /** The preview shows the main language; the others are written when the site goes live. */
  afterPublish: 'The preview shows your main language. Your other languages are written right after you publish.',
  mainLabel: 'Main language',
  makeMain: 'Make main',
  requiredByLaw: 'Required by law here',
  firstByLaw: 'The law puts it first here',
  /** Why a language is on the list. */
  reasons: {
    main: 'The language of local businesses here',
    usual: 'Many local businesses here add it',
    national: 'The country\'s national language',
    owner: 'You wrote your description in it',
    requested: 'You asked for it',
    added: 'You added it',
    abroad: 'You sell abroad',
    tourism: 'You serve visitors',
    expat: 'You serve foreign residents',
    border: 'You serve customers from across the border',
    minority: 'You serve a local community that speaks it',
    shop: 'Online shops here add it',
    domain: 'Your web address uses it',
    place: 'Usual here',
  },
  /** An offered language: {0} is a share such as "9%". */
  offered: (share: string) => `Offered by ${share} of local businesses here`,
  offeredPlain: 'Some local businesses here add it',
  /** A small or low-resource language: written by machine translation. */
  check: 'A native speaker should read it',
  addAnother: 'Add another language',
  add: 'Add',
  /** {0} is the most languages a site can have. */
  limit: (max: string) => `A site can have up to ${max} languages.`,
  save: 'Save languages',
  cancel: 'Cancel',
  saving: 'Saving your languages…',
  failed: 'Your languages did not change. Please try again.',
  /** The API's refusals, by code; {0} names the language. */
  refused: {
    locked: (name: string) => `${name} stays: the law requires it here.`,
    mainLocked: (name: string) => `${name} stays your main language: the law puts it first here.`,
    blocked: (name: string) => `${name} cannot be added here: the law does not allow it.`,
    unknown: 'Choose languages from the list.',
    none: 'Choose at least one language.',
  },
  /** The question of a place the rule table cannot settle, with several answers. */
  question: 'In which languages should your site speak to your customers?',
  questionLead: 'Choose one or more. Pick the main one: your site opens in it.',
  questionContinue: 'Continue',
  chooseFirst: 'Choose your site\'s languages above to continue.',
};

export const SITE_LANGUAGES_COPY = localized(SITE_LANGUAGES_COPY_EN, 'siteLanguages');

/** A language's name in the page's language ("Catalan", "catalán"), the tag itself when the browser cannot name it. */
export function screenName(tag: string): string {
  try {
    const name = new Intl.DisplayNames(localeTag(), { type: 'language' }).of(tag) ?? tag;
    return name ? name.charAt(0).toLocaleUpperCase(localeTag()) + name.slice(1) : tag;
  } catch {
    return tag;
  }
}

/** A language's name in itself ("Català", "English"). */
export function ownName(tag: string): string {
  if (tag === 'ca-ES-valencia') return 'Valencià';
  try {
    const base = tag.split('-')[0];
    const named = new Intl.DisplayNames([tag], { type: 'language' }).of(base === 'zh' ? tag : base) ?? tag;
    return named ? named.charAt(0).toLocaleUpperCase(tag) + named.slice(1) : tag;
  } catch {
    return tag;
  }
}

/**
 * "Catalan (Català)" in the page's language with the language's own name
 * beside it; one name when the page's name already says it ("British
 * English", never "British English (English)").
 */
export function bothNames(tag: string): string {
  const screen = screenName(tag);
  const own = ownName(tag);
  return own && !screen.toLocaleLowerCase().includes(own.toLocaleLowerCase()) ? `${screen} (${own})` : screen;
}

/** Why a language of the decision is on the site, in the page's language (null for the main language without one). */
export function reasonOf(lang: Pick<DecidedSiteLanguage, 'origin' | 'locked'> | null | undefined, opts: { added?: boolean } = {}): string | null {
  const R = SITE_LANGUAGES_COPY.reasons;
  if (opts.added) return R.added;
  if (!lang) return null;
  if (lang.locked) return SITE_LANGUAGES_COPY.requiredByLaw;
  const origin = String(lang.origin || '');
  if (origin.startsWith('trigger:')) {
    const fact = origin.slice(8) as keyof typeof R;
    return fact in R ? R[fact] : R.usual;
  }
  switch (origin) {
    case 'main':
    case 'default': return R.main;
    case 'always': return R.usual;
    case 'national': return R.national;
    case 'owner': return R.owner;
    case 'requested': return R.requested;
    case 'owner_added': return R.added;
    default: return null;
  }
}

/** An offered language's line: its share among local businesses when measured, else a plain line. */
export function offeredLine(share: { offered?: number; n?: number } | null | undefined): string {
  const offered = typeof share?.offered === 'number' && share.offered > 0 && share.offered <= 1 ? share.offered : null;
  if (offered === null) return SITE_LANGUAGES_COPY.offeredPlain;
  const pct = new Intl.NumberFormat(localeTag(), { style: 'percent', maximumFractionDigits: 0 }).format(offered);
  return SITE_LANGUAGES_COPY.offered(pct);
}

/** The line's list: each language with both names, the main one marked. */
export function lineText(state: Pick<SiteLanguagesState, 'chosen' | 'main'>): string {
  const names = state.chosen.map((tag) => (tag === state.main ? `${bothNames(tag)}, ${SITE_LANGUAGES_COPY.main}` : bothNames(tag)));
  return SITE_LANGUAGES_COPY.line(names.join(' · '));
}

/** The API's refusal in the page's language (its code and the language it names). */
export function refusalText(code: string | null | undefined, tag?: string | null, max = 4): string {
  const F = SITE_LANGUAGES_COPY.refused;
  const name = tag ? bothNames(tag) : '';
  switch (code) {
    case 'LOCKED': return name ? F.locked(name) : SITE_LANGUAGES_COPY.failed;
    case 'MAIN_LOCKED': return name ? F.mainLocked(name) : SITE_LANGUAGES_COPY.failed;
    case 'BLOCKED': return name ? F.blocked(name) : SITE_LANGUAGES_COPY.failed;
    case 'LIMIT': return SITE_LANGUAGES_COPY.limit(String(max));
    case 'UNKNOWN_LANGUAGE': return F.unknown;
    case 'NO_LANGUAGE': return F.none;
    default: return SITE_LANGUAGES_COPY.failed;
  }
}

/** The question still waits for the owner's answer (719 A). */
export function questionOpen(state: SiteLanguagesState | null | undefined): boolean {
  return !!state?.decision?.question && state.questionAnswered !== true;
}
