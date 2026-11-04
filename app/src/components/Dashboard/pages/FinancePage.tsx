import React, { useState } from 'react';
import { GlassCard, PageHeader, Tabs } from '@yotako/webmaven-ui';
import RevenueWidget, { useFinancialSummary, formatCurrency } from '../widgets/RevenueWidget';
import type { FinancePeriod } from '../../../types/finance.types';

const HEADING: React.CSSProperties = { fontWeight: 700, color: 'var(--text)' };
const LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const PERIODS: Array<{ key: FinancePeriod; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
];

function StatementRow({
  label,
  value,
  sign,
  currency,
  emphasis,
}: {
  label: string;
  value: number;
  sign?: '+' | '-';
  currency: string;
  emphasis?: boolean;
}) {
  const color = sign === '-' ? 'var(--rose)' : 'var(--text)';
  const display = `${sign === '-' ? '−' : ''}${formatCurrency(Math.abs(value), currency)}`;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 0',
        borderTop: emphasis ? '1px solid var(--glass-border)' : 'none',
        marginTop: emphasis ? 4 : 0,
      }}
    >
      <span style={{ fontSize: 14, color: 'var(--text-dim)', fontWeight: emphasis ? 700 : 500, ...(emphasis ? { color: 'var(--text)' } : {}) }}>
        {label}
      </span>
      <span style={{ ...HEADING, fontSize: emphasis ? 18 : 14, color, fontWeight: emphasis ? 700 : 600 }}>{display}</span>
    </div>
  );
}

function FinancePage() {
  const [period, setPeriod] = useState<FinancePeriod>('month');
  const state = useFinancialSummary(period, true);
  const { summary } = state;

  return (
    <div className="wm-main__inner" style={{ padding: '24px', maxWidth: 820, margin: '0 auto' }}>
      {/* "Income", the dashboard's word for this page (2026-10-16). */}
      <PageHeader
        title="Income"
        style={{ marginBottom: 24 }}
        actions={(
          // A block around the bar: on a phone it scrolls sideways inside the page's width.
          <div data-testid="wm-finance-periods" style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <Tabs items={PERIODS} activeKey={period} onChange={(key) => setPeriod(key as FinancePeriod)} />
          </div>
        )}
      />

      {/* Headline widget — shares the page's single fetch */}
      <div style={{ marginBottom: 20 }}>
        <RevenueWidget period={period} data={state} />
      </div>

      {/* Revenue statement + top sellers — only when a store is connected */}
      {summary && summary.hasStore && (
        <>
          <GlassCard padding="24px" style={{ marginBottom: 20 }}>
            <span style={LABEL}>Revenue statement · {summary.period.label}</span>
            <div style={{ marginTop: 12 }}>
              <StatementRow label="Gross sales" value={summary.revenueStatement.grossSales} sign="+" currency={summary.currency} />
              <StatementRow label="Discounts" value={summary.revenueStatement.discounts} sign="-" currency={summary.currency} />
              <StatementRow label="Tax collected" value={summary.revenueStatement.tax} currency={summary.currency} />
              <StatementRow label="Shipping collected" value={summary.revenueStatement.shipping} currency={summary.currency} />
              <StatementRow label="Refunds" value={summary.revenueStatement.refunds} sign="-" currency={summary.currency} />
              <StatementRow label="Net revenue" value={summary.revenueStatement.netRevenue} currency={summary.currency} emphasis />
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '10px 0 0' }}>
              Net revenue = gross sales − discounts − refunds. Tax and shipping are collected on customers' behalf.
              Average order value {formatCurrency(summary.revenueStatement.avgOrderValue, summary.currency)} across{' '}
              {summary.revenueStatement.orderCount.toLocaleString()} orders.
            </p>
          </GlassCard>

          {summary.topSellers.length > 0 && (
            <GlassCard padding="24px">
              <span style={LABEL}>Top sellers</span>
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: 12 }}>
                {summary.topSellers.map((p, i) => (
                  <div
                    key={p.productId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '10px 0',
                      borderBottom: i < summary.topSellers.length - 1 ? '1px solid var(--glass-border)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <span
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 8,
                          flexShrink: 0,
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: 12,
                          fontWeight: 700,
                          color: 'var(--purple)',
                          background: 'color-mix(in srgb, var(--purple) 12%, transparent)',
                        }}
                      >
                        {i + 1}
                      </span>
                      <span style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{p.quantity.toLocaleString()} sold</span>
                      <span style={{ ...HEADING, fontSize: 14 }}>{formatCurrency(p.revenue, summary.currency)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </>
      )}
    </div>
  );
}

export default FinancePage;
