/**
 * Your team > Progress, one tab for both apps (2026-10-16): where the
 * business's published work and its numbers live (Analytics), what the app
 * adds on top (the dashboard: TikTok's own numbers, read from the owner's
 * TikTok account, which a site never reads), then the weekly check-ins.
 *
 * Each week is a card drawn as an approval is (TeamCard): the Data Analyst
 * in its header, the week, an earlier week's share of its target as its
 * status badge and its revenue beside it.
 */
import React, { useEffect, useState } from 'react';
import { EmptyState, NavIcon, Progress, Skeleton } from '@yotako/webmaven-ui';
import { OperatorText, productName } from '@yotako/wpmaven-onboarding/shared';
import type { ScreensHost } from '../host/types';
import { HostLink } from '../host/HostLink';
import { memberMeta, type TeamCatalog } from './catalog';
import { TeamCard } from './TeamCard';
import { CHECK_IN_BY, PROGRESS_COPY, fmtDay, fmtMoney, weekBadge, type ProgressSnapshot } from './progress';
import { readTeamProgress } from './reads';

const label: React.CSSProperties = { margin: 0, fontSize: 14, color: 'var(--text-dim)' };
const value: React.CSSProperties = { margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--text)' };
const hint: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--text-dim)', opacity: 0.85 };

/** The weekly check-ins as drawn: pure, so the tests render them. */
export const ProgressWeeks: React.FC<{ snapshots: ReadonlyArray<ProgressSnapshot>; catalog?: TeamCatalog | null }> = ({ snapshots, catalog }) => {
  if (snapshots.length === 0) {
    return (
      <EmptyState
        icon={<NavIcon name="clock" size={40} />}
        title={PROGRESS_COPY.noneTitle}
        description={PROGRESS_COPY.none}
      />
    );
  }

  const analyst = memberMeta(catalog, CHECK_IN_BY);
  const [latest, ...history] = snapshots;
  const currency = latest.target?.currency || 'USD';
  const pct = latest.progressPct;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TeamCard testId="progress-latest" member={analyst} title={PROGRESS_COPY.weekEnding(fmtDay(latest.periodEnd))}>
        <div style={{ marginTop: 12 }}>
          {pct !== null && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 4, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 24, fontWeight: 600, color: 'var(--text)' }}>{Math.round(pct)}%</span>
                <span style={hint}>{PROGRESS_COPY.ofTarget}</span>
              </div>
              <Progress value={Math.max(0, Math.min(100, pct))} />
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
            <div>
              <p style={label}>{PROGRESS_COPY.revenue}</p>
              <p style={value}>{fmtMoney(latest.actuals.revenueCents, currency)}</p>
              {typeof latest.target?.expectedRevenueCentsWeek === 'number' && (
                <p style={hint}>{PROGRESS_COPY.target(fmtMoney(latest.target.expectedRevenueCentsWeek, currency))}</p>
              )}
            </div>
            <div>
              <p style={label}>{PROGRESS_COPY.orders}</p>
              <p style={value}>{latest.actuals.orders}</p>
            </div>
            <div data-testid="progress-visitors">
              <p style={label}>{PROGRESS_COPY.visitors}</p>
              <p style={value}>{latest.actuals.visitors}</p>
              <p style={hint}>{PROGRESS_COPY.visitorsNote}</p>
            </div>
            <div>
              <p style={label}>{PROGRESS_COPY.pageviews}</p>
              <p style={value}>{latest.actuals.pageviews}</p>
            </div>
          </div>
          {latest.notes && (
            <blockquote
              style={{
                margin: '16px 0 0', padding: 12, borderRadius: 8, boxSizing: 'border-box',
                border: '1px solid var(--glass-border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14,
              }}
            >
              <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-dim)' }}>
                {PROGRESS_COPY.reflection}
              </p>
              <OperatorText text={latest.notes} data-testid="progress-reflection" />
            </blockquote>
          )}
        </div>
      </TeamCard>

      {history.length > 0 && (
        <>
          <h3 style={{ margin: '12px 0 0', fontSize: 14, fontWeight: 500, color: 'var(--text-dim)' }}>{PROGRESS_COPY.earlier}</h3>
          {history.map((s) => (
            <TeamCard
              key={s.id}
              testId="progress-week"
              member={analyst}
              title={PROGRESS_COPY.weekEnding(fmtDay(s.periodEnd))}
              status={weekBadge(s.progressPct)}
              when={fmtMoney(s.actuals.revenueCents, s.target?.currency || currency)}
            >
              {s.notes && (
                <details style={{ marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
                  <summary style={{ cursor: 'pointer', userSelect: 'none' }}>{PROGRESS_COPY.reflectionToggle}</summary>
                  <OperatorText text={s.notes} style={{ marginTop: 4 }} />
                </details>
              )}
            </TeamCard>
          ))}
        </>
      )}
    </div>
  );
};

export interface ProgressTabProps {
  host: ScreensHost;
  instanceId: string;
  catalog?: TeamCatalog | null;
}

/** Your team > Progress, reading the check-ins on the app's transport. */
export const ProgressTab: React.FC<ProgressTabProps> = ({ host, instanceId, catalog }) => {
  const [snapshots, setSnapshots] = useState<ProgressSnapshot[] | null>(null);
  useEffect(() => {
    let alive = true;
    setSnapshots(null);
    readTeamProgress(host.transport, instanceId)
      .then((s) => { if (alive) setSnapshots(s); })
      .catch(() => { if (alive) setSnapshots([]); });
    return () => { alive = false; };
    // The host may be a new object on each render: read again only for another business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="progress-tab">
      {/* Every published post and its numbers over time live on Analytics. */}
      <p style={{ margin: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4, fontSize: 14, color: 'var(--text-dim)' }} data-testid="progress-analytics-link">
        <span>See every post {productName()} published and its numbers over time.</span>
        <HostLink to={`/analytics?business=${encodeURIComponent(instanceId)}`} style={{ fontWeight: 500, color: 'var(--text)', textDecoration: 'underline' }}>
          Open Analytics
        </HostLink>
      </p>
      {host.renderers?.teamProgressTop?.({ instanceId })}
      {snapshots === null ? <Skeleton height={160} rounded="lg" /> : <ProgressWeeks snapshots={snapshots} catalog={catalog} />}
    </div>
  );
};
