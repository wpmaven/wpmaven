import React, { useEffect, useRef, useState } from 'react';
import { Button, Radio } from '@yotako/webmaven-ui';
import type { SiteMapFrontPage, SiteMapPage } from '../../types/edits';
import { siteBrand, type SiteBrand } from '../../utils/brand';
import { hasFeature, useSiteState } from '../../utils/siteState';
import { menuForRegion } from './ChromePanel';
import { useAppliedFollows, useFrameFollows, type EditorEnv } from './env';
import { EditResultLine, PanelFrame, PreviewFlow } from './ui';
import { useEditOperation } from './useEditOperation';

/** A page's slug from its title, the way WordPress would write it. */
export function slugFromTitle(title: string): string {
  return title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

/** The hint under a title whose address a page already has, in the site's brand (utils/brand.ts) or naming nobody. */
export function addressTakenText(b: SiteBrand = siteBrand()): string {
  return `Your site has a page with this address already: ${b.mode === 'neutral' ? 'the new one gets its own.' : `${b.name} gives the new one its own.`}`;
}

/** A page's address on the site without its slashes ("services/wholesale"), '' when it cannot be read. */
export function pathOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url, window.location.href).pathname).replace(/^\/+|\/+$/g, '');
  } catch {
    return '';
  }
}

/** Whether the site has a page at this address already (its plan slug, or its address on the site). */
export function addressTaken(pages: SiteMapPage[], slug: string, under = ''): boolean {
  if (!slug) return false;
  const full = under ? `${under}/${slug}` : slug;
  return pages.some((p) => p.slug === slug || pathOf(p.url) === full);
}

/** A page another page may go under, or take its layout from: a page of its own (not the store's or the blog's list). */
const ownPage = (p: SiteMapPage) => !p.template;

/**
 * A new page in the site's own style, from its name and what it is for,
 * with More options, folded (2026-10-17): its address, its place in a menu
 * (which menu, its label, after which link), and, when the site's API takes
 * them (features.addPageOptions), the page it goes under, published now or
 * kept as a draft, a page whose layout it takes, and its search title and
 * description. The preview opens the page before it exists.
 */
