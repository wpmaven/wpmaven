/**
 * Recent activity, as a Home section (2026-10-16): the kit's ActivityList
 * with the newest rows of the business's activity log (GET
 * /instances/:id/activity), one owner sentence each, with the team
 * member's face when the team did it, and "See all" to the whole log
 * through the host (the dashboard's business page, Activity tab; the plugin
 * maps it to its own Activity page). The plugin's Overview draws it in
 * place of its recent content.
 *
 * A person who may not read the log (the API refuses their role) gets no
 * card at all.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityList, NavIcon, OperatorAvatar, OPERATOR_AVATAR_SIZES, operatorTitle, type ActivityRow, type NavIconName } from '@yotako/webmaven-ui';
import type { ScreensHost } from '../host/types';
import { ScreensHostProvider } from '../host/HostContext';
import { teamBusiness } from '../team/reads';
import { openPage } from '../approvals/ReceiptNote';
import { readRecentActivity, type ActivityItem } from './reads';
import { SectionProblem, isRefusal, sectionErrorText } from './SectionState';

export const RECENT_ACTIVITY_COPY = {
  title: 'Recent activity',
  seeAll: 'See all',
  empty: 'Nothing has happened here yet.',
  loading: 'Loading the activity',
  loadFailed: 'The activity could not be loaded. Try again in a minute.',
};

/** How many rows the card shows. */
export const RECENT_ACTIVITY_ROWS = 5;

/** How often the card reads the log again while the page is visible. */
export const ACTIVITY_POLL_MS = 2 * 60_000;

/** Where the whole log is: the business page's Activity tab. */
export function activityHref(instanceId: string): string {
  return `/instances/${encodeURIComponent(instanceId)}?tab=activity`;
}

const MEMBER_ID = /^[a-z][a-z_]{1,40}$/;

/** The team member who did it, from the row's actor ({ id, title } or the id alone); null for anyone else. */
export function activityMember(item: Pick<ActivityItem, 'actor'>): { id: string; title: string } | null {
  if (item.actor.type !== 'team') return null;
  const raw = item.actor.operator;
  if (typeof raw === 'string') return MEMBER_ID.test(raw) ? { id: raw, title: operatorTitle(raw) } : null;
  if (!raw || typeof raw !== 'object') return null;
  const { id, title } = raw as { id?: unknown; title?: unknown };
  if (typeof id !== 'string' || !MEMBER_ID.test(id)) return null;
  return { id, title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 60) : operatorTitle(id) };
}

const GROUP_ICON: Record<string, NavIconName> = {
  changes: 'pencil-square',
  approvals: 'inbox',
  tasks: 'clock',
  payments: 'banknotes',
  site: 'globe-alt',
};

/** A row's lead: the member's face, else the icon of what kind of thing happened. */
function leadOf(item: ActivityItem): React.ReactNode {
  const member = activityMember(item);
  if (member) return <OperatorAvatar id={member.id} title={member.title} size={OPERATOR_AVATAR_SIZES.card} />;
  return (
    <span
      aria-hidden="true"
      style={{
        width: OPERATOR_AVATAR_SIZES.card, height: OPERATOR_AVATAR_SIZES.card, borderRadius: 999,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--fill-soft, var(--glass))', color: 'var(--text-dim)',
      }}
    >
      <NavIcon name={GROUP_ICON[item.group] ?? 'globe-alt'} size={16} />
    </span>
  );
}

/** The log's rows as the kit's ActivityList draws them. */
export function activityRows(items: readonly ActivityItem[]): ActivityRow[] {
  return items.map((item) => ({ id: item.id, lead: leadOf(item), text: item.text, time: item.at }));
}

export type RecentActivityStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'refused';

export interface RecentActivityState {
  status: RecentActivityStatus;
  items: ActivityItem[];
  error: string | null;
  retry(): void;
}

