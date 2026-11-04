import React, { useEffect, useState } from 'react';
import { GlassCard } from '@yotako/webmaven-ui';
import { OperatorInline, formatMoney } from '@yotako/wpmaven-onboarding/shared';
import { ScreensHostProvider, useOptionalScreensHost } from '../host/HostContext';
import {
  readPlanMilestones,
  currentWeek,
  type MilestoneTask,
  type MilestoneTaskStatus,
  type MilestoneWeek,
  type PlanMilestones,
} from './reads';
import type { BusinessHome } from './useBusinessHome';

/**
 * This week's milestone: the money goal, what actually arrived, and the work
 * that is moving it.
 *
 * The card is deliberately short-sighted. It shows the week being lived, the
 * week just finished (collapsed, because it is context and not a task), and
 * at most the NEXT week's goal. Nothing further: a forecast curve months out
 * belongs on the graph, where it is labelled as a plan, not next to real
 * numbers where it would read as a promise.
 *
 * Every number comes from the API, which computes them against the forecast
 * the owner accepted. When the endpoint is not deployed the card renders
 * nothing at all.
 */

const TASK_LABEL: Record<MilestoneTaskStatus, string> = {
  done: '✓ done',
  active: 'running now',
  planned: 'planned',
  paused: 'paused',
};

const TASK_COLOR: Record<MilestoneTaskStatus, string> = {
  done: 'var(--success)',
  active: 'var(--purple)',
  planned: 'var(--text-dim)',
  paused: 'var(--warning)',
};

const label: React.CSSProperties = {
  fontSize: 'var(--text-label)', fontWeight: 700, letterSpacing: '0.6px',
  textTransform: 'uppercase', color: 'var(--text-dim)',
};

/** "3 visitors, 1 converted, 1 bought": plural-safe, and only what we have. */
function funnelLine(actual: MilestoneWeek['actual']): string | null {
  if (!actual) return null;
  const n = (v: number, one: string, many: string) => `${v.toLocaleString('en-US')} ${v === 1 ? one : many}`;
  return `${n(actual.visitors, 'visitor', 'visitors')}, ${actual.converted.toLocaleString('en-US')} converted, `
    + `${actual.orders.toLocaleString('en-US')} bought`;
}

function contributionLine(c: MilestoneTask['contribution']): string | null {
  if (!c) return null;
  const parts: string[] = [];
  if (c.visitors) parts.push(`${c.visitors.toLocaleString('en-US')} visitor${c.visitors === 1 ? '' : 's'}`);
  if (c.purchases) parts.push(`${c.purchases.toLocaleString('en-US')} purchase${c.purchases === 1 ? '' : 's'}`);
  return parts.length ? `brought ${parts.join(' and ')}` : null;
}

const weekRange = (w: MilestoneWeek): string => {
  const fmt = (iso: string) => {
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  };
  const from = fmt(w.start);
  const to = fmt(w.end);
  return from && to ? `${from} to ${to}` : from || to;
};

/**
 * The plan's weekly milestones, read through the host's transport (GET
 * /operators/plans/:planId/milestones). Null until they answer, and when
 * the route is not deployed or anything else failed: the card stays away.
 */
