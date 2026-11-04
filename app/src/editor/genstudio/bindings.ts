/**
 * What the owner selects in the site frame (the discovery script's binding
 * mode, wme:select-binding): a section, the header or footer, a product or
 * post card, a menu item, a business fact or an image, by its address in
 * the compiled site (data-wm-*).
 */
import type { ImageTarget, SiteMap, SiteMapPage } from '../../types/edits';

export type BindingKind = 'section' | 'chrome' | 'product' | 'post' | 'menu-item' | 'fact' | 'image' | 'form' | 'social';

export interface BindingAddress {
  kind: BindingKind;
  page?: string;
  sectionId?: string;
  template?: string;
  region?: 'header' | 'footer';
  productSlug?: string;
  productId?: number;
  postId?: number;
  location?: string;
  itemId?: number;
  factKey?: string;
  slot?: string;
  /** A designed form's name (data-wm-form), as the site map lists it. */
  formName?: string;
  /** A page of WordPress blocks: the top-level block's index in its page. */
  blockIndex?: number;
}

export interface FrameRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface BindingSelection {
  uid: string;
  kind: BindingKind;
  label: string;
  rect: FrameRect;
  binding: BindingAddress;
  excerpt?: string;
  /** The section, header or footer it sits in. */
  container?: BindingAddress & { label?: string };
  src?: string;
  alt?: string;
  value?: string;
  /** What a second click reaches inside a section or the header or footer. */
  inside?: Array<{ uid: string; kind: BindingKind; label: string }>;
}

export interface BindingHover {
  uid: string;
  kind: BindingKind;
  label: string;
  rect: FrameRect;
  binding?: BindingAddress;
}

const KINDS: ReadonlySet<string> = new Set(['section', 'chrome', 'product', 'post', 'menu-item', 'fact', 'image', 'form', 'social']);

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

export function parseRect(v: unknown): FrameRect {
  const r = isObj(v) ? v : {};
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  return { top: num(r.top), left: num(r.left), width: num(r.width), height: num(r.height) };
}

export function parseAddress(v: unknown): BindingAddress | null {
  if (!isObj(v) || !KINDS.has(v.kind)) return null;
  return {
    kind: v.kind,
    ...(s(v.page) ? { page: v.page } : {}),
    ...(s(v.sectionId) ? { sectionId: v.sectionId } : {}),
    ...(s(v.template) ? { template: v.template } : {}),
    ...(v.region === 'header' || v.region === 'footer' ? { region: v.region } : {}),
    ...(s(v.productSlug) ? { productSlug: v.productSlug } : {}),
    ...(n(v.productId) ? { productId: v.productId } : {}),
    ...(n(v.postId) ? { postId: v.postId } : {}),
    ...(s(v.location) ? { location: v.location } : {}),
    ...(n(v.itemId) ? { itemId: v.itemId } : {}),
    ...(s(v.factKey) ? { factKey: v.factKey } : {}),
    ...(s(v.slot) ? { slot: v.slot } : {}),
    ...(s(v.formName) && /^[a-z0-9][a-z0-9_-]*$/i.test(v.formName) ? { formName: v.formName } : {}),
    ...(typeof v.blockIndex === 'number' && Number.isInteger(v.blockIndex) && v.blockIndex >= 0 ? { blockIndex: v.blockIndex } : {}),
  };
}

/**
 * The section of a block page a frame binding names: its own id when the
 * site map lists it, else the section holding its block (a heading and the
 * text after it are one section in the map).
 */
export function sectionIdFor(map: SiteMap | null, address: Pick<BindingAddress, 'page' | 'sectionId' | 'blockIndex'>): string | undefined {
  const page = pageFor(map, address.page);
  // A designed page's sections keep their ids; the owner's blocks on it are found as on a block page.
  if (!page || (map?.engine !== 'wordpress' && typeof address.blockIndex !== 'number')) return address.sectionId;
  if (address.sectionId && page.sections.some((x) => x.id === address.sectionId)) return address.sectionId;
  if (typeof address.blockIndex !== 'number') return address.sectionId;
  const at = address.blockIndex;
  const starts = page.sections.filter((x) => map?.engine === 'wordpress' || x.wordpress)
    .map((x) => ({ id: x.id, start: Number(/^b(\d+)/.exec(x.id)?.[1] ?? NaN) })).filter((x) => Number.isFinite(x.start));
  const holding = starts.filter((x) => x.start <= at).sort((a, b) => b.start - a.start)[0];
  return holding?.id ?? address.sectionId;
}

/** A wme:select-binding payload, checked. */
export function parseSelection(payload: unknown): BindingSelection | null {
  if (!isObj(payload) || !s(payload.uid)) return null;
  const binding = parseAddress(payload.binding);
  if (!binding) return null;
  const container = parseAddress(payload.container);
  return {
    uid: payload.uid,
    kind: binding.kind,
    label: typeof payload.label === 'string' ? payload.label.slice(0, 80) : '',
    rect: parseRect(payload.rect),
    binding,
    ...(typeof payload.excerpt === 'string' ? { excerpt: payload.excerpt.slice(0, 500) } : {}),
    ...(container ? { container: { ...container, ...(typeof payload.container?.label === 'string' ? { label: payload.container.label.slice(0, 80) } : {}) } } : {}),
    ...(typeof payload.src === 'string' ? { src: payload.src } : {}),
    ...(typeof payload.alt === 'string' ? { alt: payload.alt } : {}),
    ...(typeof payload.value === 'string' ? { value: payload.value } : {}),
    ...(Array.isArray(payload.inside) ? {
      inside: payload.inside.filter((i: unknown) => isObj(i) && s((i as any).uid) && KINDS.has((i as any).kind))
        .slice(0, 16).map((i: any) => ({ uid: i.uid, kind: i.kind, label: typeof i.label === 'string' ? i.label.slice(0, 80) : '' })),
    } : {}),
  };
}

