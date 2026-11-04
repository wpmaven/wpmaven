/**
 * What an approval row would actually publish, read out of its `params`.
 *
 * Every approval surface (Waiting for you, the Approvals tab, the staff queue)
 * used to read `params` its own way: one showed `params.text` and nothing
 * else, one had its own idea of which `mediaUrls` entry was the video, and none
 * of them showed the image. The owner was asked to approve a video they could
 * not watch and a picture they could not see. This module is the one place
 * those rules live on the client. They mirror the API's `revisableField`,
 * `mediaHeaderFor` and `targetPlatforms` (operatorApprovalService) and the
 * `preview` object `GET /admin/approvals` builds from the same helpers, so a
 * customer and a staff member looking at the same row see the same thing.
 *
 * Everything here is defensive on purpose: `params` is `Json` in the schema
 * and older rows, or a tool that changes its payload, must degrade to
 * "nothing to preview" rather than blank the page.
 */

import type { IconType } from 'react-icons';
import { decodeEntities } from '@yotako/wpmaven-onboarding/shared';
import { NETWORK_LOOKS } from './networkLook';
import { networkName, resolveTargets } from './targets';

type Params = Record<string, unknown> | null | undefined;

/** Param keys that hold owner-facing copy, in the order the API tries them. */
export const REVISABLE_KEYS = ['text', 'message', 'content', 'caption', 'linkPostText', 'summary'] as const;

const VIDEO_EXT = /\.(mp4|mov|m4v|webm)(\?|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif)(\?|$)/i;

/** The shape `GET /admin/approvals` attaches as `preview`, plus the poster the
 *  client can find for the video element. `publishable` only exists on staff
 *  rows; customer rows never carry it. */
export interface ApprovalPreviewData {
  kind: 'video' | 'image' | 'text';
  /** The full post copy. Never shortened here; the component decides how much to show. */
  text: string | null;
  /** Only when it says something different from `text`. */
  caption: string | null;
  videoUrl: string | null;
  posterUrl?: string | null;
  imageUrls: string[];
  /** Lower-cased network ids: platforms ∪ videoPlatforms ∪ linkPlatforms. */
  platforms: string[];
  publishable?: Record<string, { ok: boolean; reason?: string }>;
  /** Per-network facts the owner must see before approving (the API's approvalPreview). */
  networkNotes?: Array<{ network: string; note: string }>;
  /** A shared video's second post (the API's approvalPreview, staff rows); see approvalLinkPost. */
  linkPost?: LinkPostData | null;
}

/** A shared video's second post: its own words and the networks it goes out on, by name. */
export interface LinkPostData {
  networks: string[];
  text: string;
}

/** Where the link post's link goes, as the card shows it (the API's VIDEO_LINK_WORDS). */
export const VIDEO_LINK_WORDS = '[link to the video]';

/** The networks crosspost_video's link pass posts to (the API's LINK_NETWORKS). */
const LINK_POST_NETWORKS: readonly string[] = ['linkedin', 'facebook', 'twitter', 'x', 'gmb'];

/**
 * The second post a shared video makes, read from params the way the API's
 * linkPostOf reads it: crosspost_video publishes linkPostText,
 * with the video's link where {video_url} stands, as a post of its own on
 * the link networks. The card showed the caption only, so those words were
 * approved unseen. Null when the row makes no such post.
 */
export function linkPostFrom(params: Params, toolName?: string | null): LinkPostData | null {
  if (toolName !== 'crosspost_video') return null;
  const p = asObject(params);
  const raw = p && typeof p.linkPostText === 'string' ? p.linkPostText : '';
  if (!raw.trim()) return null;
  const ids = Array.isArray(p?.linkPlatforms)
    ? (p!.linkPlatforms as unknown[]).map((x) => String(x ?? '').trim().toLowerCase()).filter((x) => LINK_POST_NETWORKS.includes(x))
    : [];
  const networks = Array.from(new Set(ids.map(networkName)));
  if (networks.length === 0) return null;
  const text = readableText(raw.split('{video_url}').join(VIDEO_LINK_WORDS));
  return text ? { networks, text } : null;
}

/**
 * The link post a card shows: the API's (on the row, or on the staff
 * preview), well-formed only; read from params when an older API sent none.
 */
