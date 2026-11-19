/**
 * The language the owner edits in (multilingual sites, design 19.1 and
 * 19.5): the language of the page the frame shows (/ca/... is Català), and
 * whether a change of words stays in that language alone ("Only in
 * Català", langScope 'language'). A design change takes them when it
 * starts (stampLanguage), so its preview, its other versions and its
 * publish keep the language it was made in, whatever page the owner opens
 * next. A site in one language never sees any of it.
 */
import { useSyncExternalStore } from 'react';
import { DESIGN_OPS, type DesignLanguage, type EditOperation, type SiteMap, type SiteMapLanguage, type SiteMapLanguages } from '../../types/edits';

export interface EditLanguage {
  /** The language of the page in the frame; null on a site in one language. */
  current: SiteMapLanguage | null;
  /** The main language; null on a site in one language. */
  main: SiteMapLanguage | null;
  /** A change of words stays in the current language alone (never in the main one). */
  only: boolean;
}

/**
 * The design changes whose words can stay in one language. A layout, a
 * picture or a style is the whole site's and reaches every language
 * (design 19.1: one design).
 */
export const WORDS_OPS: ReadonlySet<string> = new Set(['edit_section', 'edit_chrome', 'edit_form', 'edit_site']);

const NONE: EditLanguage = { current: null, main: null, only: false };
let state: EditLanguage = NONE;
const listeners = new Set<() => void>();

/** The path of an address inside the site (the site may live in a folder: example.com/shop/ca/about/ is /ca/about/). */
function pathInSite(url: string, home?: string): string | null {
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
    const u = new URL(url, base);
    let path = u.pathname || '/';
    if (home) {
      const h = new URL(home, base);
      const root = h.pathname.replace(/\/+$/, '');
      if (h.origin === u.origin && root && (path === root || path.startsWith(`${root}/`))) path = path.slice(root.length) || '/';
    }
    return path.startsWith('/') ? path : `/${path}`;
  } catch {
    return null;
  }
}

/** The language of a page by its address: under a language's prefix ("/ca/"), else the main language. Null on a site in one language. */
export function languageOfUrl(url: string, languages: SiteMapLanguages | null | undefined, home?: string): SiteMapLanguage | null {
  if (!languages || languages.list.length < 2) return null;
  const main = languages.list.find((l) => l.main) ?? null;
  const path = pathInSite(url, home);
  if (path === null) return main;
  const lower = path.toLowerCase();
  const hit = languages.list.find((l) => !l.main && l.prefix && (lower === l.prefix.slice(0, -1) || lower.startsWith(l.prefix)));
  return hit ?? main;
}

/**
 * The page of the site map a page in another language is the version of:
 * the same address under its prefix (/ca/about/ is about, /ca/ the
 * homepage). '' when the address is in the main language or matches no
 * page.
 */
export function slugForLanguageUrl(map: SiteMap | null, url: string, home?: string): string {
  if (!map?.languages) return '';
  const lang = languageOfUrl(url, map.languages, home);
  if (!lang || lang.main) return '';
  const path = pathInSite(url, home);
  if (path === null) return '';
  const rest = `/${path.slice(lang.prefix.length).replace(/^\/+/, '')}`.replace(/\/+$/, '') || '/';
  if (rest === '/') return map.pages.some((p) => p.slug === 'index') ? 'index' : '';
  const page = map.pages.find((p) => {
    if (!p.url) return false;
    const own = pathInSite(p.url, home);
    return own !== null && (own.replace(/\/+$/, '') || '/') === rest;
  });
  return page?.slug ?? '';
}

export function getEditLanguage(): EditLanguage {
  return state;
}

export function subscribeEditLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function emit(next: EditLanguage) {
  state = next;
  listeners.forEach((l) => l());
}

/** The frame shows a page of this language (null: a site in one language). Another language starts with "only" unticked. */
export function setEditLanguage(current: SiteMapLanguage | null, main: SiteMapLanguage | null): void {
  if (state.current?.tag === current?.tag && state.main?.tag === main?.tag && state.current?.name === current?.name) return;
  emit(current && main ? { current, main, only: false } : NONE);
}

/** The owner's "Only in Català" (only in a language that is not the main one). */
export function setOnlyInLanguage(only: boolean): void {
  const next = only && !!state.current && !state.current.main;
  if (next === state.only) return;
  emit({ ...state, only: next });
}

/** Forget the language (the editor closed: a site opened next starts in one language). */
export function resetEditLanguage(): void {
  if (state !== NONE) emit(NONE);
}

export function useEditLanguage(): EditLanguage {
  return useSyncExternalStore(subscribeEditLanguage, getEditLanguage, getEditLanguage);
}

/**
 * A design change with the language it is made in: lang when the frame
 * shows another language than the main one, langScope 'language' when the
 * owner asked for that language alone and the change is one of words. A
 * change that already carries its language keeps it (another version of
 * it, a refinement); a data change and a site in one language are left as
 * they are.
 */
export function stampLanguage<T extends EditOperation>(operation: T, s: EditLanguage = state): T & DesignLanguage {
  if (!DESIGN_OPS.has(operation.op)) return operation;
  const own = operation as T & DesignLanguage;
  if (own.lang) return own;
  const cur = s.current;
  if (!cur || cur.main || !s.main) return operation;
  return { ...operation, lang: cur.tag, ...(s.only && WORDS_OPS.has(operation.op) ? { langScope: 'language' as const } : {}) };
}
