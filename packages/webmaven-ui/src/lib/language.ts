/**
 * The reader's language (the visitor's own language, as many languages
 * worldwide as possible): one
 * small helper for every package that draws owner text (the kit, the setup
 * screens, the shared screens, the dashboard and the plugin).
 *
 * English is the source. Other languages are data: one catalog per language
 * and package ({ namespace: { key: text } }), made by a translation script
 * from the English and loaded on demand (addTranslations). A text a language
 * does not have yet reads in English, never blank. One language per page,
 * kept here and set by the host (the reader's pick, else the account's, else
 * the browser's). No outside library: the plugin's zip stays under its limit.
 *
 * Copy objects stay what they are; `localized(EN, 'publish')` returns an
 * object that reads the page language's text where its catalog has one and
 * the English otherwise, so `COPY.title` and `COPY.line(3)` work unchanged,
 * and a page that never sets a language reads exactly as before. A function
 * in English reads a template in a catalog: its arguments fill {0}, {1}...,
 * and plural forms ({ one, other }) pick by the first argument.
 */

/** A language as the screens name it: "en", "fr", "zh-Hans", "pt-BR". */
export type Language = string;

/**
 * The languages that keep their region or script, because their written form
 * differs: Chinese in simplified or traditional characters, Portuguese of
 * Brazil or Portugal. Every other language is its two- or three-letter code.
 */
const VARIANTS: Record<string, (rest: string[]) => string> = {
  zh: (rest) => (rest.some((p) => /^(hant|tw|hk|mo)$/i.test(p)) ? 'zh-Hant' : 'zh-Hans'),
  pt: (rest) => (rest.some((p) => /^pt$/i.test(p)) ? 'pt-PT' : 'pt-BR'),
};

/**
 * Codes browsers still send that name a language the screens call otherwise:
 * Norwegian ("no", and Nynorsk "nn", read in Bokmål), the old codes of
 * Hebrew ("iw") and Indonesian ("in"), and Tagalog ("tl") read as Filipino.
 */
const ALIASES: Record<string, string> = { no: 'nb', nn: 'nb', iw: 'he', in: 'id', tl: 'fil' };

/** Languages written right to left. */
const RIGHT_TO_LEFT = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb']);

/** Languages the page may be set to: English, plus every language with a catalog or announced by the host. */
const available = new Set<string>(['en']);
/** language -> namespace -> texts */
const catalogs = new Map<string, Record<string, unknown>>();

let current: Language = 'en';
const listeners = new Set<() => void>();

/** The two-letter code of a language tag ("fr-FR", "fr_FR", "FR" read "fr"); null when it is none. */
export function languageCode(tag: string | null | undefined): string | null {
  const m = /^\s*([a-z]{2,3})(?:[-_][a-z0-9]+)*\s*$/i.exec(tag ?? '');
  return m ? m[1].toLowerCase() : null;
}

/** A tag as the screens name the language ("zh-TW" reads "zh-Hant", "pt" "pt-BR", "fr-CA" "fr", "no" "nb"); null when it is none. */
export function languageOf(tag: string | null | undefined): Language | null {
  const code = languageCode(tag);
  if (!code) return null;
  const rest = String(tag).trim().split(/[-_]/).slice(1);
  return VARIANTS[code] ? VARIANTS[code](rest) : ALIASES[code] ?? code;
}

/** Is the page allowed to be in this language (English, or a language with texts)? */
export function isLanguage(tag: string | null | undefined): boolean {
  const lang = languageOf(tag);
  return !!lang && available.has(lang);
}

/** The languages the page may be set to now, English first. */
export function availableLanguages(): Language[] {
  return ['en', ...[...available].filter((l) => l !== 'en').sort()];
}

/**
 * Announce languages whose catalogs can be loaded (the host's list), so a
 * browser asking for one picks it before its texts have arrived.
 */
export function announceLanguages(tags: readonly string[]): void {
  for (const tag of tags) {
    const lang = languageOf(tag);
    if (lang) available.add(lang);
  }
}

/** Add a language's texts ({ namespace: { key: text } }); later additions win key by key. */
export function addTranslations(tag: string, catalog: Record<string, unknown>): void {
  const lang = languageOf(tag);
  if (!lang || lang === 'en' || !catalog || typeof catalog !== 'object') return;
  available.add(lang);
  catalogs.set(lang, { ...(catalogs.get(lang) ?? {}), ...catalog });
  if (lang === current) for (const fn of [...listeners]) fn();
}

/** Does the language have texts loaded? */
export function hasTranslations(tag: string | null | undefined): boolean {
  const lang = languageOf(tag);
  return !!lang && catalogs.has(lang);
}

/**
 * The first candidate the page may be in, in the order given (the reader's
 * pick, the account's language, then the browser's list), else English. A
 * list (navigator.languages) counts in its own order.
 */
export function pickLanguage(...candidates: Array<string | null | undefined | readonly string[]>): Language {
  for (const c of candidates) {
    for (const tag of Array.isArray(c) ? c : [c]) {
      const lang = languageOf(tag as string | null | undefined);
      if (lang && available.has(lang)) return lang;
    }
  }
  return 'en';
}

/** The page's language. */
export function getLanguage(): Language {
  return current;
}

/** Set the page's language (any tag; one the page may not be in reads English). */
export function setLanguage(tag: string | null | undefined): void {
  const next = pickLanguage(tag);
  if (next === current) return;
  current = next;
  for (const fn of [...listeners]) fn();
}