export function AddPagePanel({ env }: { env: EditorEnv }) {
  // A site WPMaven did not design: the page is written in its theme's blocks and published with the change; its menu changes after.
  const blockSite = env.siteMap?.engine === 'wordpress';
  const menus = blockSite ? [] : env.siteMap?.menus ?? [];
  const pages = env.siteMap?.pages ?? [];
  const options = hasFeature(useSiteState(), 'addPageOptions');
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [more, setMore] = useState(false);
  // null: the address and the menu's label follow the name.
  const [address, setAddress] = useState<string | null>(null);
  const [location, setLocation] = useState<string>(menuForRegion(menus, 'header')?.location ?? '');
  const [label, setLabel] = useState<string | null>(null);
  // null: at the end of the menu.
  const [position, setPosition] = useState<number | null>(null);
  const [parent, setParent] = useState(0);
  const [status, setStatus] = useState<'publish' | 'draft' | null>(null);
  const [like, setLike] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const flow = useEditOperation();
  const slug = slugFromTitle(address ?? title);
  useFrameFollows(flow, env, slug || undefined);
  const busy = flow.state.phase === 'previewing' || flow.state.phase === 'publishing';
  const parentPage = parent ? pages.find((p) => p.postId === parent) : undefined;
  const under = parentPage ? pathOf(parentPage.url) : '';
  const taken = addressTaken(pages, slug, under);
  const menuItems = (menus.find((m) => m.location === location)?.items ?? []).filter((i) => !i.parent);
  const menuLabel = (label ?? title).trim().slice(0, 60) || title.trim().slice(0, 60);
  const listed = useRef(false);
  useEffect(() => {
    if (flow.state.phase !== 'published' || listed.current) return;
    listed.current = true;
    env.listsChanged?.();
  }, [flow.state.phase, env]);

  return (
    <PanelFrame
      chip="New page"
      color="var(--purple)"
      title={title.trim() || 'Add a page'}
      onClose={env.closePanel}
      testId="editor-add-page"
      footer={(
        <PreviewFlow
          flow={flow}
          canPreview={title.trim().length >= 1 && instruction.trim().length >= 3 && !!slug}
          onPreview={(refine) => {
            void flow.preview({
              op: 'add_page',
              title: title.trim().slice(0, 80),
              instruction: instruction.trim(),
              ...(address !== null ? { slug } : {}),
              ...(location ? { menu: { location, label: menuLabel, ...(position !== null ? { position } : {}) } } : {}),
              ...(options && parent ? { parent } : {}),
              ...(options && status ? { status } : {}),
              ...(options && like ? { like } : {}),
              ...(options && (seoTitle.trim() || seoDescription.trim())
                ? { seo: { ...(seoTitle.trim() ? { title: seoTitle.trim() } : {}), ...(seoDescription.trim() ? { description: seoDescription.trim() } : {}) } }
                : {}),
            }, { refine });
          }}
          workingText="Writing the new page in your site's style. This can take a minute or two."
          phoneFirst={env.viewport === 'mobile'}
          onUndo={env.undo}
          onDone={env.closePanel}
        />
      )}
    >
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-page-title">Name</label>
        <input id="wme-gs-page-title" data-testid="page-title" className="wme-gs-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Wholesale" maxLength={80} disabled={busy} />
        {taken && !more && <p className="wme-gs-hint" style={{ marginTop: 4 }}>{addressTakenText()}</p>}
      </div>
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-page-what">What is the page for?</label>
        <textarea id="wme-gs-page-what" data-testid="editor-instruction" className="wme-gs-textarea" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="For example: prices for cafes and shops buying in bulk, how to order, and a contact form" maxLength={2000} disabled={busy} />
      </div>
      <button type="button" className="wme-gs-link" aria-expanded={more} aria-controls="wme-gs-page-more" data-testid="page-more-options" onClick={() => setMore((m) => !m)}>
        {more ? 'Fewer options' : 'More options'}
      </button>
      {more && (
        <div id="wme-gs-page-more" data-testid="page-more" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="wme-gs-label" htmlFor="wme-gs-page-address">Address</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="wme-gs-hint" aria-hidden="true">{`/${under ? `${under}/` : ''}`}</span>
              <input id="wme-gs-page-address" data-testid="page-address" className="wme-gs-input" value={address ?? slugFromTitle(title)} onChange={(e) => setAddress(e.target.value)} placeholder="wholesale" maxLength={80} disabled={busy} aria-invalid={taken} />
            </div>
            {taken && <p className="wme-gs-hint" style={{ marginTop: 4 }}>{addressTakenText()}</p>}
          </div>
          {!blockSite && (
            <>
              <div>
                <label className="wme-gs-label" htmlFor="wme-gs-page-menu">In the menu</label>
                <select id="wme-gs-page-menu" className="wme-gs-select wm-select" value={location} onChange={(e) => { setLocation(e.target.value); setPosition(null); }} disabled={busy}>
                  <option value="">Not in a menu</option>
                  {menus.map((m) => <option key={m.location} value={m.location}>{m.label}</option>)}
                </select>
              </div>
              {location && (
                <div className="wme-gs-row2">
                  <div>
                    <label className="wme-gs-label" htmlFor="wme-gs-page-menu-label">Its label</label>
                    <input id="wme-gs-page-menu-label" data-testid="page-menu-label" className="wme-gs-input" value={label ?? title} onChange={(e) => setLabel(e.target.value)} maxLength={60} disabled={busy} />
                  </div>
                  <div>
                    <label className="wme-gs-label" htmlFor="wme-gs-page-menu-where">Where</label>
                    <select id="wme-gs-page-menu-where" data-testid="page-menu-position" className="wme-gs-select wm-select" value={position === null ? 'end' : String(position)} onChange={(e) => setPosition(e.target.value === 'end' ? null : Number(e.target.value))} disabled={busy}>
                      <option value="end">At the end</option>
                      {menuItems.length > 0 && <option value="0">First</option>}
                      {menuItems.map((item, i) => <option key={item.id} value={String(i + 1)}>{`After ${item.label}`}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </>
          )}
          {options && (
            <>
              <div>
                <label className="wme-gs-label" htmlFor="wme-gs-page-parent">Under another page</label>
                <select id="wme-gs-page-parent" data-testid="page-parent" className="wme-gs-select wm-select" value={String(parent)} onChange={(e) => setParent(Number(e.target.value) || 0)} disabled={busy}>
                  <option value="0">No, at the top</option>
                  {pages.filter((p) => ownPage(p) && p.slug !== 'index' && p.postId).map((p) => <option key={p.slug} value={String(p.postId)}>{p.title}</option>)}
                </select>
              </div>
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }} disabled={busy}>
                <legend className="wme-gs-label">Publish now or keep as a draft</legend>
                <Radio name="wme-gs-page-status" value="publish" checked={status === 'publish'} onChange={() => setStatus('publish')} label={<span data-testid="page-status-publish">Publish it when you apply it</span>} disabled={busy} />
                <Radio name="wme-gs-page-status" value="draft" checked={status === 'draft'} onChange={() => setStatus('draft')} label={<span data-testid="page-status-draft">Keep it as a draft</span>} disabled={busy} />
              </fieldset>
              <div>
                <label className="wme-gs-label" htmlFor="wme-gs-page-like">Look like</label>
                <select id="wme-gs-page-like" data-testid="page-like" className="wme-gs-select wm-select" value={like} onChange={(e) => setLike(e.target.value)} disabled={busy}>
                  <option value="">Its own layout</option>
                  {pages.filter((p) => ownPage(p) && p.sections.length > 0).map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}
                </select>
              </div>
              <div>
                <label className="wme-gs-label" htmlFor="wme-gs-page-seo-title">Search title</label>
                <input id="wme-gs-page-seo-title" data-testid="page-seo-title" className="wme-gs-input" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} maxLength={120} disabled={busy} />
              </div>
              <div>
                <label className="wme-gs-label" htmlFor="wme-gs-page-seo-description">Search description</label>
                <textarea id="wme-gs-page-seo-description" data-testid="page-seo-description" className="wme-gs-textarea" style={{ minHeight: 60 }} value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} maxLength={320} disabled={busy} />
                <p className="wme-gs-hint" style={{ marginTop: 4 }}>Leave them empty to use what the page says.</p>
              </div>
            </>
          )}
        </div>
      )}
      {blockSite ? (
        <p className="wme-gs-hint">The page is written in your theme's style and goes live when you publish it. Add it to a menu from the menu editor afterwards.</p>
      ) : !(options && status) && (
        <p className="wme-gs-hint">On a site you connected, the new page is saved as a draft: it goes live when you publish it. A site WPMaven hosts publishes it right away.</p>
      )}
    </PanelFrame>
  );
}