/** The newest rows of one business's log, read now and every ACTIVITY_POLL_MS while the page is visible. */
export function useRecentActivity(host: ScreensHost, instanceId?: string | null, opts: { limit?: number; pollMs?: number } = {}): RecentActivityState {
  const business = teamBusiness(host.scope, instanceId);
  const limit = opts.limit ?? RECENT_ACTIVITY_ROWS;
  const pollMs = opts.pollMs ?? ACTIVITY_POLL_MS;
  const [status, setStatus] = useState<RecentActivityStatus>(business ? 'loading' : 'idle');
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refused = useRef(false);
  const current = useRef(business);
  current.current = business;

  const read = useCallback(async () => {
    if (!business || refused.current) return;
    const asked = business;
    try {
      const rows = await readRecentActivity(host.transport, asked, limit);
      if (current.current !== asked) return;
      setItems(rows);
      setError(null);
      setStatus('ready');
    } catch (e) {
      if (current.current !== asked) return;
      if (isRefusal(e)) {
        refused.current = true;
        setStatus('refused');
        return;
      }
      setError(sectionErrorText(host, e, RECENT_ACTIVITY_COPY.loadFailed));
      setStatus((s) => (s === 'ready' ? s : 'failed'));
    }
    // The transport may be a new object on each render: read again only for another business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business, limit]);

  useEffect(() => {
    refused.current = false;
    setItems([]);
    setError(null);
    setStatus(business ? 'loading' : 'idle');
    if (!business) return undefined;
    void read();
    if (!(pollMs > 0)) return undefined;
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void read();
    }, pollMs);
    return () => clearInterval(timer);
  }, [business, read, pollMs]);

  return { status, items, error, retry: () => { setStatus('loading'); void read(); } };
}

export interface RecentActivityCardProps {
  host: ScreensHost;
  /** The account's scope: the business on screen. A site's scope ignores it: its own instance. */
  instanceId?: string | null;
  /** How many rows (default 5). */
  limit?: number;
  /** Read again this often while the page is visible (ms; 0: never). Default 2 minutes. */
  pollMs?: number;
  title?: React.ReactNode;
}

export const RecentActivityCard: React.FC<RecentActivityCardProps> = (props) => (
  <ScreensHostProvider host={props.host}>
    <RecentActivitySection {...props} />
  </ScreensHostProvider>
);

const RecentActivitySection: React.FC<RecentActivityCardProps> = ({ host, instanceId, limit, pollMs, title }) => {
  const state = useRecentActivity(host, instanceId, { limit, pollMs });
  const business = teamBusiness(host.scope, instanceId);
  return <RecentActivityCardView host={host} instanceId={business} state={state} title={title} />;
};

/** The card for an activity state (exported for the tests and an app's own page). */
export const RecentActivityCardView: React.FC<{
  host: ScreensHost;
  instanceId: string | null;
  state: RecentActivityState;
  title?: React.ReactNode;
  now?: Date;
}> = ({ host, instanceId, state, title = RECENT_ACTIVITY_COPY.title, now }) => {
  if (!instanceId || state.status === 'idle' || state.status === 'refused') return null;
  if (state.status === 'failed') {
    return <SectionProblem title={title} text={state.error ?? RECENT_ACTIVITY_COPY.loadFailed} onRetry={state.retry} testId="recent-activity-failed" />;
  }
  const to = activityHref(instanceId);
  return (
    <ActivityList
      testId="recent-activity"
      title={title}
      items={activityRows(state.items)}
      loading={state.status === 'loading'}
      loadingLabel={RECENT_ACTIVITY_COPY.loading}
      emptyText={RECENT_ACTIVITY_COPY.empty}
      now={now}
      seeAll={{
        label: RECENT_ACTIVITY_COPY.seeAll,
        onClick: () => {
          host.track?.('home', 'activity_see_all');
          // The host's page (the dashboard routes it, the plugin opens its
          // own Activity page or the dashboard in a new tab).
          openPage(host, to);
        },
      }}
    />
  );
};

export default RecentActivityCard;
