/**
 * A change to the site, drawn the way the site will show it (2026-09-24).
 *
 * An owner's Content Writer approval read "Master Class &bull; Specialty
 * Brewing", no spacing, no images: "it should look like the original post,
 * not raw text. Fix this EVERYWHERE." A post, a page, a product or a
 * translation an operator wants to put on the site is now drawn as a page:
 * its title, its featured image, its own HTML and styles, in a frame that
 * runs no script (SitePostPreview.tsx).
 *
 * The API sends `sitePreview` on every such row (GET /operators/approvals,
 * GET /admin/approvals): the HTML already sanitized, the site's address and
 * the business's colors. This module is the fallback for a row from an API
 * that does not (it reads the same fields from params, mirroring the API's
 * sitePreviewParts in services/sitePreview.ts), and builds the document the
 * frame shows. Pure, no DOM: the node tests load it.
 */

import { readableText } from './previewData';

export type SitePreviewKind = 'post' | 'page' | 'update' | 'translation' | 'product';

export interface SitePreviewBrand {
  primary: string;
  text: string;
  heading: string;
  background: string;
  headingFont: string;
  bodyFont: string;
}

/** What the API attaches as `sitePreview`. */
export interface SitePreviewData {
  kind: SitePreviewKind;
  title: string | null;
  status: string | null;
  /** "Draft", "Will be published", ... */
  statusLabel: string;
  /** The words on one line, for a card or a message. */
  excerpt: string | null;
  /** The post's HTML (sanitized by the API; sanitized again before drawing). */
  html: string;
  images: string[];
  featuredImageUrl: string | null;
  /** The site's address, so relative links and images resolve as on the site. */
  baseUrl: string | null;
  postId?: number;
  brand?: SitePreviewBrand;
}

/** The page as it is now, for an update's Before (GET .../approvals/:id/before). */
export interface SitePreviewBefore {
  title: string | null;
  html: string;
  status: string | null;
  featuredImageUrl: string | null;
}

export interface SitePreviewBeforeAnswer {
  before: SitePreviewBefore | null;
  /** already_changed: EXECUTED, the site shows the new version. not_made: it
   *  never ran (rejected, expired, changes requested, failed). */
  reason?: 'not_an_update' | 'already_changed' | 'not_made' | 'unavailable';
}

const COMMANDS: Record<string, SitePreviewKind> = {
  create_post: 'post',
  create_page: 'page',
  update_post: 'update',
  multilingual_save_translation: 'translation',
  woocommerce_create_product: 'product',
};

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** An absolute http(s) address, or null. */
export function httpUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : null;
}

/**
 * A translation saved with overwrite and no status: the plugin rewrites the
 * one there now and keeps its status (a live one stays live); only a new one
 * starts as a draft. Same words as the API.
 */
export const TRANSLATION_KEEPS_STATUS_LABEL = 'Replaces the one there now and keeps its status (a new one starts as a draft)';

/** `overwrite` as the plugin reads it (PHP !empty). Without it the plugin never touches a translation that exists. */
export function overwriteSet(v: unknown): boolean {
  if (v === undefined || v === null || v === false || v === 0 || v === '' || v === '0') return false;
  return !(Array.isArray(v) && v.length === 0);
}

/** The owner's words for a status. Same sentences as the API. */
export function statusLabelFor(kind: SitePreviewKind, status: string | null): string {
  switch (status) {
    case 'publish': return 'Will be published';
    case 'future': return 'Scheduled';
    case 'private': return 'Private';
    case 'pending': return 'Draft, waiting for review';
    case 'draft': return 'Draft';
    default:
      return kind === 'update' ? 'Changes what is there now'
        : kind === 'translation' ? TRANSLATION_KEEPS_STATUS_LABEL
          : 'Draft';
  }
}

/** What an executed change did, in the past tense. */
export function madeLabelFor(kind: SitePreviewKind, status: string | null): string {
  switch (status) {
    case 'publish': return 'Published';
    case 'future': return 'Scheduled';
    case 'private': return 'Saved as private';
    case 'pending': return 'Saved as a draft for review';
    case 'draft': return 'Saved as a draft';
    default:
      return kind === 'update' ? 'Changed on your site'
        : kind === 'translation' ? 'Translation saved'
          : 'Saved';
  }
}

/**
 * The chip beside what the change is. While it has not run (PENDING, or
 * APPROVED and NEEDS_ACTIONS on their way), what it will do: "Draft", "Will
 * be published". Once decided, what happened: a rejected post never "Will be
 * published", and a published one is "Published".
 */
