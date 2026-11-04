/**
 * What a channel card may honestly say, read the same way on every screen
 * and in both apps (Your team > Connect, the dashboard's Settings >
 * Channels and its Home milestone). One copy since 2026-10-16: the
 * dashboard's connect rules moved here and its old module re-exports them.
 *
 * The rule this file exists for: "connected" and "we can post there" are two
 * different facts. A Pinterest on trial access, a TikTok waiting on its audit
 * or a Facebook Page while Meta is still reviewing WPMaven are all connected
 * and none of them can take a normal customer's post. Only `postable` from
 * the API says a post can go out, so only `postable` counts.
 *
 * The API contract (GET /operators/connect), per network:
 *   status   'connected' | 'needs_reconnect' | 'not_connected'
 *   postable true only when a post can really go out for this owner now
 *   gate     string[] shown under the card (older API: `gates`)
 *   connectVia            null means no Connect button
 *   connectBlockedReason  said next to the disabled Connect button
 *   account  { displayName?, handle? } (older API: `username`)
 * Older fields (state 'live' | 'connect', gates, account.username,
 * reconnect.reason) are still read, so an app deployed before the API never
 * shows a blank card.
 */
import { productName } from '@yotako/wpmaven-onboarding/shared';

export type ConnectStatus = 'connected' | 'needs_reconnect' | 'not_connected';

export interface ConnectAccountLike {
  platform?: string;
  /** A handle, with or without its "@" (the contract's name for it). */
  handle?: string | null;
  /** The older name for the handle. */
  username?: string | null;
  /** A name shown as it is: a Page title, a channel name, TikTok's nickname. */
  displayName?: string | null;
  profileUrl?: string;
}

export interface ConnectNetworkLike {
  id: string;
  label?: string;
  state?: string;
  status?: string;
  postable?: boolean;
  gates?: unknown;
  gate?: unknown;
  connectVia?: string | null;
  connectBlockedReason?: string | null;
  reconnect?: { reason?: string | null } | null;
  account?: ConnectAccountLike | null;
}

/** What WPMaven asks TikTok for, in TikTok's own words, and whether TikTok granted it. */
export interface ChannelPermission {
  scope: string;
  consentLabel: string;
  use: string;
  /** Null when TikTok is not connected. */
  granted: boolean | null;
}

/** One network of the Connect Center, as GET /operators/connect sends it. */
export interface ConnectNetwork extends ConnectNetworkLike {
  id: string;
  label: string;
  createUrl: string;
  gates: string[];
  account?: ConnectAccountLike | null;
  /** TikTok only: every permission WPMaven asks for, and what each is for. */
  permissions?: ChannelPermission[];
}

/** The Connect Center of one business. */
export interface ConnectCenter {
  configured: boolean;
  /** Whether the hosted multi-network linking page is available (the dashboard's Connect accounts). */
  aggregatorConfigured?: boolean;
  networks: ConnectNetwork[];
  liveCount?: number;
  note?: string;
}

const STATUSES: readonly ConnectStatus[] = ['connected', 'needs_reconnect', 'not_connected'];

/** Where this network stands: the API's `status`, else the older `state`. */
export function networkStatus(n: ConnectNetworkLike): ConnectStatus {
  if (typeof n.status === 'string' && (STATUSES as readonly string[]).includes(n.status)) {
    return n.status as ConnectStatus;
  }
  return n.state === 'live' ? 'connected' : 'not_connected';
}

/** Connected AND a post can really go out there now. The only thing that counts as live. */
export function isPostable(n: ConnectNetworkLike): boolean {
  return networkStatus(n) === 'connected' && n.postable === true;
}

/** How many channels a post can really go out on. */
export function postableCount(networks: readonly ConnectNetworkLike[] | null | undefined): number {
  return (networks ?? []).filter(isPostable).length;
}

/** How many channels hold a working connection, posting or not. */
export function connectedCount(networks: readonly ConnectNetworkLike[] | null | undefined): number {
  return (networks ?? []).filter((n) => networkStatus(n) === 'connected').length;
}

function strings(v: unknown): string[] {
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  if (!Array.isArray(v)) return [];
  return v.filter((g): g is string => typeof g === 'string' && g.trim().length > 0).map((g) => g.trim());
}

/** The sentences shown under the card: the contract's `gate`, plus the older `gates`, once each. */
export function networkGates(n: ConnectNetworkLike): string[] {
  return Array.from(new Set([...strings(n.gate), ...strings(n.gates)]));
}

/**
 * Why Connect cannot be pressed, when the API withholds the button
 * (connectVia null) and says why. Null when there is a button to press.
 */
export function connectBlockedReason(n: ConnectNetworkLike): string | null {
  if (n.connectVia) return null;
  const reason = typeof n.connectBlockedReason === 'string' ? n.connectBlockedReason.trim() : '';
  return reason || null;
}

/**
 * What the owner reads next to Reconnect. When Reconnect cannot be pressed
 * (`pressable` false) it does not tell them to press it: the disabled button
 * carries its own reason (reconnectBlockedReason).
 */
