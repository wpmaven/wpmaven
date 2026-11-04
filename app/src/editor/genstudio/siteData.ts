/**
 * What the editor's forms read from WordPress itself (the logged-in
 * administrator's REST access): a product's fields from WooCommerce, a
 * post's fields, the media library. Changes never go this way: they are
 * edit operations (services/edits).
 */
import { wpRestBase, wpRestUrl } from '../../services/wpApi';

function wpData(): any {
  return (typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA : null) || {};
}

/** A REST namespace on this site ("wc/v3", "wp/v2"), pretty or plain permalinks. */
export function restBase(namespace: string): string {
  return wpRestBase(wpData()).replace(/wp\/v2$/, namespace);
}

async function getJson<T>(namespace: string, endpoint: string): Promise<T> {
  const res = await fetch(wpRestUrl(restBase(namespace), endpoint), {
    credentials: 'same-origin',
    headers: { 'X-WP-Nonce': String(wpData().nonce || '') },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const plain = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export interface ProductSnapshot {
  id: number;
  name: string;
  type: string;
  /** publish, draft, pending or private. */
  status: string;
  regularPrice: string;
  salePrice: string;
  /** On sale now (a product with options: one of them at least). */
  onSale: boolean;
  shortDescription: string;
  stockStatus: 'instock' | 'outofstock' | 'onbackorder';
  modifiedGmt: string;
  imageUrl: string;
  permalink: string;
  /** A print on demand product (the plugin's wpmaven field): its photo shows the printed item, never an AI one. */
  printed: boolean;
  /** The main picture's media id (null: none), then the gallery's, in their order (the gallery's place 1 onwards). */
  featuredMediaId: number | null;
  galleryMediaIds: number[];
  /** Its store categories (product_cat). */
  categories: Array<{ id: number; name: string }>;
  /** Its item number ('' without one), its sizes in the store's unit, its attributes (a spec line is one), its card's own texts. */
  sku: string;
  dimensions: { length: string; width: string; height: string };
  attributes: Array<{ name: string; options: string[]; variation: boolean; visible: boolean }>;
  cardSlots: Record<string, string>;
  /** Its pictures in their order (the main one first), with a small copy to show. */
  pictures: Array<{ id: number; src: string }>;
}

/** A product as WooCommerce holds it, or null when it cannot be read. */
export async function loadProduct(id: number): Promise<ProductSnapshot | null> {
  try {
    const p = await getJson<any>('wc/v3', `/products/${id}`);
    if (!p || typeof p.id !== 'number') return null;
    const stock = p.stock_status === 'outofstock' || p.stock_status === 'onbackorder' ? p.stock_status : 'instock';
    // WooCommerce lists the main picture first, then the gallery; without a main picture, the gallery alone.
    const imageIds: number[] = (Array.isArray(p.images) ? p.images : []).map((i: any) => Number(i?.id)).filter((id: number) => Number.isInteger(id) && id > 0);
    const featured = p.wpmaven?.hasPhoto === false ? null : imageIds[0] ?? null;
    return {
      id: p.id,
      name: plain(text(p.name)),
      type: text(p.type) || 'simple',
      status: text(p.status) || 'publish',
      regularPrice: text(p.regular_price),
      salePrice: text(p.sale_price),
      onSale: p.on_sale === true,
      shortDescription: plain(text(p.short_description)),
      stockStatus: stock,
      modifiedGmt: text(p.date_modified_gmt),
      imageUrl: Array.isArray(p.images) && p.images[0] && typeof p.images[0].src === 'string' ? p.images[0].src : '',
      permalink: text(p.permalink),
      printed: !!p.wpmaven && typeof p.wpmaven === 'object' && p.wpmaven.kind === 'printed',
      featuredMediaId: featured,
      galleryMediaIds: featured ? imageIds.slice(1) : imageIds,
      categories: (Array.isArray(p.categories) ? p.categories : [])
        .filter((c: any) => typeof c?.id === 'number')
        .map((c: any) => ({ id: c.id, name: plain(text(c.name)) })),
      sku: text(p.sku),
      dimensions: { length: text(p.dimensions?.length), width: text(p.dimensions?.width), height: text(p.dimensions?.height) },
      attributes: (Array.isArray(p.attributes) ? p.attributes : [])
        .filter((a: any) => typeof a?.name === 'string')
        .map((a: any) => ({ name: a.name, options: Array.isArray(a.options) ? a.options.map(text) : [], variation: a.variation === true, visible: a.visible !== false })),
      cardSlots: p.wpmaven?.cardSlots && typeof p.wpmaven.cardSlots === 'object' && !Array.isArray(p.wpmaven.cardSlots)
        ? Object.fromEntries(Object.entries(p.wpmaven.cardSlots).filter(([, v]) => typeof v === 'string')) as Record<string, string>
        : {},
      pictures: (Array.isArray(p.images) ? p.images : [])
        .filter((i: any) => Number.isInteger(Number(i?.id)) && Number(i.id) > 0)
        .map((i: any) => ({ id: Number(i.id), src: text(i.thumbnail) || text(i.src) })),
    };
  } catch {
    return null;
  }
}

/** A variable product's options as WooCommerce answers them (raw rows, mapped by the Store's mapper). */
export async function loadVariations(productId: number, fields: string): Promise<Array<Record<string, any>>> {
  const list = await getJson<any[]>('wc/v3', `/products/${productId}/variations?per_page=100&_fields=${encodeURIComponent(fields)}`);
  return Array.isArray(list) ? list.filter((v) => v && typeof v === 'object') : [];
}

export interface PostSnapshot {
  id: number;
  title: string;
  excerpt: string;
  status: string;
  modifiedGmt: string;
  link: string;
  /** The text as WordPress stores it (what a rewrite and a direct edit start from). */
  content: string;
  /** The last part of its address, and the address around it ("https://site/%pagename%/"; '' with plain addresses). */
  slug: string;
  permalinkTemplate: string;
  /** Its featured picture's media id (null: none). */
  featuredMediaId: number | null;
  /** A page WPMaven designed (its address stays as the design links it). */
  designOwned: boolean;
  /** A page the site needs ("the homepage", "the privacy policy page"), which stays published; '' for any other. */
  sitePage: string;
  /** Its date in the site's time (2026-09-18T11:00:00), its blog categories' ids and its tags' ids. */
  date: string;
  categoryIds: number[];
  tagIds: number[];
}

/** A post, or a page with type 'page', as WordPress holds it (edit context), or null when it cannot be read. */
export async function loadPost(id: number, type: 'post' | 'page' = 'post'): Promise<PostSnapshot | null> {
  try {
    const p = await getJson<any>('wp/v2', `/${type === 'page' ? 'pages' : 'posts'}/${id}?context=edit`);
    if (!p || typeof p.id !== 'number') return null;
    return {
      id: p.id,
      title: text(p.title?.raw ?? p.title?.rendered),
      excerpt: plain(text(p.excerpt?.raw ?? p.excerpt?.rendered)),
      status: text(p.status) || 'publish',
      modifiedGmt: text(p.modified_gmt),
      link: text(p.link),
      content: typeof p.content?.raw === 'string' ? p.content.raw : '',
      slug: text(p.slug) || text(p.generated_slug),
      permalinkTemplate: text(p.permalink_template),
      featuredMediaId: typeof p.featured_media === 'number' && p.featured_media > 0 ? p.featured_media : null,
      designOwned: p.wpmaven?.designOwned === true,
      sitePage: text(p.wpmaven?.sitePage),
      date: text(p.date),
      categoryIds: Array.isArray(p.categories) ? p.categories.filter((c: unknown) => typeof c === 'number') : [],
      tagIds: Array.isArray(p.tags) ? p.tags.filter((t: unknown) => typeof t === 'number') : [],
    };
  } catch {
    return null;
  }
}

/** A category or a tag of the blog, or a store category. */
export interface TermItem {
  id: number;
  name: string;
  description: string;
}

/** The blog's categories or tags (by ids, or all of them, up to 100), or [] when they cannot be read. */
export async function listBlogTerms(taxonomy: 'categories' | 'tags', ids?: number[]): Promise<TermItem[]> {
  if (ids && !ids.length) return [];
  try {
    const only = ids ? `&include=${ids.slice(0, 100).join(',')}` : '';
    const list = await getJson<any[]>('wp/v2', `/${taxonomy}?per_page=100&orderby=name&_fields=id,name,description${only}`);
    return Array.isArray(list) ? list.filter((t) => typeof t?.id === 'number').map((t) => ({ id: t.id, name: plain(text(t.name)), description: plain(text(t.description)) })) : [];
  } catch {
    return [];
  }
}

/** One category (a store's or the blog's) as WordPress holds it, or null when it cannot be read. */
export async function loadTerm(taxonomy: 'product_cat' | 'category', id: number): Promise<TermItem | null> {
  try {
    const t = taxonomy === 'product_cat'
      ? await getJson<any>('wc/v3', `/products/categories/${id}`)
      : await getJson<any>('wp/v2', `/categories/${id}?_fields=id,name,description`);
    return t && typeof t.id === 'number' ? { id: t.id, name: plain(text(t.name)), description: plain(text(t.description)) } : null;
  } catch {
    return null;
  }
}

export interface MediaItem {
  id: number;
  url: string;
  thumb: string;
  alt: string;
  title: string;
}

function mediaFrom(m: any): MediaItem | null {
  if (!m || typeof m.id !== 'number' || typeof m.source_url !== 'string') return null;
  const sizes = m.media_details?.sizes ?? {};
  const thumb = sizes.medium?.source_url || sizes.thumbnail?.source_url || m.source_url;
  return { id: m.id, url: m.source_url, thumb, alt: text(m.alt_text), title: plain(text(m.title?.rendered)) };
}

/** Images of the media library, newest first. */
export async function listMedia(search = '', page = 1): Promise<MediaItem[]> {
  const q = `/media?media_type=image&per_page=24&page=${page}&orderby=date&order=desc${search ? `&search=${encodeURIComponent(search)}` : ''}`;
  const list = await getJson<any[]>('wp/v2', q);
  return Array.isArray(list) ? list.map(mediaFrom).filter((m): m is MediaItem => !!m) : [];
}

/** Upload an image to the media library (WordPress checks the file and the user's rights). */
export async function uploadMedia(file: File): Promise<MediaItem> {
  const res = await fetch(wpRestUrl(restBase('wp/v2'), '/media'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'X-WP-Nonce': String(wpData().nonce || ''),
      'Content-Disposition': `attachment; filename="${file.name.replace(/[^\w.-]+/g, '-')}"`,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body && typeof body.message === 'string' ? plain(body.message) : 'The upload did not work. Try another file.');
  const m = mediaFrom(body);
  if (!m) throw new Error('The upload did not work. Try another file.');
  return m;
}

export interface LinkTarget {
  id: number;
  title: string;
}

/** Published blog posts, newest first (for a menu link). */
export async function listPostsForMenu(): Promise<LinkTarget[]> {
  const list = await getJson<any[]>('wp/v2', '/posts?per_page=50&status=publish&orderby=date&order=desc&_fields=id,title');
  return Array.isArray(list) ? list.filter((p) => typeof p?.id === 'number').map((p) => ({ id: p.id, title: plain(text(p.title?.rendered)) || `#${p.id}` })) : [];
}

/** Blog categories and store categories (for a menu link). */
export async function listCategoriesForMenu(): Promise<Array<LinkTarget & { taxonomy: 'category' | 'product_cat' }>> {
  const out: Array<LinkTarget & { taxonomy: 'category' | 'product_cat' }> = [];
  try {
    const blog = await getJson<any[]>('wp/v2', '/categories?per_page=50&hide_empty=true&_fields=id,name');
    for (const c of Array.isArray(blog) ? blog : []) if (typeof c?.id === 'number') out.push({ id: c.id, title: plain(text(c.name)), taxonomy: 'category' });
  } catch { /* no blog categories */ }
  try {
    const store = await getJson<any[]>('wc/v3', '/products/categories?per_page=50&hide_empty=true');
    for (const c of Array.isArray(store) ? store : []) if (typeof c?.id === 'number') out.push({ id: c.id, title: plain(text(c.name)), taxonomy: 'product_cat' });
  } catch { /* no store */ }
  return out;
}
