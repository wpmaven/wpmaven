/**
 * Blog posts as the Blog screen reads them (wp/v2/posts with context=edit:
 * the raw title, never HTML entities) and the update_post fields a quick
 * edit changes.
 *
 * A read names its fields and never asks for the post's content or
 * WordPress's excerpt: WordPress makes both by rendering the post (an empty
 * excerpt comes from the rendered text), and one post whose blocks do not
 * close ran the site out of memory there, so the whole Blog answered 500.
 * The plugin's wpmaven field gives the excerpt as written and a short plain
 * summary read from the stored text, never rendered.
 */

import { decodeHtmlEntities } from '../../../utils/text';
import { plainText, rawOrText } from '../store/shared/media';
import type { PostFields, StorePostRow } from '../../../types/store';

interface WpTerm {
  id: number;
  name: string;
  taxonomy: string;
}

export interface WpPost {
  id: number;
  date: string;
  date_gmt?: string | null;
  modified_gmt?: string | null;
  slug?: string;
  status: string;
  link?: string;
  title?: { raw?: string; rendered?: string };
  excerpt?: { raw?: string; rendered?: string };
  featured_media?: number;
  /** The plugin's field: the excerpt as written, and the line under the title (plain, short, never rendered). */
  wpmaven?: { designOwned?: boolean; excerpt?: string; summary?: string };
  _embedded?: {
    'wp:featuredmedia'?: Array<{ code?: string; source_url?: string; media_details?: { sizes?: Record<string, { source_url?: string }> } }>;
    'wp:term'?: WpTerm[][];
  };
}

export interface BlogPost extends StorePostRow {
  /** The date in UTC (null for a draft without one), shown in the owner's time. */
  dateGmt: string | null;
  /** What the list shows under the title: the excerpt, else the start of the post. */
  summary: string;
}

/** Every post the owner may see, whatever its status. */
export const ALL_STATUSES = 'publish,draft,pending,future,private';

/**
 * The fields of a list or of one post: what a row and the quick edit show,
 * never `content` or `excerpt` (WordPress renders the post for both). The
 * same list as the plugin's WebMaven_Store_Rest_Filters::LIST_POST_FIELDS,
 * plus the links the embeds need.
 */
export const POST_FIELDS = 'id,date,date_gmt,modified_gmt,slug,status,link,title,featured_media,categories,tags,wpmaven,_links,_embedded';

/** The query of a list or of one post: raw texts, the featured image and the categories in the same answer. */
export const POST_QUERY = { context: 'edit', _embed: 'wp:featuredmedia,wp:term', _fields: POST_FIELDS };

export function toPost(p: WpPost): BlogPost {
  const media = p._embedded?.['wp:featuredmedia']?.[0];
  const sizes = media?.media_details?.sizes ?? {};
  const imageUrl = media && !media.code ? (sizes.medium?.source_url || sizes.thumbnail?.source_url || media.source_url || null) : null;
  const terms = (p._embedded?.['wp:term'] ?? []).flat().filter((t): t is WpTerm => !!t && typeof t.id === 'number');
  const written = p.wpmaven?.excerpt;
  const excerpt = typeof written === 'string'
    ? decodeHtmlEntities(written)
    : typeof p.excerpt?.raw === 'string' ? decodeHtmlEntities(p.excerpt.raw) : plainText(p.excerpt?.rendered);
  const summary = typeof p.wpmaven?.summary === 'string' ? p.wpmaven.summary : excerpt || plainText(p.excerpt?.rendered);
  return {
    id: p.id,
    title: rawOrText(p.title),
    excerpt,
    status: p.status,
    date: p.date,
    modifiedGmt: p.modified_gmt || null,
    slug: p.slug || '',
    link: p.link || '',
    featuredMediaId: p.featured_media ? p.featured_media : null,
    imageUrl,
    categories: terms.filter((t) => t.taxonomy === 'category').map((t) => ({ id: t.id, name: decodeHtmlEntities(t.name) })),
    tags: terms.filter((t) => t.taxonomy === 'post_tag').map((t) => decodeHtmlEntities(t.name)),
    designOwned: p.wpmaven?.designOwned === true,
    dateGmt: p.date_gmt || null,
    summary,
  };
}

/** A WordPress time without a zone is UTC: say so, so every reader agrees. */
export function utc(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
}

/** The post's date (the site's time) as a datetime-local value: "2026-10-12T09:00". */
export function dateInput(date: string | null | undefined): string {
  return date && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(date) ? date.slice(0, 16) : '';
}

export interface PostForm {
  title: string;
  excerpt: string;
  status: string;
  /** datetime-local, the site's time. */
  date: string;
  featured: { id: number; url: string | null } | null;
  categoryIds: number[];
  /** Categories by name, added to the post (made when the site has none of that name). */
  newCategories: string[];
  /** Tag names, separated by commas. */
  tags: string;
}

export function formOf(post: BlogPost): PostForm {
  return {
    title: post.title,
    excerpt: post.excerpt,
    status: post.status,
    date: dateInput(post.date),
    featured: post.featuredMediaId ? { id: post.featuredMediaId, url: post.imageUrl } : null,
    categoryIds: post.categories.map((c) => c.id),
    newCategories: [],
    tags: post.tags.join(', '),
  };
}

/** "coffee, Brewing ,, coffee" as the tag names WordPress keeps: trimmed, no empty one, each once. */
export function tagList(text: string): string[] {
  const out: string[] = [];
  for (const t of text.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t.slice(0, 100));
  }
  return out;
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Only what the form changed (update_post refuses an empty change). */
export function changedFields(post: BlogPost, form: PostForm): PostFields {
  const out: PostFields = {};
  const title = form.title.trim();
  if (title !== post.title) out.title = title;
  if (form.excerpt.trim() !== post.excerpt.trim()) out.excerpt = form.excerpt.trim();
  if (form.status !== post.status) out.status = form.status as PostFields['status'];
  if (form.date && form.date !== dateInput(post.date)) out.date = `${form.date}:00`;
  // A post scheduled now names the time it goes live.
  if (out.status === 'future' && !out.date && form.date) out.date = `${form.date}:00`;
  // A scheduled post published now goes live now (WordPress keeps a future date scheduled).
  if (out.status === 'publish' && post.status === 'future' && !out.date) out.date = `${new Date().toISOString().slice(0, 19)}Z`;
  const featured = form.featured?.id ?? null;
  if (featured !== post.featuredMediaId) out.featuredMediaId = featured;
  if (!sameSet(form.categoryIds, post.categories.map((c) => c.id))) out.categoryIds = [...form.categoryIds];
  const fresh = form.newCategories.map((n) => n.trim()).filter(Boolean);
  if (fresh.length) out.newCategories = fresh;
  const tags = tagList(form.tags);
  if (tags.join('\n') !== post.tags.join('\n')) out.tags = tags;
  return out;
}

/** The id of the post an add_post made ("post:42" in its changes). */
export function createdPostId(changed: Array<{ ref: string }> | undefined): number | null {
  for (const c of changed ?? []) {
    const m = /^post:(\d+)$/.exec(c.ref);
    if (m) return Number(m[1]);
  }
  return null;
}
