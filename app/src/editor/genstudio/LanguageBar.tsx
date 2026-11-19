import React from 'react';
import { Checkbox } from '@yotako/webmaven-ui';
import type { SiteMapLanguage, SiteMapLanguages } from '../../types/edits';

/**
 * The editor on a site in several languages (multilingual sites, design
 * 19.5): the languages in the bar (the same page in another language opens
 * at its own address), and beside the chat, on a page in another language
 * than the main one, what a change there does: it reaches every language,
 * unless the owner asks for that language's words alone ("Change words in
 * Català only"). Each language is named in itself, as the site's own
 * switcher names it.
 */
export const LANGUAGE_WORDS = {
  group: 'Site language',
  main: 'Your main language',
  notLive: 'Being written. It opens here once it is live.',
  editing: (name: string) => `You are editing the ${name} version of this page. A change you make here reaches every language.`,
  only: (name: string) => `Change words in ${name} only`,
  onlyOn: (name: string) => `Words you change stay in ${name}. A layout, a picture or a style still changes in every language.`,
  behind: (name: string) => `${name} is being updated with your latest change. It follows in a few minutes.`,
};

/** The path of an address inside the site, and the part before it (the site may live in a folder). */
function split(url: string, home?: string): { u: URL; root: string; path: string } | null {
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
    const u = new URL(url, base);
    let root = '';
    if (home) {
      const h = new URL(home, base);
      const r = h.pathname.replace(/\/+$/, '');
      if (h.origin === u.origin && r && (u.pathname === r || u.pathname.startsWith(`${r}/`))) root = r;
    }
    const path = u.pathname.slice(root.length) || '/';
    return { u, root, path: path.startsWith('/') ? path : `/${path}` };
  } catch {
    return null;
  }
}

/**
 * The same page in another language: its address under that language's
 * prefix (the main one at the root). Every language keeps the same page
 * addresses (design M3 A): /about/ is /ca/about/ in Català.
 */
export function urlInLanguage(url: string, languages: SiteMapLanguages, to: string, home?: string): string {
  const target = languages.list.find((l) => l.tag === to);
  const parts = split(url, home);
  if (!target || !parts) return url;
  const lower = parts.path.toLowerCase();
  const from = languages.list.find((l) => !l.main && l.prefix && (lower === l.prefix.slice(0, -1) || lower.startsWith(l.prefix)));
  const rest = from ? `/${parts.path.slice(from.prefix.length).replace(/^\/+/, '')}` : parts.path;
  const path = target.main || !target.prefix ? rest : `${target.prefix.replace(/\/$/, '')}${rest}`;
  const u = new URL(parts.u.toString());
  u.pathname = `${parts.root}${path}`;
  return u.toString();
}

export function LanguagePicker({ languages, current, onPick }: { languages: SiteMapLanguages; current: string; onPick: (tag: string) => void }) {
  return (
    <div className="wme-gs-bar-group" role="group" aria-label={LANGUAGE_WORDS.group} data-testid="editor-languages">
      {languages.list.map((l) => {
        const live = l.main || l.pages > 0;
        return (
          <button
            key={l.tag}
            type="button"
            className="wme-gs-tool"
            lang={l.tag}
            aria-pressed={l.tag === current}
            disabled={!live}
            title={l.main ? LANGUAGE_WORDS.main : live ? undefined : LANGUAGE_WORDS.notLive}
            onClick={() => { if (l.tag !== current) onPick(l.tag); }}
            data-testid={`editor-language-${l.tag}`}
          >
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

export function LanguageNote({ current, only, onOnly }: { current: SiteMapLanguage; only: boolean; onOnly: (only: boolean) => void }) {
  return (
    <div className="wme-gs-note" role="status" data-testid="editor-language-note" style={{ margin: '12px 12px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span>{LANGUAGE_WORDS.editing(current.name)}</span>
      <Checkbox checked={only} onChange={onOnly} label={<span data-testid="editor-language-only" style={{ fontWeight: 600 }}>{LANGUAGE_WORDS.only(current.name)}</span>} />
      {only && <span className="wme-gs-hint" data-testid="editor-language-only-hint">{LANGUAGE_WORDS.onlyOn(current.name)}</span>}
      {current.behind && <span className="wme-gs-hint" data-testid="editor-language-behind">{LANGUAGE_WORDS.behind(current.name)}</span>}
    </div>
  );
}
