import React, { useState } from 'react';
import {
  AlertTriangle, Check, Copy, ExternalLink, FileText, Globe, Hash, Mail, Newspaper, Paperclip, Phone, Send, ShoppingBag, ShoppingCart,
} from 'lucide-react';
import type { Destination, DestinationIcon, PickItem } from './destinations';
import { WINDOW_WORDS } from './labels';

const ICONS: Record<DestinationIcon, React.ComponentType<{ size?: number }>> = {
  page: FileText, product: ShoppingBag, post: Newspaper, cart: ShoppingCart, section: Hash, web: Globe,
  email: Mail, phone: Phone, file: Paperclip, send: Send, nowhere: AlertTriangle,
};

const iconButton: React.CSSProperties = {
  width: 24, height: 24, border: 0, borderRadius: 6, background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};

/**
 * Where the selected link goes (or what a button does), under the window's
 * header: a page by its title, another website by its domain and a short
 * path, an email address, a phone number. The whole address shows on hover,
 * with Copy and Open (in a new browser tab, outside the editor).
 */
export function DestinationLine({ dest }: { dest: Destination }) {
  const [copied, setCopied] = useState(false);
  const Icon = ICONS[dest.icon];
  const warn = dest.icon === 'nowhere';
  const canOpen = !!dest.full && dest.icon !== 'email' && dest.icon !== 'phone';
  const copy = () => {
    void navigator.clipboard?.writeText(dest.full).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  };
  return (
    <div data-testid="editor-window-destination" title={dest.full || undefined} style={{ padding: '8px 12px 8px 16px', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, minWidth: 0 }}>
      {!dest.does && <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{WINDOW_WORDS.goesTo}</span>}
      <span style={{ display: 'flex', color: warn ? 'var(--peach, var(--warning))' : 'var(--text-dim)', flexShrink: 0 }}><Icon size={14} /></span>
      <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: warn ? 'var(--peach, var(--warning))' : 'var(--text)' }}>
        <strong style={{ fontWeight: 600 }}>{dest.title}</strong>
        {dest.detail && <span style={{ color: 'var(--text-dim)' }}>{dest.icon === 'web' ? '' : ' · '}{dest.detail}</span>}
        {dest.newTab && <span style={{ color: 'var(--text-dim)' }}> · new tab</span>}
      </span>
      {dest.full && (
        <button type="button" onClick={copy} aria-label={WINDOW_WORDS.copy} title={copied ? WINDOW_WORDS.copied : WINDOW_WORDS.copy} data-testid="editor-window-destination-copy" style={iconButton}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
      {canOpen && (
        <button type="button" onClick={() => { window.open(dest.full, '_blank', 'noopener,noreferrer'); }} aria-label={WINDOW_WORDS.open} title={WINDOW_WORDS.open} data-testid="editor-window-destination-open" style={iconButton}>
          <ExternalLink size={14} />
        </button>
      )}
    </div>
  );
}

/**
 * The places a link can go to (or a page to add to a menu): this site's
 * pages, this page's sections, the latest posts, a search over them when
 * there are many; then another website, an email address or a phone number,
 * which fill the window's box with the sentence to finish.
 */
export function DestinationPicker({ lists, what, onPick, onFill }: {
  lists: { pages: PickItem[]; sections: PickItem[]; posts: PickItem[] };
  what: 'link' | 'menu';
  onPick: (item: PickItem) => void;
  onFill: (text: string) => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const match = (items: PickItem[]) => (q ? items.filter((i) => i.title.toLowerCase().includes(q)) : items);
  const total = lists.pages.length + lists.sections.length + lists.posts.length;
  const groups: Array<[string, PickItem[]]> = [
    [WINDOW_WORDS.pickPage, match(lists.pages)],
    [WINDOW_WORDS.pickSection, match(lists.sections)],
    [WINDOW_WORDS.pickPosts, match(lists.posts)],
  ];
  const others: Array<[string, string]> = what === 'menu'
    ? [[WINDOW_WORDS.otherSite, 'Add a link to [web address] here']]
    : [
      [WINDOW_WORDS.otherSite, 'Make it go to [web address]'],
      [WINDOW_WORDS.emailAddress, 'Make it send an email to [email address]'],
      [WINDOW_WORDS.phoneNumber, 'Make it call [phone number]'],
    ];
  const row: React.CSSProperties = {
    width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: 0, borderRadius: 8,
    background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 13, textAlign: 'left', minWidth: 0,
  };
  return (
    <div data-testid="editor-window-picker" style={{ margin: '0 16px 10px', border: '1px solid var(--glass-border)', borderRadius: 12, background: 'var(--bg-raised)', padding: 6 }}>
      {total > 8 && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={WINDOW_WORDS.pickSearch}
          aria-label={WINDOW_WORDS.pickSearch}
          style={{ width: '100%', boxSizing: 'border-box', margin: '0 0 6px', padding: '6px 8px', border: '1px solid var(--glass-border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}
        />
      )}
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {groups.filter(([, items]) => items.length > 0).map(([name, items]) => (
          <div key={name} role="group" aria-label={name}>
            <div style={{ padding: '6px 8px 2px', fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{name}</div>
            {items.map((item) => {
              const Icon = ICONS[item.icon];
              return (
                <button key={item.key} type="button" onClick={() => onPick(item)} data-testid="editor-window-pick" style={row}>
                  <span style={{ display: 'flex', color: 'var(--text-dim)', flexShrink: 0 }}><Icon size={14} /></span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{item.title}</span>
                  {item.detail && <span style={{ marginLeft: 'auto', paddingLeft: 8, color: 'var(--text-dim)', fontSize: 12, flexShrink: 0 }}>{item.detail}</span>}
                </button>
              );
            })}
          </div>
        ))}
        <div style={{ borderTop: '1px solid var(--glass-border)', marginTop: 4, paddingTop: 4 }}>
          {others.map(([label, text]) => (
            <button key={label} type="button" onClick={() => onFill(text)} style={{ ...row, color: 'var(--text-dim)' }}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
