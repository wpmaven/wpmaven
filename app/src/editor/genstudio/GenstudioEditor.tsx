import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TeamFace } from '../../components/team/TeamFace';
import { operatorRefOf, previewBanner } from '../../utils/team';
import type { EditResult, EditView, SiteMap, SiteMapPage } from '../../types/edits';
import { SiteIframe, viewOf, type IframeOffset, type ViewportMode } from '../components/SiteIframe';
import { useIframeMessages } from '../hooks/useIframeMessages';
import EmbeddedChat from '../../components/Dashboard/EmbeddedChat';
import type { ChatSiteChange } from '@yotako/webmaven-ui';
import {
  frameUrl, imageLabel, imageTargetFor, kindWord, parseHover, parseRect, parseSelection, placeTitle, sectionIdFor, sectionLabel, siteOrigin, slugForPost,
  type BindingAddress, type BindingHover, type BindingSelection,
} from './bindings';
import { ThemePartPanel } from './ThemePartPanel';
import { BindingOverlay } from './BindingOverlay';
import { GsStyle } from './styles';
import type { EditorEnv, PanelState } from './env';
import { HomePanel } from './HomePanel';
import { SectionPanel, builderText } from './SectionPanel';
import { AddSectionPanel } from './AddSectionPanel';
import { ChromePanel } from './ChromePanel';
import { MenuEditor } from './MenuEditor';
import { DesignPanel } from './DesignPanel';
import { ProductForm } from './ProductForm';
import { PostForm } from './PostForm';
import { FactsForm } from './FactsForm';
import { FormPanel } from './FormPanel';
import { ImagePanel } from './ImagePanel';
import { AddPagePanel, PageRewritePanel, RemovePagePanel } from './PagesPanels';
import { AddPostPanel } from './AddPostPanel';
import { AddProductPanel } from './AddProductPanel';
import { RedesignPanel } from './RedesignPanel';
import { IdentityPanel } from './IdentityPanel';
import { EditHistoryPanel } from './EditHistoryPanel';
import { SeoPanel } from './SeoPanel';
import { SocialLinksPanel } from './SocialLinksPanel';
import {
  ChevronDown, ChevronLeft, FileText, House, Menu, MessageSquare, Monitor, Palette, Plus, RotateCcw, Search, Smartphone, Tablet, Undo,
} from 'lucide-react';
import { useDashboardOptional } from '../../contexts/DashboardContext';
import {
  TEMPLATE_OF_MAP, TEMPLATE_TITLES, addressOfItem, editorKindOf, fetchEditorItem, rememberOpened, templateOfItem, templateRecord, writeEditorAddress,
  type EditorAddress, type EditorItem, type EditorItemKind, type TemplateKind,
} from '../../utils/editorAddress';
import { navigateHash } from '../../hooks/useHashRoute';
import { TemplateChooser } from '../window/TemplateChooser';
import { OverlayLayer } from '../window/OverlayLayer';
import { JobsLayer } from '../window/JobsLayer';
import { QuickWindow } from '../window/QuickWindow';
import { PageContextCard } from '../window/PageContextCard';
import { UnsavedChangesModal } from '../window/UnsavedChangesModal';
import { placeKey, useQuickEdit, type QuickJob } from '../window/useQuickEdit';
import { CROSSING_WORDS, JOB_WORDS, WINDOW_WORDS, caseLabel, ownNote } from '../window/labels';
import {
  containerOf, elementWord, inPageHtml, parseElementLook, parseElementRect, parseElementSelection, parseHoverElement, squashText,
  type ElementRect, type ElementSelection, type HoverElement,
} from '../window/elementEdit';

export interface EditorSelectedItem {
  type: string;
  id: string | number;
  title: string;
  url?: string;
}

/** The editor's selection as the chat reads it ("this" means it). */
export interface EditorChatContext {
  page: string;
  pageTitle: string;
  kind: string;
  label: string;
  excerpt?: string;
  sectionId?: string;
  region?: string;
  productId?: number;
  postId?: number;
  location?: string;
  itemId?: number;
  factKey?: string;
  slot?: string;
  /** An image's place: the section label (its sectionId and region ride above). */
  containerLabel?: string;
  /** A designed form's name (edit_form addresses it). */
  formName?: string;
  /** The post editor or the product editor: the server's lead follows it (the Content Writer, the E-commerce Manager). */
  focus?: 'post' | 'product';
  /** The element the editor window selected in it (a heading, a paragraph, a button), with its words. */
  element?: { kind: string; text: string };
  /** The view the owner looks at (desktop, tablet or phone, with its width): context like the page, never a rule. */
  view: EditView;
  /** The product page or the post page itself (2026-10-19): a change reaches every product (or post); showing: the record it shows. */
  template?: TemplateKind;
  showing?: { id: number; title: string };
}

/** A click on a dimmed part of the other editor (the frame's wme:crossing): where, and what it is. */
interface Crossing { to: 'record' | 'template'; view: TemplateKind; word: string; x: number; y: number }

function parseCrossing(p: Record<string, unknown>): Crossing | null {
  const to = p.to === 'record' || p.to === 'template' ? p.to : null;
  const view = p.view === 'product' || p.view === 'post' ? p.view : null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return to && view ? { to, view, word: typeof p.word === 'string' ? p.word.slice(0, 40) : '', x: num(p.x), y: num(p.y) } : null;
}

