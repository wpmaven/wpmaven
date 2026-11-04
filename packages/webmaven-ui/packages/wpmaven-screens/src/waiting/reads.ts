/**
 * What Waiting for you reads, for the account (the dashboard) or for one
 * site (the plugin), on the app's transport (2026-10-16). In a site's scope
 * every read names its own instance, in the path or as ?instanceId=: the
 * plugin's proxy refuses another business anyway, and the screen never asks.
 *
 *   approvals   GET /operators/approvals ?status=PENDING or NEEDS_ACTIONS
 *   prepared    GET /store/approvals
 *   alerts      GET /portfolio/alerts (account), GET /alerts/:instanceId (site)
 *   customers   GET /instances/:id/social/meta/status, then the first
 *               connected channel's /conversations (a count only)
 *
 * Each read may fail on its own; the screen and the count treat a failed
 * read as nothing there, never as the whole page failing.
 */
import type { OperatorApproval } from '../approvals/types';
import type { ScreensBusiness, ScreensScope, ScreensTransport } from '../host/types';
import { waitingBadgeCount, type WaitingCounts } from './tabs';

/** The approvals a screen asks for at once: the dashboard's twenty, a site's fifty (both apps' lists). */
export function approvalsLimit(scope: ScreensScope): number {
  return scope.kind === 'site' ? 50 : 20;
}

/** The query of a list read, pinned to the site's instance in its scope. */
export function scoped(scope: ScreensScope, query: Record<string, string | number> = {}): Record<string, string | number> {
  return scope.kind === 'site' ? { ...query, instanceId: scope.instanceId } : query;
}

export interface ApprovalsAnswer {
  items: OperatorApproval[];
  /** Every row waiting for a yes (the API's count, past the list's limit). */
  pendingCount: number;
}

export async function readApprovals(
  transport: ScreensTransport,
  scope: ScreensScope,
  status: 'PENDING' | 'NEEDS_ACTIONS',
  limit = approvalsLimit(scope),
): Promise<ApprovalsAnswer> {
  const data = await transport.get<{ items?: unknown; pendingCount?: unknown } | null>(
    '/operators/approvals',
    scoped(scope, { status, limit }),
  );
  const items = Array.isArray(data?.items)
    ? (data!.items as OperatorApproval[]).filter((a) => a && typeof a === 'object' && typeof a.id === 'string')
    : [];
  const pendingCount = typeof data?.pendingCount === 'number' && Number.isFinite(data.pendingCount) ? data.pendingCount : items.length;
  return { items, pendingCount };
}

/** One alert, as Worth fixing lists it (the site's view leaves its internal data out). */
export interface WaitingAlert {
  id: string;
  instanceId: string;
  siteName?: string;
  severity: string;
  title: string;
  message: string;
  createdAt: string;
}

export async function readAlerts(transport: ScreensTransport, scope: ScreensScope, limit = 20): Promise<WaitingAlert[]> {
  const data = scope.kind === 'site'
    ? await transport.get<{ alerts?: unknown } | null>(`/alerts/${encodeURIComponent(scope.instanceId)}`, { limit })
    : await transport.get<{ alerts?: unknown; items?: unknown } | null>('/portfolio/alerts', { limit });
  const rows = (data && typeof data === 'object' ? ((data as { alerts?: unknown }).alerts ?? (data as { items?: unknown }).items) : null);
  return Array.isArray(rows) ? (rows as WaitingAlert[]).filter((a) => a && typeof a.id === 'string') : [];
}

/** One change a team member prepared and sent for the owner's decision (GET /store/approvals). */
export interface PreparedChange {
  instanceId: string;
  businessName: string;
  operationId: string;
  /** The preview to publish (null on a row that lost it: publishing then makes it again). */
  previewId: string | null;
  /** The operation: update_product, add_post... */
  kind: string;
  summary: string;
  changed: Array<{ kind: string; ref: string; label: string; before?: string; after?: string }>;
  /** The operation itself, sent back as it is to publish it. */
  operation: Record<string, unknown> & { op: string };
  requestedBy: { name: string };
  createdAt: string;
}

export async function readPrepared(transport: ScreensTransport, scope: ScreensScope): Promise<PreparedChange[]> {
  const data = await transport.get<{ items?: unknown } | null>('/store/approvals', scope.kind === 'site' ? { instanceId: scope.instanceId } : undefined);
  const items = Array.isArray(data?.items) ? (data!.items as PreparedChange[]) : [];
  return items
    .filter((i) => i && typeof i.operationId === 'string' && i.operation && typeof i.operation === 'object')
    .map((i) => ({ ...i, changed: Array.isArray(i.changed) ? i.changed : [], requestedBy: { name: i.requestedBy?.name || 'A team member' } }));
}

