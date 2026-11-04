import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import type { SocialLink } from '../../types/edits';
import { useFrameFollows, type EditorEnv } from './env';
import { EditErrorBanner, EditResultLine, PanelFrame, PreviewFlow, Working } from './ui';
import { useEditOperation } from './useEditOperation';
import { SocialGlyph } from './socialGlyphs';

/** The networks a profile can be on, with the start of their addresses (the same list as the API's). */
export const SOCIAL_NETWORKS: Array<{ id: string; name: string; start: string; hosts: string[] }> = [
  { id: 'instagram', name: 'Instagram', start: 'https://www.instagram.com/', hosts: ['instagram.com'] },
  { id: 'facebook', name: 'Facebook', start: 'https://www.facebook.com/', hosts: ['facebook.com', 'fb.com', 'fb.me'] },
  { id: 'tiktok', name: 'TikTok', start: 'https://www.tiktok.com/', hosts: ['tiktok.com'] },
  { id: 'x', name: 'X', start: 'https://x.com/', hosts: ['x.com', 'twitter.com'] },
  { id: 'youtube', name: 'YouTube', start: 'https://www.youtube.com/', hosts: ['youtube.com', 'youtu.be'] },
  { id: 'linkedin', name: 'LinkedIn', start: 'https://www.linkedin.com/', hosts: ['linkedin.com'] },
  { id: 'pinterest', name: 'Pinterest', start: 'https://www.pinterest.com/', hosts: ['pinterest.com', 'pin.it'] },
  { id: 'threads', name: 'Threads', start: 'https://www.threads.net/', hosts: ['threads.net', 'threads.com'] },
  { id: 'bluesky', name: 'Bluesky', start: 'https://bsky.app/', hosts: ['bsky.app'] },
  { id: 'whatsapp', name: 'WhatsApp', start: 'https://wa.me/', hosts: ['wa.me', 'whatsapp.com'] },
  { id: 'etsy', name: 'Etsy', start: 'https://www.etsy.com/', hosts: ['etsy.com'] },
  { id: 'google', name: 'Google Business Profile', start: 'https://g.page/', hosts: ['g.page', 'goo.gl', 'google.com'] },
  { id: 'tripadvisor', name: 'Tripadvisor', start: 'https://www.tripadvisor.com/', hosts: ['tripadvisor.com', 'tripadvisor.co.uk', 'tripadvisor.fr', 'tripadvisor.de', 'tripadvisor.es', 'tripadvisor.it'] },
  { id: 'spotify', name: 'Spotify', start: 'https://open.spotify.com/', hosts: ['spotify.com'] },
  { id: 'bandcamp', name: 'Bandcamp', start: 'https://bandcamp.com/', hosts: ['bandcamp.com'] },
  { id: 'soundcloud', name: 'SoundCloud', start: 'https://soundcloud.com/', hosts: ['soundcloud.com'] },
  { id: 'discord', name: 'Discord', start: 'https://discord.gg/', hosts: ['discord.gg', 'discord.com'] },
  { id: 'other', name: 'Other link', start: 'https://', hosts: [] },
];

const MAX_LINKS = 12;

/** A closed row's height: its 30px buttons, 6px above and below them, and the line between rows. */
export const SOCIAL_ROW_HEIGHT = 43;

/** The list's height before it scrolls: about five and a half rows, so the panel keeps "Add a link" in sight. */
export const SOCIAL_LIST_MAX_HEIGHT = 236;

/** An open row's height until the browser measures it: the picker, the address, a hint and the row's buttons. */
const OPEN_ROW_GUESS = 172;

/**
 * The list's height before it scrolls, the row open for editing (its height
 * given, 0 when not measured yet) counted as one row: about five and a half
 * rows still show while one is open, not three.
 */
export function socialListMaxHeight(openRowHeight: number | null): number {
  if (openRowHeight === null) return SOCIAL_LIST_MAX_HEIGHT;
  return SOCIAL_LIST_MAX_HEIGHT + Math.max(0, (openRowHeight || OPEN_ROW_GUESS) - SOCIAL_ROW_HEIGHT);
}

