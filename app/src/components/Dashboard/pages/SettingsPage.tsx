import React, { useState, useEffect } from 'react';
import { GlassCard, Button, Badge, Modal, PageHeader, Progress } from '@yotako/webmaven-ui';
import { CreditCard, ExternalLink, Trash2 } from 'lucide-react';
import PlanMark, { PLAN_MARK_CARD } from '../../PlanMark';
import { planDisplayName, planStatusLabel } from '../../../utils/planLabels';
import { isWpmavenSite, siteBrand, dashboardPhrase, accountPhrase, type SiteBrand } from '../../../utils/brand';
import { dashboardLink, hasFeature, useSiteState, type SiteState } from '../../../utils/siteState';
import { currentTier, tierIn } from '../../../utils/tier';
import { useDashboard } from '../../../contexts/DashboardContext';

// The cards that read the API: each its own chunk, loaded when Settings shows it.
const StoreCurrencyCard = React.lazy(() => import(/* webpackChunkName: "wm-settings-currency" */ './settings/StoreCurrencyCard'));
const SocialCard = React.lazy(() => import(/* webpackChunkName: "wm-settings-social" */ './settings/SocialCard'));
const ReportScheduleCard = React.lazy(() => import(/* webpackChunkName: "wm-settings-reports" */ './settings/ReportScheduleCard'));
const ChoicesCard = React.lazy(() => import(/* webpackChunkName: "wm-settings-choices" */ './settings/ChoicesCard'));

