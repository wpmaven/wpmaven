import React, { useState } from 'react';
import { GlassCard, Button, Badge, PageHeader } from '@yotako/webmaven-ui';
import { ChevronDown } from 'lucide-react';
import { getInstanceId } from '../../../../services/proxyClient';
import { useProxyQuery, type ProxyQueryResult } from '../../../../hooks/useProxyQuery';
import ScreenState from '../../ui/ScreenState';
import { dashboardLink, useSiteState, wpAdminLinks, type SiteState } from '../../../../utils/siteState';
import { dashboardPhrase, isWpmavenSite, siteBrand } from '../../../../utils/brand';
import { currentTier } from '../../../../utils/tier';
import { formatCents, formatDay, formatMonth } from '../../../../utils/money';
import { PAYMENT_OPTIONS } from '../../../../constants/storePayments';
import { routeById } from '../registry/routes';
import { useDashboard } from '../../../../contexts/DashboardContext';

/**
 * Payments in WordPress (1.3.0): WPMaven Payments where it stands, then, for
 * an administrator, the balance and next payout, the last payouts and the
 * monthly statements, and the store's other ways to get paid.
 *
 * Our data only: no script from Stripe or anyone else runs in wp-admin, and
 * nothing here opens a Stripe session. Setting payments up, bank details,
 * the payout schedule and tax documents are in the dashboard, behind a
 * deliberate link. A Shop manager sees the state and the gateways.
 *
 * Only the ways that can pay a business in the store's currency are offered
 * (1.9.1), as the site's gateways route says
 * (storeCurrency); for a currency none can, the owner reads why.
 */

/** GET .../payments/wpmaven/status */
export interface PaymentsStatus {
  state: 'not_started' | 'onboarding' | 'in_review' | 'action_needed' | 'active' | 'disconnected';
  mode: 'created' | 'connected' | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  due: string[];
  dueBy: string | null;
  available: boolean;
}

interface Money { currency: string; amountCents: number }

/** GET .../payments/wpmaven/balance */
type Balance = { linked: true } | {
  linked: false;
  available: Money[];
  pending: Money[];
  nextPayout: { arrivalDate: string; amountCents: number; currency: string } | null;
  schedule: { interval: 'daily' | 'weekly' | 'monthly' | 'manual'; weeklyAnchor: string | null; delayDays: number | null } | null;
};

/** GET .../payments/wpmaven/payouts */
type Payouts = { linked: true } | {
  linked: false;
  payouts: Array<{ arrivalDate: string; amountCents: number; currency: string; status: string; method: string }>;
};

interface Statement {
  month: string;
  currency: string;
  orders: Array<{ orderNumber: string; date: string; amountCents: number; feeCents: number; printCostCents: number; refundedCents: number }>;
  totals: { salesCents: number; feesCents: number; printCostCents: number; refundsCents: number; netCents: number };
}

/**
 * The ways that can pay a business in the store's currency, in the shape of the API's payment status: PayPal never
 * for UAE dirhams, only PayPal for Philippine pesos, WPMaven Payments
 * (processed by Stripe) only where Stripe is, none for Indian rupees.
 */
interface StoreCurrencyPayments {
  code: string;
  /** The gateways that can, in the screen's order; none for a currency no gateway pays a business in. */
  services: string[];
  wpmavenPayments: boolean;
  /** What the owner reads when none can, else null. */
  note: string | null;
}

/** GET webmaven_wp/v1/store/gateways (the plugin's own route) */
interface Gateways {
  woocommerce: boolean;
  wpmaven: { enabled: boolean };
  gateways: Array<{ id: string; title: string; connected: 'connected' | 'pending' | 'none'; enabled: boolean; active: boolean; setupUrl: string | null }>;
  printedProducts: boolean;
  manageUrl: string | null;
  /** Null when the store's currency is not one the table covers: every way is offered then. */
  storeCurrency?: StoreCurrencyPayments | null;
}