export function reconnectReason(n: ConnectNetworkLike, name: string, pressable = true): string {
  const said = typeof n.reconnect?.reason === 'string' ? n.reconnect.reason.trim() : '';
  if (said) return said;
  return pressable
    ? `Your ${name} login expired or was removed, so we cannot post there. Press Reconnect and sign in to ${name} again.`
    : `Your ${name} login expired or was removed, so we cannot post there.`;
}

/**
 * Why Reconnect cannot be pressed, for a dead login we have no route to
 * reconnect through. Never empty: a disabled Reconnect always says what it
 * waits on. The API's own reason when it sends one, else ours. No "we will
 * tell you as soon as it can": nothing sends that notice.
 */
export function reconnectBlockedReason(n: ConnectNetworkLike, name: string): string {
  return connectBlockedReason(n)
    ?? `${productName()} cannot reconnect ${name} from here yet.`;
}

/**
 * The account line on a card. A handle is "@name"; a display name is shown
 * as it is, never with an "@" that would make it look like a handle. X sends
 * its @handle as `handle`.
 */
export function accountLabel(account: ConnectAccountLike | null | undefined): string | null {
  if (!account) return null;
  const rawHandle = typeof account.handle === 'string' && account.handle.trim()
    ? account.handle
    : typeof account.username === 'string' ? account.username : '';
  const handle = rawHandle.trim().replace(/^@/, '');
  const name = typeof account.displayName === 'string' ? account.displayName.trim() : '';
  if (name && handle && name.replace(/^@/, '') !== handle) return `${name} (@${handle})`;
  if (handle) return `@${handle}`;
  return name || null;
}

/**
 * The line over the Connect grid. "Live" means a post can go out there now
 * (the API's `postable`), never merely connected: a trial-access Pinterest,
 * an unaudited TikTok or a Facebook Page while Meta reviews WPMaven used to
 * count as live, and the sentence right after it promised posts there.
 */
export function connectSummaryLine(networks: readonly ConnectNetworkLike[]): string {
  const live = networks.filter(isPostable).length;
  const waiting = networks.filter((n) => networkStatus(n) === 'connected' && !isPostable(n)).length;
  const head = `${live} of ${networks.length} channels live.`;
  const more = waiting > 0
    ? ` ${waiting} more ${waiting === 1 ? 'is' : 'are'} connected but cannot take posts yet.`
    : '';
  return `${head}${more} Your team only posts to live channels, and always with your approval.`;
}

/**
 * The order of the channel cards, the dashboard's
 * Settings > Channels order: first the networks a customer can connect and
 * post to at launch (X, LinkedIn, Pinterest, TikTok, YouTube), then Facebook
 * and Instagram, then Google Business Profile; WhatsApp, the owner's own
 * line, last. The API sends its cards in the same order.
 */
export const CHANNEL_ORDER: readonly string[] = [
  'twitter', 'linkedin', 'pinterest', 'tiktok', 'youtube', 'facebook', 'instagram', 'gmb', 'whatsapp',
];

/**
 * The networks in the order of the cards (CHANNEL_ORDER), whatever order
 * they came in. One the list does not know keeps its place after the rest.
 */
export function inChannelOrder<T extends { id: string }>(networks: readonly T[]): T[] {
  const rank = (id: string): number => {
    const at = CHANNEL_ORDER.indexOf(id);
    return at < 0 ? CHANNEL_ORDER.length : at;
  };
  return [...networks].sort((a, b) => rank(a.id) - rank(b.id));
}

/**
 * How many columns `count` cards get in `width` px: the most that fit at
 * `minPx` each (four at most) and divide the cards evenly, so every row is
 * full (the rule: fixed, even columns that wrap, never an orphan
 * row). When no count above one divides them, the fullest last row wins.
 * One column when nothing wider fits, and before the width is known.
 */
export function evenGridColumns(count: number, width: number, minPx = CHANNEL_CARD_MIN_PX, gapPx = CHANNEL_GRID_GAP_PX, maxColumns = 4): number {
  if (!(count > 1) || !(width > 0)) return 1;
  const rowWidth = (c: number) => c * minPx + (c - 1) * gapPx;
  const max = Math.max(1, Math.min(Math.floor(maxColumns), count));
  let widest = 1;
  for (let c = max; c >= 2; c -= 1) {
    if (rowWidth(c) <= width) { widest = c; break; }
  }
  if (widest === 1) return 1;
  for (let c = widest; c >= 2; c -= 1) {
    if (count % c === 0) return c;
  }
  let best = widest;
  for (let c = widest; c >= 2; c -= 1) {
    if (c - (count % c) < best - (count % best)) best = c;
  }
  return best;
}

/** The Connect grid's gap, and the narrowest a channel card may be ("Connect Google Business Profile" fits on one line). */
export const CHANNEL_GRID_GAP_PX = 12;
export const CHANNEL_CARD_MIN_PX = 300;