/** Be told when the page's language or its texts change; returns the way to stop. */
export function onLanguageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** "rtl" for a language written right to left, else "ltr". */
export function textDirection(lang: Language = current): 'ltr' | 'rtl' {
  return RIGHT_TO_LEFT.has(languageCode(languageOf(lang)) ?? '') ? 'rtl' : 'ltr';
}

/** The tag amounts and dates are formatted with ("fr", "zh-Hans", English as "en-US"). */
export function localeTag(lang: Language = current): string {
  return lang === 'en' ? 'en-US' : lang;
}

type Plain = Record<string | symbol, unknown>;
const isPlainObject = (v: unknown): v is Plain =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** The other languages' versions of a copy object: any part may be missing. */
export type Translations<T> = Partial<Record<string, DeepPartial<T>>>;
export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T | string | PluralForms
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

const isPluralForms = (v: unknown): v is PluralForms => isPlainObject(v) && typeof v.other === 'string';

/** The positional places of a call: {0}, {1}... */
const placesOf = (args: unknown[]): Record<string, string | number> =>
  Object.fromEntries(args.map((a, i) => [String(i), typeof a === 'number' ? formatNumber(a) : String(a)]));

/** A catalog's text for an English function: a template, or plural forms picked by the first argument. */
function templateFor(text: string | PluralForms): (...args: unknown[]) => string {
  return (...args: unknown[]) => {
    if (typeof text === 'string') return fill(text, placesOf(args));
    const n = Number(args[0]);
    const rule = new Intl.PluralRules(localeTag()).select(Number.isFinite(n) ? n : 0) as keyof PluralForms;
    return fill(text[rule] ?? text.other, { ...placesOf(args), n: placesOf(args)['0'] ?? '' });
  };
}

/** The translation of one property, read against its English value. */
function translated(base: unknown, value: unknown): unknown {
  if (value === undefined || value === null) return base;
  if (typeof base === 'function') {
    if (typeof value === 'function') return value;
    if (typeof value === 'string' || isPluralForms(value)) return templateFor(value);
    return base;
  }
  if (typeof base === 'string') return typeof value === 'string' ? value : base;
  if (Array.isArray(base)) return Array.isArray(value) && value.length === base.length ? value : base;
  return typeof value === typeof base ? value : base;
}

/**
 * A copy object that reads in the page's language: each property is the
 * translation's when its catalog has one, the English one otherwise. The
 * texts come from the catalogs (`localized(EN, 'publish')`, namespace
 * 'publish') or from an object of languages (`localized(EN, { fr: FR })`).
 * Nested plain objects read the same way.
 */
export function localized<T extends object>(en: T, source: string | Translations<T>): T {
  const nested = new Map<string, Map<string | symbol, unknown>>();
  const textsFor = (lang: string): Plain | undefined => {
    const t = typeof source === 'string' ? catalogs.get(lang)?.[source] : (source as Record<string, unknown>)[lang];
    return isPlainObject(t) ? t : undefined;
  };
  return new Proxy(en, {
    get(target, key, receiver) {
      const base = Reflect.get(target, key, receiver);
      if (current === 'en' || typeof key === 'symbol') return base;
      const texts = textsFor(current);
      const value = texts ? texts[key] : undefined;
      if (isPlainObject(base)) {
        if (!isPlainObject(value)) return base;
        let cache = nested.get(current);
        if (!cache) nested.set(current, (cache = new Map()));
        // Cached per language; a catalog added later is read through the same nested proxy.
        if (!cache.has(key)) cache.set(key, localized(base, { [current]: value } as Translations<typeof base>));
        return cache.get(key);
      }
      return translated(base, value);
    },
  });
}

/** A sentence with its {name} places filled; a place without a value stays as written. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in values ? String(values[name]) : all));
}

/** The plural forms of a word or sentence; `other` is required, the rest as the language needs. */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/**
 * The form for n in the page's language, with {n} filled in its own
 * number format. French counts 0 and 1 as one ("0 commande"), English only 1.
 */
export function plural(n: number, forms: PluralForms, lang: Language = current): string {
  const rule = new Intl.PluralRules(localeTag(lang)).select(n) as keyof PluralForms;
  const text = forms[rule] ?? forms.other;
  return fill(text, { n: formatNumber(n, undefined, lang) });
}

/** A number in the page's language ("1,234.5"; French "1 234,5"). */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions, lang: Language = current): string {
  return new Intl.NumberFormat(localeTag(lang), options).format(n);
}

/** An amount in its currency, in the page's language ("$39"; French "39 $US"). */
export function formatMoney(amount: number, currency: string, options?: Intl.NumberFormatOptions, lang: Language = current): string {
  return new Intl.NumberFormat(localeTag(lang), { style: 'currency', currency, ...options }).format(amount);
}

/** A date or time in the page's language. */
export function formatDate(date: Date | number | string, options?: Intl.DateTimeFormatOptions, lang: Language = current): string {
  return new Intl.DateTimeFormat(localeTag(lang), options).format(date instanceof Date ? date : new Date(date));
}

/** Tests: back to English with no catalogs and no announced languages. */
export function resetLanguages(): void {
  catalogs.clear();
  available.clear();
  available.add('en');
  current = 'en';
}
