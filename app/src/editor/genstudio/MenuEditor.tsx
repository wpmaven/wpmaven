import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import type { MenuItemInput, MenuLink, SiteMap, SiteMapMenu } from '../../types/edits';
import { siteBrand, type SiteBrand } from '../../utils/brand';
import { KIND_COLORS } from './bindings';
import { useFrameFollows, type EditorEnv } from './env';
import { PanelFrame, PreviewFlow } from './ui';
import { listCategoriesForMenu, listPostsForMenu, type LinkTarget } from './siteData';
import { useEditOperation } from './useEditOperation';

/** One line of the menu as the editor holds it: a flat list, children one level in. */
export interface MenuRow {
  key: string;
  id?: number;
  label: string;
  link: MenuLink;
  depth: 0 | 1;
  newTab?: boolean;
}

export const MAX_MENU_ITEMS = 30;
const MENU_URL = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

let keySeq = 0;
const nextKey = () => `row${++keySeq}`;

/** The menu's items as rows (deeper items come up to the one level the editor shows). */
export function rowsFromMenu(menu: SiteMapMenu | null): MenuRow[] {
  if (!menu) return [];
  const canNest = menu.maxDepth >= 2;
  return menu.items.map((i) => ({
    key: nextKey(),
    id: i.id,
    label: i.label,
    link: i.link,
    depth: canNest && i.depth > 0 ? 1 : 0,
  }));
}

/** The rows as the operation takes them: children under the item above them. */
export function menuInputFromRows(rows: MenuRow[]): MenuItemInput[] {
  const out: MenuItemInput[] = [];
  for (const r of rows) {
    const item: MenuItemInput = { ...(r.id ? { id: r.id } : {}), label: r.label.trim(), link: r.link, ...(r.newTab ? { newTab: true } : {}) };
    const parent = out[out.length - 1];
    if (r.depth === 1 && parent) {
      parent.children = [...(parent.children ?? []), item];
    } else {
      out.push(item);
    }
  }
  return out;
}

/** What is wrong with the rows, in plain words (empty when they can be sent). */
export function menuProblems(rows: MenuRow[]): string[] {
  const out: string[] = [];
  if (rows.length > MAX_MENU_ITEMS) out.push(`A menu holds at most ${MAX_MENU_ITEMS} links.`);
  if (rows.some((r) => !r.label.trim())) out.push('Every link needs a name.');
  if (rows.some((r) => r.label.trim().length > 60)) out.push('A link name has at most 60 characters.');
  if (rows.some((r) => r.link.kind === 'url' && !MENU_URL.test(r.link.url.trim()))) out.push('A web address starts with https://, mailto:, tel: or /.');
  return out;
}

/** Where a link goes, in words. */
export function linkWords(link: MenuLink, map: SiteMap | null): string {
  switch (link.kind) {
    case 'page': return `Page: ${map?.pages.find((p) => p.postId === link.pageId)?.title ?? `#${link.pageId}`}`;
    case 'product': return `Product: ${map?.products.find((p) => p.id === link.productId)?.name ?? `#${link.productId}`}`;
    case 'post': return 'A blog post';
    case 'term': return link.taxonomy === 'product_cat' ? 'A product category' : 'A blog category';
    case 'shop': return 'The shop';
    case 'url': return link.url;
    default: return '';
  }
}

type AddKind = 'page' | 'post' | 'product' | 'category' | 'shop' | 'url';

/** The editor's line while the site has no menu to change, in the site's brand (utils/brand.ts) or naming nobody. */
export function noMenuText(b: SiteBrand = siteBrand()): string {
  return b.mode === 'neutral' ? 'This site has no menu that can be changed here yet.' : `This site has no menu ${b.name} can change yet.`;
}

/**
 * A menu of the site: rename, reorder (drag, or the arrows), nest one level
 * where the menu shows it, remove, and add a page, a product, the shop or a
 * web address. The preview shows the site with the new menu.
 */
