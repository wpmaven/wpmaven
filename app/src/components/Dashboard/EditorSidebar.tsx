import React, { useState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Modal, NavIcon, NavItem, SearchInput, Tabs, type NavIconName } from '@yotako/webmaven-ui';
import { useDashboard, type EditorSidebarItem } from '../../contexts/DashboardContext';
import { editFailure, errorSentence, storeApi } from '../../services/storeApi';
import { hasFeature, useSiteState } from '../../utils/siteState';
import { fetchEditorApi, lastOpened, templateRecord, type EditorTemplate } from '../../utils/editorAddress';

interface PageItem {
  id: number;
  title: string;
  type: string;
  url: string;
  price?: string;
  /** The price as the store shows it: its currency and format, a range for a variable product. */
  price_text?: string;
  /** A page WPMaven designed: its plan slug (the edit engine removes it). */
  wm_page?: string;
  /** A page that stays: the front page, the blog's posts page, the store's own pages. */
  locked?: boolean;
  /** 'draft': not live yet (its url is its preview). */
  status?: string;
}

type TabType = 'pages' | 'posts' | 'products';

/** How long the field waits after the last key before it asks WordPress for older matches. */
export const SEARCH_WAIT_MS = 250;

/** The items whose title holds the words searched for, in any case; all of them for an empty search. */
export function itemsMatching<T extends { title: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => (item.title || '').toLowerCase().includes(q));
}

/** What the field shows: the loaded items that match at once, then the older ones WordPress found. */
export function withFound<T extends { id: number }>(matching: T[], found: T[]): T[] {
  const seen = new Set(matching.map((i) => i.id));
  return [...matching, ...found.filter((i) => !seen.has(i.id))];
}

/** Whether a row offers its trash: never the homepage or a page that stays, a page only when WPMaven designed it. */
export function removable(item: PageItem): boolean {
  if (item.type === 'home') return false;
  if (item.type === 'page') return !!item.wm_page && !item.locked;
  return item.type === 'post' || item.type === 'product';
}

/** Each kind's icon, from the sidebar's own set (the kit's NavIcon). */
const ITEM_ICONS: Record<string, NavIconName> = { product: 'shopping-bag', post: 'newspaper' };

/** The tab that lists a kind of item (the product page and the post page are the Pages tab's). */
const TAB_OF: Record<string, TabType> = { page: 'pages', post: 'posts', product: 'products', template: 'pages' };

/** The word on a template page's row: it changes every product (or post) page. */
export const TEMPLATE_CHIP = 'Template';

const NOUNS: Record<TabType, { none: string; one: string; many: string; type: 'page' | 'post' | 'product'; add: string }> = {
  pages: { none: 'No published pages', one: 'page', many: 'pages', type: 'page', add: 'Add a page' },
  posts: { none: 'No published posts', one: 'post', many: 'posts', type: 'post', add: 'Add a post' },
  products: { none: 'No products', one: 'product', many: 'products', type: 'product', add: 'Add a product' },
};

/** The trash's dialog, in the owner's words: a page is previewed without it first, a post or a product goes to the trash. */
export function removeWords(item: { type: string; title: string }): { title: string; text: string; confirm: string } {
  const title = `Remove “${item.title}”?`;
  return item.type === 'page'
    ? { title, text: 'Its menu links go too, and links to it on other pages are changed.', confirm: 'Preview without it' }
    : { title, text: 'It moves to the trash in WordPress.', confirm: 'Remove' };
}

