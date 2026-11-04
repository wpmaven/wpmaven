/**
 * The editor's address names what it shows (2026-10-19): #/editor/page/53,
 * #/editor/post/2321, #/editor/product/27; #/editor alone is the homepage.
 * The product page and the post page themselves name the record they show:
 * #/editor/template/product/27. The editor writes it on every move (in
 * place, no history entry), and a reload, a pasted link or the Blog screen's
 * "Edit content" opens that item again. The item itself is read by its id
 * from the sidebar's own route.
 */
import { getHashParts, navigateHash } from '../hooks/useHashRoute';
import { idFrom } from '../components/Dashboard/store/shared/useSubPath';

export type EditorItemKind = 'page' | 'post' | 'product';

/** The product page and the post page: the one design every product (or post) shows with. */
export type TemplateKind = 'product' | 'post';

export interface EditorAddress {
  kind: EditorItemKind;
  id: number;
  /** The product page (or the post page) itself, shown with this product (or post). */
  template?: boolean;
}

const KINDS: readonly string[] = ['page', 'post', 'product'];

/** The item an address names (["editor", "product", "27"], ["editor", "template", "product", "27"]), or null. */
export function editorAddressOf(parts: readonly string[]): EditorAddress | null {
  if (parts[0] !== 'editor') return null;
  if (parts[1] === 'template') {
    const kind = parts[2];
    const id = idFrom(parts[3]);
    return (kind === 'product' || kind === 'post') && id ? { kind, id, template: true } : null;
  }
  if (!KINDS.includes(parts[1] ?? '')) return null;
  const id = idFrom(parts[2]);
  return id ? { kind: parts[1] as EditorItemKind, id } : null;
}

/** "editor/product/27", "editor/template/product/27", or "editor" for the homepage (no id). */
export function editorHash(a: EditorAddress | null): string {
  if (!a || a.id <= 0) return 'editor';
  return a.template && a.kind !== 'page' ? `editor/template/${a.kind}/${a.id}` : `editor/${a.kind}/${a.id}`;
}

/** Whether two addresses name the same thing (a product, or the product page shown with it). */
export function sameEditorAddress(a: EditorAddress | null, b: EditorAddress | null): boolean {
  return !!a && !!b && a.id === b.id && !!a.template === !!b.template;
}

/** The product page's and the post page's names, in the sidebar and the editor's bar. */
export const TEMPLATE_TITLES: Record<TemplateKind, string> = { product: 'Product page', post: 'Post page' };

/** The site map's kind of each one. */
export const TEMPLATE_OF_MAP: Record<string, TemplateKind> = { woo_single: 'product', post_single: 'post' };

/** A template page the editor offers, with the record it opens on when nothing else was opened. */
export interface EditorTemplate {
  kind: TemplateKind;
  title: string;
  showing: { id: number; title: string; url: string } | null;
}

/** The record last opened in the product editor (or the post editor): the product page (or post page) opens on it. */
export interface LastOpened { id: number; title: string; url: string }

const LAST_KEY = 'wm-editor-last-';

/** Kept per browser, a convenience only: absent, the site map's record is shown. */
export function rememberOpened(kind: TemplateKind, item: LastOpened): void {
  try { localStorage.setItem(LAST_KEY + kind, JSON.stringify({ id: item.id, title: item.title, url: item.url })); } catch { /* not kept */ }
}

export function lastOpened(kind: TemplateKind): LastOpened | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_KEY + kind) || 'null');
    return raw && typeof raw.id === 'number' && raw.id > 0 && typeof raw.url === 'string' ? { id: raw.id, title: String(raw.title || ''), url: raw.url } : null;
  } catch {
    return null;
  }
}

/** The editor's address for what it shows now, in place (only while the address is the editor's). */
export function writeEditorAddress(a: EditorAddress | null): void {
  if (getHashParts()[0] !== 'editor') return;
  navigateHash(editorHash(a), { replace: true });
}

/** A sidebar item's kind: a post, a product, or a page (the homepage, and the product page and post page themselves, too). */
export function editorKindOf(type: string | undefined): EditorItemKind {
  return type === 'post' || type === 'product' ? type : 'page';
}

/** A sidebar item that is the product page or the post page (its slug says which), or null. */
export function templateOfItem(item: { type: string; slug?: string } | null | undefined): TemplateKind | null {
  if (!item || item.type !== 'template') return null;
  return item.slug === 'post' ? 'post' : 'product';
}

/** The address of a sidebar item: a template page names the record it shows. */
export function addressOfItem(item: { type: string; id: string | number; slug?: string }): EditorAddress {
  const template = templateOfItem(item);
  return template ? { kind: template, id: Number(item.id) || 0, template: true } : { kind: editorKindOf(item.type), id: Number(item.id) || 0 };
}

/**
 * The published products (or posts) a template page can show, newest first,
 * or the ones whose title holds the words searched for (the chooser).
 */
export async function fetchShowable(kind: TemplateKind, search = ''): Promise<EditorItem[]> {
  try {
    const d = await fetchEditorApi<{ items?: EditorItem[] }>('pages', { type: kind, status: 'publish', ...(search.trim() ? { search: search.trim() } : {}) });
    return Array.isArray(d?.items) ? d.items.filter((i) => typeof i.id === 'number' && typeof i.url === 'string') : [];
  } catch {
    return [];
  }
}

function restBase(): string {
  const wpData = (window as any).WEBMAVEN_WP_DATA;
  const mainUrl = wpData?.restUrl || '/wp-json/webmaven_wp/v1';
  return mainUrl.replace('webmaven_wp/v1', 'webmaven/v1');
}

/** One of the editor's own routes (the sidebar's lists, one item), as the signed-in user. */
export async function fetchEditorApi<T>(endpoint: string, query: Record<string, string> = {}): Promise<T> {
  const base = restBase();
  const params = new URLSearchParams(query).toString();
  // The REST root may carry its own query (?rest_route=...): the parameters join it.
  const url = `${base}/${endpoint}${params ? `${base.includes('?') ? '&' : '?'}${params}` : ''}`;
  const response = await fetch(url, {
    headers: { 'X-WP-Nonce': (window as any).WEBMAVEN_WP_DATA?.nonce || '' },
  });
  return response.json();
}

/** One row of the sidebar, as the editor opens it. */
export interface EditorItem {
  id: number;
  title: string;
  type: string;
  url: string;
  /** 'draft': not live yet (its url is its preview). */
  status?: string;
  wm_page?: string;
  locked?: boolean;
  price_text?: string;
}

/** A page, post or product by its id (its address, title and status), or null when it is none or cannot be edited. */
export async function fetchEditorItem(id: number): Promise<EditorItem | null> {
  try {
    const d = await fetchEditorApi<{ item?: EditorItem | null }>('pages', { id: String(id) });
    const item = d?.item;
    return item && typeof item.id === 'number' && typeof item.url === 'string' ? item : null;
  } catch {
    return null;
  }
}

/**
 * The record a template page opens on (2026-10-19): the product (or post)
 * last opened in its editor when it is still published, else the one the
 * site map names; null when there is none.
 */
export async function templateRecord(t: Pick<EditorTemplate, 'kind' | 'showing'>): Promise<{ id: number; title: string; url: string } | null> {
  const last = lastOpened(t.kind);
  if (last && t.showing && last.id === t.showing.id) return t.showing;
  if (last) {
    const fresh = await fetchEditorItem(last.id);
    if (fresh && fresh.type === t.kind && fresh.status !== 'draft') return { id: fresh.id, title: fresh.title, url: fresh.url };
  }
  return t.showing;
}