export function approvalLinkPost(a: {
  params?: unknown;
  toolName?: string | null;
  linkPost?: unknown;
  preview?: { linkPost?: unknown } | null;
}): LinkPostData | null {
  for (const v of [a.linkPost, a.preview?.linkPost]) {
    if (!v || typeof v !== 'object') continue;
    const { networks, text } = v as { networks?: unknown; text?: unknown };
    const names = Array.isArray(networks) ? networks.filter((n): n is string => typeof n === 'string' && n.trim().length > 0) : [];
    if (typeof text === 'string' && text.trim() && names.length > 0) return { networks: names, text: text.trim() };
  }
  if (a.linkPost === null) return null;
  return linkPostFrom(asObject(a.params), a.toolName);
}

/** `params` is `Json` in the schema: guard against a string, an array, or null
 *  before reading keys off it. */
function asObject(params: unknown): Record<string, unknown> | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  return params as Record<string, unknown>;
}

function stringsIn(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string' && u.trim().length > 0) : [];
}

/**
 * The one param that holds owner-facing copy, or null when the action has no
 * words (a budget bump, a store setting). Same keys, same order as the API, so
 * "Request changes" is offered exactly where the API would accept it.
 */
export function revisableField(params: Params): { key: string; value: string } | null {
  const p = asObject(params);
  if (!p) return null;
  for (const key of REVISABLE_KEYS) {
    const v = p[key];
    if (typeof v === 'string' && v.trim().length > 0) return { key, value: v };
  }
  return null;
}

/**
 * Every network an action posts to. social_publish names them `platforms`;
 * crosspost_video splits them into `videoPlatforms` and `linkPlatforms`, and
 * posts the file to all three video networks when its video list names none
 * of them. Reading only `platforms` made a cross-post to TikTok look like it
 * targeted nothing, so the consent step was skipped on the one tool most
 * likely to send a video there.
 *
 * Prefer the server's `approval.targets` (approvalTargets in ./targets); this
 * reads params, and is the fallback for a row without that field.
 */
export function targetPlatforms(params: Params, toolName?: string | null): string[] {
  return resolveTargets(toolName, params);
}

/**
 * The video an action carries, if it carries one: an explicit `videoUrl`, or
 * the first `mediaUrls` entry with a video extension. This is the one
 * derivation, used by the preview, by the TikTok consent step (which needs the
 * file) and by the Approvals tab (which only asks for the referral payload when
 * a shareable video exists). Two copies of this test would drift, and the two
 * places would then disagree about whether the same approval has a video.
 */
export function videoUrlFrom(params: Params): string | null {
  const p = asObject(params);
  if (!p) return null;
  if (typeof p.videoUrl === 'string' && p.videoUrl.trim()) return p.videoUrl;
  return stringsIn(p.mediaUrls).find((u) => VIDEO_EXT.test(u)) ?? null;
}

/** Every still image the action would publish: `imageUrl`, then `mediaUrls`
 *  minus the video. A URL with no extension is kept (signed storage links
 *  often have none); the component hides it if the browser cannot load it. */
export function imageUrlsFrom(params: Params): string[] {
  const p = asObject(params);
  if (!p) return [];
  const out: string[] = [];
  if (typeof p.imageUrl === 'string' && p.imageUrl.trim()) out.push(p.imageUrl);
  for (const u of stringsIn(p.mediaUrls)) {
    if (VIDEO_EXT.test(u)) continue;
    if (IMAGE_EXT.test(u) || !/\.[a-z0-9]{2,5}(\?|$)/i.test(u)) out.push(u);
  }
  return Array.from(new Set(out));
}

/**
 * Tools whose `summary` is the operator's one sentence for the owner about a
 * change to the site, not words that change puts anywhere. The API's sentence
 * says what the call does, read from the call itself, and the summary follows
 * it as "Your team's note" (ownerApprovalPolicy, also for the database and
 * setting writes), so the preview never shows it a second time as if it
 * were the content, and the raw call stays in the card's "Action details"
 * (2026-09-29).
 */
export const SUMMARY_DESCRIBES_CHANGE: ReadonlySet<string> = new Set([
  'plugin_rest_write', 'plugin_ajax_call', 'plugin_set_option', 'site_database_write',
]);