function networkOf(id: string) {
  return SOCIAL_NETWORKS.find((n) => n.id === id) ?? SOCIAL_NETWORKS[SOCIAL_NETWORKS.length - 1];
}

/** The row's name: the network's, or for "Other link" the name the owner gave it. */
export function socialLinkName(link: SocialLink): string {
  if (link.network === 'other') return (link.label ?? '').trim() || 'Other link';
  return networkOf(link.network).name;
}

/** The address, short: a handle as written, a web address as its host and path ("instagram.com/ryebakery"). */
export function shortAddress(url: string): string {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return u;
  try {
    const p = new URL(u);
    const path = `${p.pathname}${p.search}`.replace(/\/+$/, '');
    return `${p.host.replace(/^www\./i, '')}${path}`;
  } catch {
    return u;
  }
}

/** Why a row cannot be saved yet, in the owner's words, or null. A handle (@name) is fine: WPMaven makes it the address. */
export function socialRowProblem(row: SocialLink): string | null {
  const n = networkOf(row.network);
  const url = row.url.trim();
  if (!url) return 'Add the address of your profile.';
  if (n.id === 'other' && !(row.label ?? '').trim()) return 'Give this link a name.';
  if (!/^https?:\/\//i.test(url) && !/^[\w.-]+\.[a-z]{2,}\//i.test(url)) {
    return n.id === 'other' || n.id === 'google' || n.id === 'tripadvisor' || n.id === 'spotify' || n.id === 'discord'
      ? `Add the full address of ${n.id === 'other' ? 'this link' : `your ${n.name} profile`}, starting with https://.`
      : null;
  }
  if (n.id === 'other') return null;
  let host = '';
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^(www|m)\./, '');
  } catch {
    return 'This is not a web address. It starts with https://.';
  }
  if (!n.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    return `This is not ${/^(?:[AEIOU]|X\b)/.test(n.name) ? 'an' : 'a'} ${n.name} address. It starts with ${n.start}.`;
  }
  return null;
}

/** A link on screen, with a key of its own so a row keeps its place in the list while it moves. */
interface Row {
  key: number;
  link: SocialLink;
}

/**
 * Social links: the business's profiles, in the order the site shows them.
 * Saved as one change (the site's social icons, its social menu and what
 * search engines read about the business follow), with its undo.
 *
 * Each link reads as one row: the network's mark, its name and its address,
 * short, with Edit and Remove. Edit opens the row in place (the network, the
 * address, the order); one row is open at a time, and "Add a link" adds a row
 * already open. The list scrolls inside the panel past about five and a half
 * rows, the open one counted as one row at its own height.
 */