/**
 * The site without one page (2026-10-17, from the sidebar's trash): its
 * preview opens at once, then Apply as any change. Its menu links go too,
 * and links to it on other pages are changed.
 */
export function RemovePagePanel({ env, page, title, onRemoved }: { env: EditorEnv; page: string; title: string; onRemoved: () => void }) {
  const flow = useEditOperation();
  useFrameFollows(flow, env);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void flow.preview({ op: 'remove_page', page });
  }, [flow, page]);
  const told = useRef(false);
  useEffect(() => {
    if (flow.state.phase !== 'published' || told.current) return;
    told.current = true;
    env.listsChanged?.();
    onRemoved();
  }, [flow.state.phase, env, onRemoved]);
  return (
    <PanelFrame
      chip="Remove a page"
      color="var(--rose)"
      title={`Remove ${title}`}
      sub="You see the site without it before it goes"
      onClose={env.closePanel}
      testId="editor-remove-page"
      footer={(
        <PreviewFlow
          flow={flow}
          canPreview
          onPreview={() => { void flow.preview({ op: 'remove_page', page }); }}
          previewLabel="Preview without it"
          workingText="Preparing the site without this page."
          onUndo={env.undo}
          onDone={env.closePanel}
        />
      )}
    >
      <p className="wme-gs-hint">Its menu links go too, and links to it on other pages are changed.</p>
    </PanelFrame>
  );
}

/**
 * What the open page offers (2026-10-17, the actions the page list's rows
 * had): rewrite it, a new layout (the homepage: refresh its look, or a new
 * one), and for a draft, publish it.
 */
export function PageActions({ env, page }: { env: EditorEnv; page: SiteMapPage }) {
  // A page added on a connected site waits as a draft until the owner publishes it.
  const publishing = useEditOperation();
  useAppliedFollows(publishing, env);
  const isHome = page.slug === 'index';
  const hasSections = page.sections.length > 0;
  const draft = page.status === 'draft' && publishing.state.phase !== 'published';
  const canRewrite = !page.template && hasSections;
  const canRedesign = hasSections && !isHome && !/blog|posts/i.test(page.template ?? '');
  if (!canRewrite && !canRedesign && !(isHome && hasSections) && !(draft && page.postId) && !publishing.state.result && !publishing.state.error) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="editor-page-actions">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
        {canRewrite && (
          <button type="button" className="wme-gs-link" data-testid="editor-rewrite-page" onClick={() => env.openPanel({ kind: 'rewrite', page: page.slug })}>
            Rewrite this page
          </button>
        )}
        {isHome && hasSections && (
          <>
            <button type="button" className="wme-gs-link" data-testid="editor-redesign-page" onClick={() => env.openPanel({ kind: 'redesign', page: page.slug, mode: 'refresh' })}>
              Refresh the look
            </button>
            <button type="button" className="wme-gs-link" data-testid="editor-new-homepage" onClick={() => env.openPanel({ kind: 'redesign', page: page.slug, mode: 'new' })}>
              New homepage
            </button>
          </>
        )}
        {canRedesign && (
          <button type="button" className="wme-gs-link" data-testid="editor-redesign-page" onClick={() => env.openPanel({ kind: 'redesign', page: page.slug })}>
            Redesign this page
          </button>
        )}
        {draft && page.postId && (
          <button
            type="button"
            className="wme-gs-link"
            data-testid="page-publish"
            disabled={publishing.state.phase === 'publishing'}
            onClick={async () => {
              const r = await publishing.publishNow({ op: 'update_post', postId: page.postId as number, fields: { status: 'publish' } });
              if (r?.status === 'published') { env.refreshSiteMap(); env.listsChanged?.(); }
            }}
          >
            {publishing.state.phase === 'publishing' ? 'Publishing' : 'Publish this page'}
          </button>
        )}
      </div>
      {draft && page.postId && <p className="wme-gs-hint">This page is a draft: visitors do not see it yet.</p>}
      {(publishing.state.result || publishing.state.error) && (
        <EditResultLine result={publishing.state.result} failure={publishing.state.error} />
      )}
    </div>
  );
}