/** GET /sites/me/plan (API), through the plugin's /subscription route. */
interface SubscriptionData {
  plan?: string;
  /** The customer's name for the plan ("Operator", "White label", "Free"). */
  planName?: string;
  status?: string;
  /** What upgrading gets an owner with no plan, in figures; null once they have one. */
  upgrade?: { name: string; sentence: string } | null;
  subscription: {
    plan: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  } | null;
  /** Plan token allotment + usage. Matches the API's actual response shape. */
  planUsage: {
    used: number;
    limit: number;
    percent: number;
  };
  extraUsage?: {
    enabled: boolean;
    spentCents: number;
    limitCents: number;
    percent: number;
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' };
const HEADING: React.CSSProperties = { fontWeight: 700, color: 'var(--text)' };

function SettingsPage() {
  const [data, setData] = useState<SubscriptionData | null>(null);
  const site = useSiteState();
  const tier = currentTier();
  const owner = tier === 'owner';
  // The plan belongs to the site owner (1.2.8): it is read for an
  // administrator only; others get a sentence saying so, and no call.
  const [loading, setLoading] = useState(owner);
  const [error, setError] = useState<string | null>(null);

  const wpData = (window as any).WEBMAVEN_WP_DATA;
  const restUrl = wpData?.restUrl || '/wp-json/webmaven_wp/v1';
  const nonce = wpData?.nonce || '';
  const dashboardUrl = wpData?.remotes?.dashboardUrl || '';

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${restUrl}/subscription`, { headers: { 'X-WP-Nonce': nonce } });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (json?.success) setData(json.data);
        else setError('Your plan could not be loaded. Try again in a minute.');
      } catch {
        if (!cancelled) setError('Your plan could not be loaded. Check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [owner, restUrl, nonce]);

  const plan = data?.subscription?.plan || data?.plan || 'FREE';
  const status = data?.subscription?.status || data?.status || 'ACTIVE';
  const planName = data?.planName || planDisplayName(plan) || 'Free';
  const upgrade = plan === 'FREE' ? data?.upgrade ?? null : null;
  const planLimit = data?.planUsage?.limit ?? 0;
  const planUsed = data?.planUsage?.used ?? 0;
  // Trust the API-computed percent when present; fall back to local math.
  const rawPercent = data?.planUsage?.percent
    ?? (planLimit > 0 ? (planUsed / planLimit) * 100 : 0);
  const progressPercent = Math.min(100, rawPercent);
  // Match the external dashboard's `displayPercent` helper: when the user
  // has any usage at all but the rounded percent would read 0 (or any value
  // under 1), show "<1" instead of "0". Catches API-side rounding-to-zero.
  const hasUsage = planUsed > 0;
  const displayPercent = hasUsage && progressPercent < 1
    ? '<1'
    : Math.round(progressPercent).toString();
  const hasPlan = planLimit > 0;
  // The business pages answer WordPress roles here (the plugin and the API agree on tiers).
  const roles = hasFeature(site, 'parity');
  const store = !!((window as any).WEBMAVEN_WP_DATA?.store?.active || site.business?.store);

  return (
    <div style={{ width: '100%', maxWidth: 640, margin: '0 auto', padding: '24px 0' }}>
      <PageHeader title="Settings and usage" style={{ marginBottom: 28 }} />

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <div className="wpm-auth-loading__spinner" />
        </div>
      )}

      {error && !loading && (
        <GlassCard padding="16px" style={{ marginBottom: 20 }}>
          <p role="alert" style={{ color: 'var(--rose)', fontSize: 13, margin: 0 }}>{error}</p>
        </GlassCard>
      )}

      {!owner && (
        <GlassCard padding="16px" style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>
            The plan and its usage are shown to this site's administrators.
          </p>
        </GlassCard>
      )}

      {data && !loading && (
        <>
          {/* Plan */}
          <GlassCard padding="24px" style={{ marginBottom: 20 }}>
            <span style={LABEL}>Your plan</span>
            {/* On a phone the button goes under the plan rather than squeezing it. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* The plan's icon on the left of its name; none under a brand. */}
                <PlanMark plan={plan} size={PLAN_MARK_CARD} />
                <span style={{ ...HEADING, fontSize: 22 }}>{planName}</span>
                <Badge color={status === 'ACTIVE' ? 'cyan' : 'peach'}>{planStatusLabel(status)}</Badge>
              </div>
              {dashboardUrl && (
                <a href={`${dashboardUrl}/billing`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                  <Button variant="primary" style={{ fontSize: 13 }}>
                    {plan === 'FREE' ? (upgrade ? `Upgrade to ${upgrade.name}` : 'Upgrade') : 'Manage plan'}
                  </Button>
                </a>
              )}
            </div>
            {upgrade?.sentence && (
              <p style={{ fontSize: 13, color: 'var(--text)', margin: '14px 0 0' }}>{upgrade.sentence}</p>
            )}
            {data.subscription?.currentPeriodEnd && plan !== 'FREE' && (
              <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '14px 0 0' }}>
                Renews {formatDate(data.subscription.currentPeriodEnd)}
              </p>
            )}
          </GlassCard>

          {/* Plan usage */}
          {hasPlan ? (
            <GlassCard padding="24px" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={LABEL}>Plan usage</span>
                <span style={{ ...HEADING, fontSize: 20 }}>{displayPercent}%</span>
              </div>
              {/* The kit's bar; near the end of the plan it turns peach, then rose (pages.css). */}
              <Progress
                value={Math.max(progressPercent, planUsed > 0 ? 1 : 0)}
                className={`wm-usage-bar${progressPercent > 90 ? ' wm-usage-bar--full' : progressPercent > 70 ? ' wm-usage-bar--high' : ''}`}
              />
              {data.subscription?.currentPeriodStart && data.subscription?.currentPeriodEnd && (
                <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '12px 0 0' }}>
                  {formatDate(data.subscription.currentPeriodStart)} to {formatDate(data.subscription.currentPeriodEnd)}
                </p>
              )}
            </GlassCard>
          ) : (
            <GlassCard padding="24px" style={{ marginBottom: 20 }}>
              <span style={LABEL}>Plan usage</span>
              <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '12px 0 0' }}>
                No plan yet. Usage tracking starts when you subscribe.
              </p>
            </GlassCard>
          )}
        </>
      )}

      <React.Suspense fallback={null}>
        {/* The store's currency: read and changed here (Keep or Convert)
            once the business pages answer WordPress roles; otherwise on the
            business page in the dashboard. */}
        {!loading && store && (roles && tierIn(['owner', 'store'], tier)
          ? <StoreCurrencyCard />
          : owner ? <StoreCurrencyRow site={site} /> : null)}
        {/* A copy of the site served under another address: the account
            knows the original one. */}
        {!loading && <CopyOfSiteNotice site={site} />}
        {/* WhatsApp: from the account (whatsappLinked); linking runs on the
            owner's dashboard sign-in. WhatsApp messages come from WPMaven's own
            number, so a branded site shows no card (1.2.31). */}
        {!loading && owner && isWpmavenSite() && <WhatsAppCard site={site} />}
        {/* Payments: where WPMaven Payments stands, and the Payments screen
            where the account lets this site show it; otherwise the way to the
            dashboard. Never a Connect button here. */}
        {!loading && (hasFeature(site, 'payments') && tierIn(['owner', 'store'], tier)
          ? <PaymentsCard site={site} />
          : owner ? <PaymentsSummary site={site} /> : null)}
        {/* Social: which networks post for this business, read only. */}
        {!loading && owner && (hasFeature(site, 'social')
          ? <SocialCard />
          : <SocialInDashboard site={site} />)}
        {/* Report schedule: where the account lets this site read reports. */}
        {!loading && owner && hasFeature(site, 'reports') && <ReportScheduleCard />}
        {/* What the site shares (statistics, the customers' copy, the footer
            link): each off until an administrator turns it on. */}
        {!loading && owner && <ChoicesCard />}
      </React.Suspense>
      {/* Last on the page: the one control that stops these screens. */}
      {!loading && owner && <DisconnectSiteCard />}
    </div>
  );
}

/**
 * Payments while the Payments screen runs here: where WPMaven Payments
 * stands (from the account, no call) and the way to the screen.
 */
function PaymentsCard({ site }: { site: SiteState }) {
  const { setCurrentPage } = useDashboard();
  const { lines } = paymentsText(site.payments);
  return (
    <GlassCard padding="24px" style={{ marginBottom: 20 }}>
      <div data-testid="wm-payments-summary" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <CreditCard size={14} color="var(--text-dim)" />
        <span style={LABEL}>Payments</span>
      </div>
      {lines.map((line) => (
        <p key={line} style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 8px' }}>{line}</p>
      ))}
      <Button variant="primary" style={{ fontSize: 13 }} onClick={() => setCurrentPage('payments')}>Open Payments</Button>
    </GlassCard>
  );
}

/** What disconnecting does, in the card and in its confirm alike. */
export function disconnectText(b: SiteBrand = siteBrand()): string {
  return `This disconnects this site from ${accountPhrase(b)}. Your site keeps running, and these screens stop until an administrator signs in again.`;
}

/**
 * Disconnect this site (administrators), in its own card at the bottom of
 * Settings, as the dashboard has it: it says what it does before it is
 * pressed, then asks once more. The site keeps running, and the WPMaven
 * screens here stop until someone signs in again (POST logout).
 */
function DisconnectSiteCard() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = disconnectText();
  const disconnect = async () => {
    const wp = (window as any).WEBMAVEN_WP_DATA || {};
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${wp.restUrl || '/wp-json/webmaven_wp/v1'}/logout`, {
        method: 'POST',
        headers: { 'X-WP-Nonce': wp.nonce || '' },
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // The app reads the site's state again: disconnected, it shows Sign in.
      window.location.reload();
    } catch {
      setError('This site could not be disconnected. Try again in a minute.');
      setBusy(false);
    }
  };
  return (
    <GlassCard
      padding="20px 24px"
      data-testid="wm-disconnect-site"
      style={{ marginTop: 20, borderColor: 'color-mix(in srgb, var(--danger) 35%, transparent)' }}
    >
      <h2 style={{ ...HEADING, fontSize: 16, fontWeight: 600, margin: 0 }}>Disconnect this site</h2>
      <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5, margin: '6px 0 16px' }}>{text}</p>
      {/* The kit's danger, the quiet outline before the confirm (the dialog's is the solid one). */}
      <Button variant="danger" size="sm" data-testid="wm-disconnect" leftIcon={<Trash2 size={16} aria-hidden="true" />} onClick={() => setOpen(true)}>
        Disconnect
      </Button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Disconnect this site?" description={text}>
        {error && <p role="alert" style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--rose)' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="dangerSolid" disabled={busy} onClick={disconnect}>{busy ? 'Disconnecting' : 'Disconnect'}</Button>
        </div>
      </Modal>
    </GlassCard>
  );
}

