import React from 'react';
import { GlassCard, Chart } from '@yotako/webmaven-ui';
import { Info } from 'lucide-react';
import type { FinancialSummary, FinancePeriod } from '../../../types/finance.types';
import { getInstanceId, ProxyError } from '../../../services/proxyClient';
import { useProxyQuery } from '../../../hooks/useProxyQuery';
import ScreenState from '../ui/ScreenState';

/**
 * RevenueWidget: the finance headline card.
 *
 * Reads GET /instances/:instanceId/finance/summary through the WP proxy and
 * surfaces revenue, net revenue, refund-rate, gross growth and margin (or an
 * "add product costs" hint), plus goal progress and a small revenue trend.
 *
 * Data source: pass a `data` bundle to render from a parent (the Finance page
 * owns one fetch and shares it with the breakdown), or omit it and the widget
 * reads on its own through useFinancialSummary, so it also works standalone.
 */

export interface FinanceSummaryState {
  summary: FinancialSummary | null;
  loading: boolean;
  /** Why the read did not work (null while it did or is on its way). */
  error: ProxyError | null;
  refused: boolean;
  refetch: () => void;
}

/**
 * The finance summary through the plugin's proxy: one read for the page and
 * its headline card (the page passes it down; the card reads on its own
 * only when nothing is passed).
 */
export function useFinancialSummary(period: FinancePeriod = 'month', live = true, enabled = true): FinanceSummaryState {
  const instanceId = getInstanceId() || '';
  const q = useProxyQuery<FinancialSummary>(
    instanceId ? `instances/${instanceId}/finance/summary` : null,
    { period, live: live ? '1' : '0' },
    { enabled },
  );
  return {
    summary: q.status === 'ready' ? q.data : null,
    loading: q.status === 'loading',
    error: q.status === 'failed' || q.status === 'refused' ? q.error : null,
    refused: q.status === 'refused',
    refetch: () => { void q.refetch(); },
  };
}

export function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency ? currency + ' ' : ''}${amount.toFixed(2)}`;
  }
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatTrendLabel(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
const HEADING: React.CSSProperties = { fontWeight: 700, color: 'var(--text)' };

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span style={LABEL}>{label}</span>
      <div style={{ ...HEADING, fontSize: 18, marginTop: 4, color: accent || 'var(--text)' }}>{value}</div>
    </div>
  );
}

export interface RevenueWidgetProps {
  period?: FinancePeriod;
  /** Controlled data from a parent. Omit to self-fetch. */
  data?: FinanceSummaryState;
}

function RevenueWidget({ period = 'month', data }: RevenueWidgetProps) {
  // Its own read only when the page passed none: never two reads of the same summary.
  const selfState = useFinancialSummary(period, true, !data);
  const { summary, loading, error, refused, refetch } = data ?? selfState;

  if (loading) {
    return (
      <GlassCard padding="24px">
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
          <svg style={{ animation: 'wm-spin 0.8s linear infinite' }} width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="var(--glass-border)" strokeWidth="3" />
            <path d="M4 12a8 8 0 018-8" stroke="var(--purple)" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      </GlassCard>
    );
  }

  if (error) {
    return refused
      ? <ScreenState state="refused" error={error} />
      : <ScreenState state="failed" error={error} fallback="Your finances could not be loaded. Try again in a minute." onRetry={refetch} />;
  }

  if (!summary || !summary.hasStore) {
    return (
      <GlassCard padding="24px">
        <span style={LABEL}>Revenue</span>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '10px 0 0' }}>
          No store yet. Add WooCommerce to see revenue, refunds and profit here.
        </p>
      </GlassCard>
    );
  }

  const rs = summary.revenueStatement;
  const growth = summary.ratios.grossGrowthPct;
  const growthColor = growth == null ? 'var(--text)' : growth >= 0 ? 'var(--cyan)' : 'var(--rose)';
  const margin = summary.margin;

  return (
    <GlassCard padding="24px">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={LABEL}>Revenue · {summary.period.label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {summary.source === 'live' ? 'Live' : summary.source === 'mixed' ? 'Live + history' : 'From history'}
        </span>
      </div>

      {/* Net revenue headline */}
      <div style={{ margin: '12px 0 4px' }}>
        <div style={{ ...HEADING, fontSize: 34, lineHeight: 1.1 }}>{formatCurrency(rs.netRevenue, summary.currency)}</div>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Net revenue (after discounts &amp; refunds)</span>
      </div>

      {/* Stat grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, margin: '18px 0' }}>
        <Stat label="Gross sales" value={formatCurrency(rs.grossSales, summary.currency)} />
        <Stat label="Refund rate" value={formatPct(summary.ratios.refundRatePct)} />
        <Stat
          label="Growth vs last period"
          value={growth == null ? 'No earlier period yet' : `${growth >= 0 ? '+' : ''}${formatPct(growth)}`}
          accent={growthColor}
        />
        <Stat label="Orders" value={rs.orderCount.toLocaleString()} />
      </div>

      {/* Margin — auto when costs exist, else a nudge */}
      <div
        style={{
          padding: '14px 16px',
          borderRadius: 12,
          background: 'var(--glass)',
          border: '1px solid var(--glass-border)',
          marginBottom: summary.trend.length > 0 || summary.goals.length > 0 ? 18 : 0,
        }}
      >
        {margin.available ? (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {margin.grossMarginPct != null && (
              <Stat label="Gross margin" value={formatPct(margin.grossMarginPct)} accent="var(--purple)" />
            )}
            {margin.netProfit != null && (
              <Stat
                label={`Net profit${margin.fees?.estimated ? ' (est.)' : ''}`}
                value={formatCurrency(margin.netProfit, summary.currency)}
                accent={margin.netProfit >= 0 ? 'var(--cyan)' : 'var(--rose)'}
              />
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Info size={16} color="var(--peach)" />
            <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              Add product costs to see margin{margin.reason && margin.reason !== 'add product costs' ? `: ${margin.reason}` : '.'}
            </span>
          </div>
        )}
      </div>

      {/* Revenue trend */}
      {summary.trend.length > 0 && (
        <div style={{ marginBottom: summary.goals.length > 0 ? 18 : 0 }}>
          <span style={{ ...LABEL, display: 'block', marginBottom: 8 }}>Revenue trend</span>
          <div style={{ height: 140 }}>
            <Chart
              type="area"
              data={{
                labels: summary.trend.map((t) => formatTrendLabel(t.date)),
                datasets: [{ label: 'Revenue', data: summary.trend.map((t) => t.revenue), color: 'var(--purple)' }],
              }}
              options={{
                showLegend: false,
                showGrid: false,
                smooth: true,
                aspectRatio: 3,
                formatValue: (v: number) => formatCurrency(v, summary.currency),
              }}
            />
          </div>
        </div>
      )}

      {/* Goal progress */}
      {summary.goals.length > 0 && (
        <div>
          <span style={{ ...LABEL, display: 'block', marginBottom: 10 }}>Goal progress</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {summary.goals.map((g) => {
              const pct = Math.max(0, Math.min(100, g.progressPct));
              return (
                <div key={g.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{g.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                      {g.target != null
                        ? `${formatCurrency(g.current, summary.currency)} / ${formatCurrency(g.target, summary.currency)}`
                        : formatCurrency(g.current, summary.currency)}
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--glass)' }}>
                    <div
                      style={{
                        height: '100%',
                        borderRadius: 999,
                        width: `${pct}%`,
                        background: pct >= 100 ? 'var(--cyan)' : 'var(--purple)',
                        transition: 'width 0.5s ease',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </GlassCard>
  );
}

export default RevenueWidget;