const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' };
const HEADING: React.CSSProperties = { fontWeight: 700, color: 'var(--text)' };
const CARD: React.CSSProperties = { marginBottom: 20 };

/**
 * The words and the button for each WPMaven Payments state, in the site's
 * brand. `offered`: whether it can pay a business in the store's currency
 * (it is processed by Stripe, 604 A); where it cannot, nothing offers to set
 * it up, and before an account exists the card says nothing at all.
 */
export function paymentsStateCopy(status: PaymentsStatus, ours = isWpmavenSite(), offered = true): { state: string; lines: string[]; action: 'set_up' | 'finish' | null } {
  // "WPMaven Payments is", "Card payments are".
  const name = ours ? 'WPMaven Payments is' : 'Card payments are';
  switch (status.state) {
    case 'not_started':
      if (!offered) return { state: 'not_offered', lines: [], action: null };
      if (!status.available) return { state: 'unavailable', lines: [`${name} not open for new businesses yet.`], action: null };
      return {
        state: 'not_started',
        lines: [ours
          ? 'Get paid with WPMaven Payments. Payments are processed by Stripe and paid out to your bank.'
          : 'Take card payments at your checkout. Payments are processed by Stripe and paid out to your bank.'],
        action: 'set_up',
      };
    case 'onboarding':
      return { state: 'in_progress', lines: [`${name} being set up. A few questions are left to answer.`], action: 'finish' };
    case 'in_review':
      return { state: 'in_progress', lines: [`${name} being set up. Stripe is checking your details.`], action: null };
    case 'action_needed': {
      const count = status.due.length;
      const what = count === 1 ? 'One detail is' : `${count || 'Some'} details are`;
      const by = status.dueBy ? ` by ${formatDay(status.dueBy)}` : '';
      return { state: 'action_needed', lines: [`Stripe needs more from you. ${what} due${by}.`], action: 'finish' };
    }
    case 'disconnected':
      return { state: 'disconnected', lines: [`Your Stripe account is no longer linked, so ${ours ? 'WPMaven Payments' : 'card payments'} cannot take payments.`], action: offered ? 'set_up' : null };
    case 'active':
    default:
      if (!status.chargesEnabled || !status.payoutsEnabled) {
        return {
          state: 'restricted',
          lines: [!status.chargesEnabled ? 'Card payments are paused. Stripe needs something from you.' : 'Payouts are paused. Stripe needs something from you.'],
          action: 'finish',
        };
      }
      return { state: 'active', lines: [`${name} on. Card payments go to your bank automatically.`], action: null };
  }
}

function money(list: Money[]): string {
  return list.length ? list.map((m) => formatCents(m.amountCents, m.currency)).join(' + ') : formatCents(0, 'USD');
}

function scheduleWords(s: NonNullable<Extract<Balance, { linked: false }>['schedule']>): string {
  switch (s.interval) {
    case 'daily': return 'Paid out every day';
    case 'weekly': return s.weeklyAnchor ? `Paid out every ${s.weeklyAnchor.charAt(0).toUpperCase()}${s.weeklyAnchor.slice(1)}` : 'Paid out every week';
    case 'monthly': return 'Paid out every month';
    case 'manual': return 'Paid out when you ask for it';
    default: return '';
  }
}

const STATUS_WORDS: Record<string, string> = { paid: 'Paid', pending: 'On its way', in_transit: 'On its way', canceled: 'Cancelled', failed: 'Failed' };

