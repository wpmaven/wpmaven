/**
 * Which networks an approval reaches, and whether one of them is TikTok.
 *
 * The API computes this (`targets`, `goesToTikTok` on GET /operators/approvals)
 * with its resolveTargets, and every
 * surface uses the server's answer. The params reading below is the
 * fallback for a row that came from an older API without those fields, and it
 * mirrors the API rule exactly, including the old crosspost_video default:
 * a cross-post whose video list names none of youtube, instagram or tiktok
 * (omitted, [], or ['facebook']) went to all three. Missing that default is
 * how a cross-post to TikTok once looked like it targeted nothing, and got a
 * one-click Approve.
 *
 * No runtime imports but the product's name: this module is loaded by the
 * node unit tests as well as by the apps.
 */

import type { OperatorApproval } from './types';
import { productName } from '@yotako/wpmaven-onboarding/shared';

/** The networks crosspost_video uploads the file to. */
export const VIDEO_NETWORKS: readonly string[] = ['youtube', 'instagram', 'tiktok'];

/** The networks crosspost_video's link pass accepts; it drops anything else. */
export const LINK_NETWORKS: readonly string[] = [
  'linkedin', 'facebook', 'twitter', 'x', 'gmb', 'threads', 'bluesky', 'reddit',
];

/** Where every approval link points. The page picks the right business from the id. */
export const APPROVALS_PATH = '/team?tab=approvals';

/** In-app link to one approval on the Post to TikTok screen. */
export function approvalPath(approvalId: string): string {
  return `${APPROVALS_PATH}&approval=${encodeURIComponent(approvalId)}`;
}

/**
 * Approved on its card only, where all of it is shown (the API's
 * approveOnCard): a database write whose plain words cannot say
 * all it changes. Never from a one-tap Approve.
 */
export function approvalNeedsCard(a: { approveOnCard?: boolean | null }): boolean {
  return a.approveOnCard === true;
}

/** What Home says beside the button to the card of such a change. */
export const CARD_ONLY_COPY = {
  routeButton: 'Review and approve',
  get routeFirst(): string {
    return `${productName()} cannot put all of this change into words, so you approve it on its card, where the whole change is shown.`;
  },
} as const;

function asObject(params: unknown): Record<string, unknown> | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  return params as Record<string, unknown>;
}

function lowerList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (x == null) continue;
    const s = String(x).trim().toLowerCase();
    if (s) out.push(s);
  }
  return out;
}

/**
 * Every network a tool call reaches: `platforms`, plus `videoPlatforms`
 * filtered to the three video networks (with the crosspost_video default when
 * that leaves nothing), plus `linkPlatforms` (for crosspost_video, only the
 * ones its link pass accepts). Lower-cased, de-duplicated, in that order.
 */
export function resolveTargets(toolName: string | null | undefined, params: unknown): string[] {
  const p = asObject(params);
  const platforms = lowerList(p?.platforms);
  let video = lowerList(p?.videoPlatforms).filter((x) => VIDEO_NETWORKS.includes(x));
  let link = lowerList(p?.linkPlatforms);
  if (toolName === 'crosspost_video') {
    link = link.filter((x) => LINK_NETWORKS.includes(x));
    if (video.length === 0) video = [...VIDEO_NETWORKS];
  }
  return Array.from(new Set([...platforms, ...video, ...link]));
}

type TargetSource = Pick<OperatorApproval, 'params'>
  & Partial<Pick<OperatorApproval, 'toolName' | 'targets' | 'goesToTikTok' | 'youtube'>>;

/** A network's name as the owner knows it (the API's networkName). */
const NETWORK_NAMES: Readonly<Record<string, string>> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  twitter: 'X',
  x: 'X',
  gmb: 'Google Business Profile',
  threads: 'Threads',
  bluesky: 'Bluesky',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
};

export function networkName(id: string): string {
  return NETWORK_NAMES[id] ?? id;
}