export function MenuEditor({ env, location, itemId }: { env: EditorEnv; location?: string; itemId?: number }) {
  const menus = env.siteMap?.menus ?? [];
  const [current, setCurrent] = useState<string>(location && menus.some((m) => m.location === location) ? location : menus[0]?.location ?? '');
  // Opened before the site map arrived: the asked menu, else the first, once it is known.
  useEffect(() => {
    if (!current && menus.length) setCurrent(location && menus.some((m) => m.location === location) ? location : menus[0].location);
  }, [current, menus, location]);
  const menu = menus.find((m) => m.location === current) ?? null;
  const [rows, setRows] = useState<MenuRow[]>(() => rowsFromMenu(menu));
  const [initial, setInitial] = useState<string>(() => JSON.stringify(menuInputFromRows(rowsFromMenu(menu))));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [addKind, setAddKind] = useState<AddKind>('page');
  const [addTarget, setAddTarget] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const flow = useEditOperation();
  useFrameFollows(flow, env);
  const busy = flow.state.phase === 'previewing' || flow.state.phase === 'publishing';
  const canNest = (menu?.maxDepth ?? 1) >= 2;

  // The rows follow what the site has: another menu, or the site map read
  // again after a publish (the published result stays on screen).
  const menuJson = JSON.stringify(menu);
  useEffect(() => {
    const next = rowsFromMenu(menu);
    setRows(next);
    setInitial(JSON.stringify(menuInputFromRows(next)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, menuJson]);
  const { reset } = flow;
  useEffect(() => { reset(); }, [current, reset]);

  const items = useMemo(() => menuInputFromRows(rows), [rows]);
  const dirty = JSON.stringify(items) !== initial;
  const problems = menuProblems(rows);

  const pages = (env.siteMap?.pages ?? []).filter((p) => p.postId);
  const products = (env.siteMap?.products ?? []).filter((p) => p.id);
  // Posts and categories are read from WordPress when the owner picks that kind of link.
  const [posts, setPosts] = useState<LinkTarget[] | null>(null);
  const [categories, setCategories] = useState<Array<LinkTarget & { taxonomy: 'category' | 'product_cat' }> | null>(null);
  useEffect(() => {
    if (addKind === 'post' && posts === null) listPostsForMenu().then(setPosts).catch(() => setPosts([]));
    if (addKind === 'category' && categories === null) listCategoriesForMenu().then(setCategories).catch(() => setCategories([]));
  }, [addKind, posts, categories]);

  const patch = (key: string, change: Partial<MenuRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const move = (key: string, by: -1 | 1) => setRows((rs) => {
    const i = rs.findIndex((r) => r.key === key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= rs.length) return rs;
    const next = [...rs];
    [next[i], next[j]] = [next[j], next[i]];
    if (next[0].depth === 1) next[0] = { ...next[0], depth: 0 };
    return next;
  });
  const dropOn = (key: string) => {
    if (!dragKey || dragKey === key) return;
    setRows((rs) => {
      const from = rs.findIndex((r) => r.key === dragKey);
      const to = rs.findIndex((r) => r.key === key);
      if (from < 0 || to < 0) return rs;
      const next = [...rs];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      if (next[0].depth === 1) next[0] = { ...next[0], depth: 0 };
      return next;
    });
    setDragKey(null);
  };

  const add = () => {
    let link: MenuLink | null = null;
    let label = addLabel.trim();
    if (addKind === 'page') {
      const p = pages.find((x) => String(x.postId) === addTarget);
      if (p?.postId) { link = { kind: 'page', pageId: p.postId }; label = label || p.title; }
    } else if (addKind === 'product') {
      const p = products.find((x) => String(x.id) === addTarget);
      if (p?.id) { link = { kind: 'product', productId: p.id }; label = label || p.name; }
    } else if (addKind === 'post') {
      const p = (posts ?? []).find((x) => String(x.id) === addTarget);
      if (p) { link = { kind: 'post', postId: p.id }; label = label || p.title; }
    } else if (addKind === 'category') {
      const c = (categories ?? []).find((x) => `${x.taxonomy}:${x.id}` === addTarget);
      if (c) { link = { kind: 'term', taxonomy: c.taxonomy, termId: c.id }; label = label || c.title; }
    } else if (addKind === 'shop') {
      link = { kind: 'shop' };
      label = label || 'Shop';
    } else if (addTarget.trim()) {
      link = { kind: 'url', url: addTarget.trim() };
    }
    if (!link || !label) return;
    setRows((rs) => [...rs, { key: nextKey(), label: label.slice(0, 60), link: link as MenuLink, depth: 0 }]);
    setAddTarget('');
    setAddLabel('');
  };

  return (
    <PanelFrame
      chip="Menu"
      color={KIND_COLORS['menu-item']}
      title={menu ? menu.label : 'Menus'}
      sub={menu ? `${rows.length} ${rows.length === 1 ? 'link' : 'links'}` : undefined}
      onClose={env.closePanel}
      footer={menu ? (
        <PreviewFlow
          flow={flow}
          canPreview={dirty && problems.length === 0}
          onPreview={() => { void flow.preview({ op: 'update_menu', location: current, items }); }}
          workingText="Preparing the menu preview."
          phoneFirst={env.viewport === 'mobile'}
          onUndo={env.undo}
          onDone={() => flow.reset()}
        />
      ) : undefined}
    >
      {menus.length === 0 && <p className="wme-gs-hint">{noMenuText()}</p>}
      {menus.length > 1 && (
        <div>
          <label className="wme-gs-label" htmlFor="wme-gs-menu-loc">Menu</label>
          <select id="wme-gs-menu-loc" className="wme-gs-select wm-select" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={busy || dirty}>
            {menus.map((m) => <option key={m.location} value={m.location}>{m.label}</option>)}
          </select>
          {dirty && <p className="wme-gs-hint" style={{ marginTop: 4 }}>Preview or undo your changes to switch menus.</p>}
        </div>
      )}
      {menu && (
        <ul className="wme-gs-list" data-testid="menu-items" aria-label={`Links of ${menu.label}`}>
          {rows.map((r, i) => (
            <li
              key={r.key}
              className={`wme-gs-row${r.depth ? ' is-child' : ''}${dragKey === r.key ? ' is-drag' : ''}`}
              draggable={!busy}
              onDragStart={() => setDragKey(r.key)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropOn(r.key)}
              onDragEnd={() => setDragKey(null)}
              data-testid="menu-item"
              style={r.id && r.id === itemId ? { borderColor: 'var(--purple)' } : undefined}
            >
              <span aria-hidden="true" style={{ cursor: 'grab', color: 'var(--text-dim)' }}>{'☰'}</span>
              <div className="wme-gs-row-main">
                <input
                  className="wme-gs-input"
                  value={r.label}
                  onChange={(e) => patch(r.key, { label: e.target.value })}
                  aria-label={`Name of link ${i + 1}`}
                  maxLength={60}
                  disabled={busy}
                  style={{ padding: '5px 8px' }}
                />
                <small>{linkWords(r.link, env.siteMap)}</small>
              </div>
              <button type="button" className="wme-gs-row-btn" onClick={() => move(r.key, -1)} disabled={busy || i === 0} aria-label={`Move ${r.label} up`}>{'↑'}</button>
              <button type="button" className="wme-gs-row-btn" onClick={() => move(r.key, 1)} disabled={busy || i === rows.length - 1} aria-label={`Move ${r.label} down`}>{'↓'}</button>
              {canNest && (
                <button
                  type="button"
                  className="wme-gs-row-btn"
                  onClick={() => patch(r.key, { depth: r.depth ? 0 : 1 })}
                  disabled={busy || (i === 0 && r.depth === 0)}
                  aria-label={r.depth ? `Move ${r.label} out of the item above` : `Put ${r.label} under the item above`}
                >
                  {r.depth ? '←' : '→'}
                </button>
              )}
              <button type="button" className="wme-gs-row-btn" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} disabled={busy} aria-label={`Remove ${r.label}`}>&times;</button>
            </li>
          ))}
        </ul>
      )}
      {menu && flow.state.phase === 'idle' && (
        <div className="wme-gs-note">
          <p className="wme-gs-label" style={{ marginBottom: 8 }}>Add a link</p>
          <div className="wme-gs-row2" style={{ marginBottom: 8 }}>
            <select className="wme-gs-select wm-select" value={addKind} onChange={(e) => { setAddKind(e.target.value as AddKind); setAddTarget(''); }} aria-label="What the link opens">
              <option value="page">A page</option>
              <option value="post">A blog post</option>
              {products.length > 0 && <option value="product">A product</option>}
              <option value="category">A category</option>
              {products.length > 0 && <option value="shop">The shop</option>}
              <option value="url">A web address</option>
            </select>
            {addKind === 'page' && (
              <select className="wme-gs-select wm-select" value={addTarget} onChange={(e) => setAddTarget(e.target.value)} aria-label="Page">
                <option value="">Choose a page</option>
                {pages.map((p) => <option key={p.slug} value={String(p.postId)}>{p.title}</option>)}
              </select>
            )}
            {addKind === 'product' && (
              <select className="wme-gs-select wm-select" value={addTarget} onChange={(e) => setAddTarget(e.target.value)} aria-label="Product">
                <option value="">Choose a product</option>
                {products.map((p) => <option key={p.slug} value={String(p.id)}>{p.name}</option>)}
              </select>
            )}
            {addKind === 'post' && (
              <select className="wme-gs-select wm-select" value={addTarget} onChange={(e) => setAddTarget(e.target.value)} aria-label="Blog post">
                <option value="">{posts === null ? 'Reading your posts' : posts.length ? 'Choose a post' : 'No published post'}</option>
                {(posts ?? []).map((p) => <option key={p.id} value={String(p.id)}>{p.title}</option>)}
              </select>
            )}
            {addKind === 'category' && (
              <select className="wme-gs-select wm-select" value={addTarget} onChange={(e) => setAddTarget(e.target.value)} aria-label="Category">
                <option value="">{categories === null ? 'Reading your categories' : categories.length ? 'Choose a category' : 'No category with content'}</option>
                {(categories ?? []).map((c) => <option key={`${c.taxonomy}:${c.id}`} value={`${c.taxonomy}:${c.id}`}>{c.title}{c.taxonomy === 'product_cat' ? ' (store)' : ''}</option>)}
              </select>
            )}
            {addKind === 'url' && (
              <input className="wme-gs-input" value={addTarget} onChange={(e) => setAddTarget(e.target.value)} placeholder="https://" aria-label="Web address" />
            )}
          </div>
          <div className="wme-gs-actions">
            <input className="wme-gs-input" style={{ flex: 1, minWidth: 0 }} value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="Name in the menu" maxLength={60} aria-label="Name in the menu" />
            <Button variant="outline" size="sm" onClick={add} disabled={rows.length >= MAX_MENU_ITEMS} data-testid="menu-add">Add</Button>
          </div>
        </div>
      )}
      {problems.length > 0 && <div className="wme-gs-note is-warn" role="alert">{problems.join(' ')}</div>}
    </PanelFrame>
  );
}