const WHATSAPP_ICON = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z';

/** A link to a dashboard page, in a new tab, saying so. */
function DashboardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={`Opens ${dashboardPhrase(siteBrand())}`} style={{ fontSize: 13, color: 'var(--purple)' }}>
      {children}
      <ExternalLink size={12} style={{ marginLeft: 4, verticalAlign: '-1px' }} />
    </a>
  );
}

/**
 * WhatsApp, from the account (the site state's whatsappLinked): no status
 * read, no linking here. Linking runs on the owner's dashboard sign-in.
 */
function WhatsAppCard({ site }: { site: SiteState }) {
  const href = dashboardLink(site, '/settings?tab=channels');
  return (
    <GlassCard padding="24px" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="var(--text-dim)"><path d={WHATSAPP_ICON} /></svg>
        <span style={LABEL}>WhatsApp</span>
        {site.whatsappLinked && <Badge color="cyan">connected</Badge>}
      </div>
      {site.whatsappLinked ? (
        <>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 12px' }}>
            Your team sends build updates, site alerts and chat to your WhatsApp.
          </p>
          <DashboardLink href={href}>Manage WhatsApp in your WPMaven dashboard</DashboardLink>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 16px' }}>
            Get build updates, site alerts and chat right in WhatsApp. You connect it in your WPMaven dashboard.
          </p>
          <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            <Button variant="primary" style={{ fontSize: 13 }}>Connect WhatsApp in your dashboard</Button>
          </a>
        </>
      )}
    </GlassCard>
  );
}