export function statusChipFor(
  preview: Pick<SitePreviewData, 'kind' | 'status' | 'statusLabel'>,
  approvalStatus?: string | null,
): string {
  switch (approvalStatus) {
    case 'EXECUTED': return madeLabelFor(preview.kind, preview.status);
    case 'REJECTED':
    case 'EXPIRED':
    case 'CHANGES_REQUESTED': return 'Not made';
    case 'FAILED': return 'Not made, it failed';
    default: return preview.statusLabel;
  }
}

/**
 * Whether an update can be set beside the page as it is now: only while the
 * change waits (PENDING, or NEEDS_ACTIONS, approved and held for actions).
 * After it ran the site shows the new version; a change that never ran has
 * nothing to compare. A row with no status shows no Before at all.
 */
export function canCompareBefore(approvalStatus?: string | null): boolean {
  return approvalStatus === 'PENDING' || approvalStatus === 'NEEDS_ACTIONS';
}

/** Every http(s) image the HTML shows, in order. */
export function imagesIn(html: string): string[] {
  const out: string[] = [];
  if (typeof html !== 'string') return out;
  for (const m of html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const url = httpUrl((m[1] ?? m[2] ?? m[3] ?? '').replace(/&amp;/g, '&'));
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

/** `text` cut to `max` characters at a word, with "..." when it was cut. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(1, max - 3));
  const atWord = cut.replace(/\s+\S*$/, '');
  return `${(atWord.length >= max * 0.6 ? atWord : cut).trimEnd()}...`;
}

/**
 * The preview of a row whose API sent none: read from its params (direct, or
 * through execute_command). Null for a row that puts no content on the site.
 * Its `html` is the params' HTML as-is: SitePostPreview sanitizes whatever
 * it draws.
 */
export function deriveSitePreview(toolName: string | null | undefined, params: unknown): SitePreviewData | null {
  const p = asObject(params);
  if (!p || !toolName) return null;
  let command = toolName;
  let args: Record<string, unknown> = p;
  if (toolName === 'execute_command') {
    const call = asObject(p.command) ?? p;
    command = String(call.command ?? '').replace(/^wp_/, '');
    args = asObject(call.args) ?? {};
  }
  const kind = COMMANDS[command];
  if (!kind) return null;
  const rawTitle = kind === 'product' ? str(args.name) : str(args.title);
  const title = rawTitle ? readableText(rawTitle).replace(/\s+/g, ' ').trim() || null : null;
  const body = kind === 'product'
    ? [str(args.short_description), str(args.description)].filter((v): v is string => !!v).join('\n')
    : str(args.content) ?? '';
  // An update, and a translation saved with overwrite, keep the status of
  // what is there now (mirrors the API's sitePreviewParts).
  const keepsStatus = kind === 'update' || (kind === 'translation' && overwriteSet(args.overwrite));
  const status = str(args.status) ?? (kind === 'product' ? 'publish' : keepsStatus ? null : 'draft');
  const productImages = kind === 'product' && Array.isArray(args.images)
    ? args.images.map(httpUrl).filter((u): u is string => !!u)
    : [];
  const featuredImageUrl = kind === 'product' ? productImages[0] ?? null : httpUrl(args.featured_image_url);
  const images: string[] = [];
  for (const u of [featuredImageUrl, ...productImages, ...imagesIn(body)]) {
    if (u && !images.includes(u)) images.push(u);
  }
  const words = readableText(body).replace(/\s+/g, ' ').trim();
  const postId = kind === 'update' ? Number(args.id) : NaN;
  return {
    kind,
    title,
    status,
    statusLabel: statusLabelFor(kind, status),
    excerpt: words ? clip(words, 300) : null,
    html: body,
    images,
    featuredImageUrl,
    baseUrl: null,
    ...(Number.isInteger(postId) && postId > 0 ? { postId } : {}),
  };
}

/** The noun the owner reads in "See the full post". Same words as the API's WhatsApp link. */
export function sitePreviewNoun(kind: SitePreviewKind): string {
  switch (kind) {
    case 'post': return 'post';
    case 'page': return 'page';
    case 'product': return 'product';
    case 'translation': return 'translation';
    case 'update': return 'change';
  }
}

/** The row's preview: the API's when it sent one, else read from params. */
export function sitePreviewOf(row: {
  toolName?: string | null;
  params?: unknown;
  sitePreview?: SitePreviewData | null;
}): SitePreviewData | null {
  if (row.sitePreview && typeof row.sitePreview === 'object' && typeof row.sitePreview.html === 'string') return row.sitePreview;
  return deriveSitePreview(row.toolName, row.params);
}

/**
 * The preview to draw as a page, or null to show the row the plain way: an
 * update that changes no words (only a title or a status) has no page to
 * draw, and drawing an empty one would say the page will be emptied.
 */
export function drawableSitePreview(row: {
  toolName?: string | null;
  params?: unknown;
  sitePreview?: SitePreviewData | null;
}): SitePreviewData | null {
  const site = sitePreviewOf(row);
  if (!site) return null;
  if (site.html.trim()) return site;
  return site.kind !== 'update' && (site.title || site.featuredImageUrl) ? site : null;
}

// ── The document the frame shows ─────────────────────────────────────────

/**
 * The frame's own policy: nothing loads but images, styles and fonts from the
 * web, no script of any kind, no form goes anywhere, nothing is framed.
 * It is the first thing in <head>, before anything the post brings.
 */
export const PREVIEW_CSP = "default-src 'none'; img-src https: data:; media-src https:; style-src 'unsafe-inline' https:; font-src https: data:; form-action 'none'";

/**
 * The frame's sandbox. Never `allow-scripts`: with `allow-same-origin` (kept
 * so the page can measure the post's height) it would let the post's script
 * reach the dashboard. Links open in a new tab, outside the sandbox.
 */
export const PREVIEW_SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

const DEFAULT_BRAND: SitePreviewBrand = {
  primary: '#1f2937', text: '#111827', heading: '#111827', background: '#ffffff', headingFont: 'Inter', bodyFont: 'Inter',
};

/** A CSS color or font name safe inside the stylesheet, else the default. */
function safeColor(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(v.trim()) ? v.trim() : fallback;
}
function safeFont(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^[\w\s-]{1,60}$/.test(v.trim()) ? v.trim() : fallback;
}

export function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The article stylesheet: readable defaults for anything the post does not
 * style itself (its own <style> comes after and wins), tinted with the
 * business's colors and fonts so the draft reads like their site.
 */
export function articleStylesheet(brand?: Partial<SitePreviewBrand> | null): string {
  const b = {
    primary: safeColor(brand?.primary, DEFAULT_BRAND.primary),
    text: safeColor(brand?.text, DEFAULT_BRAND.text),
    heading: safeColor(brand?.heading, DEFAULT_BRAND.heading),
    background: safeColor(brand?.background, DEFAULT_BRAND.background),
    headingFont: safeFont(brand?.headingFont, DEFAULT_BRAND.headingFont),
    bodyFont: safeFont(brand?.bodyFont, DEFAULT_BRAND.bodyFont),
  };
  return [
    'html{-webkit-text-size-adjust:100%}',
    `body{margin:0;background:${b.background};color:${b.text};font-family:"${b.bodyFont}",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.65;overflow-wrap:break-word}`,
    '.wm-post{display:flow-root;max-width:720px;margin:0 auto;padding:24px 20px 32px}',
    `.wm-post h1,.wm-post h2,.wm-post h3,.wm-post h4,.wm-post h5,.wm-post h6{color:${b.heading};font-family:"${b.headingFont}",Georgia,serif;line-height:1.25;margin:1.4em 0 .5em}`,
    '.wm-post>h1:first-child{margin-top:0;font-size:2em}',
    '.wm-post p,.wm-post ul,.wm-post ol,.wm-post figure,.wm-post blockquote,.wm-post table{margin:0 0 1em}',
    `.wm-post a{color:${b.primary};text-decoration:underline}`,
    '.wm-post img,.wm-post video{max-width:100%;height:auto;border-radius:6px}',
    '.wm-post .wm-featured{display:block;width:100%;max-height:420px;object-fit:cover;margin:0 0 1.2em}',
    `.wm-post blockquote{border-left:3px solid ${b.primary};padding-left:1em;opacity:.9}`,
    '.wm-post table{border-collapse:collapse;width:100%}.wm-post td,.wm-post th{border:1px solid rgba(0,0,0,.12);padding:6px 8px}',
    '.wm-post figcaption{font-size:.85em;opacity:.75}',
  ].join('\n');
}

export interface PostDocumentInput {
  title: string | null;
  /** SANITIZED html only (sanitizePostHtml). */
  html: string;
  featuredImageUrl?: string | null;
  baseUrl?: string | null;
  brand?: Partial<SitePreviewBrand> | null;
}

/**
 * The whole document for the frame's srcdoc: the policy first, the site's
 * address as the base (links open in a new tab), the article stylesheet,
 * then <article><h1>title</h1>[featured image]post</article>.
 */
export function buildPostDocument(input: PostDocumentInput): string {
  const base = httpUrl(input.baseUrl ?? null);
  const featured = httpUrl(input.featuredImageUrl ?? null);
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(PREVIEW_CSP)}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    base ? `<base href="${escapeHtml(base)}" target="_blank">` : '<base target="_blank">',
    `<style>${articleStylesheet(input.brand)}</style>`,
    '</head><body><article class="wm-post">',
    input.title ? `<h1>${escapeHtml(input.title)}</h1>` : '',
    featured ? `<img class="wm-featured" src="${escapeHtml(featured)}" alt="">` : '',
    input.html,
    '</article></body></html>',
  ].join('');
}