function StateCard({ site, status, offered }: { site: SiteState; status: PaymentsStatus; offered: boolean }) {
  const copy = paymentsStateCopy(status, isWpmavenSite(), offered);
  if (!copy.lines.length) return null;
  const instanceId = getInstanceId() || site.instance?.id || '';
  const href = dashboardLink(site, `/get-paid?business=${encodeURIComponent(instanceId)}`);
  return (
    <GlassCard padding="24px" style={CARD}>
      <div data-testid="wm-payments" data-state={copy.state}>
        <span style={LABEL}>{isWpmavenSite() ? 'WPMaven Payments' : 'Card payments'}</span>
        {copy.lines.map((line) => <p key={line} style={{ fontSize: 14, color: 'var(--text)', margin: '10px 0 0' }}>{line}</p>)}
        {copy.action && (
          <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'inline-block', marginTop: 14 }}>
            <Button variant="primary" size="sm">{copy.action === 'set_up' ? 'Set up in your dashboard' : 'Finish in your dashboard'}</Button>
          </a>
        )}
      </div>
    </GlassCard>
  );
}

function BalanceCard({ instanceId }: { instanceId: string }) {
  const q = useProxyQuery<Balance>(`instances/${instanceId}/payments/wpmaven/balance`);
  if (q.status === 'loading') return <div style={CARD}><ScreenState state="loading" label="Loading your balance" compact /></div>;
  if (q.status === 'refused') return <div style={CARD}><ScreenState state="refused" error={q.error} compact /></div>;
  if (q.status === 'failed') {
    if (q.error?.code === 'NO_ACCOUNT') return null;
    return <div style={CARD}><ScreenState state="failed" error={q.error} fallback="Your balance could not be loaded. Try again in a minute." onRetry={q.refetch} compact /></div>;
  }
  const b = q.data;
  if (!b) return null;
  return (
    <GlassCard padding="24px" style={CARD}>
      <div data-testid="wm-payments-balance">
        <span style={LABEL}>Balance</span>
        {b.linked ? (
          <p style={{ fontSize: 14, color: 'var(--text)', margin: '10px 0 0' }}>
            This store is paid through your own Stripe account. Its balance and payouts are in your Stripe dashboard.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginTop: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Ready to pay out</div>
                <div style={{ ...HEADING, fontSize: 24 }}>{money(b.available)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>On its way</div>
                <div style={{ ...HEADING, fontSize: 24 }}>{money(b.pending)}</div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '12px 0 0' }}>
              {b.nextPayout
                ? `Next payout: ${formatCents(b.nextPayout.amountCents, b.nextPayout.currency)} on ${formatDay(b.nextPayout.arrivalDate)}.`
                : 'No payout is scheduled right now.'}
              {b.schedule && scheduleWords(b.schedule) ? ` ${scheduleWords(b.schedule)}.` : ''}
            </p>
          </>
        )}
      </div>
    </GlassCard>
  );
}

