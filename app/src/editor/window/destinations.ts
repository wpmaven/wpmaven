/**
 * Where a link or a button goes, in the owner's words (the editor window's
 * "Goes to" line, 2026-10-18), and the places a link can be pointed to
 * (its "Change Where It Goes" list). A page of this site by its title, a
 * product, a post, a store page, a section of this page, an email address,
 * a phone number, a file, another website by its domain with its path
 * shortened. Pure.
 */
import type { SiteMap, SiteMapPage } from '../../types/edits';
import type { ButtonInfo, LinkInfo } from './elementEdit';

export type DestinationIcon = 'page' | 'product' | 'post' | 'cart' | 'section' | 'web' | 'email' | 'phone' | 'file' | 'send' | 'nowhere';

export interface Destination {
  icon: DestinationIcon;
  /** The main words: a page's title, a website's domain, an address. */
  title: string;
  /** After them, dimmer: a path, "Store page", "Email". */
  detail: string;
  /** The whole address (its tooltip, Copy and Open); '' when there is none. */
  full: string;
  newTab: boolean;
  /** What a button does (sends a form, adds to the cart), not where it goes. */
  does?: boolean;
}

export interface DestinationContext {
  map: SiteMap | null;
  /** The page in the frame (its slug in the site map). */
  page: string;
  /** This site's address (its links are named by their page, never by their domain). */
  origin: string;
}

const FILE = /\.(pdf|docx?|xlsx?|pptx?|zip|jpe?g|png|gif|webp|svg|mp3|mp4|mov|csv|txt)$/i;
const STORE: Record<string, string> = { cart: 'Cart', checkout: 'Checkout', 'my-account': 'My account', shop: 'Shop' };

const decode = (v: string): string => {
  try { return decodeURIComponent(v); } catch { return v; }
};
const trimSlash = (p: string): string => p.replace(/\/+$/, '') || '/';
const pathOf = (url: string, origin: string): string => {
  try { return trimSlash(new URL(url, origin).pathname); } catch { return ''; }
};
const humanize = (slug: string): string => decode(slug).replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/**
 * A path on one line: whole when it is short, else its first part and its
 * last readable one (a map's place, not its trailing code) around "…", cut
 * when it is long itself.
 */
export function shortPath(pathname: string, max = 30): string {
  const p = decode(pathname).replace(/\+/g, ' ').replace(/\/+$/, '');
  if (!p || p === '/') return '';
  if (p.length <= max) return p;
  const parts = p.split('/').filter(Boolean);
  const readable = parts.slice(1).reverse().find((part) => /[a-z]{3,}/i.test(part) && !/[=!@]/.test(part));
  const last = readable || parts[parts.length - 1] || '';
  const head = parts.length > 2 ? `/${parts[0]}/…/` : parts.length === 2 ? `/${parts[0]}/` : '/';
  const lead = head.length > max / 2 ? '/…/' : head;
  const whole = lead + last;
  return whole.length <= max ? whole : `${lead}${last.slice(0, Math.max(8, max - lead.length - 1))}…`;
}

/** The page of the site map at a path ('/' is the homepage). */
function pageAt(map: SiteMap | null, path: string, origin: string): SiteMapPage | null {
  if (!map) return null;
  return map.pages.find((p) => pathOf(p.url, origin) === path) || (path === '/' ? map.pages.find((p) => p.slug === 'index') || null : null);
}