export function usePlanMilestones(planId: string | null): PlanMilestones | null {
  const host = useOptionalScreensHost();
  const [data, setData] = useState<PlanMilestones | null>(null);
  useEffect(() => {
    if (!planId || !host) { setData(null); return undefined; }
    let cancelled = false;
    readPlanMilestones(host.transport, planId)
      .then((d) => { if (!cancelled) setData(d); })
      // A 404 already answered null; anything else is our problem, not a
      // message for the owner, so the card just stays away.
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
    // The transport may be a new object on each render: read again only for another plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);
  return data;
}

/** This week's milestone of a plan, read through the host (nothing without one). */
export const ThisWeekMilestone: React.FC<{ planId: string | null }> = ({ planId }) => {
  const data = usePlanMilestones(planId);
  return data ? <ThisWeekMilestoneView data={data} /> : null;
};

/** The week being lived, from the milestones the API computed; nothing when no week is current. */
export const ThisWeekMilestoneView: React.FC<{ data: PlanMilestones; now?: number }> = ({ data, now }) => {
  const [prevOpen, setPrevOpen] = useState(false);
  const week = currentWeek(data.weeks, now);
  if (!week) return null;

  const money = (cents: number) => formatMoney(cents, data.currency || 'USD');
  const idx = data.weeks.indexOf(week);
  const previous = idx > 0 ? data.weeks[idx - 1] : null;
  const next = idx >= 0 && idx < data.weeks.length - 1 ? data.weeks[idx + 1] : null;
  const funnel = funnelLine(week.actual);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <div style={label}>This week&apos;s milestone</div>
        <span style={{ fontSize: 'var(--text-meta)', color: 'var(--text-dim)' }}>{weekRange(week)}</span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 16 }}>
        <div>
          <div style={{ fontSize: 'var(--text-title)', fontWeight: 700, color: 'var(--text)' }}>
            {money(week.actual?.revenueCents ?? 0)}
          </div>
          <div style={{ fontSize: 'var(--text-meta)', color: 'var(--text-dim)' }}>
            so far, against an estimated goal of {money(week.goal.revenueCents)}
          </div>
        </div>
      </div>

      {funnel && (
        <p style={{ margin: '8px 0 0', fontSize: 'var(--text-data)', color: 'var(--text-dim)' }}>{funnel}</p>
      )}

      {week.tasks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {week.tasks.map((t) => {
            const contribution = contributionLine(t.contribution);
            return (
              <div
                key={t.id}
                style={{
                  borderRadius: 10, border: '1px solid var(--glass-border)', background: 'var(--glass)',
                  padding: '8px 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
                }}
              >
                <span style={{ flex: 1, minWidth: 160, fontSize: 'var(--text-body)', color: 'var(--text)' }}>
                  <OperatorInline text={t.title} />
                  {contribution && (
                    <span style={{ display: 'block', fontSize: 'var(--text-meta)', color: 'var(--text-dim)' }}>
                      {contribution}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 'var(--text-meta)', fontWeight: 600, color: TASK_COLOR[t.status] }}>
                  {TASK_LABEL[t.status] ?? t.status}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {next && (
        <p style={{ margin: '10px 0 0', fontSize: 'var(--text-data)', color: 'var(--text-dim)' }}>
          Next week&apos;s estimated goal: {money(next.goal.revenueCents)}.
        </p>
      )}

      {previous && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setPrevOpen((v) => !v)}
            aria-expanded={prevOpen}
            style={{ background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', fontSize: 'var(--text-data)', color: 'var(--text-dim)', textDecoration: 'underline' }}
          >
            {prevOpen ? 'Hide last week' : 'Last week'}
          </button>
          {prevOpen && (
            <p style={{ margin: '2px 0 0', fontSize: 'var(--text-data)', color: 'var(--text-dim)' }}>
              {weekRange(previous)}: {money(previous.actual?.revenueCents ?? 0)} against an estimated goal of{' '}
              {money(previous.goal.revenueCents)}
              {funnelLine(previous.actual) ? `. ${funnelLine(previous.actual)}.` : '.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export interface ThisWeekCardProps {
  /** The business's Home (useBusinessHome): the plan whose milestones it reads. */
  home: BusinessHome;
  /** In its own card (the default), or bare inside the app's (the dashboard's Home card). */
  card?: boolean;
}

/**
 * This week's milestone, as a Home section: the money goal, what arrived
 * against it, and the work moving it. Nothing at all until the API serves
 * it (no plan, no current week, a route not deployed): no empty card.
 */
export const ThisWeekCard: React.FC<ThisWeekCardProps> = ({ home, card = true }) => (
  <ScreensHostProvider host={home.host}>
    <ThisWeekSection planId={home.plan?.id ?? null} card={card} />
  </ScreensHostProvider>
);

const ThisWeekSection: React.FC<{ planId: string | null; card: boolean }> = ({ planId, card }) => {
  const data = usePlanMilestones(planId);
  if (!data || !currentWeek(data.weeks)) return null;
  const body = <ThisWeekMilestoneView data={data} />;
  return card ? <GlassCard padding={24} data-testid="this-week-card">{body}</GlassCard> : body;
};

export default ThisWeekMilestone;