/** The copy a row publishes or puts on the site; never an operator's description of a change. */
function contentField(params: Params, toolName?: string | null): { key: string; value: string } | null {
  const copy = revisableField(params);
  if (copy && copy.key === 'summary' && toolName && SUMMARY_DESCRIBES_CHANGE.has(toolName)) return null;
  return copy;
}

/**
 * Whether the card offers the call under "Action details": whenever the
 * preview does not already show what the call puts out (a post's text, a
 * page's words), and something is left to check once the internal data is
 * out (actionDetailLines). A database statement, a REST call, a setting or a
 * command is never in the sentence the owner reads (ownerApprovalPolicy,
 * 2026-09-29), so it is always here to check, and only here. A call whose
 * only parameter is internal (an instanceId) has no Action details at all.
 */
export function showsActionDetails(
  a: { toolName?: string | null; params?: unknown; edit?: unknown },
  isEdit: EditMatcher = carriesEditPreview,
): boolean {
  const p = asObject(a.params);
  if (!p || Object.keys(p).length === 0) return false;
  // A change through the edit operations shows its preview, which says
  // everything it changes: its call is never shown. Which rows those are is
  // the app's edit preview's to say (renderers.editPreview.matches).
  if (isEdit(a)) return false;
  if (contentField(p, a.toolName) || siteChangeWords(a.toolName, p)) return false;
  return actionDetailLines(p).length > 0;
}

/** Says whether a row is a change through the edit operations, drawn by the app's edit preview. */
export type EditMatcher = (a: { toolName?: string | null; params?: unknown; edit?: unknown }) => boolean;

/**
 * Without the app's own rule: a row that carries an edit preview (the API's
 * `edit`). The dashboard and the plugin pass their edit preview's matcher,
 * which also knows an edit tool's call waiting on its preview.
 */
export function carriesEditPreview(a: { edit?: unknown }): boolean {
  return !!a.edit && typeof a.edit === 'object' && !Array.isArray(a.edit);
}

/**
 * One labelled line of Action details: a value as text, or the lines of an
 * object (a REST call's body, a command's arguments).
 */
export interface ActionDetailLine {
  label: string;
  value: string | ActionDetailLine[];
  /** A statement, an address or a command: drawn in the code face. */
  code?: boolean;
}

/**
 * Ids and references the owner does not know (2026-10-16): instanceId,
 * conversationId, userId, siteId, any key ending in Id or _id, their
 * plurals. The camel case is matched as written, so "paid" or "valid" stay.
 */
const REFERENCE_KEY = /^(?:id|ids|uuid|guid|ref|refs|reference)$|_(?:id|ids|ref|refs)$/i;
const CAMEL_REFERENCE = /[a-z0-9](?:Id|Ids|ID|IDs|Ref|Refs)$/;
/** The keys that hold a token, a key or a secret. */
const SECRET_KEY = /token|secret|passw(?:or)?d|passphrase|nonce|credential|authori[sz]ation|^auth$|cookie|apikey|(?:^|[_-])(?:key|salt)$/i;
const CAMEL_SECRET = /[a-z0-9]Key$/;
/** Values that are a credential whatever their key: a bearer or basic header, a Stripe key, a JWT. */
const SECRET_VALUE = /^(?:Bearer|Basic)\s|^(?:sk|rk|pk)_(?:live|test)_|^eyJ[\w-]+\.[\w-]+\./;

/** Whether a parameter is never shown: a reference, a secret, or (at the top) one the API marks internal with a leading underscore. */
export function internalParamKey(key: string, top = false): boolean {
  return (top && key.startsWith('_'))
    || REFERENCE_KEY.test(key) || CAMEL_REFERENCE.test(key)
    || SECRET_KEY.test(key) || CAMEL_SECRET.test(key);
}