/** The store's currency is changed on the business page only (it changes every price). */
function StoreCurrencyRow({ site }: { site: SiteState }) {
  const store = (window as any).WEBMAVEN_WP_DATA?.store;
  if (!store?.active && !site.business?.store) return null;
  return (
    <GlassCard padding="20px 24px" style={{ marginBottom: 20 }}>
      <span style={LABEL}>Store currency</span>
      <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '8px 0 0' }}>
        {site.links.business ? (
          <DashboardLink href={site.links.business}>{`Change it on your business page in ${dashboardPhrase(siteBrand())}.`}</DashboardLink>
        ) : (
          `Change it on your business page in ${dashboardPhrase(siteBrand())}.`
        )}
      </p>
    </GlassCard>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Whether this WordPress is not at the address the account knows: the
 * account's siteUrl is neither this site's own address (WP_HOME, else home)
 * nor the edge's primary host on a custom domain.
 */
export function isCopyOfSite(site: SiteState, identity: { home?: string; primaryHost?: string } | undefined): boolean {
  const known = site.instance?.siteUrl ? hostOf(site.instance.siteUrl) : '';
  if (!known || !identity?.home) return false;
  const here = hostOf(identity.home);
  const primary = (identity.primaryHost || '').toLowerCase().replace(/^www\./, '');
  return !!here && known !== here && known !== primary;
}

