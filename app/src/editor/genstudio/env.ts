import { useEffect, useRef } from 'react';
import type { EditResult, EditView, ImageTarget, SiteMap } from '../../types/edits';
import type { ViewportMode } from '../components/SiteIframe';
import type { BindingAddress } from './bindings';
import type { EditOperationApi } from './useEditOperation';

/** How the homepage is redesigned: refreshed section by section, or a whole new design. */
export type RedesignMode = 'refresh' | 'new';

/** The panels of the editor (one shows at a time). */
export type PanelState =
  | { kind: 'home' }
  | { kind: 'section'; page: string; sectionId: string; label: string; inside: Array<{ uid: string; kind: string; label: string }> }
  | { kind: 'add-section'; page: string; afterSectionId: string | null }
  | { kind: 'chrome'; region: 'header' | 'footer' }
  | { kind: 'menu'; location?: string; itemId?: number }
  | { kind: 'design' }
  | { kind: 'product'; productId?: number; productSlug?: string; label: string }
  | { kind: 'post'; postId: number; label: string }
  | { kind: 'facts'; focusKey?: string }
  /** A designed form, by its name in the site map. */
  | { kind: 'form'; name: string }
  | { kind: 'image'; target: ImageTarget | null; src: string; alt: string; label: string; region?: 'header' | 'footer' }
  | { kind: 'add-page' }
  /** A new post or product (the sidebar's Add, by its tab). */
  | { kind: 'add-post' }
  | { kind: 'add-product' }
  /** The site without a page, previewed before it goes (the sidebar's trash). */
  | { kind: 'remove-page'; page: string; title: string }
  /** One whole page rewritten (the header and footer left alone). */
  | { kind: 'rewrite'; page: string }
  /** A new layout for one page (the homepage: a refresh or a whole new design). */
  | { kind: 'redesign'; page: string; mode?: RedesignMode }
  /** The logo and the site icon. */
  | { kind: 'identity' }
  | { kind: 'seo' }
  /** The business's social profiles: the site's social icons, its social menu, what search engines read. */
  | { kind: 'social' }
  | { kind: 'history' };

/** What every panel may ask of the editor around it. */
export interface EditorEnv {
  siteMap: SiteMap | null;
  viewport: ViewportMode;
  /** The view the owner looks at, with its width: what an instruction is read with (context, never a rule). */
  view?: EditView;
  /** The plan slug of the page the frame shows ('' while unknown). */
  currentPage: string;
  /** The sections of the page in the frame, in their order (from the frame). */
  outline: Array<{ page: string; sectionId: string; label: string }>;
  /** Show a preview in the frame (the page this panel works on, else the first touched). */
  showPreview: (result: EditResult, page?: string) => void;
  /** Back to the live page (reloaded, so a publish shows). */
  showLive: () => void;
  /** Read the site map again (after a publish changed pages, menus or facts). */
  refreshSiteMap: () => void;
  /** Ask the frame to select something by its address. */
  select: (address: Partial<BindingAddress> & { uid?: string }) => void;
  openPanel: (panel: PanelState) => void;
  closePanel: () => void;
  /** The Design panel's live colors and fonts in the frame. */
  setTokensLive: (vars: Record<string, string>) => void;
  resetTokensLive: () => void;
  loadFont: (href: string) => void;
  /** Open History on this change's undo. */
  undo: (result: EditResult) => void;
  /** A change that went live (any panel's publish): the top bar's Undo takes it back. */
  applied?: (result: EditResult) => void;
  /** Send words to the editor's chat, as the owner would (the chat opens). */
  ask?: (text: string) => void;
  /** A post or product just made: the frame opens it, and the sidebar's lists are read again. */
  openNew?: (item: { type: 'post' | 'product'; id: number; title: string; draft: boolean }) => void;
  /** A page added or removed: the sidebar's lists are read again. */
  listsChanged?: () => void;
}

/** Tell the editor a panel's change went live, once, so its top bar can undo it. */
export function useAppliedFollows(flow: EditOperationApi, env: EditorEnv): void {
  const told = useRef<string | null>(null);
  const envRef = useRef(env);
  envRef.current = env;
  useEffect(() => {
    const r = flow.state.result;
    if (flow.state.phase !== 'published' || !r || !r.ok || r.status !== 'published') return;
    if (told.current === r.operationId) return;
    told.current = r.operationId;
    envRef.current.applied?.(r);
  }, [flow.state]);
}

/**
 * The frame follows a panel's change: its preview once ready, the live site
 * once published or discarded. A change no page shows (the site icon) keeps
 * the live page in the frame: opts.preview false.
 */
export function useFrameFollows(flow: EditOperationApi, env: EditorEnv, page?: string, opts: { preview?: boolean } = {}): void {
  useAppliedFollows(flow, env);
  const showsPreview = opts.preview !== false;
  const last = useRef(flow.state.phase);
  const lastShown = useRef<string | null>(flow.state.preview?.operationId ?? null);
  const envRef = useRef(env);
  envRef.current = env;
  useEffect(() => {
    const prev = last.current;
    const s = flow.state;
    last.current = s.phase;
    const shownBefore = lastShown.current;
    lastShown.current = s.preview?.operationId ?? null;
    if (s.phase === 'previewed' && s.preview && (prev === 'previewing' || (prev === 'previewed' && shownBefore !== s.preview.operationId))) {
      // A new preview, or another version picked to compare.
      if (showsPreview) envRef.current.showPreview(s.preview, page);
    } else if (s.phase === 'published' && prev !== 'published') {
      envRef.current.showLive();
      envRef.current.refreshSiteMap();
    } else if (s.phase === 'idle' && (prev === 'previewed' || prev === 'publishing')) {
      envRef.current.showLive();
    }
  }, [flow.state, page, showsPreview]);
}
