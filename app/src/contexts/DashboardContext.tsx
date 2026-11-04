import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { wpApi } from '../services/wpApi';
import { wpRest } from '../services/wpRest';
import { storeAppData } from '../components/Dashboard/store/shared/storeContext';
import { getHashParts, navigateHash, onHashChange } from '../hooks/useHashRoute';
import { hashForPage, movedHash, routeById, routeForHash } from '../components/Dashboard/pages/registry/routes';
import {
  TEMPLATE_TITLES, addressOfItem, editorAddressOf, editorHash, fetchEditorItem, sameEditorAddress,
  type EditorAddress, type EditorItemKind, type EditorTemplate,
} from '../utils/editorAddress';

// ── Hash routing: the page lives in the URL hash so browser back/forward
//    work and dashboard pages are shareable. Every page and its address
//    come from the page registry (components/Dashboard/pages/registry). ──
function pageFromHash(): DashboardPage | null {
  const parts = getHashParts();
  return routeForHash(parts[0] ?? '')?.id ?? null;
}

/**
 * An address a page left when it moved (#/tasks, now #/team/plan) becomes
 * the new one, in place: Back never returns to it. True when it did.
 */
function followMovedAddress(): boolean {
  const to = movedHash(getHashParts());
  if (!to) return false;
  navigateHash(to, { replace: true });
  return true;
}

// Types
/**
 * The site's own counts on Overview's numbers card. Products and orders
 * only with WooCommerce, for a user who may open them; each is left out
 * when it could not be read.
 */
export interface DashboardStats {
  posts: number;
  pages: number;
  comments: number;
  users: number;
  products?: number;
  orders?: number;
}

/**
 * A total from a WooCommerce list (X-WP-Total), reading one item's id:
 * never a product's or an order's content. Unknown when it cannot be read.
 */
async function wooTotal(route: string): Promise<number | undefined> {
  try {
    const answer = await wpRest.get<unknown>(route, { query: { per_page: 1, _fields: 'id' } });
    return answer.total;
  } catch {
    return undefined;
  }
}

/** A page id of the page registry ('home', 'site-editor', 'settings', ...). */
export type DashboardPage = string;

/**
 * One item the editor opens. A template ('template', 2026-10-19) is the
 * product page or the post page itself (slug: 'product' or 'post'), shown
 * with the record its id names.
 */
export interface EditorSidebarItem {
  type: 'page' | 'post' | 'product' | 'template' | 'template-part';
  id: string | number;
  title: string;
  url?: string;
  slug?: string;
}

/**
 * What the Editor page's sidebar asks of the editor beside it (2026-10-17):
 * the Add form of the tab it shows, in the editor's right panel; the site
 * without a page (its plan slug), previewed there before it goes.
 */
export type EditorRequest =
  | { action: 'add'; kind: 'page' | 'post' | 'product' }
  | { action: 'remove-page'; page: string; title: string };

function loadSidebarState(page: DashboardPage): boolean {
  try {
    const val = localStorage.getItem(`wm-sidebar-${page}`);
    if (val !== null) return val === '1';
  } catch {}
  // Per-page default: the editor open, every other page closed.
  return routeById(page)?.sidebarOpen === true;
}

function saveSidebarState(page: DashboardPage, open: boolean) {
  try { localStorage.setItem(`wm-sidebar-${page}`, open ? '1' : '0'); } catch {}
}

interface DashboardState {
  currentPage: DashboardPage;
  editorPostId: number | null;
  editorSelectedItem: EditorSidebarItem | null;
  /**
   * The item the editor's address names (#/editor/post/2321: a reload, a
   * pasted link, the Blog screen's "Edit content"), until it is read and
   * selected; the sidebar selects the homepage only once it is settled.
   */
  editorTarget: EditorAddress | null;
  /** What the editor shows, as visitors see it (a draft: its preview): View site opens it; null outside the editor. */
  editorViewUrl: string | null;
  /** The sidebar's request, until the editor takes it. */
  editorRequest: EditorRequest | null;
  /** A preview shows in the editor's frame: the open page's row has no trash meanwhile. */
  editorPreviewing: boolean;
  /** Counts the pages, posts and products the editor added or removed: the sidebar reads its lists again. */
  editorListsVersion: number;
  /** The product page and the post page the site map offers (the sidebar's Templates), once the editor read it. */
  editorTemplates: EditorTemplate[];
  sidebarOpen: boolean;
  sidebarMobileOpen: boolean;
  stats: DashboardStats | null;
  isLoadingStats: boolean;
}