/** A connected channel customers write to: a Facebook Page or an Instagram account of one business. */
export interface CustomerChannel {
  instanceId: string;
  network: 'facebook' | 'instagram';
  /** The Page name or the @handle, as the customer knows it. */
  accountName: string;
}

interface MetaStatus {
  facebook?: { connected?: boolean; pageName?: string | null } | null;
  instagram?: { connected?: boolean; username?: string | null } | null;
}

/** The connected channels of these businesses, in their order (a business that cannot be read has none). */
export async function readChannels(transport: ScreensTransport, businessIds: readonly string[]): Promise<CustomerChannel[]> {
  const statuses = await Promise.all(businessIds.map(async (id) => {
    try {
      return { id, status: await transport.get<MetaStatus | null>(`/instances/${encodeURIComponent(id)}/social/meta/status`) };
    } catch {
      return { id, status: null };
    }
  }));
  const out: CustomerChannel[] = [];
  for (const { id, status } of statuses) {
    if (!status) continue;
    if (status.facebook?.connected) out.push({ instanceId: id, network: 'facebook', accountName: status.facebook.pageName || 'Facebook Page' });
    if (status.instagram?.connected) {
      out.push({ instanceId: id, network: 'instagram', accountName: status.instagram.username ? `@${status.instagram.username}` : 'Instagram' });
    }
  }
  return out;
}

/**
 * How many conversations of a channel Meta still lets the business answer
 * (its 24-hour window is open). The API does not say which are unanswered,
 * only which can still be answered: that is what is counted, and said.
 */
export async function readOpenConversations(transport: ScreensTransport, channel: CustomerChannel, limit = 25): Promise<number> {
  const rail = channel.network === 'facebook' ? 'meta' : 'instagram';
  const data = await transport.get<unknown>(`/instances/${encodeURIComponent(channel.instanceId)}/social/${rail}/conversations`, { limit });
  const rows = Array.isArray(data) ? data : (data && typeof data === 'object' ? (data as { conversations?: unknown }).conversations : null);
  return Array.isArray(rows) ? rows.filter((t) => t && typeof t === 'object' && (t as { windowOpen?: unknown }).windowOpen === true).length : 0;
}

/** The customers who can still be answered, on the first connected channel; null when none is connected. */
export async function readCustomers(
  transport: ScreensTransport,
  scope: ScreensScope,
  businesses: ReadonlyArray<ScreensBusiness> | null | undefined,
): Promise<{ channel: CustomerChannel; open: number } | null> {
  const ids = scope.kind === 'site' ? [scope.instanceId] : (businesses ?? []).map((b) => b.id);
  if (ids.length === 0) return null;
  const [first] = await readChannels(transport, ids);
  if (!first) return null;
  return { channel: first, open: await readOpenConversations(transport, first) };
}

/** What the menu's badge counts, read once: each source on its own, a failed one counts nothing. */
export async function readWaitingCounts(
  transport: ScreensTransport,
  scope: ScreensScope,
  opts: {
    /** May publish prepared changes (else they are neither read nor counted). */
    publishesPrepared?: boolean;
    /** Count the customers too (a call per business to Meta: an app may read them less often). */
    customers?: boolean;
    /** The account's businesses, for the customers (account scope). */
    businesses?: ReadonlyArray<ScreensBusiness> | null;
  } = {},
): Promise<Omit<WaitingCounts, 'held'>> {
  const [ap, prepared, alerts, customers] = await Promise.allSettled([
    readApprovals(transport, scope, 'PENDING', 1),
    opts.publishesPrepared === false ? Promise.resolve([]) : readPrepared(transport, scope),
    readAlerts(transport, scope, 50),
    opts.customers ? readCustomers(transport, scope, opts.businesses) : Promise.resolve(null),
  ]);
  return {
    yes: ap.status === 'fulfilled' ? ap.value.pendingCount : 0,
    prepared: prepared.status === 'fulfilled' ? prepared.value.length : 0,
    fix: alerts.status === 'fulfilled' ? alerts.value.length : 0,
    customers: customers.status === 'fulfilled' ? customers.value?.open ?? 0 : 0,
  };
}

/**
 * The number beside Waiting for you in the menu, read and summed by the one
 * rule both apps use (waitingBadgeCount).
 */
export async function readWaitingCount(
  transport: ScreensTransport,
  scope: ScreensScope,
  opts: Parameters<typeof readWaitingCounts>[2] = {},
): Promise<number> {
  return waitingBadgeCount(await readWaitingCounts(transport, scope, opts));
}
