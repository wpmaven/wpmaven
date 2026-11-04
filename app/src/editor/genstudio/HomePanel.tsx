import React, { useEffect, useState } from 'react';
import { pageFor } from './bindings';
import { useFrameFollows, type EditorEnv } from './env';
import { PanelFrame, PreviewFlow, Working } from './ui';
import { useEditOperation } from './useEditOperation';
import { dropMove, orderAfterMoves, type SectionMove } from './sectionOrder';
import { HomepageSwitch, PageActions } from './PagesPanels';

const Glyph = ({ d }: { d: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

/**
 * What the editor shows before anything is selected: the sections of the
 * page in the frame (a click selects one), what the page itself offers
 * (rewrite it, a new layout, publish a draft: 2026-10-17, from the page
 * list that went), and the changes that are not about one part of a page.
 * A change across the site is asked in the chat.
 */
export function HomePanel({ env, loadingMap }: { env: EditorEnv; loadingMap: boolean }) {
  const page = pageFor(env.siteMap, env.currentPage);
  const live = page?.sections.length
    ? page.sections.map((s) => ({ sectionId: s.id, label: s.label, excerpt: s.excerpt }))
    : env.outline.map((o) => ({ sectionId: o.sectionId, label: o.label, excerpt: '' }));
  const flow = useEditOperation();
  useFrameFollows(flow, env, env.currentPage);
  /** The drops of this session: the outline follows the preview's order, and a reorder is one change. */
  const [moves, setMoves] = useState<SectionMove[]>([]);
  const [dragged, setDragged] = useState<string | null>(null);
  // A discarded reorder puts the outline back in the live order.
  useEffect(() => { if (flow.state.phase === 'idle') setMoves([]); }, [flow.state.phase]);
  const order = orderAfterMoves(live.map((s) => s.sectionId), moves);
  const sections = order.map((id) => live.find((s) => s.sectionId === id)!).filter(Boolean);
  const reordering = flow.state.phase !== 'idle';
  const canDrag = !!page && env.siteMap?.editable !== false && flow.state.phase !== 'previewing' && flow.state.phase !== 'publishing' && flow.state.phase !== 'published';

  const drop = (target: string) => {
    const from = dragged;
    setDragged(null);
    if (!page || !from) return;
    const m = dropMove(page.slug, order, from, target);
    if (!m) return;
    const refine = flow.state.phase === 'previewed' && flow.state.operation?.op === 'move_section';
    void flow.preview(m, { refine }).then((r) => {
      if (r?.status === 'previewed' && r.ok) setMoves((cur) => [...(refine ? cur : []), m]);
    });
  };

  const repreview = () => {
    void (async () => {
      let ok = true;
      for (const [i, m] of moves.entries()) {
        if (!ok) break;
        const r = await flow.preview(m, { refine: i > 0 });
        ok = r?.status === 'previewed' && !!r.ok;
      }
    })();
  };

  const entries: Array<{ key: string; title: string; hint: string; icon: React.ReactNode; onClick: () => void; testId?: string }> = [
    { key: 'design', title: 'Colors and fonts', hint: 'The look of every page', icon: <Glyph d={<><circle cx="13.5" cy="6.5" r="2.5" /><circle cx="6.5" cy="12" r="2.5" /><circle cx="17.5" cy="15.5" r="2.5" /><path d="M12 22a10 10 0 1 1 10-10" /></>} />, onClick: () => env.openPanel({ kind: 'design' }) },
    { key: 'identity', title: 'Logo and site icon', hint: 'The picture in your header and the small one in browser tabs', icon: <Glyph d={<><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></>} />, onClick: () => env.openPanel({ kind: 'identity' }) },
    { key: 'facts', title: 'Business details', hint: 'Phone, email, address, hours', icon: <Glyph d={<><path d="M3 21V7l9-4 9 4v14" /><path d="M9 21v-6h6v6" /></>} />, onClick: () => env.openPanel({ kind: 'facts' }) },
    { key: 'menu', title: 'Menus', hint: 'The links in your header and footer', icon: <Glyph d={<><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>} />, onClick: () => env.openPanel({ kind: 'menu' }) },
    { key: 'history', title: 'History', hint: 'Every change, with its undo', icon: <Glyph d={<><polyline points="1 4 1 10 7 10" /><path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" /></>} />, onClick: () => env.openPanel({ kind: 'history' }) },
  ];

  return (
    <PanelFrame chip="Editor" color="var(--purple)" title="Click any part of your site to change it" sub="A section, the header or footer, a product, a menu link, a detail or an image" testId="editor-home">
      {loadingMap && <Working text="Reading your site." />}
      {sections.length > 0 && (
        <div>
          <p className="wme-gs-section-title" style={{ marginBottom: 8 }}>{page ? `Sections of ${page.title}` : 'Sections of this page'}</p>
          <ul className="wme-gs-list" data-testid="editor-outline">
            {sections.map((s) => (
              <li
                key={s.sectionId}
                data-testid="editor-outline-row"
                data-section={s.sectionId}
                onDragOver={(e) => { if (dragged && dragged !== s.sectionId) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); drop(s.sectionId); }}
                style={{ display: 'flex', alignItems: 'stretch', gap: 6, opacity: dragged === s.sectionId ? 0.5 : 1 }}
              >
                {canDrag && (
                  <span
                    role="button"
                    tabIndex={-1}
                    draggable
                    aria-label={`Drag to move ${s.label}`}
                    title={`Drag to move ${s.label}`}
                    data-testid="editor-outline-drag"
                    onDragStart={(e) => { setDragged(s.sectionId); try { e.dataTransfer.setData('text/plain', s.sectionId); e.dataTransfer.effectAllowed = 'move'; } catch { /* some browsers */ } }}
                    onDragEnd={() => setDragged(null)}
                    style={{ cursor: 'grab', display: 'flex', alignItems: 'center', padding: '0 4px', color: 'var(--muted, #888)' }}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
                  </span>
                )}
                <button type="button" className="wme-gs-entry" style={{ padding: '9px 12px', flex: 1 }} onClick={() => env.select({ kind: 'section', sectionId: s.sectionId, ...(env.currentPage ? { page: env.currentPage } : {}) })}>
                  <span style={{ minWidth: 0 }}>
                    {s.label}
                    {s.excerpt && <small style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.excerpt}</small>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {reordering && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {flow.state.phase === 'previewed' && <p className="wme-gs-hint" style={{ margin: 0 }}>Keep dragging to change the order more. It stays one change.</p>}
              <PreviewFlow
                flow={flow}
                canPreview={false}
                onPreview={repreview}
                workingText="Preparing the page in its new order."
                phoneFirst={env.viewport === 'mobile'}
                onUndo={env.undo}
                onDone={() => { flow.reset(); setMoves([]); }}
              />
            </div>
          )}
        </div>
      )}
      {page && <PageActions env={env} page={page} />}
      {/* Which homepage visitors land on: on the homepage, and anywhere while it is not the new one. */}
      {env.siteMap?.frontPage && (page?.slug === 'index' || env.siteMap.frontPage.showing !== 'designed') && <HomepageSwitch env={env} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p className="wme-gs-section-title">Also</p>
        {entries.map((e) => (
          <button key={e.key} type="button" className="wme-gs-entry" onClick={e.onClick} data-testid={`editor-entry-${e.key}`}>
            {e.icon}
            <span>{e.title}<small>{e.hint}</small></span>
          </button>
        ))}
      </div>
    </PanelFrame>
  );
}