export function parseHover(payload: unknown): BindingHover | null {
  if (!isObj(payload) || !s(payload.uid) || !KINDS.has(payload.kind)) return null;
  const binding = parseAddress(payload.binding);
  return {
    uid: payload.uid,
    kind: payload.kind,
    label: typeof payload.label === 'string' ? payload.label.slice(0, 80) : '',
    rect: parseRect(payload.rect),
    ...(binding ? { binding } : {}),
  };
}

/** How each kind is named on its outline and its panel. */
export const KIND_WORDS: Record<BindingKind, string> = {
  section: 'Section',
  chrome: 'Header',
  product: 'Product',
  post: 'Post',
  'menu-item': 'Menu item',
  social: 'Social links',
  fact: 'Business detail',
  image: 'Image',
  form: 'Form',
};

/** One outline color per kind, from the app's palette. */
export const KIND_COLORS: Record<BindingKind, string> = {
  section: 'var(--purple)',
  chrome: 'var(--blue, var(--purple))',
  product: 'var(--cyan)',
  post: 'var(--cyan)',
  'menu-item': 'var(--blue, var(--purple))',
  social: 'var(--rose, var(--purple))',
  fact: 'var(--peach)',
  image: 'var(--mauve, var(--purple))',
  form: 'var(--green, var(--cyan))',
};

export function kindWord(sel: { kind: BindingKind; binding?: BindingAddress }): string {
  if (sel.kind === 'chrome') return sel.binding?.region === 'footer' ? 'Footer' : 'Header';
  return KIND_WORDS[sel.kind];
}

/** The site map page of an address (or of the page the frame shows). */
export function pageFor(map: SiteMap | null, slug: string | undefined): SiteMapPage | null {
  if (!map || !slug) return null;
  return map.pages.find((p) => p.slug === slug) ?? null;
}

/**
 * What the owner calls the page an address names: its title in the site map,
 * a post's title on a site WPMaven did not design (its address is the post's
 * id), Home for the designed home page, else the page's WordPress title when
 * it is known (framed: a store page like the cart, named as the page list
 * names it), else the address itself.
 */
export function placeTitle(map: SiteMap | null, slug: string | undefined, framed = ''): string {
  if (!slug) return framed;
  const page = pageFor(map, slug);
  if (page) return page.title;
  const post = map?.engine === 'wordpress' && /^\d+$/.test(slug) ? map.posts?.find((p) => p.postId === Number(slug)) : undefined;
  if (post) return post.title;
  if (slug === 'index') return 'Home';
  return framed || slug;
}

/** The plan slug of the page the frame shows, from its WordPress id or the front page. */
export function slugForPost(map: SiteMap | null, postId: number, isFront: boolean): string {
  if (!map) return isFront ? 'index' : '';
  const byId = postId > 0 ? map.pages.find((p) => p.postId === postId) : undefined;
  if (byId) return byId.slug;
  if (isFront) return map.pages.some((p) => p.slug === 'index') ? 'index' : (map.pages[0]?.slug ?? 'index');
  return '';
}

/** A section's name as the site map knows it (else the frame's heading). */
export function sectionLabel(map: SiteMap | null, page: string | undefined, sectionId: string | undefined, fallback = ''): string {
  const section = pageFor(map, page)?.sections.find((x) => x.id === sectionId);
  return section?.label || fallback || (sectionId ? sectionId.replace(/[-_]+/g, ' ') : 'Section');
}

/** The image an image binding replaces: the logo, an image of a section, or one of the header or footer; null when it sits elsewhere. */
export function imageTargetFor(sel: BindingSelection): ImageTarget | null {
  if (sel.kind !== 'image' || !sel.binding.slot) return null;
  if (sel.binding.slot === 'logo') return { kind: 'site', slot: 'logo' };
  const c = sel.container;
  if (c?.kind === 'section' && c.page && c.sectionId) {
    return { kind: 'section', page: c.page, sectionId: c.sectionId, imageSlot: sel.binding.slot };
  }
  if (c?.kind === 'chrome') {
    return { kind: 'chrome', region: c.region === 'footer' ? 'footer' : 'header', imageSlot: sel.binding.slot };
  }
  return null;
}

/** The title of an image's panel: where it is. */
export function imageLabel(sel: BindingSelection): string {
  if (sel.binding.slot === 'logo') return 'Your logo';
  const c = sel.container;
  if (c?.kind === 'chrome') return `Image in the ${c.region === 'footer' ? 'footer' : 'header'}`;
  return c?.label ? `Image in ${c.label}` : 'Image';
}

/** The origin the site's pages are served from (WordPress's home), else wp-admin's. */
export function siteOrigin(): string {
  const w = window as any;
  try {
    return new URL(w.wmeConfig?.siteOrigin || w.WEBMAVEN_WP_DATA?.editor?.siteOrigin || window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}

/** A link on this site with the editor's frame parameters (never another origin's). */
export function frameUrl(url: string, extra: Record<string, string> = {}): string {
  try {
    const u = new URL(url, window.location.href);
    if (u.origin === siteOrigin() || u.origin === window.location.origin) {
      u.searchParams.set('webmaven_discover', '1');
      for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    }
    return u.toString();
  } catch {
    return url;
  }
}