/** The call's own parts, in the owner's words. The rest keep their name, made readable. */
const DETAIL_LABELS: Record<string, string> = {
  sql: 'Database statement',
  command: 'Command',
  args: 'Arguments',
  arguments: 'Arguments',
  plugin: 'Plugin',
  plugin_slug: 'Plugin',
  option: 'Setting',
  option_name: 'Setting',
  value: 'Value',
  option_value: 'Value',
  action: 'Action',
  body: 'Body',
  query: 'Query',
  params: 'Fields',
};
/** Parts read as code: what runs, exactly as it runs. */
const CODE_KEYS = new Set(['sql', 'command', 'option', 'option_name', 'action']);
/** The keys of a REST call's address, joined with its method into one line. */
const ADDRESS_KEYS = ['route', 'path', 'endpoint', 'url'] as const;
/** The operator's note for the owner: the card says it already, in its sentence. */
const NOTE_KEYS = new Set(['summary']);
const MAX_DEPTH = 4;
const MAX_ITEMS = 20;

/** "discount_type" and "discountType" read "Discount type". */
function readableKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** A value as the owner reads it, or null when there is nothing (or nothing safe) to show. */
function detailValue(value: unknown, depth: number): string | ActionDetailLine[] | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    return text && !SECRET_VALUE.test(text) ? text : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    if (value.every((v) => v == null || ['string', 'number', 'boolean'].includes(typeof v))) {
      const items = value.map((v) => detailValue(v, depth + 1)).filter((v): v is string => typeof v === 'string');
      if (items.length === 0) return null;
      const shown = items.slice(0, MAX_ITEMS).join(', ');
      return items.length > MAX_ITEMS ? `${shown}, and ${items.length - MAX_ITEMS} more` : shown;
    }
    const lines: ActionDetailLine[] = [];
    value.slice(0, MAX_ITEMS).forEach((v, i) => {
      const inner = detailValue(v, depth + 1);
      if (inner !== null) lines.push({ label: String(i + 1), value: inner });
    });
    return lines.length > 0 ? lines : null;
  }
  const obj = asObject(value);
  if (!obj) return null;
  const lines = objectLines(obj, depth + 1, false);
  return lines.length > 0 ? lines : null;
}

/**
 * An object's lines: internal keys out, each other key labelled. At the top
 * a parameter reads in words; inside one (a REST body, a command's
 * arguments, a setting's value) the keys are the call's own field names,
 * shown as they are.
 */
function objectLines(obj: Record<string, unknown>, depth: number, top: boolean): ActionDetailLine[] {
  const lines: ActionDetailLine[] = [];
  for (const [key, raw] of Object.entries(obj)) {
    if (internalParamKey(key, top)) continue;
    const value = detailValue(raw, depth);
    if (value === null) continue;
    const label = top ? (DETAIL_LABELS[key] ?? readableKey(key)) : key;
    lines.push({ label, value, ...(top && CODE_KEYS.has(key) && typeof value === 'string' ? { code: true } : {}) });
  }
  return lines;
}

/**
 * What Action details show of a call (2026-10-16): what the owner can check
 * (the database statement, the address and body of a REST call, a setting's
 * name and value, a command and its arguments) as labelled lines, never
 * JSON. Never an id or a reference the owner does not know, a token, a key
 * or a secret, at any depth, nor the operator's note the card already says.
 * Empty when nothing is left: then there are no Action details at all.
 */
export function actionDetailLines(params: unknown): ActionDetailLine[] {
  const p = asObject(params);
  if (!p) return [];
  // A REST call's address: its method and route on one line, where the route is.
  const addressKey = ADDRESS_KEYS.find((k) => typeof p[k] === 'string' && (p[k] as string).trim() !== '');
  const method = typeof p.method === 'string' ? p.method.trim().toUpperCase() : '';
  const lines: ActionDetailLine[] = [];
  for (const [key, value] of Object.entries(p)) {
    if (NOTE_KEYS.has(key) || (addressKey && key === 'method')) continue;
    if (key === addressKey) {
      const address = detailValue(value, 0);
      if (typeof address === 'string') lines.push({ label: 'Address', value: method ? `${method} ${address}` : address, code: true });
      continue;
    }
    lines.push(...objectLines({ [key]: value }, 0, true));
  }
  return lines;
}

/**
 * Whether "Request changes" can do anything for this row: it needs wording to
 * rewrite, the API caps the rounds at three, and a change to the site (a
 * page, a setting) is never re-drafted from the inbox (revisable: false, set
 * by the API since every change asks, 2026-09-22).
 */