/** What a button does, or where a link goes; null when there is nothing to say. */
export function describeDestination(link: LinkInfo | undefined, button: ButtonInfo | undefined, ctx: DestinationContext): Destination | null {
  if (button?.does === 'add-to-cart') {
    return { icon: 'cart', title: `Adds ${button.product || 'this product'} to the cart`, detail: '', full: '', newTab: false, does: true };
  }
  if (button?.does === 'submit') {
    const form = ctx.map?.forms?.find((f) => f.name === button.form || button.form.endsWith(`-${f.name}`));
    return { icon: 'send', title: `Sends ${form?.label || 'this form'}`, detail: '', full: '', newTab: false, does: true };
  }
  if (!link) return null;
  const raw = link.href.trim();
  const newTab = link.target === '_blank';
  if (!raw || raw === '#' || /^javascript:/i.test(raw)) return { icon: 'nowhere', title: 'Goes nowhere', detail: '', full: '', newTab: false };
  if (/^mailto:/i.test(raw)) {
    const address = decode(raw.slice(7).split('?')[0]).trim();
    return address ? { icon: 'email', title: address, detail: 'Email', full: raw, newTab: false } : { icon: 'nowhere', title: 'No email address', detail: '', full: '', newTab: false };
  }
  if (/^(tel|sms):/i.test(raw)) {
    const number = decode(raw.replace(/^(tel|sms):/i, '')).trim();
    return number ? { icon: 'phone', title: number, detail: 'Phone', full: raw, newTab: false } : { icon: 'nowhere', title: 'No phone number', detail: '', full: '', newTab: false };
  }
  let url: URL;
  try { url = new URL(link.url || raw, ctx.origin); } catch { return { icon: 'web', title: raw, detail: '', full: raw, newTab }; }
  if (url.origin !== ctx.origin) {
    return { icon: 'web', title: url.hostname.replace(/^www\./, ''), detail: shortPath(url.pathname), full: url.href, newTab };
  }
  const path = trimSlash(url.pathname);
  const here = ctx.map?.pages.find((p) => p.slug === ctx.page) || null;
  if (url.hash && (raw.startsWith('#') || (here && pathOf(here.url, ctx.origin) === path))) {
    const id = decode(url.hash.slice(1));
    const section = here?.sections.find((s) => s.id === id);
    return { icon: 'section', title: section?.label || `#${id}`, detail: 'On this page', full: url.href, newTab };
  }
  if (link.download || FILE.test(path)) return { icon: 'file', title: decode(path.split('/').pop() || path), detail: 'File', full: url.href, newTab };
  const page = pageAt(ctx.map, path, ctx.origin);
  if (page) return { icon: 'page', title: page.title, detail: path === '/' ? '/' : shortPath(path), full: url.href, newTab };
  if (path === '/') return { icon: 'page', title: 'Home', detail: '/', full: url.href, newTab };
  const product = /^\/product\/([^/]+)$/.exec(path);
  if (product) {
    const known = ctx.map?.products.find((p) => p.slug === product[1]);
    return { icon: 'product', title: known?.name || humanize(product[1]), detail: 'Product', full: url.href, newTab };
  }
  const post = ctx.map?.posts?.find((p) => pathOf(p.url, ctx.origin) === path);
  if (post) return { icon: 'post', title: post.title, detail: 'Post', full: url.href, newTab };
  const store = STORE[path.slice(1)];
  if (store) return { icon: 'cart', title: store, detail: 'Store page', full: url.href, newTab };
  return { icon: 'page', title: shortPath(path) || path, detail: '', full: url.href, newTab };
}

/** A place a link can go to (or a page a menu can add), with the words that ask for it. */
export interface PickItem { key: string; icon: DestinationIcon; title: string; detail: string; prompt: string }

/**
 * The places to choose from: this site's live pages (the homepage first),
 * this page's sections (for a link), the latest posts. `menu` asks to add
 * a link to the page; `link` to point the selected link or button there.
 */
export function destinationsFor(map: SiteMap | null, page: string, what: 'link' | 'menu', origin: string): { pages: PickItem[]; sections: PickItem[]; posts: PickItem[] } {
  if (!map) return { pages: [], sections: [], posts: [] };
  const goTo = (words: string) => (what === 'menu' ? `Add a link to ${words} here.` : `Make it go to ${words}.`);
  const live = map.pages.filter((p) => p.status !== 'draft');
  const ordered = [...live.filter((p) => p.slug === 'index'), ...live.filter((p) => p.slug !== 'index')];
  const pages = ordered.map((p) => {
    const path = pathOf(p.url, origin) || '/';
    return { key: `page:${p.slug}`, icon: 'page' as const, title: p.title, detail: path === '/' ? '/' : shortPath(path), prompt: goTo(`the "${p.title}" page (${path})`) };
  });
  const here = what === 'link' ? map.pages.find((p) => p.slug === page) : null;
  const sections = (here?.sections || []).filter((s) => s.id && s.label).map((s) => ({
    key: `section:${s.id}`, icon: 'section' as const, title: s.label, detail: 'On this page', prompt: goTo(`the "${s.label}" section of this page (#${s.id})`),
  }));
  const posts = (map.posts || []).slice(0, 8).map((p) => {
    const path = pathOf(p.url, origin);
    return { key: `post:${p.postId}`, icon: 'post' as const, title: p.title, detail: 'Post', prompt: goTo(`the post "${p.title}" (${path})`) };
  });
  return { pages, sections, posts };
}