/**
 * Navigation guard — returns true to allow, false to block (guard will handle navigation itself).
 * The `proceed` callback should be called by the guard when it's ready to allow navigation.
 */
type NavigationGuard = (targetPage: DashboardPage, proceed: () => void) => boolean;

interface DashboardContextValue extends DashboardState {
  setCurrentPage: (page: DashboardPage) => void;
  /** The editor on one item by its id (a post unless kind says otherwise; its real kind is read with it). */
  openEditor: (postId: number, kind?: EditorItemKind) => void;
  setEditorViewUrl: (url: string | null) => void;
  selectEditorItem: (item: EditorSidebarItem) => void;
  /** The sidebar asks the editor (null: the editor took the request). */
  requestEditor: (request: EditorRequest | null) => void;
  setEditorPreviewing: (on: boolean) => void;
  editorListsChanged: () => void;
  setEditorTemplates: (templates: EditorTemplate[]) => void;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  toggleMobileSidebar: () => void;
  /**
   * Opens or closes the menu for a moment, without keeping it as the page's
   * choice: a guided tour shows the menu, then puts it back.
   */
  peekSidebar: (open: boolean) => void;
  refreshStats: () => Promise<void>;
  /** Reads the site's counts once, for the screen that shows them. */
  ensureContent: () => void;
  navigateToWpAdmin: (path: string) => void;
  /** Register a navigation guard (e.g. for unsaved changes). Pass null to unregister. */
  setNavigationGuard: (guard: NavigationGuard | null) => void;
}

const STORAGE_KEY = 'webmaven-dashboard-state';

const DashboardContext = createContext<DashboardContextValue | undefined>(undefined);

/** The dashboard's context where it may be absent (the editor rendered on its own, its tests). */
export function useDashboardOptional(): DashboardContextValue | undefined {
  return useContext(DashboardContext);
}