function PayoutsCard({ instanceId }: { instanceId: string }) {
  const q = useProxyQuery<Payouts>(`instances/${instanceId}/payments/wpmaven/payouts`, { limit: 10 });
  if (q.status === 'loading') return null;
  if (q.status === 'refused') return <div style={CARD}><ScreenState state="refused" error={q.error} compact /></div>;
  if (q.status === 'failed') {
    if (q.error?.code === 'NO_ACCOUNT') return null;
    return <div style={CARD}><ScreenState state="failed" error={q.error} fallback="Your payouts could not be loaded. Try again in a minute." onRetry={q.refetch} compact /></div>;
  }
  const p = q.data;
  if (!p || p.linked) return null;
  return (
    <GlassCard padding="24px" style={CARD}>
      <div data-testid="wm-payments-payouts">
        <span style={LABEL}>Last payouts</span>
        {p.payouts.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '10px 0 0' }}>No payouts yet. Your first one comes a few days after your first sale.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 13 }}>
            <tbody>
              {p.payouts.map((row, i) => (
                <tr key={`${row.arrivalDate}-${i}`} style={{ borderTop: i ? '1px solid var(--glass-border)' : undefined }}>
                  <td style={{ padding: '8px 0', color: 'var(--text)' }}>{formatDay(row.arrivalDate)}</td>
                  <td style={{ padding: '8px 0', color: 'var(--text-dim)' }}>{STATUS_WORDS[row.status] ?? 'In progress'}</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', ...HEADING, fontSize: 13 }}>{formatCents(row.amountCents, row.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </GlassCard>
  );
}

function StatementsCard({ instanceId }: { instanceId: string }) {
  const months = useProxyQuery<{ months: string[] }>(`instances/${instanceId}/payments/wpmaven/statements`);
  const [month, setMonth] = useState<string | null>(null);
  const statement = useProxyQuery<Statement>(month ? `instances/${instanceId}/payments/wpmaven/statements/${month}` : null);
  if (months.status === 'loading') return null;
  if (months.status === 'refused') return <div style={CARD}><ScreenState state="refused" error={months.error} compact /></div>;
  if (months.status === 'failed') {
    return <div style={CARD}><ScreenState state="failed" error={months.error} fallback="Your statements could not be loaded. Try again in a minute." onRetry={months.refetch} compact /></div>;
  }
  const list = months.data?.months ?? [];
  return (
    <GlassCard padding="24px" style={CARD}>
      <div data-testid="wm-payments-statements">
        <span style={LABEL}>Statements</span>
        {list.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '10px 0 0' }}>No statement yet. A month gets one once it has a paid order.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {list.map((m) => (
              <Button key={m} size="sm" variant={m === month ? 'secondary' : 'outline'} aria-pressed={m === month} onClick={() => setMonth(m === month ? null : m)}>
                {formatMonth(m)}
              </Button>
            ))}
          </div>
        )}
        {month && statement.status === 'loading' && <div style={{ marginTop: 12 }}><ScreenState state="loading" label="Loading the statement" compact /></div>}
        {month && statement.status === 'failed' && (
          <div style={{ marginTop: 12 }}>
            <ScreenState state="failed" error={statement.error} fallback="This statement could not be loaded. Try again in a minute." onRetry={statement.refetch} compact />
          </div>
        )}
        {month && statement.status === 'refused' && <div style={{ marginTop: 12 }}><ScreenState state="refused" error={statement.error} compact /></div>}
        {month && statement.status === 'ready' && statement.data && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14, fontSize: 13 }}>
            <tbody>
              {([
                ['Sales', statement.data.totals.salesCents],
                ['Payment fees', -statement.data.totals.feesCents],
                ['Printing and shipping', -statement.data.totals.printCostCents],
                ['Refunds', -statement.data.totals.refundsCents],
              ] as Array<[string, number]>).map(([label, cents]) => (
                <tr key={label}>
                  <td style={{ padding: '6px 0', color: 'var(--text-dim)' }}>{label}</td>
                  <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--text)' }}>{`${cents < 0 ? 'minus ' : ''}${formatCents(Math.abs(cents), statement.data!.currency)}`}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid var(--glass-border)' }}>
                <td style={{ padding: '8px 0', ...HEADING, fontSize: 13 }}>What you kept</td>
                <td style={{ padding: '8px 0', textAlign: 'right', ...HEADING, fontSize: 14 }}>{formatCents(statement.data.totals.netCents, statement.data.currency)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </GlassCard>
  );
}

/**
 * Whether the store's other ways to get paid fold under WPMaven Payments:
 * on a WPMaven site, closed, unless they are the only way (WPMaven Payments
 * is not open to new businesses) or one of them is half set up.
 */
export function otherWaysFolded(ours: boolean, wpmavenAvailable: boolean, gateways: Gateways['gateways']): boolean {
  return ours && wpmavenAvailable && !gateways.some((x) => x.connected === 'pending');
}

const TOGGLE: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, padding: 0, border: 0, background: 'none',
  cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)', textAlign: 'left', fontFamily: 'inherit',
};