/**
 * What the Editor page's sidebar edits (2026-10-16): Pages, Posts and, with
 * a store, Products, live or drafts (a draft says so), in the kit's
 * segmented Tabs; a search field under them
 * on every tab (2026-10-17), which keeps the loaded items whose title
 * matches at once, then adds the older ones WordPress finds; then the list.
 * The list is the only part that scrolls: the tabs and the field stay on top
 * of it, and Add (a page, a post or a product, by the tab) under it, right
 * above View site.
 *
 * The Pages tab ends with a Templates group (2026-10-19): the product page
 * and the post page a designed site has, each with the "Template" chip;
 * a change there reaches every product (or post) page.
 *
 * A row shows its trash on hover and on keyboard focus (2026-10-17). A
 * page's dialog goes to "Preview without it" in the editor's right panel;
 * a post's or a product's moves it to the trash in WordPress, once. There is
 * no trash on the homepage, the pages that stay, or the page in the frame
 * while a preview shows.
 */
export default function EditorSidebar() {
  const { editorSelectedItem, selectEditorItem, requestEditor, editorPreviewing, editorListsVersion, editorTarget, editorTemplates } = useDashboard();
  const edits = hasFeature(useSiteState(), 'edits');
  const [pages, setPages] = useState<PageItem[]>([]);
  const [posts, setPosts] = useState<PageItem[]>([]);
  const [products, setProducts] = useState<PageItem[]>([]);
  const [store, setStore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('pages');
  const [query, setQuery] = useState('');
  // The older matches WordPress answered, for this tab and these words.
  const [found, setFound] = useState<{ tab: TabType; query: string; items: PageItem[] } | null>(null);
  const [removing, setRemoving] = useState<PageItem | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeProblem, setRemoveProblem] = useState<string | null>(null);
  const firstLoad = useRef(true);

  useEffect(() => {
    async function load() {
      // Read again after an add or a removal: the list stays on screen meanwhile.
      const first = firstLoad.current;
      firstLoad.current = false;
      if (first) setLoading(true);
      try {
        const pageData = await fetchEditorApi<{ pages: PageItem[]; posts: PageItem[]; products?: PageItem[]; store?: boolean }>('pages').catch(() => ({ pages: [], posts: [], products: [], store: false }));
        const loadedPages = pageData.pages || [];
        setPages(loadedPages);
        setPosts(pageData.posts || []);
        setProducts(pageData.products || []);
        setStore(pageData.store === true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [editorListsVersion]);

  // Nothing to show yet: the homepage, unless the editor's address names an
  // item, which is read first (and the homepage when it is gone) (2026-10-19).
  useEffect(() => {
    if (loading || editorSelectedItem || editorTarget || pages.length === 0) return;
    const homepage = pages[0];
    selectEditorItem({ type: 'page', id: homepage.id, title: homepage.title, url: homepage.url });
  }, [loading, editorSelectedItem, editorTarget, pages, selectEditorItem]);

  // An item opened from elsewhere (its address, the Blog screen, the page
  // picker, one just added): the tab that lists it.
  const selectedType = editorSelectedItem?.type;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  useEffect(() => {
    const tab = selectedType ? TAB_OF[selectedType] : undefined;
    if (!tab || tab === activeTabRef.current) return;
    setActiveTab(tab);
    setQuery('');
  }, [selectedType]);

  // WordPress's own search, once the field rests: the older items the loaded list does not hold.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setFound(null);
      return undefined;
    }
    let live = true;
    const tab = activeTab;
    const timer = setTimeout(() => {
      fetchEditorApi<{ items?: PageItem[] }>('pages', { search: q, type: NOUNS[tab].type })
        .then((d) => { if (live) setFound({ tab, query: q, items: Array.isArray(d?.items) ? d.items : [] }); })
        .catch(() => { if (live) setFound({ tab, query: q, items: [] }); });
    }, SEARCH_WAIT_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [query, activeTab]);

  const isSelected = (type: string, id: string | number) => {
    return editorSelectedItem?.type === type && String(editorSelectedItem?.id) === String(id);
  };

  const handleSelect = (item: EditorSidebarItem) => {
    selectEditorItem(item);
  };

  /** A template page's row: the product page (or post page) opens on its record. */
  const openTemplate = async (t: EditorTemplate) => {
    const record = await templateRecord(t);
    if (record) selectEditorItem({ type: 'template', id: record.id, title: t.title, url: record.url, slug: t.kind });
  };

  // Another tab starts with its whole list.
  const switchTab = (tab: TabType) => {
    setActiveTab(tab);
    setQuery('');
  };

  const closeRemove = () => {
    if (removeBusy) return;
    setRemoving(null);
    setRemoveProblem(null);
  };

  /** The dialog's confirm: a page to its preview in the editor; a post or a product to the trash, once. */
  const confirmRemove = async () => {
    const item = removing;
    if (!item || removeBusy) return;
    if (item.type === 'page') {
      if (item.wm_page) requestEditor({ action: 'remove-page', page: item.wm_page, title: item.title });
      setRemoving(null);
      return;
    }
    setRemoveBusy(true);
    setRemoveProblem(null);
    try {
      const result = await storeApi.edit(item.type === 'product' ? { op: 'remove_product', productId: item.id } : { op: 'remove_post', postId: item.id });
      const failure = editFailure(result);
      if (failure) {
        setRemoveProblem(failure.message);
        return;
      }
      const drop = (list: PageItem[]) => list.filter((i) => !(i.type === item.type && i.id === item.id));
      if (item.type === 'product') setProducts(drop); else setPosts(drop);
      setFound((f) => (f ? { ...f, items: drop(f.items) } : f));
      // The item in the frame went: the frame shows the homepage.
      if (isSelected(item.type, item.id) && pages[0]) {
        selectEditorItem({ type: 'page', id: pages[0].id, title: pages[0].title, url: pages[0].url });
      }
      setRemoving(null);
    } catch (e) {
      setRemoveProblem(errorSentence(e, 'This could not be removed. Try again.'));
    } finally {
      setRemoveBusy(false);
    }
  };

  const items = activeTab === 'pages' ? pages : activeTab === 'posts' ? posts : products;
  const words = query.trim();
  const answered = !!found && found.tab === activeTab && found.query === words;
  const shown = words ? withFound(itemsMatching(items, words), answered ? found!.items : []) : items;
  const tabs: { key: TabType; label: string }[] = [
    { key: 'pages', label: 'Pages' },
    { key: 'posts', label: 'Posts' },
  ];
  if (store || products.length > 0) {
    tabs.push({ key: 'products', label: 'Products' });
  }
  const dialog = removing ? removeWords(removing) : null;
  // The Templates group: on the Pages tab, its rows matching the words searched for (one with a record to show).
  const templates = activeTab === 'pages' && !loading
    ? itemsMatching(editorTemplates.filter((t) => t.showing || lastOpened(t.kind)), words)
    : [];

  return (
    <div className="wpm-editor-sidebar" data-testid="wm-editor-sidebar" data-tour="editor-pages">
      <div className="wpm-editor-sidebar__tabs">
        <Tabs items={tabs} activeKey={activeTab} onChange={(key) => switchTab(key as TabType)} size="sm" ariaLabel="What to edit" />
      </div>

      <div className="wpm-editor-sidebar__search">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Esc clears the field (and stays in the sidebar).
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              e.nativeEvent.stopPropagation();
              setQuery('');
            }
          }}
          placeholder={`Find a ${NOUNS[activeTab].one}`}
          aria-label={`Find a ${NOUNS[activeTab].one} by its title`}
          data-testid="wm-editor-search"
        />
      </div>

      {/* The list: the one part of the sidebar that scrolls on this page. */}
      <div className="wpm-sidebar__section-items" data-testid="wm-editor-items">
        {loading ? (
          <div style={{ padding: '12px' }}>
            <div className="wpm-skeleton wpm-skeleton--text" />
            <div className="wpm-skeleton wpm-skeleton--text" style={{ width: '60%', marginTop: 8 }} />
          </div>
        ) : !words && items.length === 0 ? (
          <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-dim)' }}>
            {NOUNS[activeTab].none}
          </div>
        ) : shown.length === 0 ? (
          <div role="status" data-testid="wm-editor-no-match" style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-dim)' }}>
            {answered ? `No ${NOUNS[activeTab].many} match “${words}”.` : `Looking for older ${NOUNS[activeTab].many}.`}
          </div>
        ) : (
          shown.map((item) => {
            const type = item.type === 'home' ? 'page' : item.type;
            const selected = isSelected(type, item.id);
            const trash = edits && removable(item) && !(selected && editorPreviewing);
            return (
              <div key={`${item.type}-${item.id}`} className="wpm-sidebar__row" data-testid="wm-editor-row">
                <button
                  type="button"
                  className={`wpm-sidebar__nav-item ${selected ? 'wpm-sidebar__nav-item--active' : ''}`}
                  onClick={() => handleSelect({ type: type as EditorSidebarItem['type'], id: item.id, title: item.title, url: item.url })}
                >
                  <span className="wpm-sidebar__nav-icon">
                    <NavIcon name={ITEM_ICONS[item.type] ?? 'document-text'} size={16} />
                  </span>
                  <span className="wpm-sidebar__nav-label">
                    {item.title}
                    {item.status === 'draft' && (
                      <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 6 }}>Draft</span>
                    )}
                    {item.type === 'product' && item.price_text && (
                      <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 6 }}>{item.price_text}</span>
                    )}
                  </span>
                </button>
                {trash && (
                  <button
                    type="button"
                    className="wpm-sidebar__trash"
                    aria-label={`Remove ${item.title}`}
                    title={`Remove ${item.title}`}
                    data-testid="wm-editor-trash"
                    onClick={() => { setRemoveProblem(null); setRemoving(item); }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })
        )}
        {templates.length > 0 && (
          <div role="group" aria-label="Templates" data-testid="wm-editor-templates">
            <div style={{ padding: '14px 12px 4px', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Templates</div>
            {templates.map((t) => {
              const selected = editorSelectedItem?.type === 'template' && (editorSelectedItem.slug ?? 'product') === t.kind;
              return (
                <div key={t.kind} className="wpm-sidebar__row" data-testid="wm-editor-template-row">
                  <button
                    type="button"
                    className={`wpm-sidebar__nav-item ${selected ? 'wpm-sidebar__nav-item--active' : ''}`}
                    onClick={() => { void openTemplate(t); }}
                    title={t.kind === 'product' ? 'Changes every product page' : 'Changes every post page'}
                  >
                    <span className="wpm-sidebar__nav-icon">
                      <NavIcon name={t.kind === 'product' ? 'shopping-bag' : 'newspaper'} size={16} />
                    </span>
                    <span className="wpm-sidebar__nav-label">
                      {t.title}
                      <span data-testid="wm-editor-template-chip" style={{ fontSize: 10, fontWeight: 600, color: 'var(--purple)', border: '1px solid color-mix(in srgb, var(--purple) 35%, transparent)', borderRadius: 999, padding: '0 6px', marginLeft: 6 }}>{TEMPLATE_CHIP}</span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add, by the tab: its form opens in the editor's right panel. */}
      {edits && (
        <div className="wpm-editor-sidebar__add">
          <NavItem
            icon={<NavIcon name="plus" />}
            label={NOUNS[activeTab].add}
            testId="wm-editor-add"
            onClick={() => requestEditor({ action: 'add', kind: NOUNS[activeTab].type })}
          />
        </div>
      )}

      <Modal isOpen={!!removing} onClose={closeRemove} title={dialog?.title} description={dialog?.text}>
        <div data-testid="wm-editor-remove-dialog">
          {removeProblem && <p role="alert" style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--rose)' }}>{removeProblem}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button variant="ghost" onClick={closeRemove} disabled={removeBusy} data-testid="wm-editor-remove-cancel">Cancel</Button>
            <Button variant="dangerSolid" onClick={() => { void confirmRemove(); }} disabled={removeBusy} data-testid="wm-editor-remove-confirm">
              {removeBusy ? 'Removing' : dialog?.confirm}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
