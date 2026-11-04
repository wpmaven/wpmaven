import React, { useCallback, useState } from 'react';
import { TeamFace } from '../../../team/TeamFace';
import { operatorRefOf } from '../../../../utils/team';
import { GlassCard, Button, PageHeader, Tabs } from '@yotako/webmaven-ui';
import { getInstanceId, proxy } from '../../../../services/proxyClient';
import { useProxyQuery } from '../../../../hooks/useProxyQuery';
import ScreenState from '../../ui/ScreenState';
import { errorSentence } from '../../../../utils/apiWords';
import { dashboardLink, useSiteState } from '../../../../utils/siteState';
import { dashboardPhrase, siteBrand } from '../../../../utils/brand';

/**
 * Activity (1.3.0), for administrators: what happened on this business,
 * newest first, from the API's log (changes, approvals, tasks, payments and
 * the site itself), in plain sentences with who did it. The full log, with
 * its filters, is the business page's Activity tab in the dashboard.
 */

export type ActivityGroup = 'changes' | 'approvals' | 'tasks' | 'payments' | 'site';

export interface ActivityItem {
  id: string;
  at: string;
  kind: string;
  group: ActivityGroup;
  actor: { type: string; label: string; operator?: unknown };
  text: string;
  link: { label: string; path: string } | null;
}

interface ActivityAnswer {
  items: ActivityItem[];
  nextBefore: string | null;
}

const GROUPS: Array<{ key: ActivityGroup | 'all'; label: string }> = [
  { key: 'all', label: 'Everything' },
  { key: 'changes', label: 'Changes' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'payments', label: 'Payments' },
  { key: 'site', label: 'Site' },
];

const PAGE = 30;

/** "Today", "Yesterday", or the date. */
export function dayHeading(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(d) === day(now)) return 'Today';
  if (day(d) === day(yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function time(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function ActivityPage() {
  const site = useSiteState();
  const instanceId = getInstanceId() || site.instance?.id || '';
  const [group, setGroup] = useState<ActivityGroup | 'all'>('all');
  const query = { limit: PAGE, ...(group === 'all' ? {} : { groups: group }) };
  const q = useProxyQuery<ActivityAnswer>(instanceId ? `instances/${instanceId}/activity` : null, query, { pollMs: 120_000 });
  const [more, setMore] = useState<{ items: ActivityItem[]; nextBefore: string | null; key: string } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const brand = siteBrand();
  const key = `${instanceId}:${group}`;
  const extra = more && more.key === key ? more : null;
  const items = [...(q.data?.items ?? []), ...(extra?.items ?? [])];
  const nextBefore = extra ? extra.nextBefore : q.data?.nextBefore ?? null;

  const showMore = useCallback(async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const answer = await proxy.get<ActivityAnswer>(`instances/${instanceId}/activity`, { ...query, before: nextBefore });
      setMore({ key, items: [...(extra?.items ?? []), ...answer.items], nextBefore: answer.nextBefore });
    } catch (err) {
      setMoreError(errorSentence(err, 'More could not be loaded. Try again in a minute.'));
    } finally {
      setLoadingMore(false);
    }
  }, [nextBefore, instanceId, query, key, extra]);

  const business = site.links.business;
  const days: Array<{ heading: string; items: ActivityItem[] }> = [];
  for (const item of items) {
    const heading = dayHeading(item.at);
    const last = days[days.length - 1];
    if (last && last.heading === heading) last.items.push(item);
    else days.push({ heading, items: [item] });
  }

  return (
    <div className="wm-main__inner" style={{ padding: '24px', maxWidth: 760, margin: '0 auto' }}>
      <div data-testid="wm-activity">
        <PageHeader
          title="Activity"
          style={{ marginBottom: 20 }}
          actions={business && (
            <a data-testid="wm-activity-dashboard-link" href={`${business}?tab=activity`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--purple)' }}>
              {`Open in ${dashboardPhrase(brand)}`}
            </a>
          )}
        />
        {/* A block around the bar: on a phone it scrolls sideways inside the page's width. */}
        <div data-testid="wm-activity-tabs" style={{ maxWidth: '100%', overflowX: 'auto', marginBottom: 16 }}>
          <Tabs items={GROUPS} activeKey={group} onChange={(key) => setGroup(key as ActivityGroup | 'all')} />
        </div>
        {q.status === 'loading' && <ScreenState state="loading" label="Loading the activity" />}
        {q.status === 'refused' && <ScreenState state="refused" error={q.error} />}
        {q.status === 'failed' && <ScreenState state="failed" error={q.error} fallback="The activity could not be loaded. Try again in a minute." onRetry={q.refetch} />}
        {q.status === 'ready' && items.length === 0 && (
          <ScreenState state="empty" title={group === 'all' ? 'Nothing has happened on this site yet.' : 'Nothing here yet.'} />
        )}
        {q.status === 'ready' && days.map((day) => (
          <section key={day.heading} style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', margin: '0 0 8px' }}>{day.heading}</h2>
            <GlassCard padding="8px 20px">
              {day.items.map((item, i) => (
                <div
                  key={item.id}
                  data-testid="wm-activity-item"
                  data-kind={item.kind}
                  style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 12, padding: '12px 0', borderTop: i ? '1px solid var(--glass-border)' : undefined }}
                >
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{time(item.at)}</span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{item.text}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      {/* A team row: who on the team did it; people keep their names. */}
                      {item.actor.type === 'team' && operatorRefOf(item.actor.operator) && (
                        <TeamFace id={operatorRefOf(item.actor.operator)!.id} title={operatorRefOf(item.actor.operator)!.title} size="row" decorative />
                      )}
                      {item.actor.label}
                      {item.link && (
                        <>
                          {' · '}
                          <a href={dashboardLink(site, item.link.path)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--purple)' }}>{item.link.label}</a>
                        </>
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </GlassCard>
          </section>
        ))}
        {q.status === 'ready' && nextBefore && (
          <Button data-testid="wm-activity-more" variant="outline" size="sm" disabled={loadingMore} onClick={showMore}>
            {loadingMore ? 'Loading' : 'Show more'}
          </Button>
        )}
        {moreError && <p role="alert" style={{ fontSize: 13, color: 'var(--rose)' }}>{moreError}</p>}
      </div>
    </div>
  );
}