export function canRequestChanges(a: { params?: unknown; revisable?: boolean; revisionRound?: number | null }): boolean {
  return a.revisable !== false && revisableField(asObject(a.params)) !== null && (a.revisionRound ?? 0) < 3;
}

/** Elements a browser lays out as a block: a blank line before and after. */
const BLOCK_TAGS = 'address|article|aside|blockquote|details|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|summary|table|tr|ul';
/** Elements whose content is never read on the page. */
const SILENT_TAGS = 'script|style|noscript|template|svg|head|title|iframe|object';
/** The rest of a tag: its attributes, where a quoted value may hold ">". */
const ATTRS = `(?:"[^"]*"|'[^']*'|[^'">])*`;

/**
 * Copy as a person reads it on the site. A change to the site carries its
 * page as HTML (every change asks, 2026-09-22), and the owner should read the
 * words laid out as the site lays them out: a blank line between paragraphs
 * and headings, "• " before each list item, a line break for <br>, spaces
 * collapsed the way a browser collapses them, and every character reference
 * decoded once. A regex that decoded only `&nbsp;` and `&amp;` and ran the
 * blocks together is how a blog post's preview read "&bull; Fresh bread
 * &ndash; daily" (2026-09-24). Plain copy (a post, a message) keeps its own
 * line breaks, with its references decoded too.
 *
 * MIRRORS the API's htmlToText (utils/operatorText/htmlText.ts, behind
 * readableCopy), which uses a real parser; this one reads without a DOM so
 * the node tests can run it. Both are held to the same examples.
 */