/** Which homepage visitors land on, in owner words, and the switch the owner can make. */
export function homepageWords(front: SiteMapFrontPage): { text: string; hint?: string; action?: { use: 'designed' | 'previous'; label: string } } {
  if (front.showing === 'designed') {
    return front.previousAvailable
      ? { text: 'Visitors land on your new homepage.', hint: 'Your old homepage stays on your site. You can switch back any time.', action: { use: 'previous', label: 'Put the old one back' } }
      : { text: 'Visitors land on your new homepage.' };
  }
  if (front.showing === 'previous') {
    return { text: 'Visitors land on the homepage your site had before.', action: { use: 'designed', label: 'Use the new homepage' } };
  }
  return {
    text: front.currentTitle ? `Your site opens on ${front.currentTitle}, chosen in WordPress.` : 'Your site opens on a page chosen in WordPress.',
    action: { use: 'designed', label: 'Use the new homepage' },
  };
}

/**
 * The homepage switch: the designed homepage, or the one the site had before
 * WPMaven. A data change, live at once, in History with its undo.
 */
export function HomepageSwitch({ env }: { env: EditorEnv }) {
  const front = env.siteMap?.frontPage;
  const flow = useEditOperation();
  if (!front) return null;
  const words = homepageWords(front);
  const busy = flow.state.phase === 'publishing';
  return (
    <div className="wme-gs-note" data-testid="homepage-switch" data-showing={front.showing} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ margin: 0 }}>{words.text}</p>
      {words.hint && <p className="wme-gs-hint">{words.hint}</p>}
      {words.action && (
        <div className="wme-gs-actions">
          <Button
            variant="outline"
            size="sm"
            data-testid="homepage-switch-button"
            isLoading={busy}
            disabled={busy}
            onClick={async () => {
              const r = await flow.publishNow({ op: 'set_front_page', use: words.action!.use });
              if (r?.status === 'published') { env.showLive(); env.refreshSiteMap(); }
            }}
          >
            {words.action.label}
          </Button>
        </div>
      )}
      {(flow.state.result || flow.state.error) && (
        <>
          <EditResultLine result={flow.state.result} failure={flow.state.error} />
          {flow.state.result?.status === 'published' && flow.state.result.undoable && (
            <div className="wme-gs-actions"><Button variant="ghost" size="sm" onClick={() => env.undo(flow.state.result!)}>Undo</Button></div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One whole page rewritten from one instruction ("for a younger audience"):
 * every section of the page in one preview, the header and footer left as
 * they are.
 */
export function PageRewritePanel({ env, page }: { env: EditorEnv; page: { slug: string; title: string } }) {
  const [instruction, setInstruction] = useState('');
  const flow = useEditOperation();
  useFrameFollows(flow, env, page.slug);
  const busy = flow.state.phase === 'previewing' || flow.state.phase === 'publishing';
  return (
    <PanelFrame
      chip="Whole page"
      color="var(--purple)"
      title={`Rewrite ${page.title}`}
      sub="Every section of this page, in one preview"
      onClose={env.closePanel}
      testId="editor-page-rewrite"
      footer={(
        <PreviewFlow
          flow={flow}
          canPreview={instruction.trim().length >= 3}
          onPreview={(refine) => {
            void flow.preview({ op: 'edit_site', instruction: instruction.trim(), scope: { pages: [page.slug], chrome: false }, view: env.view }, { refine });
          }}
          workingText="Going through every section of the page. This can take a few minutes."
          phoneFirst={env.viewport === 'mobile'}
          onUndo={env.undo}
          onDone={env.closePanel}
        />
      )}
    >
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-page-rewrite">How should this page change?</label>
        <textarea id="wme-gs-page-rewrite" data-testid="editor-instruction" className="wme-gs-textarea" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="For example: speak to students and young professionals, with shorter sentences" maxLength={2000} disabled={busy} />
      </div>
      <p className="wme-gs-hint">The header and footer stay as they are. To change them, or every page, ask in the chat.</p>
    </PanelFrame>
  );
}