export function useDashboard(): DashboardContextValue {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DashboardState>(() => {
    let page: DashboardPage = 'home';
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const p = JSON.parse(saved).currentPage;
        if (typeof p === 'string' && routeById(p)) page = p;
      }
    } catch {}
    // A deep link wins over the remembered page: pasting
    // ...#/finance must land on Finance, not on last-visited.
    followMovedAddress();
    const fromHash = pageFromHash();
    if (fromHash) page = fromHash;
    const target = page === 'site-editor' ? editorAddressOf(getHashParts()) : null;
    return {
      currentPage: page,
      editorPostId: target?.id ?? null,
      editorSelectedItem: null,
      editorTarget: target,
      editorViewUrl: null,
      editorRequest: null,
      editorPreviewing: false,
      editorListsVersion: 0,
      editorTemplates: [],
      sidebarOpen: loadSidebarState(page),
      sidebarMobileOpen: false,
      stats: null,
      isLoadingStats: false,
    };
  });

  // Persist current page
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentPage: state.currentPage }));
    } catch {}
  }, [state.currentPage]);

  const navigationGuardRef = useRef<NavigationGuard | null>(null);

  const setNavigationGuard = useCallback((guard: NavigationGuard | null) => {
    navigationGuardRef.current = guard;
  }, []);

  const doSetCurrentPage = useCallback((page: DashboardPage) => {
    setState(prev => ({
      ...prev,
      currentPage: page,
      sidebarOpen: loadSidebarState(page),
      sidebarMobileOpen: false,
    }));
  }, []);

  const setCurrentPage = useCallback((page: DashboardPage) => {
    const guard = navigationGuardRef.current;
    if (guard) {
      const allowed = guard(page, () => doSetCurrentPage(page));
      if (!allowed) return; // guard is handling it (e.g. showing a modal)
    }
    doSetCurrentPage(page);
  }, [doSetCurrentPage]);

  // ── Hash ↔ page sync ──────────────────────────────────────────────────────
  // State → hash: every page change becomes a history entry.
  const currentPageRef = useRef(state.currentPage);
  currentPageRef.current = state.currentPage;
  useEffect(() => {
    // A deep link inside the page (#/store/products/31) keeps its sub-path:
    // only an address naming another page is rewritten.
    if ((getHashParts()[0] ?? '') === hashForPage(state.currentPage)) return;
    navigateHash(hashForPage(state.currentPage));
  }, [state.currentPage]);

  // Hash → state: browser back/forward and pasted links drive the page. Runs
  // through the navigation guard; a blocked navigation reverts the hash so
  // URL and screen never disagree.
  useEffect(() => {
    return onHashChange(() => {
      // An old address: its new one's own change follows, and is read then.
      if (followMovedAddress()) return;
      const page = pageFromHash();
      // An editor address naming another item than the one shown (or asked): that item is read and opened.
      const target = page === 'site-editor' ? editorAddressOf(getHashParts()) : null;
      if (target) {
        setState(prev => (sameEditorAddress(prev.editorSelectedItem ? addressOfItem(prev.editorSelectedItem) : null, target) || sameEditorAddress(prev.editorTarget, target)
          ? prev
          : { ...prev, editorTarget: target, editorPostId: target.id }));
      }
      if (!page || page === currentPageRef.current) return;
      const guard = navigationGuardRef.current;
      if (guard) {
        const allowed = guard(page, () => doSetCurrentPage(page));
        if (!allowed) {
          navigateHash(hashForPage(currentPageRef.current), { replace: true });
          return;
        }
      }
      doSetCurrentPage(page);
    });
  }, [doSetCurrentPage]);

  // "Edit content" and the like (2026-10-19): through the editor's address,
  // so the item opens (and a reload comes back to it).
  const openEditor = useCallback((postId: number, kind: EditorItemKind = 'post') => {
    const target: EditorAddress = { kind, id: postId };
    navigateHash(editorHash(target));
    setState(prev => ({
      ...prev,
      currentPage: 'site-editor',
      editorPostId: postId,
      editorTarget: target,
      sidebarOpen: loadSidebarState('site-editor'),
      sidebarMobileOpen: false,
    }));
  }, []);

  // The item the address names, read once: selected (the editor opens it), or the homepage when it is gone.
  const editorTarget = state.editorTarget;
  useEffect(() => {
    if (!editorTarget) return undefined;
    let live = true;
    void fetchEditorItem(editorTarget.id).then((item) => {
      if (!live) return;
      setState(prev => {
        if (prev.editorTarget !== editorTarget) return prev;
        if (!item) return { ...prev, editorTarget: null };
        // The product page (or the post page) shown with this product (or post): a published one of that kind only.
        if (editorTarget.template && item.type === editorTarget.kind && item.status !== 'draft') {
          const kind = editorTarget.kind === 'post' ? 'post' : 'product';
          return { ...prev, editorTarget: null, editorPostId: item.id, editorSelectedItem: { type: 'template', id: item.id, title: TEMPLATE_TITLES[kind], url: item.url, slug: kind } };
        }
        const type: EditorSidebarItem['type'] = item.type === 'post' || item.type === 'product' ? item.type : 'page';
        return { ...prev, editorTarget: null, editorPostId: item.id, editorSelectedItem: { type, id: item.id, title: item.title, url: item.url } };
      });
    });
    return () => { live = false; };
  }, [editorTarget]);

  const setEditorViewUrl = useCallback((url: string | null) => {
    setState(prev => (prev.editorViewUrl === url ? prev : { ...prev, editorViewUrl: url }));
  }, []);

  const selectEditorItem = useCallback((item: EditorSidebarItem) => {
    setState(prev => ({ ...prev, editorSelectedItem: item, editorPostId: Number(item.id) || null }));
  }, []);

  const requestEditor = useCallback((request: EditorRequest | null) => {
    setState(prev => ({ ...prev, editorRequest: request }));
  }, []);

  const setEditorPreviewing = useCallback((on: boolean) => {
    setState(prev => (prev.editorPreviewing === on ? prev : { ...prev, editorPreviewing: on }));
  }, []);

  const editorListsChanged = useCallback(() => {
    setState(prev => ({ ...prev, editorListsVersion: prev.editorListsVersion + 1 }));
  }, []);

  const setEditorTemplates = useCallback((templates: EditorTemplate[]) => {
    setState(prev => (JSON.stringify(prev.editorTemplates) === JSON.stringify(templates) ? prev : { ...prev, editorTemplates: templates }));
  }, []);

  const toggleSidebar = useCallback(() => {
    setState(prev => {
      const next = !prev.sidebarOpen;
      saveSidebarState(prev.currentPage, next);
      return { ...prev, sidebarOpen: next };
    });
  }, []);

  const closeSidebar = useCallback(() => {
    setState(prev => {
      saveSidebarState(prev.currentPage, false);
      return { ...prev, sidebarOpen: false, sidebarMobileOpen: false };
    });
  }, []);

  const toggleMobileSidebar = useCallback(() => {
    setState(prev => ({ ...prev, sidebarMobileOpen: !prev.sidebarMobileOpen }));
  }, []);

  const peekSidebar = useCallback((open: boolean) => {
    setState(prev => ({ ...prev, sidebarOpen: open }));
  }, []);

  const refreshStats = useCallback(async () => {
    setState(prev => ({ ...prev, isLoadingStats: true }));
    try {
      // Only the totals matter: each read carries one item's id, never a post's content.
      // The store's, with WooCommerce and for a user who may open it.
      const store = storeAppData();
      const [postsRes, pagesRes, commentsRes, usersRes, products, orders] = await Promise.all([
        wpApi.getPosts({ per_page: 1, _embed: false, _fields: 'id' }),
        wpApi.getPages({ per_page: 1, _embed: false, _fields: 'id' }),
        wpApi.getComments({ per_page: 1 }),
        wpApi.getUsers({ per_page: 1 }),
        store.wooActive && store.caps.products ? wooTotal('wc/v3/products') : undefined,
        store.wooActive && store.caps.orders ? wooTotal('wc/v3/orders') : undefined,
      ]);
      const stats: DashboardStats = { posts: postsRes.total, pages: pagesRes.total, comments: commentsRes.total, users: usersRes.total };
      if (typeof products === 'number') stats.products = products;
      if (typeof orders === 'number') stats.orders = orders;
      setState(prev => ({ ...prev, stats, isLoadingStats: false }));
    } catch {
      // Unknown, never zero: a failed read is not an empty site.
      setState(prev => ({ ...prev, stats: null, isLoadingStats: false }));
    }
  }, []);

  const navigateToWpAdmin = useCallback((path: string) => {
    // admin_url(), as the plugin hands it over (WEBMAVEN_WP_DATA.adminUrl).
    const adminUrl = (window as any).WEBMAVEN_WP_DATA?.adminUrl || '/wp-admin/';
    window.location.href = `${adminUrl}${path}`;
  }, []);

  // The site's counts are read once, when a screen that shows them mounts
  // (ensureContent), not on every screen.
  const contentRequested = useRef(false);
  const ensureContent = useCallback(() => {
    if (contentRequested.current) return;
    contentRequested.current = true;
    void refreshStats();
  }, [refreshStats]);

  const value: DashboardContextValue = {
    ...state,
    setCurrentPage, openEditor, setEditorViewUrl, selectEditorItem,
    requestEditor, setEditorPreviewing, editorListsChanged, setEditorTemplates,
    toggleSidebar, closeSidebar, toggleMobileSidebar, peekSidebar,
    refreshStats, ensureContent, navigateToWpAdmin,
    setNavigationGuard,
  };

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export default DashboardContext;