export function readableText(value: string): string {
  if (typeof value !== 'string' || !value) return '';
  if (!/<[a-z!/][^>]*>/i.test(value)) return decodeEntities(value).replace(/\u00a0/g, ' ').trim();
  // Tags come out BEFORE references are decoded: "&lt;b&gt;" is the text
  // "<b>" on the site, and must not then be taken for a tag.
  const words = value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<![^>]*>/g, '')
    .replace(new RegExp(`<(${SILENT_TAGS})\\b${ATTRS}>[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), '')
    .replace(/[ \t\r\n\f]+/g, ' ')
    .replace(new RegExp(`<br\\b${ATTRS}>`, 'gi'), '\n')
    .replace(new RegExp(`<li\\b${ATTRS}>`, 'gi'), '\n• ')
    .replace(new RegExp(`<\\/?(td|th)\\b${ATTRS}>`, 'gi'), ' ')
    .replace(new RegExp(`<\\/?(${BLOCK_TAGS})\\b${ATTRS}>`, 'gi'), '\n\n')
    .replace(new RegExp(`<\\/?[a-z]${ATTRS}>`, 'gi'), '');
  return decodeEntities(words)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The tools whose change puts words on the site (a page, a post, a product, a translation). */
const SITE_WORDS_COMMANDS = new Set(['create_post', 'create_page', 'update_post', 'multilingual_save_translation', 'woocommerce_create_product']);

/**
 * The words a change to the site puts on it, as a person reads them: the
 * text of the page, post, product or translation it writes, directly or
 * through execute_command. Null for a change with no words (a plugin, a
 * setting, a file). Mirrors the API's siteChangeExcerpt (operatorApprovalService),
 * which WhatsApp shows for the same row, so the owner never approves a page
 * from Home without having read it. Not clipped: the card decides how much.
 */
export function siteChangeWords(toolName: string | null | undefined, params: unknown): string | null {
  const p = asObject(params);
  if (!p || !toolName) return null;
  let command = toolName;
  let args: Record<string, unknown> = p;
  if (toolName === 'execute_command') {
    const call = asObject(p.command) ?? p;
    command = String(call.command ?? '').replace(/^wp_/, '');
    args = asObject(call.args) ?? {};
  }
  if (!SITE_WORDS_COMMANDS.has(command)) return null;
  const body = [args.content, args.description, args.short_description].find((v): v is string => typeof v === 'string' && v.trim().length > 0);
  if (!body) return null;
  const text = readableText(body).trim();
  return text || null;
}

/**
 * Build the preview for a row from its params. Pure, never throws.
 *
 * `source` carries what the API computed for the row: when `targets` is an
 * array it is the network list as-is, otherwise the list is read from params
 * with the tool's own default (see ./targets).
 */
export function deriveApprovalPreview(
  params: unknown,
  source: { toolName?: string | null; targets?: unknown } = {},
): ApprovalPreviewData {
  const p = asObject(params);
  // An operator's summary of a change is the card's sentence, not content.
  const copy = contentField(p, source.toolName);
  // A change to the site made through execute_command keeps its words under
  // command.args, where revisableField does not look: the owner then saw
  // "Nothing to preview" and the raw call. Its words are what it puts on the site.
  const text = copy ? readableText(copy.value) : siteChangeWords(source.toolName, p);
  const rawCaption = p && typeof p.caption === 'string' ? readableText(p.caption) : null;
  // A caption that repeats the post is noise under the picture; only a caption
  // that says something else is worth a second block.
  const caption = rawCaption && rawCaption.trim() && rawCaption.trim() !== (text ?? '').trim() ? rawCaption : null;
  const videoUrl = videoUrlFrom(p);
  const imageUrls = imageUrlsFrom(p);
  const posterUrl = p && typeof p.posterUrl === 'string' && p.posterUrl.trim()
    ? p.posterUrl
    : p && typeof p.thumbnailUrl === 'string' && p.thumbnailUrl.trim() ? p.thumbnailUrl : null;
  return {
    kind: videoUrl ? 'video' : imageUrls.length ? 'image' : 'text',
    text,
    caption,
    videoUrl,
    posterUrl,
    imageUrls,
    platforms: Array.isArray(source.targets)
      ? Array.from(new Set(source.targets.map((t) => String(t).trim().toLowerCase()).filter(Boolean)))
      : targetPlatforms(p, source.toolName),
  };
}

/**
 * The staff console's preview of one row: the API's own (it knows each
 * network's gates), except that a change to the site shows its words the
 * way a person reads them. An owner's blog post read "<p>Master Class
 * &bull; Specialty Brewing" there (2026-09-24); the API now sends it
 * readable, and an API that still sends the page's HTML is read here from
 * the params with the inbox's own rules. A social post is left exactly as
 * the API sent it: staff copy it to post it by hand.
 */
export function staffPreview<P extends ApprovalPreviewData>(row: {
  params?: unknown;
  toolName?: string | null;
  targets?: unknown;
  changesSite?: boolean;
  preview?: P | null;
}): P | ApprovalPreviewData {
  if (!row.preview) return deriveApprovalPreview(row.params, { toolName: row.toolName, targets: row.targets });
  if (!row.changesSite) return row.preview;
  const derived = deriveApprovalPreview(row.params, { toolName: row.toolName, targets: row.targets });
  return { ...row.preview, text: derived.text, caption: derived.caption };
}

/** True when there is nothing a person could look at: no copy, no media, no targets. */
export function isEmptyPreview(preview: ApprovalPreviewData): boolean {
  return !preview.text && !preview.caption && !preview.videoUrl
    && preview.imageUrls.length === 0 && preview.platforms.length === 0;
}

/**
 * The API says `x`; the connect cards say `twitter`. Google's profile has been
 * called three things across the services. Fold the spellings before the
 * lookup so a chip always finds its logo.
 */
const PLATFORM_ALIASES: Record<string, string> = {
  x: 'twitter',
  fb: 'facebook',
  ig: 'instagram',
  yt: 'youtube',
  gbp: 'gmb',
  google: 'gmb',
  google_business: 'gmb',
  googlebusiness: 'gmb',
};

/** Chip-length names where the connect card's full name would wrap. */
const CHIP_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  gmb: 'Google Business',
};

export interface PlatformMeta {
  id: string;
  label: string;
  Icon: IconType | null;
  color: string;
}

/** Logo, brand color and short name for a network id, or a plain label for one we do not know. */
export function platformMeta(platform: string): PlatformMeta {
  const raw = String(platform ?? '').trim().toLowerCase();
  const id = PLATFORM_ALIASES[raw] ?? raw;
  const look = NETWORK_LOOKS[id];
  if (look) return { id, label: CHIP_LABELS[id] ?? look.name, Icon: look.Icon, color: look.color };
  const label = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Unknown';
  return { id: raw, label, Icon: null, color: 'var(--text-dim)' };
}