function andList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A video file by extension (the API's VIDEO_URL_RE). */
const VIDEO_URL_RE = /\.(mp4|mov|m4v|webm)(?:[?#]|$)/i;
/**
 * The path of a video WPMaven rendered, with or without its `.mp4`, never
 * the `.jpg` poster (the API's RENDER_VIDEO_PATH_RE).
 */
const RENDER_VIDEO_PATH_RE = /\/videos\/[A-Za-z0-9_-]{8,}(?:\.mp4)?(?:[?#]|$)/;

/** A media URL that reads as a video in the sentence (the API's readsAsVideo). */
function readsAsVideo(url: string): boolean {
  return VIDEO_URL_RE.test(url) || RENDER_VIDEO_PATH_RE.test(url);
}

/** The server's `targets` when it sent them, otherwise the same rule read from params. */
export function approvalTargets(a: TargetSource): string[] {
  if (Array.isArray(a.targets)) return lowerList(a.targets);
  return resolveTargets(a.toolName, a.params);
}

/** The server's `goesToTikTok` when it sent it, otherwise derived from the targets. */
export function approvalGoesToTikTok(a: TargetSource): boolean {
  if (typeof a.goesToTikTok === 'boolean') return a.goesToTikTok;
  return approvalTargets(a).includes('tiktok');
}

/**
 * Does this row upload a video to YouTube? The API says so with `youtube`
 * (the visibility question, null on every other row); a row from an older
 * API without the field is read from its targets. Such a row is approved on
 * its card, where the owner chooses who can see the video (YouTube API
 * Services Developer Policies III.E), never with a one-click Approve.
 */
export function approvalGoesToYouTube(a: TargetSource): boolean {
  if (a.youtube !== undefined) return a.youtube !== null;
  return approvalTargets(a).includes('youtube');
}

/**
 * The heading of a publishing approval, in the owner's words, on every card
 * (Approvals, History, the staff console).
 *
 * Never "Cross-post video": the video is one WPMaven made for the business
 * or one the owner gave, shared to the owner's own accounts, and TikTok's
 * guidelines rule out an app that copies content from other platforms to
 * TikTok. So a video that goes to TikTok alone is headed "A video for
 * TikTok", straight above the Post to TikTok screen, and a video for several
 * networks is "Share a video". Null for a tool that is not a publishing one.
 */
export const PUBLISH_HEADINGS: Readonly<Record<string, string>> = {
  social_post: 'Post to X',
  social_publish: 'Publish to social networks',
  crosspost_video: 'Share a video',
  social_reply_message: 'Reply to a customer',
};

export const TIKTOK_ONLY_HEADING = 'A video for TikTok';

export function publishHeading(a: TargetSource): string | null {
  const toolName = a.toolName ?? '';
  const known = PUBLISH_HEADINGS[toolName];
  if (!known) return null;
  if (toolName === 'crosspost_video' || toolName === 'social_publish') {
    const targets = approvalTargets(a);
    if (targets.length > 0 && targets.every((t) => t === 'tiktok')) return TIKTOK_ONLY_HEADING;
  }
  return known;
}

/**
 * What a publishing approval does, naming its networks: the sentence the API
 * writes (ownerApprovalPolicy.publishSentence), read the same way here.
 * crosspost_video: "Posts this video to TikTok." (plus the link post when
 * there is one); anything else that names networks: "Posts this video to
 * TikTok and Instagram." with a video file or one of our renders, "Posts to
 * Facebook." without.
 * Null when it names no network.
 */
export function publishSentence(a: TargetSource): string | null {
  const p = asObject(a.params) ?? {};
  const names = (ids: string[]) => Array.from(new Set(ids.map(networkName)));
  if (a.toolName === 'crosspost_video') {
    let video = lowerList(p.videoPlatforms).filter((x) => VIDEO_NETWORKS.includes(x));
    if (video.length === 0) video = [...VIDEO_NETWORKS];
    const hasLinkPost = typeof p.linkPostText === 'string' && p.linkPostText.trim().length > 0;
    const links = hasLinkPost ? names(lowerList(p.linkPlatforms).filter((x) => LINK_NETWORKS.includes(x))) : [];
    const to = andList(names(video));
    return links.length
      ? `Posts this video to ${to}, then shares a link to it on ${andList(links)}.`
      : `Posts this video to ${to}.`;
  }
  const all = names(approvalTargets(a));
  if (all.length === 0) return null;
  const media = Array.isArray(p.mediaUrls) ? p.mediaUrls : [];
  // Our render counts as a video without its `.mp4` too: the API takes such
  // a finished render as the TikTok video.
  const video = media.some((u) => typeof u === 'string' && readsAsVideo(u.trim()));
  return video ? `Posts this video to ${andList(all)}.` : `Posts to ${andList(all)}.`;
}

/**
 * The sentence under an approval's heading. A row that goes to TikTok always
 * names its networks (publishSentence), whatever tool filed it and whatever
 * reason it was stored with: a social_publish to TikTok used to read "Posts
 * to your connected social accounts with the settings you choose." next to a
 * cross-post's "Posts this video to TikTok." (2026-09-24). The API sends the
 * same sentence now; this keeps rows from an older API right too. Any other
 * row shows its own reason.
 */
export function approvalSentence(a: TargetSource & Partial<Pick<OperatorApproval, 'reason'>>): string | null {
  const stored = typeof a.reason === 'string' && a.reason.trim() ? a.reason : null;
  if (approvalGoesToTikTok(a)) return publishSentence(a) ?? stored;
  return stored;
}

/** One network's fact on an approval card (the API's `networkNotes`). */
export interface ApprovalNetworkNote {
  network: string;
  note: string;
}

/**
 * The per-network facts the owner must see before approving, e.g. "X and
 * LinkedIn get the text only; the image is not posted there." Read from the
 * row (GET /operators/approvals) or the staff console's `preview`, only
 * well-formed entries, and each sentence once: the API may file the same
 * sentence under every network it is about.
 */
export function approvalNetworkNotes(
  a: { networkNotes?: unknown; preview?: { networkNotes?: unknown } | null },
): ApprovalNetworkNote[] {
  const raw = Array.isArray(a.networkNotes)
    ? a.networkNotes
    : Array.isArray(a.preview?.networkNotes) ? a.preview?.networkNotes as unknown[] : [];
  const seen = new Set<string>();
  const out: ApprovalNetworkNote[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { network, note } = item as { network?: unknown; note?: unknown };
    if (typeof note !== 'string' || !note.trim()) continue;
    const text = note.trim();
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ network: typeof network === 'string' ? network.trim().toLowerCase() : '', note: text });
  }
  return out;
}