/** An element's words from its markup (inert: nothing in it loads or runs). */
export function htmlText(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  } catch {
    return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

/** Text the frame's element map can type into on the page (as before). */
const TEXT_CATEGORIES = ['text-heading', 'text-paragraph', 'text-button', 'text-quote', 'text-list', 'text-table', 'text-code', 'text-meta', 'text-link'];

/** The element's own panel (its words, image, card, menu, detail, form), as the frame's bindings address it. */
export function panelSelectionOf(sel: ElementSelection): BindingSelection | null {
  return sel.engine?.drill || sel.engine?.object || sel.engine?.container || null;
}

/** The section, header or footer around an element, as the window's own selection ("Whole Section"). */
export function wholeSectionOf(sel: ElementSelection): ElementSelection | null {
  const c = sel.engine?.container;
  if (!c) return null;
  return {
    uid: `binding:${c.uid}`,
    rect: parseElementRect({ ...c.rect, bottom: c.rect.top + c.rect.height, right: c.rect.left + c.rect.width }),
    source: 'binding',
    blockName: '',
    postId: sel.postId,
    category: 'layout-section',
    editable: false,
    content: '',
    textContent: c.excerpt || c.label || '',
    engine: { container: c, object: null, drill: null },
    label: kindWord(c),
    kind: c.kind === 'chrome' ? 'chrome' : 'section',
  };
}

/** The preview to show for a page: that page's own when it was touched, else the change shown on the page in the frame. */
export function previewUrlFor(result: EditResult, page: string, liveUrl: string): string | null {
  const preview = result.preview;
  if (!preview) return null;
  const own = preview.pages.find((p) => p.slug === page)?.url;
  if (own) return frameUrl(own, { wm_preview_bare: '1' });
  try {
    const token = new URL(preview.url, window.location.href).searchParams.get('wm_preview');
    const site = new URL(liveUrl, window.location.href);
    const touchesEveryPage = ['set_design_tokens', 'edit_chrome', 'update_menu', 'update_facts'].includes(result.kind);
    if (token && touchesEveryPage && site.origin === siteOrigin()) {
      site.searchParams.set('wm_preview', token);
      return frameUrl(site.toString(), { wm_preview_bare: '1' });
    }
  } catch { /* the first touched page then */ }
  return frameUrl(preview.pages[0]?.url || preview.url, { wm_preview_bare: '1' });
}

/** The frame's own parameters, which a visitor's address never carries. */
const FRAME_PARAMS = ['webmaven_discover', 'wm_preview_bare', 'wm_preview'];

/** What the editor shows, as a visitor opens it (View site): its live address without the frame's parameters (a draft keeps its preview). */
export function viewUrlOf(url: string): string {
  try {
    const u = new URL(url, window.location.href);
    for (const k of FRAME_PARAMS) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

/** Where a post or product just made opens: its address by id; a draft its preview, which the signed-in owner sees. */
export function newItemUrl(home: string, item: { type: 'post' | 'product'; id: number; draft: boolean }): string {
  const u = new URL(home, window.location.href);
  if (item.type === 'product') u.searchParams.set('post_type', 'product');
  u.searchParams.set('p', String(item.id));
  if (item.draft) u.searchParams.set('preview', 'true');
  return u.toString();
}

/** Whether a new panel is the one already open (the same section, region, card or menu): it stays as it is. */
export function samePanel(current: PanelState, next: PanelState): boolean {
  if (current.kind !== next.kind) return false;
  switch (next.kind) {
    case 'section': return current.kind === 'section' && current.page === next.page && current.sectionId === next.sectionId;
    case 'chrome': return current.kind === 'chrome' && current.region === next.region;
    case 'product': return current.kind === 'product' && ((!!next.productSlug && current.productSlug === next.productSlug) || (!!next.productId && current.productId === next.productId));
    case 'post': return current.kind === 'post' && current.postId === next.postId;
    case 'menu': return current.kind === 'menu' && current.location === next.location;
    case 'image': return current.kind === 'image' && JSON.stringify(current.target) === JSON.stringify(next.target) && !!next.target;
    case 'form': return current.kind === 'form' && current.name === next.name;
    default: return false;
  }
}

function addressOfPanel(panel: PanelState): Partial<BindingAddress> | null {
  switch (panel.kind) {
    case 'section': return { kind: 'section', page: panel.page, sectionId: panel.sectionId };
    case 'chrome': return { kind: 'chrome', region: panel.region };
    case 'product': return panel.productSlug ? { kind: 'product', productSlug: panel.productSlug } : null;
    case 'post': return { kind: 'post', postId: panel.postId };
    default: return null;
  }
}

const VIEWPORTS: Array<{ mode: ViewportMode; label: string; icon: React.ReactNode }> = [
  { mode: 'desktop', label: 'Desktop', icon: <Monitor /> },
  { mode: 'tablet', label: 'Tablet', icon: <Tablet /> },
  { mode: 'mobile', label: 'Phone', icon: <Smartphone /> },
];

/**
 * The editor of a site WPMaven built. The owner clicks a part of the site
 * (a section, the header or footer, a product or post card, a menu link, a
 * business detail, an image), says or sets what should change, sees the
 * preview in place with its checks, and publishes it; every change lands in
 * History with its undo. Colors and fonts and pages have their own panels;
 * a change across the site is asked in the chat (2026-10-17). The sidebar
 * beside the editor asks it for the Add form of its tab and for the site
 * without a page (DashboardContext's editorRequest).
 */
export default function GenstudioEditor({
  siteMap, loadingMap, onRefreshSiteMap, selectedItem, notice,
}: {
  siteMap: SiteMap | null;
  loadingMap: boolean;
  onRefreshSiteMap: () => void;
  selectedItem?: EditorSelectedItem | null;
  notice?: string | null;
}) {
  const homeUrl = useMemo(() => {
    const w = window as any;
    return w.wmeConfig?.siteUrl || w.WEBMAVEN_WP_DATA?.editor?.siteUrl || `${siteOrigin()}/`;
  }, []);
  const [liveUrl, setLiveUrl] = useState<string>(() => selectedItem?.url || homeUrl);
  // The page in the frame as the window's changes know it: they show on their own page only.
  const where = useMemo(() => placeKey(liveUrl), [liveUrl]);
  const whereRef = useRef(where);
  whereRef.current = where;
  // The frame's first address; every later page, preview or reload is set on the frame itself.
  const [initialSrc] = useState(() => frameUrl(selectedItem?.url || homeUrl));
  const [frameMode, setFrameMode] = useState<'live' | 'preview'>('live');
  // Who prepared the preview on screen (the API's operator), for the banner.
  const [previewBy, setPreviewBy] = useState<{ id: string; title: string } | null>(null);
  const [viewport, setViewport] = useState<ViewportMode>('desktop');
  const [offset, setOffset] = useState<IframeOffset>({ top: 0, left: 0, width: 0, height: 0 });
  const [panel, setPanel] = useState<PanelState>({ kind: 'home' });
  const [panelKey, setPanelKey] = useState(0);
  const [hovered, setHovered] = useState<BindingHover | null>(null);
  const [selected, setSelected] = useState<BindingSelection | null>(null);
  const [currentPage, setCurrentPage] = useState('');
  // This site's address: its links are named by their page in the window, never by their domain.
  const linkOrigin = useMemo(() => {
    try { return new URL(homeUrl, window.location.href).origin; } catch { return siteOrigin(); }
  }, [homeUrl]);
  // The WordPress id of the page in the frame (its search details, its row in the site map).
  const [framePostId, setFramePostId] = useState(() => Number(selectedItem?.id) || 0);
  const framePostIdRef = useRef(framePostId);
  framePostIdRef.current = framePostId;
  // What the editor shows (2026-10-19): a page, a post or a product, known
  // when the owner opens it (the sidebar's row), corrected by the frame when
  // the page says otherwise (a product opened from the page picker). The
  // chat is that editor's: the page editor's, the post editor's or the
  // product editor's.
  const [editorKind, setEditorKind] = useState<EditorItemKind>(() => editorKindOf(selectedItem?.type));
  const single = editorKind === 'page' ? null : editorKind;
  const editorKindRef = useRef(editorKind);
  editorKindRef.current = editorKind;
  // The product page or the post page itself (2026-10-19): the frame shows a
  // product (or post) as an example, its own parts dimmed, and every change
  // goes to the design all of them print with. The chat is the page
  // editor's (the Web Designer's).
  const [template, setTemplate] = useState<TemplateKind | null>(() => templateOfItem(selectedItem));
  const templateRef = useRef(template);
  templateRef.current = template;
  // The record's own name (the product's, the post's): the bar, the chat's line and its context say it, never the design page's.
  const [record, setRecord] = useState<{ id: number; title: string } | null>(() => (
    selectedItem && (selectedItem.type === 'post' || selectedItem.type === 'product') ? { id: Number(selectedItem.id) || 0, title: selectedItem.title } : null
  ));
  // A click on a dimmed part of the other editor: the note at the pointer.
  const [crossing, setCrossing] = useState<Crossing | null>(null);
  // The part to select again once the other editor mapped the page (a crossing): its uid, or the node clicked (true).
  const reselect = useRef<string | true | null>(null);
  const [outline, setOutline] = useState<EditorEnv['outline']>([]);
  // The sidebar is the editor chat; a panel opens over it ("More Options", All settings).
  const [side, setSide] = useState<'panel' | 'chat'>('chat');
  const [chatOpen, setChatOpen] = useState(true);
  // The editor window: the element the frame's element map selected, as before.
  const [elHovered, setElHovered] = useState<HoverElement | null>(null);
  const [elSelected, setElSelected] = useState<ElementSelection | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [ask, setAsk] = useState<{ text: string; token: number } | null>(null);
  const [toast, setToast] = useState<{ message: string; result?: EditResult } | null>(null);
  const [lastApplied, setLastApplied] = useState<EditResult | null>(null);
  // The chat changed the site: the card reads its item again (2026-10-19).
  const [siteVersion, setSiteVersion] = useState(0);
  // The frame's scroll, kept across a reload the owner did not ask for (a chat change).
  const pendingScroll = useRef(0);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [undoTarget, setUndoTarget] = useState<{ operationId: string; summary: string } | null>(null);
  const [missing, setMissing] = useState(false);
  const selectedAddress = useRef<Partial<BindingAddress> | null>(null);
  const siteMapRef = useRef(siteMap);
  siteMapRef.current = siteMap;
  const pageMenuRef = useRef<HTMLDivElement>(null);
  // The view the owner looks at, with the width its page is laid out at: the
  // chat's context and every instruction's, as the open page is (2026-10-17).
  const viewWidth = viewOf(viewport, offset).width;
  const view = useMemo<EditView>(() => ({ mode: viewport, width: viewWidth }), [viewport, viewWidth]);

  const { sendToIframe, setIframeRef, iframeRef } = useIframeMessages({
    'wme:discovery-ready': (p) => {
      setFramePostId(Number(p.postId) || 0);
      if (pendingScroll.current > 0) {
        const y = pendingScroll.current;
        pendingScroll.current = 0;
        try { iframeRef.current?.contentWindow?.scrollTo(0, y); } catch { /* another origin: it opens at the top */ }
      }
      // A new page: nothing on it is under the pointer yet.
      setElHovered(null);
      setHovered(null);
      const slug = slugForPost(siteMapRef.current, Number(p.postId) || 0, p.isFront === true);
      if (slug) setCurrentPage(slug);
      setCrossing(null);
      // The product page itself maps as the design; a crossing selects again the part it came from.
      const again = reselect.current;
      reselect.current = null;
      sendToIframe('wme:request-map', { bindings: true, page: slug, ...(templateRef.current ? { mode: 'template' } : {}), ...(again ? { reselect: again } : {}) });
    },
    // The page says what it is: a post's or a product's own page, or a page (view: none of them).
    'wme:map-ready': (p) => {
      // The page before may map itself once more while the next one loads: its map says nothing of this one.
      if (framePostIdRef.current > 0 && Number(p.postId) > 0 && Number(p.postId) !== framePostIdRef.current) return;
      // The page loaded (again): the window's changes asked on it look for their parts, by id, else by their words.
      quickRef.current.unplace();
      const mine = quickRef.current.jobs.filter(({ job }) => job.place.where === whereRef.current);
      if (mine.length) {
        // A change whose preview the page shows has its new words there: found by its id alone.
        sendToIframe('wme:locate', { items: mine.map(({ job }) => ({ id: job.id, uid: job.uid, words: job.shown ? '' : job.sel.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) })) });
      }
      // The product page itself: the page editor's chat, whatever the frame shows as its example.
      if (p.mode === 'template' || templateRef.current) return;
      if (p.single === 'post' || p.single === 'product') setEditorKind(p.single);
      else if (!p.view) setEditorKind('page');
    },
    'wme:hover': (p) => setElHovered(parseHoverElement(p)),
    'wme:hover-out': () => setElHovered(null),
    'wme:select': (p) => onElementSelectRef.current(p),
    'wme:positions': (p) => {
      setElHovered((h) => (h && p[h.uid] ? { ...h, rect: parseElementRect(p[h.uid]) } : h));
      setElSelected((s) => (s && p[s.uid] ? { ...s, rect: parseElementRect(p[s.uid]) } : s));
      // The window's changes on this page follow their parts.
      const moved: Record<string, ElementRect> = {};
      for (const { job } of quickRef.current.jobs) if (p[job.uid]) moved[job.uid] = parseElementRect(p[job.uid]);
      quickRef.current.follow(moved);
    },
    'wme:located': (p) => {
      for (const it of Array.isArray(p.items) ? p.items : []) {
        if (!it || typeof it.id !== 'string') continue;
        const uid = typeof it.uid === 'string' && it.uid ? it.uid : null;
        quickRef.current.place(it.id, uid, uid ? parseElementRect(it.rect) : undefined, parseElementLook(it.look));
        // A change opened from another page: its window opens once its part is found.
        if (pendingJob.current === it.id) {
          pendingJob.current = null;
          const job = uid ? quickRef.current.jobs.find((v) => v.job.id === it.id)?.job : null;
          if (job) focusJobRef.current(job);
        }
      }
    },
    'wme:editing-rect': (p) => {
      setElSelected((s) => (s && s.uid === p.uid ? { ...s, rect: parseElementRect(p.rect) } : s));
    },
    'wme:editing-done': (p) => onEditingDoneRef.current(p),
    // A click on (or inside) a part WPMaven works on: that change's window.
    'wme:busy-click': (p) => {
      const job = quickRef.current.jobAt(String(p.uid || ''));
      if (job) focusJobRef.current(job);
    },
    'wme:link-click': () => undefined,
    'wme:crossing': (p) => setCrossing(parseCrossing(p)),
    'wme:bindings-ready': (p) => {
      const sections = Array.isArray(p.sections) ? p.sections : [];
      setOutline(sections.filter((s: any) => s && typeof s.sectionId === 'string').map((s: any) => ({ page: String(s.page || ''), sectionId: s.sectionId, label: String(s.label || '') })));
      if (typeof p.page === 'string' && p.page) setCurrentPage(p.page);
      // A reload (a publish, a preview) keeps the selection's outline.
      if (selectedAddress.current) sendToIframe('wme:highlight', selectedAddress.current as Record<string, unknown>);
    },
    'wme:binding-hover': (p) => setHovered(parseHover(p)),
    'wme:binding-hover-out': () => setHovered(null),
    'wme:binding-positions': (p) => {
      setHovered((h) => (h && p[h.uid] ? { ...h, rect: parseRect(p[h.uid]) } : h));
      setSelected((s) => (s && p[s.uid] ? { ...s, rect: parseRect(p[s.uid]) } : s));
    },
    'wme:binding-highlighted': (p) => {
      const sel = parseSelection(p);
      if (sel) setSelected(sel);
    },
    'wme:binding-missing': () => setMissing(true),
    'wme:select-binding': (p) => {
      const sel = parseSelection(p);
      if (sel) openSelection(onMapSections(sel));
    },
    'wme:deselect': () => { setSelected(null); selectedAddress.current = null; closeWindowRef.current(); },
  });

  /** A block page's frame binding with the section the site map names (a heading and its text are one section). */
  const onMapSections = (sel: BindingSelection): BindingSelection => {
    const map = siteMapRef.current;
    // A designed page's sections keep their ids; blocks the owner added on it are found as on a block page.
    if (map?.engine !== 'wordpress' && typeof sel.binding.blockIndex !== 'number') return sel;
    const fix = <T extends BindingAddress>(a: T): T => (a.kind === 'section' ? { ...a, sectionId: sectionIdFor(map, a) } : a);
    return { ...sel, binding: fix(sel.binding), ...(sel.container ? { container: fix(sel.container) } : {}) };
  };

  const navigate = useCallback((url: string) => {
    if (iframeRef.current) iframeRef.current.src = url;
  }, [iframeRef]);

  // The app around the editor (absent when the editor is drawn on its own): its sidebar, its navigation guard, its address.
  const dashboard = useDashboardOptional();
  const listsChanged = dashboard?.editorListsChanged;
  const selectItem = dashboard?.selectEditorItem;
  const inApp = !!dashboard;
  /** The editor's address names what it shows (#/editor/product/27), written in place on every move. */
  const writeAddress = useCallback((item: EditorAddress | null) => {
    if (inApp) writeEditorAddress(item);
  }, [inApp]);

  const showLive = useCallback(() => {
    setPreviewBy(null);
    setFrameMode('live');
    navigate(frameUrl(liveUrl));
  }, [liveUrl, navigate]);

  const showPreview = useCallback((result: EditResult, page?: string) => {
    const url = previewUrlFor(result, page || currentPage, liveUrl);
    if (!url) return;
    setPreviewBy(operatorRefOf(result.operator));
    setFrameMode('preview');
    navigate(url);
  }, [currentPage, liveUrl, navigate]);

  const openPanel = useCallback((next: PanelState) => {
    setPanel(next);
    setPanelKey((k) => k + 1);
    setSide('panel');
    setMissing(false);
    if (next.kind !== 'history') setUndoTarget(null);
    const address = addressOfPanel(next);
    selectedAddress.current = address;
    // An image keeps its selection (the frame's outline, and the chat's "this").
    if (!address && next.kind !== 'image') setSelected(null);
    if (frameMode === 'preview') {
      // A new panel works on the live site.
      setFrameMode('live');
      navigate(frameUrl(liveUrl));
    }
  }, [frameMode, liveUrl, navigate]);

  const panelRef = useRef(panel);
  panelRef.current = panel;

  const openSelection = useCallback((sel: BindingSelection) => {
    setSelected(sel);
    const b = sel.binding;
    let next: PanelState | null = null;
    switch (sel.kind) {
      case 'section':
        next = { kind: 'section', page: b.page || currentPage, sectionId: b.sectionId || '', label: sel.label, inside: sel.inside ?? [] };
        break;
      case 'chrome':
        next = { kind: 'chrome', region: b.region === 'footer' ? 'footer' : 'header' };
        break;
      case 'product':
        next = { kind: 'product', productId: b.productId, productSlug: b.productSlug, label: sel.label };
        break;
      case 'post':
        if (b.postId) next = { kind: 'post', postId: b.postId, label: sel.label };
        break;
      case 'menu-item':
        next = { kind: 'menu', location: b.location, itemId: b.itemId };
        break;
      case 'fact':
        next = { kind: 'facts', focusKey: b.factKey };
        break;
      case 'form':
        if (b.formName) next = { kind: 'form', name: b.formName };
        break;
      case 'social':
        next = { kind: 'social' };
        break;
      case 'image': {
        const region = sel.container?.kind === 'chrome' ? (sel.container.region ?? 'header') : undefined;
        next = { kind: 'image', target: imageTargetFor(sel), src: sel.src ?? '', alt: sel.alt ?? '', label: imageLabel(sel), region };
        break;
      }
      default:
        break;
    }
    // The panel already open on this part stays (its instruction, its preview).
    if (next && !samePanel(panelRef.current, next)) openPanel(next);
    else setSide('panel');
    // The frame keeps this outline while the panel is open.
    selectedAddress.current = { ...sel.binding };
  }, [currentPage, openPanel]);

  const closePanel = useCallback(() => {
    setPanel({ kind: 'home' });
    setPanelKey((k) => k + 1);
    setSelected(null);
    selectedAddress.current = null;
    setUndoTarget(null);
    sendToIframe('wme:clear-selection');
    if (frameMode === 'preview') showLive();
  }, [frameMode, sendToIframe, showLive]);

  // A page switch with the window's change still in preview asks first (set once the window exists).
  const guardRef = useRef<(action: () => void) => void>((action) => action());

  // A page or post chosen in the app's sidebar opens in the frame.
  const lastItem = useRef(selectedItem);
  // The panel the next item opens with (a post or product just made: its own form), else the home panel.
  const nextItemPanel = useRef<PanelState | null>(null);
  const liveUrlRef = useRef(liveUrl);
  liveUrlRef.current = liveUrl;
  /**
   * An address in the frame, live, with a panel (the home panel unless one
   * is given), as a pick in the sidebar opens it; item: what it is (its
   * kind and id), which the chat and the editor's address follow at once.
   */
  const openInFrame = useCallback((url: string, next: PanelState = { kind: 'home' }, item?: EditorAddress) => {
    closeWindowRef.current();
    setLiveUrl(url);
    setFrameMode('live');
    setCurrentPage('');
    setOutline([]);
    setPanel(next);
    setPanelKey((k) => k + 1);
    if (next.kind !== 'home') { setChatOpen(true); setSide('panel'); }
    setSelected(null);
    selectedAddress.current = null;
    // The old page's outline under the pointer goes with it (2026-10-19).
    setElHovered(null);
    setHovered(null);
    setCrossing(null);
    setTemplate(item?.template ? (item.kind === 'post' ? 'post' : 'product') : null);
    if (item) {
      setEditorKind(item.template ? 'page' : item.kind);
      setFramePostId(item.id);
      writeAddress(item);
    }
    navigate(frameUrl(url));
  }, [navigate, writeAddress]);

  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  /**
   * The same page in the other editor, without loading it again (a
   * crossing, the sidebar's template row on the product shown): the product
   * editor or the product page itself; the frame maps it again that way and
   * selects the part the crossing came from.
   */
  const switchInPlace = useCallback((item: EditorAddress) => {
    closeWindowRef.current();
    setCrossing(null);
    setTemplate(item.template ? (item.kind === 'post' ? 'post' : 'product') : null);
    setEditorKind(item.template ? 'page' : item.kind);
    setFramePostId(item.id);
    setSelected(null);
    selectedAddress.current = null;
    setElHovered(null);
    setHovered(null);
    writeAddress(item);
    const again = reselect.current;
    reselect.current = null;
    sendToIframe('wme:request-map', { bindings: true, page: currentPageRef.current, ...(item.template ? { mode: 'template' } : {}), ...(again ? { reselect: again } : {}) });
  }, [writeAddress, sendToIframe]);

  useEffect(() => {
    if (!selectedItem || selectedItem === lastItem.current) return;
    lastItem.current = selectedItem;
    const next = nextItemPanel.current ?? undefined;
    nextItemPanel.current = null;
    const item = addressOfItem(selectedItem);
    if (selectedItem.type === 'post' || selectedItem.type === 'product') setRecord({ id: item.id, title: selectedItem.title });
    // The page already in the frame (the sidebar picks the home page at first) is not loaded again;
    // the same product in the other editor (the product page itself, or back) maps again in place.
    if (selectedItem.url && frameUrl(selectedItem.url).replace(/\/(?=\?|$)/, '') !== frameUrl(liveUrlRef.current).replace(/\/(?=\?|$)/, '')) guardRef.current(() => openInFrame(selectedItem.url as string, next, item));
    else if (!!item.template !== !!templateRef.current) guardRef.current(() => switchInPlace(item));
    else writeAddress(item);
  }, [selectedItem, openInFrame, switchInPlace, writeAddress]);

  // The item the editor opened on: its address (a reload, the way back to the editor).
  useEffect(() => {
    if (selectedItem) writeAddress(addressOfItem(selectedItem));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The product page (or post page) itself, shown with a record: the
   * sidebar selects its row (and the editor follows), or, with no sidebar,
   * the frame opens it.
   */
  const openTemplate = useCallback((kind: TemplateKind, shown: { id: number; title: string; url: string }) => {
    setRecord({ id: shown.id, title: shown.title });
    if (selectItem) {
      selectItem({ type: 'template', id: shown.id, title: TEMPLATE_TITLES[kind], url: shown.url, slug: kind });
      return;
    }
    guardRef.current(() => openInFrame(shown.url, { kind: 'home' }, { kind, id: shown.id, template: true }));
  }, [selectItem, openInFrame]);

  /**
   * A crossing (2026-10-19): from the product page itself to the product
   * shown (Edit This Product), or from the product to the product page
   * (Edit The Product Page), on the same page in the frame, the part it
   * came from selected again (from: its uid, or true for the node clicked).
   */
  const crossTo = useCallback((to: 'record' | 'template', from: string | true) => guardRef.current(() => {
    const kind: TemplateKind = templateRef.current ?? (editorKindRef.current === 'post' ? 'post' : 'product');
    const id = framePostIdRef.current;
    if (!id) return;
    reselect.current = from;
    const url = liveUrlRef.current;
    const title = recordRef.current?.id === id ? recordRef.current.title : '';
    const row = to === 'template'
      ? { type: 'template' as const, id, title: TEMPLATE_TITLES[kind], url, slug: kind }
      : { type: kind, id, title: title || TEMPLATE_TITLES[kind], url };
    if (selectItem) {
      lastItem.current = row;
      selectItem(row);
      switchInPlace(addressOfItem(row));
    } else switchInPlace(addressOfItem(row));
  }), [selectItem, switchInPlace]);
  const recordRef = useRef(record);
  recordRef.current = record;

  const openPage = useCallback((page: SiteMapPage) => guardRef.current(() => {
    setPagesOpen(false);
    // The product page or the post page: shown with the record last opened in its editor, else the map's.
    const kind = page.template ? TEMPLATE_OF_MAP[page.template] : undefined;
    if (kind) {
      void templateRecord({ kind, showing: page.showing ?? null }).then((shown) => { if (shown) openTemplate(kind, shown); });
      return;
    }
    closeWindowRef.current();
    setLiveUrl(page.url);
    setFrameMode('live');
    setCurrentPage(page.slug);
    setOutline([]);
    setPanel({ kind: 'home' });
    setSelected(null);
    selectedAddress.current = null;
    setElHovered(null);
    setHovered(null);
    // A page of the picker is a page (the frame says otherwise for a product's), and the sidebar selects it too (2026-10-19).
    const id = page.postId ?? (page.slug === 'index' ? 0 : null);
    setEditorKind('page');
    setFramePostId(id ?? 0);
    if (selectItem && id !== null) {
      const row = { type: 'page' as const, id, title: page.title, url: page.url };
      lastItem.current = row;
      selectItem(row);
    }
    setTemplate(null);
    setCrossing(null);
    writeAddress({ kind: 'page', id: id ?? 0 });
    navigate(frameUrl(page.url));
  }), [navigate, writeAddress, selectItem, openTemplate]);

  /** The page in the frame was removed: the frame shows the homepage, the panel stays with its result. */
  const leaveRemovedPage = useCallback(() => {
    setLiveUrl(homeUrl);
    setFrameMode('live');
    setCurrentPage('');
    setOutline([]);
    setElHovered(null);
    setHovered(null);
    setEditorKind('page');
    setTemplate(null);
    writeAddress(null);
    navigate(frameUrl(homeUrl));
  }, [homeUrl, navigate, writeAddress]);

  /**
   * The page card saved the item (its title, address or status): the frame
   * reloads it at its address now (a draft at its preview), and the
   * sidebar's row follows (2026-10-19).
   */
  const reloadItem = useCallback(async () => {
    const id = framePostIdRef.current;
    const fresh = id > 0 ? await fetchEditorItem(id) : null;
    const url = fresh?.url || liveUrlRef.current;
    setLiveUrl(url);
    setPreviewBy(null);
    setFrameMode('live');
    navigate(frameUrl(url));
    if (fresh && (fresh.type === 'post' || fresh.type === 'product')) setRecord({ id: fresh.id, title: fresh.title });
    if (fresh && selectItem) {
      const row = { type: editorKindOf(fresh.type), id: fresh.id, title: fresh.title, url: fresh.url };
      lastItem.current = row;
      selectItem(row);
    }
    listsChanged?.();
  }, [navigate, selectItem, listsChanged]);

  /**
   * The chat changed the site (2026-10-19): the editor shows it without a
   * reload by hand. A turn's changes are taken together (one refresh, a moment
   * after the last); the lists, the site map and the card read again, and the
   * frame reloads at its scroll unless every change names another record.
   * While the owner types in place or looks at a preview, it waits for them.
   */
  const chatChanges = useRef<ChatSiteChange[]>([]);
  const chatChangeTimer = useRef<number | null>(null);
  const [chatStale, setChatStale] = useState(false);
  const onSiteChanged = useCallback((changes: ChatSiteChange[]) => {
    chatChanges.current.push(...changes);
    if (chatChangeTimer.current) window.clearTimeout(chatChangeTimer.current);
    chatChangeTimer.current = window.setTimeout(() => {
      const all = chatChanges.current;
      chatChanges.current = [];
      chatChangeTimer.current = null;
      onRefreshSiteMap();
      listsChanged?.();
      setSiteVersion((v) => v + 1);
      // Pages, posts and products share their ids: another record is any id but the one shown.
      const shown = framePostIdRef.current;
      const elsewhere = all.every((c) => typeof c.id === 'number' && c.id !== shown && (c.kind === 'page' || c.kind === 'post' || c.kind === 'product'));
      if (!elsewhere) setChatStale(true);
    }, 700);
  }, [onRefreshSiteMap, listsChanged]);
  useEffect(() => () => { if (chatChangeTimer.current) window.clearTimeout(chatChangeTimer.current); }, []);

  // Close the page list on an outside click.
  useEffect(() => {
    if (!pagesOpen) return undefined;
    const onDown = (e: MouseEvent) => {
      if (pageMenuRef.current && !pageMenuRef.current.contains(e.target as Node)) setPagesOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pagesOpen]);

  /** A post or product just made (an Add panel): the frame opens it with its own form, and the sidebar reads its lists again. */
  const openNew = useCallback((item: { type: 'post' | 'product'; id: number; title: string; draft: boolean }) => {
    const url = newItemUrl(homeUrl, item);
    const next: PanelState = item.type === 'post' ? { kind: 'post', postId: item.id, label: item.title } : { kind: 'product', productId: item.id, label: item.title };
    if (!selectItem) {
      guardRef.current(() => openInFrame(url, next, { kind: item.type, id: item.id }));
      return;
    }
    nextItemPanel.current = next;
    listsChanged?.();
    selectItem({ type: item.type, id: item.id, title: item.title, url });
  }, [listsChanged, selectItem, homeUrl, openInFrame]);

  const env: EditorEnv = useMemo(() => ({
    siteMap,
    viewport,
    view,
    currentPage,
    outline,
    showPreview,
    showLive,
    refreshSiteMap: onRefreshSiteMap,
    select: (address) => sendToIframe('wme:select-address', address as Record<string, unknown>),
    openPanel,
    closePanel,
    setTokensLive: (vars) => sendToIframe('wme:set-tokens', { vars }),
    resetTokensLive: () => sendToIframe('wme:reset-tokens'),
    loadFont: (href) => sendToIframe('wme:load-font', { href }),
    undo: (result) => {
      setUndoTarget({ operationId: result.operationId, summary: result.summary || 'This change' });
      setPanel({ kind: 'history' });
      setPanelKey((k) => k + 1);
      setSide('panel');
    },
    // Every change that goes live leaves the top bar's Undo on it (the window's Apply did; a panel's publish too).
    applied: (result) => { if (result.undoable !== false) setLastApplied(result); },
    // "Write it for me" (a new post): the chat writes it, as if the owner asked.
    ask: (text) => {
      setChatOpen(true);
      setSide('chat');
      setAsk({ text, token: Date.now() });
    },
    openNew,
    listsChanged: () => listsChanged?.(),
  }), [siteMap, viewport, view, currentPage, outline, showPreview, showLive, onRefreshSiteMap, sendToIframe, openPanel, closePanel, openNew, listsChanged]);

  // ── The editor window ─────────────────────────────────────────────
  const elSelectedRef = useRef(elSelected);
  elSelectedRef.current = elSelected;
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;

  // A text change previews in the page itself (as before); the element's markup on screen now.
  const inPage = useRef<{ uid: string; html: string } | null>(null);
  const quick = useQuickEdit(elSelected, siteMap, {
    showPreview: (r) => {
      const sel = elSelectedRef.current;
      const shown = sel && inPage.current?.uid === sel.uid ? { ...sel, content: inPage.current.html } : sel;
      const html = shown && frameMode === 'live' ? inPageHtml(shown, r, htmlText) : null;
      if (sel && html !== null) {
        if (isEditingRef.current) { sendToIframe('wme:cancel-editing'); setIsEditing(false); }
        sendToIframe('wme:apply-preview', { uid: sel.uid, content: html });
        inPage.current = { uid: sel.uid, html };
        return;
      }
      if (inPage.current) { sendToIframe('wme:discard-preview', { uid: inPage.current.uid }); inPage.current = null; }
      showPreview(r);
    },
    showLive: () => {
      if (inPage.current) {
        sendToIframe('wme:discard-preview', { uid: inPage.current.uid });
        inPage.current = null;
        return;
      }
      showLive();
    },
    onApplied: (r, focused, job) => {
      setLastApplied(r);
      setToast({ message: WINDOW_WORDS.live, result: r });
      onRefreshSiteMap();
      if (focused) {
        inPage.current = null;
        closeWindowRef.current(true);
        showLive();
        return;
      }
      // A change that went live while the owner was elsewhere: its page shows it once they are free (as a chat change).
      if (job.place.where === whereRef.current) setChatStale(true);
    },
    onAsk: (text) => {
      setChatOpen(true);
      setSide('chat');
      setAsk({ text, token: Date.now() });
    },
    place: () => ({
      url: liveUrlRef.current,
      title: pageTitleRef.current,
      ...(framePostIdRef.current > 0 ? { item: { kind: editorKindRef.current, id: framePostIdRef.current, ...(templateRef.current ? { template: true } : {}) } } : {}),
    }),
    view,
  }, where);
  const quickRef = useRef(quick);
  quickRef.current = quick;

  // The window's changes on this page, for the frame: the parts it follows as the page scrolls (a Whole
  // Section's too), and the parts WPMaven works on, where a click opens that change (its window, with Stop).
  const placed = quick.jobs.filter(({ job }) => job.place.where === where && job.spot);
  const jobsKey = JSON.stringify({
    busy: placed.filter(({ state }) => state.phase === 'previewing' || state.phase === 'publishing').map(({ job }) => job.uid),
    follow: placed.map(({ job }) => job.uid),
  });
  useEffect(() => { sendToIframe('wme:jobs', JSON.parse(jobsKey)); }, [jobsKey, sendToIframe]);

  // The page reloads for a change made elsewhere (the chat's, or the window's own that went live in the
  // background) once the owner is free: not while they type in place or look at a preview.
  const windowHolds = quick.phase === 'result' || quick.phase === 'typed';
  useEffect(() => {
    if (!chatStale || isEditing || windowHolds || frameMode !== 'live') return;
    setChatStale(false);
    try { pendingScroll.current = iframeRef.current?.contentWindow?.scrollY ?? 0; } catch { pendingScroll.current = 0; }
    void reloadItem();
  }, [chatStale, isEditing, windowHolds, frameMode, reloadItem, iframeRef]);

  /**
   * Close the window: typing on the page is cancelled (as before). A change
   * on its way, or prepared, stays on its part (2026-10-19): its glass, then
   * its badge, opens it again.
   */
  const closeWindow = useCallback((applied = false) => {
    const sel = elSelectedRef.current;
    const q = quickRef.current;
    if (isEditingRef.current) sendToIframe('wme:cancel-editing');
    if (!applied && sel && q.phase === 'typed') sendToIframe('wme:apply-preview', { uid: sel.uid, content: sel.content });
    q.leave();
    setIsEditing(false);
    setElSelected(null);
  }, [sendToIframe]);
  const closeWindowRef = useRef(closeWindow);
  closeWindowRef.current = closeWindow;

  /** A click on the page selected an element (the frame's element map, as before). */
  const onElementSelect = (payload: Record<string, unknown>) => {
    const sel = parseElementSelection(payload);
    if (sel) selectPart(sel);
  };
  /** The window on a part: the one clicked, or the part of a change opened from its badge. */
  const selectPart = (sel: ElementSelection) => {
    setCrossing(null);
    const q = quickRef.current;
    const before = elSelectedRef.current;
    if (isEditingRef.current) {
      sendToIframe('wme:cancel-editing');
      setIsEditing(false);
    }
    if (before && q.phase === 'typed') sendToIframe('wme:apply-preview', { uid: before.uid, content: before.content });
    // The change on the part before goes on (its glass, then its badge); the window moves.
    q.leave();
    // The window replaces a panel's outline.
    setSelected(null);
    selectedAddress.current = null;
    setElSelected(sel);
    // Typing on the page, as before: a text element WPMaven can change (not one with a change of the window on it).
    if (!q.jobAt(sel.uid) && TEXT_CATEGORIES.includes(sel.category) && sel.editable && (containerOf(sel, siteMapRef.current) || sel.single)) {
      setTimeout(() => {
        sendToIframe('wme:enable-editing', { uid: sel.uid });
        setIsEditing(true);
      }, 50);
    }
  };
  const onElementSelectRef = useRef(onElementSelect);
  onElementSelectRef.current = onElementSelect;
  /**
   * The window on a change of this page: the frame selects its part again (its words, its box now); a
   * Whole Section is not one of the frame's parts, so the change's own selection is used, at its box now.
   */
  const focusJob = (job: QuickJob) => {
    if (job.uid.startsWith('binding:')) selectPart({ ...job.sel, uid: job.uid, rect: job.spot?.rect ?? job.sel.rect });
    else sendToIframe('wme:select-element', { uid: job.uid, reveal: true });
  };
  const focusJobRef = useRef(focusJob);
  focusJobRef.current = focusJob;

  /** Words typed on the page: the window offers them to Apply (live at once) or Discard. */
  const onEditingDone = (payload: Record<string, unknown>) => {
    setIsEditing(false);
    const sel = elSelectedRef.current;
    if (!sel || String(payload.uid || '') !== sel.uid) return;
    const before = htmlText(sel.content);
    const after = htmlText(String(payload.content || ''));
    if (!after || before === after) return;
    quickRef.current.setTyped(before, after);
  };
  const onEditingDoneRef = useRef(onEditingDone);
  onEditingDoneRef.current = onEditingDone;

  /**
   * Words typed on the page, not applied yet: another page asks first. A
   * change of the window (on its way, or prepared) goes along to the other
   * page (2026-10-19); leaving the editor asks first while one is there.
   */
  const dirty = quick.phase === 'typed';
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const jobsOpen = quick.jobs.some(({ state }) => state.phase !== 'idle' && state.phase !== 'published');
  const jobsOpenRef = useRef(jobsOpen);
  jobsOpenRef.current = jobsOpen;
  const guard = useCallback((action: () => void) => {
    if (dirtyRef.current) setPendingNav(() => action);
    else action();
  }, []);
  guardRef.current = guard;

  // Leaving the browser page with words typed or a change open asks first.
  useEffect(() => {
    if (!dirty && !jobsOpen) return undefined;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, jobsOpen]);

  // The dashboard's own navigation asks first too.
  const [leaveEditor, setLeaveEditor] = useState<(() => void) | null>(null);
  const setNavigationGuard = dashboard?.setNavigationGuard;
  useEffect(() => {
    if (!setNavigationGuard) return undefined;
    setNavigationGuard((_target, proceed) => {
      if (dirtyRef.current) { setPendingNav(() => proceed); return false; }
      if (jobsOpenRef.current) { setLeaveEditor(() => proceed); return false; }
      return true;
    });
    return () => setNavigationGuard(null);
  }, [setNavigationGuard]);

  /** A change's badge (or the tray's): the window on its part, on its page, its preview shown. */
  const pendingJob = useRef<string | null>(null);
  const openJob = useCallback((job: QuickJob) => {
    if (job.place.where === whereRef.current && !job.lost && frameMode === 'live') {
      focusJobRef.current(job);
      return;
    }
    // Its page opens first; the window opens once the page found its part.
    guardRef.current(() => {
      pendingJob.current = job.id;
      openInFrame(job.place.url, { kind: 'home' }, job.place.item);
    });
  }, [frameMode, sendToIframe, openInFrame]);

  // Only the toast of a change that went live hides by itself.
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Escape closes the window; Ctrl+Z (Cmd+Z) undoes the last change, outside a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === 'Escape') {
        setCrossing(null);
        if (pagesOpen) setPagesOpen(false);
        else if (elSelectedRef.current) closeWindowRef.current();
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing && lastAppliedRef.current) {
        e.preventDefault();
        env.undo(lastAppliedRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pagesOpen, env]);
  const lastAppliedRef = useRef(lastApplied);
  lastAppliedRef.current = lastApplied;

  // A page the site map does not hold (the cart, the checkout): the title the page list shows for it.
  const sideItem = dashboard?.editorSelectedItem;
  const framedTitle = sideItem && sideItem.type !== 'template' && framePostId > 0 && Number(sideItem.id) === framePostId ? sideItem.title : '';
  // The record in the frame (a product's, a post's own page, or the one the product page shows): its own name, read once.
  const recordTitle = record && record.id === framePostId ? record.title : '';
  const needsRecord = (!!template || editorKind !== 'page') && framePostId > 0 && !recordTitle;
  useEffect(() => {
    if (!needsRecord) return undefined;
    let live = true;
    const id = framePostId;
    void fetchEditorItem(id).then((item) => { if (live && item) setRecord({ id, title: item.title }); });
    return () => { live = false; };
  }, [needsRecord, framePostId]);
  // The product page (or post page) opens on the record last opened in its editor.
  useEffect(() => {
    if (template || editorKind === 'page' || framePostId <= 0 || !recordTitle) return;
    rememberOpened(editorKind, { id: framePostId, title: recordTitle, url: liveUrl });
  }, [template, editorKind, framePostId, recordTitle, liveUrl]);
  // What the editor shows, by name (2026-10-19): a product's or a post's own name in its editor (never the
  // design page's, "Product"); "Product page, showing Stoneware Jug" on the product page itself.
  const designTitle = placeTitle(siteMap, currentPage, framedTitle) || 'Your site';
  const pageTitle = template
    ? (recordTitle ? `${TEMPLATE_TITLES[template]}, showing ${recordTitle}` : TEMPLATE_TITLES[template])
    : single ? (recordTitle || framedTitle || designTitle) : designTitle;
  const pageTitleRef = useRef(pageTitle);
  pageTitleRef.current = pageTitle;
  // A page built with a page builder says what WPMaven changes on it (a block site's page only).
  const pageBuilder = siteMap?.engine === 'wordpress' ? siteMap.pages.find((p) => p.slug === currentPage || String(p.postId) === currentPage)?.builder : undefined;

  // What the chat's "this" means: the window's element (its card, image, detail or section), else a panel's part.
  const chatSel = elSelected ? panelSelectionOf(elSelected) : selected;
  const chatContext: EditorChatContext | null = useMemo(() => {
    // The post editor and the product editor (2026-10-18): the open post or
    // product (its Content Writer or E-commerce Manager leads the chat), and
    // the element selected in it.
    if (single) {
      const own = elSelected?.single ? elSelected : null;
      const words = own && own.label !== 'Content' ? squashText(own.textContent, 300) : '';
      return {
        page: currentPage,
        pageTitle,
        kind: single,
        label: pageTitle.slice(0, 80),
        focus: single,
        ...(framePostId > 0 ? (single === 'post' ? { postId: framePostId } : { productId: framePostId }) : {}),
        ...(own && words ? { element: { kind: (own.label || elementWord(own.category)).toLowerCase(), text: words } } : {}),
        view,
      };
    }
    // The product page itself: the change reaches every product, shown here with one of them.
    const shown = template ? { template, ...(framePostId > 0 ? { showing: { id: framePostId, title: recordTitle } } : {}) } : {};
    if (!chatSel) return currentPage ? { page: currentPage, pageTitle, kind: 'page', label: pageTitle, view, ...shown } : null;
    const selected = chatSel;
    const b = selected.binding;
    const label = b.kind === 'section' ? sectionLabel(siteMap, b.page, b.sectionId, selected.label) : (selected.label || kindWord(selected));
    // An image names the section, header or footer it sits in, so the chat can address it.
    const c = b.kind === 'image' ? selected.container : undefined;
    const place = c?.kind === 'section' && c.sectionId
      ? { sectionId: c.sectionId, containerLabel: sectionLabel(siteMap, c.page, c.sectionId, c.label).slice(0, 80) }
      : c?.kind === 'chrome' ? { region: c.region === 'footer' ? 'footer' : 'header' } : {};
    return {
      page: b.page || c?.page || currentPage,
      pageTitle,
      kind: b.kind,
      label: label.slice(0, 80),
      ...(selected.excerpt ? { excerpt: selected.excerpt.slice(0, 500) } : {}),
      ...(b.sectionId ? { sectionId: b.sectionId } : {}),
      ...(b.region ? { region: b.region } : {}),
      ...(b.productId ? { productId: b.productId } : {}),
      ...(b.postId ? { postId: b.postId } : {}),
      ...(b.location ? { location: b.location } : {}),
      ...(b.itemId ? { itemId: b.itemId } : {}),
      ...(b.factKey ? { factKey: b.factKey } : {}),
      ...(b.formName ? { formName: b.formName } : {}),
      ...(b.slot ? { slot: b.slot } : {}),
      ...place,
      // The element the window selected in it (a heading, a paragraph, a button), with its words.
      ...(elSelected && elSelected.category.startsWith('text-') && elSelected.engine?.container === chatSel
        ? { element: { kind: elementWord(elSelected.category), text: squashText(elSelected.textContent, 300) } }
        : {}),
      view,
      ...shown,
    };
  }, [chatSel, elSelected, currentPage, pageTitle, siteMap, view, single, framePostId, template, recordTitle]);

  const tools: Array<{ key: string; label: string; panel: PanelState; testId: string; icon: React.ReactNode }> = [
    { key: 'design', label: 'Design', panel: { kind: 'design' }, testId: 'design-panel', icon: <Palette /> },
    { key: 'facts', label: 'Details', panel: { kind: 'facts' }, testId: 'facts-panel', icon: <House /> },
    { key: 'menu', label: 'Menus', panel: { kind: 'menu' }, testId: 'menu-panel', icon: <Menu /> },
    { key: 'seo', label: 'Search', panel: { kind: 'seo' }, testId: 'seo-panel', icon: <Search /> },
    { key: 'history', label: 'History', panel: { kind: 'history' }, testId: 'history-panel', icon: <RotateCcw /> },
  ];

  const renderPanel = () => {
    switch (panel.kind) {
      case 'section': return <SectionPanel key={panelKey} env={env} page={panel.page} sectionId={panel.sectionId} label={panel.label} inside={panel.inside} />;
      case 'add-section': return <AddSectionPanel key={panelKey} env={env} page={panel.page} afterSectionId={panel.afterSectionId} />;
      // A site WPMaven did not design: its theme draws the header and footer (or keeps them as template parts).
      case 'chrome': return siteMap?.engine === 'wordpress'
        ? <ThemePartPanel key={panelKey} env={env} region={panel.region} />
        : <ChromePanel key={panelKey} env={env} region={panel.region} />;
      case 'menu': return <MenuEditor key={panelKey} env={env} location={panel.location} itemId={panel.itemId} />;
      case 'design': return <DesignPanel key={panelKey} env={env} />;
      case 'product': return <ProductForm key={panelKey} env={env} productId={panel.productId} productSlug={panel.productSlug} label={panel.label} />;
      case 'post': return <PostForm key={panelKey} env={env} postId={panel.postId} label={panel.label} />;
      case 'facts': return <FactsForm key={panelKey} env={env} focusKey={panel.focusKey} />;
      case 'form': return <FormPanel key={panelKey} env={env} name={panel.name} />;
      case 'image': return <ImagePanel key={panelKey} env={env} target={panel.target} src={panel.src} alt={panel.alt} label={panel.label} region={panel.region} />;
      case 'add-page': return <AddPagePanel key={panelKey} env={env} />;
      case 'add-post': return <AddPostPanel key={panelKey} env={env} />;
      case 'add-product': return <AddProductPanel key={panelKey} env={env} />;
      case 'remove-page': {
        const removing = panel.page;
        // The page in the frame went: the frame shows the homepage.
        return <RemovePagePanel key={panelKey} env={env} page={panel.page} title={panel.title} onRemoved={() => { if (removing === currentPage) leaveRemovedPage(); }} />;
      }
      case 'redesign': return <RedesignPanel key={panelKey} env={env} page={panel.page} mode={panel.mode} />;
      case 'rewrite': {
        const page = siteMap?.pages.find((p) => p.slug === panel.page) ?? { slug: panel.page, title: panel.page === 'index' ? 'Home' : panel.page };
        return <PageRewritePanel key={panelKey} env={env} page={page} />;
      }
      case 'identity': return <IdentityPanel key={panelKey} env={env} />;
      case 'seo': return <SeoPanel key={panelKey} env={env} postId={framePostId || (siteMap?.pages.find((p) => p.slug === currentPage)?.postId ?? 0)} />;
      case 'social': return <SocialLinksPanel key={panelKey} env={env} />;
      case 'history': return <EditHistoryPanel key={panelKey} env={env} undoTarget={undoTarget} onOpenPreview={(r) => showPreview(r)} />;
      default: return <HomePanel env={env} loadingMap={loadingMap} />;
    }
  };

  const openSide = (next: PanelState) => { setChatOpen(true); openPanel(next); };

  // The sidebar's requests (2026-10-17): the Add form of the tab it shows, the site without a page.
  const editorRequest = dashboard?.editorRequest ?? null;
  const requestEditor = dashboard?.requestEditor;
  const handledRequest = useRef<typeof editorRequest>(null);
  useEffect(() => {
    if (!editorRequest || handledRequest.current === editorRequest) return;
    handledRequest.current = editorRequest;
    requestEditor?.(null);
    if (editorRequest.action === 'add') openSide({ kind: editorRequest.kind === 'page' ? 'add-page' : editorRequest.kind === 'post' ? 'add-post' : 'add-product' });
    else openSide({ kind: 'remove-page', page: editorRequest.page, title: editorRequest.title });
  });
  // View site and the top bar's button open what the editor shows (2026-10-19); the homepage again once it closes.
  const setEditorViewUrl = dashboard?.setEditorViewUrl;
  useEffect(() => { setEditorViewUrl?.(viewUrlOf(liveUrl)); }, [liveUrl, setEditorViewUrl]);
  useEffect(() => () => setEditorViewUrl?.(null), [setEditorViewUrl]);
  // While a preview shows in the frame, the open page's row in the sidebar has no trash.
  const setEditorPreviewing = dashboard?.setEditorPreviewing;
  useEffect(() => { setEditorPreviewing?.(frameMode === 'preview'); }, [frameMode, setEditorPreviewing]);
  useEffect(() => () => setEditorPreviewing?.(false), [setEditorPreviewing]);
  const elementPanel = elSelected ? panelSelectionOf(elSelected) : null;
  // Offered from anything inside a section, header or footer (a card, a list of them included), never from the section itself.
  const isContainer = elSelected?.kind ? elSelected.kind === 'section' || elSelected.kind === 'chrome' : elSelected?.category === 'layout-section';
  const wholeSection = elSelected && elSelected.engine?.container && !isContainer ? wholeSectionOf(elSelected) : null;

  return (
    <div className="wme-gs" data-editor-mode="genstudio">
      <GsStyle />
      <div className="wme-gs-bar" role="toolbar" aria-label="Editor" data-tour="editor-bar">
        <div className="wme-gs-page" ref={pageMenuRef}>
          <button type="button" className="wme-gs-tool wme-gs-page-btn" aria-haspopup="listbox" aria-expanded={pagesOpen} onClick={() => setPagesOpen((o) => !o)} data-testid="editor-page-picker" data-tour="editor-page-picker">
            {/* The product page itself: its name here, the record it shows in the chooser beside it. */}
            <span>{template ? TEMPLATE_TITLES[template] : pageTitle}</span>
            <ChevronDown />
          </button>
          {pagesOpen && (
            <div className="wme-gs-menu" role="listbox" aria-label="Pages">
              {(siteMap?.pages ?? []).filter((p) => !p.template || !TEMPLATE_OF_MAP[p.template] || p.showing).map((p) => {
                const kind = p.template ? TEMPLATE_OF_MAP[p.template] : undefined;
                const on = kind ? template === kind : !template && p.slug === currentPage;
                return (
                  <button key={p.slug} type="button" role="option" aria-selected={on} aria-current={on} onClick={() => openPage(p)}>
                    <span>{kind ? TEMPLATE_TITLES[kind] : p.title}</span>
                    <small>{kind ? WINDOW_WORDS.template : p.sections.length ? `${p.sections.length} sections` : ''}</small>
                  </button>
                );
              })}
              <button type="button" className="wme-gs-menu-add" data-testid="editor-page-picker-add" onClick={() => { setPagesOpen(false); openSide({ kind: 'add-page' }); }}>
                <span><Plus size={14} aria-hidden="true" /> Add a page</span>
              </button>
            </div>
          )}
        </div>
        {template && (
          <TemplateChooser
            kind={template}
            shownId={framePostId}
            shownTitle={recordTitle}
            onPick={(item: EditorItem) => openTemplate(template, { id: item.id, title: item.title, url: item.url })}
          />
        )}
        <div className="wme-gs-bar-sep" />
        <div className="wme-gs-bar-group" role="group" aria-label="Screen size">
          {VIEWPORTS.map((v) => (
            <button key={v.mode} type="button" className="wme-gs-tool" aria-pressed={viewport === v.mode} title={v.label} aria-label={v.label} onClick={() => setViewport(v.mode)} style={{ padding: '0 9px' }} data-testid={`viewport-${v.mode}`}>
              {v.icon}
            </button>
          ))}
        </div>
        <div className="wme-gs-spacer" />
        {/* The sidebar's panels, as before: Chat, Search, History; then Undo. */}
        <button type="button" className={`wme-gs-tool${chatOpen && side === 'chat' ? ' is-on' : ''}`} aria-pressed={chatOpen && side === 'chat'} onClick={() => { if (chatOpen && side === 'chat') setChatOpen(false); else { setChatOpen(true); setSide('chat'); } }} data-testid="editor-chat-toggle" data-tour="editor-chat-toggle" title="Chat">
          <MessageSquare size={14} /><span className="wme-gs-tool-word">Chat</span>
        </button>
        <button type="button" className={`wme-gs-tool${chatOpen && side === 'panel' && panel.kind === 'seo' ? ' is-on' : ''}`} onClick={() => openSide({ kind: 'seo' })} data-testid="editor-seo-toggle" title="SEO">
          <Search size={14} /><span className="wme-gs-tool-word">SEO</span>
        </button>
        <button type="button" className={`wme-gs-tool${chatOpen && side === 'panel' && panel.kind === 'history' ? ' is-on' : ''}`} onClick={() => openSide({ kind: 'history' })} data-testid="editor-history-toggle" data-tour="editor-history" title="History">
          <FileText size={14} /><span className="wme-gs-tool-word">History</span>
        </button>
        <button type="button" className="wme-gs-tool" onClick={() => { if (lastApplied) env.undo(lastApplied); }} disabled={!lastApplied} data-testid="editor-undo-last" data-tour="editor-undo" title={lastApplied ? `Undo: ${lastApplied.summary} (Ctrl+Z)` : 'Undo (Ctrl+Z)'} aria-label="Undo">
          <Undo size={14} />
        </button>
      </div>

      <div className="wme-gs-main">
        <div className="wme-gs-stage" data-tour="editor-canvas">
          <SiteIframe src={initialSrc} setIframeRef={setIframeRef} onOffsetChange={setOffset} viewport={viewport} />
          {frameMode === 'live' && <BindingOverlay hovered={hovered} selected={selected} offset={offset} />}
          <OverlayLayer hovered={elHovered} selected={elSelected} iframeOffset={offset} isEditing={isEditing} working={quick.phase === 'working' || quick.phase === 'applying'} />
          <JobsLayer jobs={quick.jobs} where={where} focusedId={quick.current?.id ?? null} live={frameMode === 'live'} iframeOffset={offset} onOpen={openJob} />
          {elSelected && (
            <QuickWindow
              selected={elSelected}
              iframeOffset={offset}
              isEditing={isEditing}
              quick={quick}
              onClose={() => closeWindow()}
              // A post's or a product's own content has no side panel: the chat's Content Writer or E-commerce Manager changes it.
              onMore={elementPanel && !elSelected.single ? () => { setChatOpen(true); openSelection(onMapSections(elementPanel)); } : null}
              onWholeSection={wholeSection ? () => { if (isEditing) { sendToIframe('wme:cancel-editing'); setIsEditing(false); } quick.reset(); setElSelected(wholeSection); } : null}
              // A field, a label or a send button: its form, selected in the frame as a click would.
              onWholeForm={elSelected.inForm ? () => { sendToIframe('wme:select-element', { uid: elSelected.inForm }); } : null}
              // The same part in the other editor (the product, or the product page), with it selected there.
              onCross={framePostId > 0 && (template || single) ? (to) => crossTo(to, elSelected.uid) : null}
              onOpen={(what) => {
                if (what === 'category' && elSelected.link?.url) guardRef.current(() => openInFrame(elSelected.link?.url as string));
                else if (what === 'store-product' && framePostId > 0) {
                  if (inApp) navigateHash(`store/products/${framePostId}`);
                  else window.open(`${(window as any).WEBMAVEN_WP_DATA?.adminUrl || '/wp-admin/'}post.php?post=${framePostId}&action=edit`, '_blank', 'noopener');
                }
              }}
              siteMap={siteMap}
              page={currentPage}
              origin={linkOrigin}
            />
          )}
          {crossing && frameMode === 'live' && (
            <div
              role="dialog"
              aria-label={crossing.to === 'record' ? ownNote(crossing.word, recordTitle, crossing.view) : CROSSING_WORDS.shared[crossing.view]}
              data-testid="editor-crossing"
              style={{
                position: 'absolute',
                top: offset.top + crossing.y * (offset.scale ?? 1) + 12,
                left: Math.max(8, offset.left + crossing.x * (offset.scale ?? 1) - 20),
                zIndex: 320, maxWidth: 280, padding: '10px 12px', borderRadius: 12, fontSize: 13,
                background: 'color-mix(in srgb, var(--bg) 88%, transparent)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)', display: 'flex', flexDirection: 'column', gap: 8,
              }}
            >
              <span style={{ color: 'var(--text)' }}>{crossing.to === 'record' ? ownNote(crossing.word, recordTitle, crossing.view) : CROSSING_WORDS.shared[crossing.view]}</span>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button type="button" className="wme-gs-tool" style={{ height: 26 }} onClick={() => setCrossing(null)} data-testid="editor-crossing-close">{caseLabel(WINDOW_WORDS.close)}</button>
                <button type="button" className="wme-gs-tool is-on" style={{ height: 26 }} onClick={() => crossTo(crossing.to, true)} data-testid="editor-crossing-go">
                  {caseLabel(crossing.to === 'record' ? CROSSING_WORDS.editRecord[crossing.view] : CROSSING_WORDS.editTemplate[crossing.view])}
                </button>
              </div>
            </div>
          )}
          {frameMode === 'preview' && (
            <div className="wme-gs-banner" role="status" data-testid="editor-preview-banner">
              {previewBy ? <TeamFace id={previewBy.id} title={previewBy.title} presence="waiting" size="row" decorative /> : <i aria-hidden="true" />}
              <span>{previewBanner(previewBy)}</span>
              <button type="button" className="wme-gs-tool" style={{ height: 26 }} onClick={showLive}>Show the live site</button>
            </div>
          )}
          {notice && <div className="wme-gs-note is-warn" role="status" style={{ position: 'absolute', left: 16, right: 16, bottom: 16, zIndex: 60 }}>{notice}</div>}
          {missing && <div className="wme-gs-note is-warn" role="status" style={{ position: 'absolute', left: 16, right: 16, bottom: 16, zIndex: 60 }}>That part is not on this page. Open its page from the page list.</div>}
          {pageBuilder && !notice && !missing && frameMode === 'live' && (
            <div className="wme-gs-note" role="status" data-testid="editor-builder-page-notice" style={{ position: 'absolute', left: 16, right: 16, bottom: 16, zIndex: 59 }}>{builderText(pageBuilder)}</div>
          )}
          {!elSelected && !selected && frameMode === 'live' && (
            <div className="wme-gs-empty" data-testid="editor-empty-hint" data-tour="editor-hint">{WINDOW_WORDS.emptyHint}</div>
          )}
          {toast && (
            <div role="status" data-testid="editor-toast" className="wme-gs-toast" style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', padding: '10px 20px', borderRadius: 12, fontSize: 13, fontWeight: 500, zIndex: 600, background: 'color-mix(in srgb, var(--bg) 85%, transparent)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)', color: 'var(--purple)', display: 'flex', alignItems: 'center', gap: 10 }}>
              {toast.message}
              {toast.result && (
                <button type="button" className="wme-gs-tool" style={{ height: 26 }} onClick={() => { if (toast.result) env.undo(toast.result); setToast(null); }} data-testid="editor-toast-undo">{caseLabel(WINDOW_WORDS.undo)}</button>
              )}
            </div>
          )}
        </div>
        {chatOpen && (
          <aside className="wme-gs-side" aria-label="Chat" data-tour="editor-chat" style={{ position: 'relative' }}>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
              {!template && <PageContextCard
                kind={editorKind}
                postId={framePostId}
                pageTitle={pageTitle}
                siteMap={siteMap}
                refreshKey={`${lastApplied?.operationId ?? ''}:${siteVersion}`}
                onApplied={(r) => { setLastApplied(r); setToast({ message: WINDOW_WORDS.live, result: r }); onRefreshSiteMap(); }}
                onSaved={() => { void reloadItem(); }}
              />}
              {/* All settings: the panels of the last waves, over the chat */}
              <div role="group" aria-label={WINDOW_WORDS.allSettings} data-testid="editor-all-settings" data-tour="editor-settings" style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: '6px 10px', borderBottom: '1px solid var(--glass-border)' }}>
                <button type="button" className={`wme-gs-tool${side === 'panel' && panel.kind === 'home' ? ' is-on' : ''}`} onClick={() => openSide({ kind: 'home' })} data-testid="editor-all-settings-open" style={{ height: 28, padding: '0 10px' }}>
                  {WINDOW_WORDS.allSettings}
                </button>
                {tools.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`wme-gs-tool${side === 'panel' && panel.kind === t.panel.kind ? ' is-on' : ''}`}
                    data-testid={t.testId}
                    onClick={() => openSide(t.panel)}
                    title={t.label}
                    aria-label={t.label}
                    style={{ height: 28, padding: '0 8px' }}
                  >
                    {t.icon}
                  </button>
                ))}
              </div>
              <EmbeddedChat
                // One chat per editor (2026-10-18): the page editor's, the post
                // editor's, the product editor's, each its own thread; switching
                // editors draws that editor's chat (each kept for the page's life).
                // From one product to another the product editor's chat stays as
                // it is (2026-10-19): the kind is known when the owner opens one.
                key={editorKind}
                sidebar
                promptVariant="editor"
                onSiteChanged={onSiteChanged}
                // The view rides along even before the page is known.
                context={chatContext ?? { view }}
                ask={ask}
                // The post editor's chat is the Content Writer's, the product editor's the E-commerce Manager's.
                editorKind={editorKind}
                // What "this" means, over the box: the page, or the part of it selected.
                aboveInput={chatContext ? (
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }} data-testid="editor-chat-context">
                    Talking about <strong style={{ color: 'var(--text)' }}>{chatContext.kind === 'page' || (chatContext.focus && !chatContext.element) ? chatContext.pageTitle : chatContext.focus && chatContext.element ? caseLabel(chatContext.element.kind.charAt(0).toUpperCase() + chatContext.element.kind.slice(1)) : chatContext.element ? `${chatContext.element.kind}: ${squashText(chatContext.element.text, 60)}` : `${kindWord({ kind: chatSel?.kind ?? 'section', binding: chatSel?.binding })}: ${chatContext.label}`}</strong>
                    {chatContext.kind !== 'page' && !(chatContext.focus && !chatContext.element) && <> {chatContext.focus ? 'in' : 'on'} {chatContext.pageTitle}</>}
                  </div>
                ) : undefined}
              />
            </div>
            {side === 'panel' && (
              <div data-testid="editor-overlay" style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', flexDirection: 'column', background: 'var(--bg-raised)' }}>
                <button type="button" className="wme-gs-tool" onClick={() => setSide('chat')} data-testid="editor-back-to-chat" style={{ alignSelf: 'flex-start', margin: '8px 10px 0' }}>
                  <ChevronLeft />{WINDOW_WORDS.backToChat}
                </button>
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{renderPanel()}</div>
              </div>
            )}
          </aside>
        )}
      </div>
      {pendingNav && (
        <UnsavedChangesModal
          message={WINDOW_WORDS.leave}
          onSave={async () => { await quick.apply(); const go = pendingNav; setPendingNav(null); if (go) go(); }}
          onDiscard={() => { closeWindow(); const go = pendingNav; setPendingNav(null); if (go) go(); }}
          onCancel={() => setPendingNav(null)}
        />
      )}
      {leaveEditor && !pendingNav && (
        <UnsavedChangesModal
          title={JOB_WORDS.leaveTitle}
          message={JOB_WORDS.leave}
          saveLabel={JOB_WORDS.stay}
          discardLabel={JOB_WORDS.leaveAnyway}
          onSave={async () => setLeaveEditor(null)}
          onDiscard={() => { const go = leaveEditor; setLeaveEditor(null); go(); }}
          onCancel={() => setLeaveEditor(null)}
        />
      )}
    </div>
  );
}