function OtherWays({ site, status, q }: { site: SiteState; status: PaymentsStatus | null; q: ProxyQueryResult<Gateways> }) {
  // The providers of the owner's own, folded while WPMaven Payments is on offer.
  const [othersOpen, setOthersOpen] = useState(false);
  const ours = isWpmavenSite();
  if (q.status === 'loading') return null;
  if (q.status === 'refused') return <div style={CARD}><ScreenState state="refused" error={q.error} compact /></div>;
  if (q.status === 'failed') {
    return <div style={CARD}><ScreenState state="failed" error={q.error} fallback="The store's payment methods could not be read. Try again in a minute." onRetry={q.refetch} compact /></div>;
  }
  const g = q.data;
  if (!g) return null;
  const byId = new Map(g.gateways.map((x) => [x.id, x]));
  const ourOn = !!status && status.state === 'active' && status.chargesEnabled;
  // Only the ways that can pay a business in the store's currency (604 A),
  // and a provider the store already connected or is setting up.
  const offer = g.storeCurrency ?? null;
  const wpmavenHere = offer?.wpmavenPayments !== false;
  const wpmavenOffered = site.payments.available && wpmavenHere;
  const folded = otherWaysFolded(ours, wpmavenOffered, g.gateways);
  const wpmavenOption = PAYMENT_OPTIONS.find((o) => o.id === 'webmaven_payments')!;
  const providers = PAYMENT_OPTIONS.filter((o) => o.id !== 'webmaven_payments'
    && (!offer || offer.services.includes(o.id) || (byId.get(o.id)?.connected ?? 'none') !== 'none'));
  // No way can pay a business in it (the rupee): the note says why, while nothing takes money.
  const noWay = offer && !offer.services.length && !offer.wpmavenPayments && !g.wpmaven.enabled
    && !g.gateways.some((x) => x.connected === 'connected') ? offer.note : null;
  return (
    <GlassCard padding="24px" style={CARD}>
      <div data-testid="wm-payments-gateways">
        <span style={LABEL}>Other ways to get paid</span>
        {!g.woocommerce ? (
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '10px 0 0' }}>No store yet. Add WooCommerce to sell online, then choose how customers pay.</p>
        ) : (
          <>
            {g.printedProducts && !ourOn && (
              <p role="note" style={{ fontSize: 13, color: 'var(--text)', margin: '10px 0 0' }}>
                {ours ? 'Printed products need WPMaven Payments.' : 'Printed products need card payments from your dashboard.'}
              </p>
            )}
            {noWay && (
              <p role="note" data-testid="wm-payments-no-way" style={{ fontSize: 13, color: 'var(--text)', margin: '10px 0 0' }}>{noWay}</p>
            )}
            {(wpmavenHere || g.wpmaven.enabled) && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ ...HEADING, fontSize: 14 }}>{ours ? wpmavenOption.title : 'Card payments'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{wpmavenOption.blurb}</div>
                </div>
                {g.wpmaven.enabled ? <Badge color="cyan">On at checkout</Badge> : <span style={{ fontSize: 12, color: 'var(--text-dim)', flexShrink: 0, whiteSpace: 'nowrap' }}>Not on yet</span>}
              </div>
            )}
            {/* The providers fold under WPMaven Payments, as on the dashboard: open when they are the only way, or while one is half set up. */}
            {folded && (
              <button
                type="button"
                style={TOGGLE}
                aria-expanded={othersOpen}
                aria-controls="wm-payments-others"
                data-testid="wm-payments-others-toggle"
                onClick={() => setOthersOpen((open) => !open)}
              >
                <span>Or connect a provider you already use</span>
                <ChevronDown size={14} aria-hidden="true" style={{ flexShrink: 0, transition: 'transform 0.15s ease', transform: othersOpen ? 'rotate(180deg)' : undefined }} />
              </button>
            )}
            {(!folded || othersOpen) && providers.length > 0 && (
              <div id="wm-payments-others" data-testid="wm-payments-others" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: folded ? 8 : 10 }}>
                {/* Under the line, its second half; open for a provider half set up, the whole sentence. */}
                {ours && wpmavenOffered && (
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
                    {folded ? 'The money then goes to your account with that provider.' : 'Or connect a provider you already use. The money then goes to your account with that provider.'}
                  </p>
                )}
                {providers.map((option) => {
                  const live = byId.get(option.id);
                  const state = live?.connected === 'connected' ? 'Connected' : live?.connected === 'pending' ? 'Being set up' : 'Not added';
                  return (
                    <div key={option.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ ...HEADING, fontSize: 14 }}>{option.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{`${option.blurb} ${state}.`}</div>
                      </div>
                      {live?.setupUrl ? (
                        <a href={live.setupUrl} style={{ textDecoration: 'none', flexShrink: 0, whiteSpace: 'nowrap' }}>
                          <Button variant="outline" size="sm">{live.active ? 'Settings' : 'Set up'}</Button>
                        </a>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>An administrator can add it</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </GlassCard>
  );
}

function OrdersLink() {
  const { setCurrentPage } = useDashboard();
  if (routeById('orders')) {
    return (
      <Button variant="outline" size="sm" onClick={() => setCurrentPage('orders')}>See your orders</Button>
    );
  }
  const orders = wpAdminLinks().find((l) => l.key === 'orders');
  if (!orders) return null;
  return <a href={orders.url} style={{ fontSize: 13, color: 'var(--purple)' }}>See your orders in WooCommerce</a>;
}

export default function PaymentsPage() {
  const site = useSiteState();
  const owner = currentTier() === 'owner';
  const instanceId = getInstanceId() || site.instance?.id || '';
  const status = useProxyQuery<PaymentsStatus>(instanceId ? `instances/${instanceId}/payments/wpmaven/status` : null);
  const gateways = useProxyQuery<Gateways>('store/gateways', undefined, { local: true });
  // WPMaven Payments is processed by Stripe: offered only where Stripe can
  // pay a business in the store's currency (604 A), as the site's route says.
  const wpmavenForCurrency = gateways.data?.storeCurrency?.wpmavenPayments !== false;
  const brand = siteBrand();
  const hasAccount = !!status.data && status.data.state !== 'not_started';
  const query = `?business=${encodeURIComponent(instanceId)}`;

  return (
    <div className="wm-main__inner" style={{ padding: '24px', maxWidth: 760, margin: '0 auto' }}>
      <PageHeader title="Payments" style={{ marginBottom: 24 }} />

      {status.status === 'loading' && <div style={CARD}><ScreenState state="loading" label="Loading your payments" /></div>}
      {status.status === 'refused' && <div style={CARD}><ScreenState state="refused" error={status.error} /></div>}
      {status.status === 'failed' && (
        <div style={CARD}><ScreenState state="failed" error={status.error} fallback="Your payments could not be loaded. Try again in a minute." onRetry={status.refetch} /></div>
      )}
      {status.status === 'ready' && status.data && gateways.status !== 'loading' && <StateCard site={site} status={status.data} offered={wpmavenForCurrency} />}

      {owner && hasAccount && (
        <>
          <BalanceCard instanceId={instanceId} />
          <PayoutsCard instanceId={instanceId} />
          <StatementsCard instanceId={instanceId} />
          <GlassCard padding="20px 24px" style={CARD}>
            <p style={{ fontSize: 13, color: 'var(--text)', margin: 0 }}>
              {`Bank details, payout schedule and tax documents are in ${dashboardPhrase(brand)}.`}
            </p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
              <a data-testid="wm-payments-dashboard-link" href={dashboardLink(site, `/income/payouts${query}`)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--purple)' }}>Bank and payouts</a>
              <a href={dashboardLink(site, `/income/taxes${query}`)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--purple)' }}>Tax documents</a>
            </div>
          </GlassCard>
        </>
      )}

      <div style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 12 }}>
        <OrdersLink />
      </div>

      <OtherWays site={site} status={status.data} q={gateways} />
    </div>
  );
}