function CopyOfSiteNotice({ site }: { site: SiteState }) {
  const identity = (window as any).WEBMAVEN_WP_DATA?.siteIdentity;
  if (!isCopyOfSite(site, identity)) return null;
  const who = isWpmavenSite() ? 'WPMaven' : 'your dashboard';
  return (
    <GlassCard padding="16px 20px" style={{ marginBottom: 20 }}>
      <p data-testid="wm-copy-notice" style={{ fontSize: 13, color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>
        {`This site's address is not the one ${who} knows (${site.instance!.siteUrl}). If this is a copy of your site, connect it as its own site.`}
      </p>
    </GlassCard>
  );
}

/** WPMaven Payments where it stands, in the site's brand. */
export function paymentsText(p: SiteState['payments'], b: SiteBrand = siteBrand()): { lines: string[]; action: 'get_paid' | 'open' | null } {
  const ours = b.mode === 'wpmaven';
  if (p.wpmaven === 'active') {
    return { lines: [ours ? 'WPMaven Payments is on. Card payments go to your bank automatically.' : 'Card payments are on. They go to your bank automatically.'], action: null };
  }
  if (p.wpmaven === 'pending') {
    return {
      lines: [
        ours ? 'WPMaven Payments is being set up.' : 'Card payments are being set up.',
        p.needsAction ? 'Stripe needs a few details from you.' : 'Stripe is checking your details.',
      ],
      action: 'open',
    };
  }
  if (!p.available) {
    return { lines: [ours ? 'WPMaven Payments is not open for new businesses yet.' : 'Card payments are not open for new businesses yet.'], action: null };
  }
  return {
    lines: [ours
      ? 'WPMaven Payments is off. Take card payments in your store with WPMaven Payments. Set it up in your WPMaven dashboard.'
      : `Card payments are off. Set them up in ${dashboardPhrase(b)}.`],
    action: 'get_paid',
  };
}

/**
 * Payments while the account does not let this site manage them here: no
 * Connect button that cannot work. WPMaven Payments where it stands, the
 * store's other payment methods (read by the plugin from WooCommerce), and
 * the way to WooCommerce's own payment settings.
 */
function PaymentsSummary({ site }: { site: SiteState }) {
  const store = (window as any).WEBMAVEN_WP_DATA?.store || {};
  const gateways: string[] = Array.isArray(store.gateways) ? store.gateways.filter((g: unknown) => typeof g === 'string' && g) : [];
  const manageUrl = typeof store.manageUrl === 'string' && /^https?:\/\//.test(store.manageUrl) ? store.manageUrl : '';
  const { lines, action } = paymentsText(site.payments);
  const href = action ? site.links.getPaid : null;
  return (
    <GlassCard padding="24px" style={{ marginBottom: 20 }}>
      <div data-testid="wm-payments-summary" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <CreditCard size={14} color="var(--text-dim)" />
        <span style={LABEL}>Payments</span>
      </div>
      {lines.map((line) => (
        <p key={line} style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 8px' }}>{line}</p>
      ))}
      {gateways.length > 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 8px' }}>
          {`Other payment methods on this store: ${gateways.join(', ')}`}
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" title={`Opens ${dashboardPhrase(siteBrand())}`} style={{ textDecoration: 'none' }}>
            <Button variant="primary" style={{ fontSize: 13 }}>{action === 'open' ? 'Open payments' : 'Get paid'}</Button>
          </a>
        )}
        {manageUrl && (
          <a href={manageUrl} style={{ fontSize: 13, color: 'var(--text-dim)' }}>Manage in WooCommerce</a>
        )}
      </div>
    </GlassCard>
  );
}

/** X and what the team shares, in the dashboard: one row. */
function SocialInDashboard({ site }: { site: SiteState }) {
  return (
    <GlassCard padding="20px 24px" style={{ marginBottom: 20 }}>
      <span style={LABEL}>Social · X</span>
      <p style={{ fontSize: 13, margin: '8px 0 0' }}>
        <DashboardLink href={dashboardLink(site, '/settings?tab=channels')}>
          {`Connect X and choose what your team shares in ${dashboardPhrase(siteBrand())}.`}
        </DashboardLink>
      </p>
    </GlassCard>
  );
}

export default SettingsPage;