export function SocialLinksPanel({ env }: { env: EditorEnv }) {
  const saved = env.siteMap?.social?.links ?? [];
  const nextKey = useRef(0);
  const rowOf = (link: SocialLink): Row => ({ key: nextKey.current++, link: { ...link } });
  const [rows, setRows] = useState<Row[]>(() => saved.map(rowOf));
  // The key of the row open for editing, or null.
  const [open, setOpen] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // The open row's height as drawn (0 until measured): the list grows by what it adds to a row.
  const [openHeight, setOpenHeight] = useState(0);
  // The row just closed with Done: its Edit button takes the focus back.
  const refocus = useRef<number | null>(null);
  const flow = useEditOperation();
  // A block theme's footer shows them (its social links block): previewed first, like every change to a page.
  const blockFooter = env.siteMap?.engine === 'wordpress' && !!env.siteMap?.parts?.some((p) => p.slug === 'footer');
  useFrameFollows(flow, env);
  const s = flow.state;
  const busy = s.phase === 'publishing' || s.phase === 'previewing';
  const links = rows.map((r) => r.link);
  // A row without an address is left out when saving: it only reads "No address yet".
  const problems = links.map((l) => (l.url.trim() ? socialRowProblem(l) : null));
  const changed = JSON.stringify(links) !== JSON.stringify(saved);
  const noSpot = !blockFooter && !env.siteMap?.social?.menuLocation && !rows.length && !saved.length;
  const full = rows.length >= MAX_LINKS;
  const linksOf = () => links.filter((l) => l.url.trim()).map((l) => ({ network: l.network, url: l.url.trim(), ...(l.network === 'other' ? { label: (l.label ?? '').trim() } : {}) }));

  // The open row measured before it paints, and again as it grows (a name field, a warning).
  useLayoutEffect(() => {
    if (open === null) return undefined;
    const row = listRef.current?.querySelector<HTMLElement>('[data-open="true"]');
    if (!row) return undefined;
    const measure = () => setOpenHeight(row.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(measure);
    watch.observe(row);
    return () => watch.disconnect();
  }, [open]);

  // An editor opened low in the list scrolls into view; a closed one gives the focus back to its Edit button.
  useEffect(() => {
    if (open !== null) {
      listRef.current?.querySelector('[data-open="true"]')?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    if (refocus.current === null) return;
    listRef.current?.querySelector<HTMLButtonElement>(`[data-row="${refocus.current}"] [data-testid="social-edit"]`)?.focus();
    refocus.current = null;
  }, [open]);

  const update = (key: number, patch: Partial<SocialLink>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, link: { ...r.link, ...patch } } : r)));
  const move = (i: number, by: -1 | 1) => setRows((cur) => {
    const next = [...cur];
    const [row] = next.splice(i, 1);
    next.splice(i + by, 0, row);
    return next;
  });
  const remove = (key: number) => {
    setRows((cur) => cur.filter((r) => r.key !== key));
    if (open === key) setOpen(null);
  };
  const add = () => {
    const row = rowOf({ network: 'instagram', url: '' });
    setRows((cur) => [...cur, row]);
    setOpen(row.key);
  };
  const done = () => {
    refocus.current = open;
    setOpen(null);
  };

  const save = async () => {
    if (problems.some(Boolean) || !changed) return;
    const r = await flow.publishNow({ op: 'update_social_links', links: linksOf() });
    if (r?.status === 'published') {
      setOpen(null);
      env.refreshSiteMap();
    }
  };

  return (
    <PanelFrame
      chip="Social"
      color="var(--rose, var(--purple))"
      title="Social links"
      sub="Where people find your business on social media. Shown wherever your site shows its social icons."
      onClose={env.closePanel}
      footer={blockFooter ? (
        <PreviewFlow
          flow={flow}
          canPreview={changed && !problems.some(Boolean)}
          onPreview={() => { void flow.preview({ op: 'update_social_links', links: linksOf() }); }}
          workingText="Preparing your footer with your social links."
          phoneFirst={env.viewport === 'mobile'}
          onUndo={env.undo}
          onDone={() => { flow.reset(); env.refreshSiteMap(); }}
        />
      ) : (
        <>
          {busy && <Working text="Saving your social links." />}
          {s.result && <EditResultLine result={s.result} failure={s.error} />}
          {s.error && s.error.stage === 'publish' && (
            <EditErrorBanner code={s.error.code} message={s.error.message} busy={busy} onRetry={() => { void save(); }} onDiscard={() => { flow.reset(); setOpen(null); setRows(saved.map(rowOf)); }} />
          )}
          <div className="wme-gs-actions">
            {s.phase === 'published' && s.result?.undoable && (
              <Button data-testid="editor-undo" variant="ghost" size="sm" onClick={() => env.undo(s.result!)}>Undo</Button>
            )}
            <Button data-testid="social-save" variant="primary" size="sm" className="wme-gs-push" disabled={!changed || busy || problems.some(Boolean)} isLoading={busy} onClick={() => { void save(); }}>Save</Button>
          </div>
        </>
      )}
    >
      {noSpot && (
        <p className="wme-gs-hint" data-testid="social-no-spot">Your site's design has no social icons. Your profiles still go into what search engines and AI assistants read about your business.</p>
      )}
      {rows.length === 0 ? (
        <p className="wme-gs-hint" data-testid="social-empty">No social links yet.</p>
      ) : (
        // Its own scroll: about five and a half rows show, one open or not, and the panel's title and Save stay where they are.
        <ul ref={listRef} className="wme-gs-social" style={{ maxHeight: socialListMaxHeight(open === null ? null : openHeight) }} data-testid="social-list" aria-label="Your social links">
          {rows.map((row, i) => {
            const { link } = row;
            const name = socialLinkName(link);
            const problem = problems[i];
            if (open === row.key) {
              return (
                <li key={row.key} className="wme-gs-social-row is-open" data-testid="social-row" data-row={row.key} data-open="true" data-network={link.network}>
                  <div className="wme-gs-social-pick">
                    <SocialGlyph network={link.network} />
                    <select aria-label="Network" className="wme-gs-select wm-select" data-testid="social-network" value={link.network} disabled={busy} onChange={(e) => update(row.key, { network: e.target.value })}>
                      {SOCIAL_NETWORKS.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                    </select>
                  </div>
                  {link.network === 'other' && (
                    <input aria-label="Name of the link" className="wme-gs-input" placeholder="Name of the link" value={link.label ?? ''} disabled={busy} onChange={(e) => update(row.key, { label: e.target.value })} />
                  )}
                  <input
                    aria-label="Address"
                    data-testid="social-url"
                    className="wme-gs-input"
                    placeholder={link.network === 'other' ? 'https://' : `${networkOf(link.network).start}yourname or @yourname`}
                    value={link.url}
                    disabled={busy}
                    aria-invalid={problem ? 'true' : undefined}
                    autoFocus
                    onChange={(e) => update(row.key, { url: e.target.value })}
                  />
                  {!link.url.trim() ? <p className="wme-gs-hint">No address yet: hidden on your site.</p> : problem && <p className="wme-gs-note is-warn" role="alert">{problem}</p>}
                  <div className="wme-gs-actions">
                    <button type="button" className="wme-gs-row-btn is-icon" aria-label={`Move ${name} up`} title="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className="wme-gs-row-btn is-icon" aria-label={`Move ${name} down`} title="Move down" disabled={busy || i === rows.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className="wme-gs-row-btn is-icon" data-testid="social-remove" aria-label={`Remove ${name}`} title="Remove" disabled={busy} onClick={() => remove(row.key)}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                    <Button variant="secondary" size="sm" className="wme-gs-push" data-testid="social-done" disabled={busy} onClick={done}>Done</Button>
                  </div>
                </li>
              );
            }
            return (
              <li key={row.key} className="wme-gs-social-row" data-testid="social-row" data-row={row.key} data-network={link.network}>
                <div className="wme-gs-social-line">
                  <SocialGlyph network={link.network} />
                  <span className="wme-gs-social-name">{name}</span>
                  <span className={`wme-gs-social-url${link.url.trim() ? '' : ' is-empty'}`} title={link.url.trim() || undefined} data-testid="social-address">
                    {link.url.trim() ? shortAddress(link.url) : 'No address yet'}
                  </span>
                  <button type="button" className="wme-gs-row-btn is-icon" data-testid="social-edit" aria-label={`Edit ${name}`} title="Edit" disabled={busy} onClick={() => setOpen(row.key)}>
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className="wme-gs-row-btn is-icon" data-testid="social-remove" aria-label={`Remove ${name}`} title="Remove" disabled={busy} onClick={() => remove(row.key)}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
                {problem && <p className="wme-gs-note is-warn" role="alert">{problem}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="wme-gs-actions">
        <Button variant="outline" size="sm" data-testid="social-add" leftIcon={<Plus size={16} aria-hidden="true" />} disabled={busy || full} onClick={add}>
          Add a link
        </Button>
        {full && <span className="wme-gs-hint">{`${MAX_LINKS} links at most.`}</span>}
      </div>
    </PanelFrame>
  );
}
