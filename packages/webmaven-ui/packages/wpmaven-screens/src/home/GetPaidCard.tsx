/**
 * Turn on a way to get paid, as a Home section (moved from the dashboard,
 * 2026-10-17): the dashboard's Home and business page, and the plugin's
 * Overview, draw this one card. It reads the store's gateways and WPMaven
 * Payments through the app's transport (getPaid.ts), and the app's host
 * gives what only it does: where WPMaven Payments is set up (its Get paid
 * step, through host.navigate), how a provider's setup is finished in
 * WordPress (host.gatewaySetup), Stripe's notices (renderers.stripeNotices),
 * the guided tour (host.tourSettled) and who may set it up
 * (viewer.setsUpPayments).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, GlassCard } from '@yotako/webmaven-ui';
import { productName } from '@yotako/wpmaven-onboarding/shared';
import { HiOutlineChevronDown } from 'react-icons/hi2';
import type { ScreensHost } from '../host/types';
import { teamBusiness } from '../team/reads';
import { readHomeFinance } from './reads';
import { useHomeSectionStyles } from './styles';
import {
  GET_PAID_COPY, STORE_GATEWAYS, getPaidPath, needsAccount, needsGateway, noWayToGetPaidNote, offeredGateways, openSetupPage,
  openSetupTab, readPaymentStatus, readWpmPayments, setupErrorMessage, setupGateway, stateLine, typicalFeeText, wpmavenOfferedFor,
  type GatewayTabResult, type PaymentStatus, type PendingTab, type StoreGateway, type WpmPaymentsStatus,
} from './getPaid';

// The dashboard's type scale, said inline (the plugin has no stylesheet of the dashboard's).
const TITLE: React.CSSProperties = { margin: 0, fontSize: 'var(--text-body)', lineHeight: 'var(--leading-body)', fontWeight: 650, color: 'var(--text)' };
const BODY: React.CSSProperties = { margin: 0, fontSize: 'var(--text-body)', lineHeight: 'var(--leading-body)', color: 'var(--text)' };
const BODY_DIM: React.CSSProperties = { ...BODY, color: 'var(--text-dim)' };
const SMALL: React.CSSProperties = { margin: 0, fontSize: 'var(--text-meta)', lineHeight: 1.45, color: 'var(--text)' };
const SMALL_DIM: React.CSSProperties = { ...SMALL, color: 'var(--text-dim)' };
const NAME: React.CSSProperties = { ...BODY, fontWeight: 550 };
const ACCENT = 'var(--accent, #6962AD)';
const ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };
const LINK: React.CSSProperties = { color: 'inherit', textDecoration: 'underline' };

/**
 * What a person who cannot set up how the store gets paid reads in place of
 * the choices (the owner and admins only; from WordPress, the owner's own account): that the store cannot take
 * money yet, and who can turn that on, or where. No button of the card's
 * own, because the API refuses each one.
 */
export const GetPaidNeedsOwner: React.FC<{ reason: React.ReactNode }> = ({ reason }) => (
  <div data-testid="getpaid-needs-owner">
    <h3 style={TITLE}>{GET_PAID_COPY.title}</h3>
    <p style={{ ...BODY_DIM, marginTop: 4 }}>Your storefront is live, but visitors cannot order until a way to get paid is on.</p>
    {typeof reason === 'string'
      ? <p style={{ ...BODY, marginTop: 8 }} role="note">{reason}</p>
      : <div style={{ ...BODY, marginTop: 8 }} role="note">{reason}</div>}
  </div>
);

export interface GetPaidCardProps {
  host: ScreensHost;
  /** The business (the account's scope); a site's scope sets up its own. */
  instanceId?: string | null;
  /** The business page's narrow version: one gateway under the other, a smaller card. */
  compact?: boolean;
  /**
   * No card of its own: Home puts every section in its own card and hides
   * the card when the section renders nothing, so the way to get paid is
   * laid out, spaced and ordered like the rest.
   */
  bare?: boolean;
  /**
   * The store's own currency for the fees line, when the page already has it
   * (Home reads the finance summary anyway); null when it is not known.
   * Left out, the card asks for it itself, and only when it shows.
   */
  currency?: string | null;
}

/** No tour: the card says nothing to anyone about its answer. */
const noTour = (_key: string, _scope: string | null | undefined, _settled: boolean): void => undefined;

/**
 * Get paid (2026-09-16). A store went live and nothing asked the owner to
 * connect a way to take money: the onboarding's "Set up payments" card only
 * ever rendered inside the WordPress wizard. This is the same choice
 * (WooPayments, Stripe, PayPal, the gateway's own hosted KYC), for a store
 * with no connected gateway, and gone the moment one is. Hidden until the
 * site answers, never an error.
 *
 * WPMaven Payments (2026-10-01) comes first: the owner's payments account,
 * set up in the dashboard's Get paid step, no provider page and no WordPress
 * sign-in. While it is being set up the card follows it; once it is on, the
 * card is gone like for any connected gateway, and it comes back when Stripe
 * needs something from the owner. The providers of the owner's own stay
 * below it as the other way.
 *
 * Only the ways that can pay a business in the store's currency are offered
 * (the API's status says which): PayPal
 * never for UAE dirhams, only PayPal for Philippine pesos, WPMaven Payments
 * (processed by Stripe) only where Stripe is. When none can (Indian rupees
 * today), the card says why instead of offering anything.
 */
export const GetPaidCard: React.FC<GetPaidCardProps> = ({ host, instanceId: chosen, compact, bare, currency }) => {
  useHomeSectionStyles();
  const instanceId = teamBusiness(host.scope, chosen) ?? '';
  // The transport may be a new object on each render: the calls read the latest host.
  const hostRef = useRef(host);
  hostRef.current = host;
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [busy, setBusy] = useState<StoreGateway | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justConnected, setJustConnected] = useState(false);
  // A setup page the browser would not open in a new tab (a sign-in link,
  // good for one minute).
  const [blockedUrl, setBlockedUrl] = useState<{ url: string; title: string } | null>(null);
  // The site's plugin is too old for one-click sign-in: the setup page was
  // opened on the site's own WordPress login instead.
  const [fallback, setFallback] = useState<{ url: string; opened: boolean; title: string; note: string } | null>(null);
  // Adding a WordPress administrator account on a site the owner connected
  // themselves is asked first, in the app's own dialog.
  const [confirmRequest, setConfirmRequest] = useState<{
    title: string; detail: string; confirmLabel: string; onConfirm(): void | Promise<void>;
  } | null>(null);
  // The providers of the owner's own, folded while WPMaven Payments is on offer.
  const [othersOpen, setOthersOpen] = useState(false);
  const pollRef = useRef<number | null>(null);
  // The Get paid step comes back to the page that opened it (Home, or the business's page).
  const getPaid = () => host.navigate(getPaidPath(instanceId, host.here?.()));
  const setsUp = host.viewer?.setsUpPayments !== false;
  // WPMaven Payments; null when the API did not answer (the card is then the providers alone).
  const [wpm, setWpm] = useState<WpmPaymentsStatus | null>(null);
  useEffect(() => {
    if (!instanceId) return undefined;
    let alive = true;
    void readWpmPayments(hostRef.current.transport, instanceId).then((s) => { if (alive) setWpm(s); });
    return () => { alive = false; };
  }, [instanceId]);

  // The site has answered at least once, for this business: nothing drawn
  // from here on means "nothing to ask", not "still loading" (the guided
  // tour's get-paid stop).
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);
  const tourSettled = host.tourSettled ?? noTour;
  tourSettled('paid', instanceId, answeredFor === instanceId);

  const refresh = useCallback(async () => {
    const s = await readPaymentStatus(hostRef.current.transport, instanceId);
    setStatus(s);
    setAnsweredFor(instanceId);
    return s;
  }, [instanceId]);

  useEffect(() => {
    if (instanceId) void refresh();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [refresh, instanceId]);

  // The return from the gateway lands with ?payments=connected (the API's
  // link names the dashboard, which keeps its query on the way): re-read once.
  useEffect(() => {
    if (instanceId && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('payments') === 'connected') void refresh();
  }, [refresh, instanceId]);

  const track = (category: string, action: string, name?: string) => hostRef.current.track?.(category, action, name);

  const connect = async (gateway: StoreGateway) => {
    if (busy) return;
    setBusy(gateway); setError(null); setBlockedUrl(null); setFallback(null);
    const title = STORE_GATEWAYS.find((g) => g.id === gateway)?.title ?? 'that provider';
    // Open the window inside the click (popup blockers), point it once the URL is known.
    const win = openSetupTab();
    try {
      const result = await setupGateway(hostRef.current.transport, instanceId, gateway);
      if (result.alreadyConnected) { win?.close(); await refresh(); return; }
      if (!result.connectUrl) {
        // It used to close the tab, re-read the status and end there: the
        // card sat unchanged and nothing said why.
        win?.close();
        await refresh();
        setError(`Your site did not send back a setup page for ${title}. Please try again, or pick another provider.`);
        return;
      }
      track('payments', 'connect_started', gateway);
      await finishInWpAdmin(win, gateway, title, result.connectUrl, false);
    } catch (e) {
      win?.close();
      setError(setupErrorMessage(e, title));
    } finally {
      setBusy(null);
    }
  };

  // Poll while the owner finishes KYC in the other tab.
  const pollUntilConnected = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      const s = await refresh();
      if (s?.primary) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        setJustConnected(true);
        track('payments', 'connected', s.primary);
      }
    }, 5000);
  };

  /*
   * The provider finishes onboarding inside wp-admin. The dashboard's owner
   * has no WordPress password: its host sends the tab (opened inside the
   * click) through the one-click sign-in, straight to that provider's
   * screen, as the owner's own WordPress administrator (2026-09-22). In
   * WordPress the person is signed in already: the tab opens the setup page
   * the site sent. Never throws.
   */
  const finishInWpAdmin = async (win: PendingTab | null, gateway: StoreGateway, title: string, connectUrl: string, confirmNewAccount: boolean) => {
    const setup = hostRef.current.gatewaySetup;
    let opened: GatewayTabResult;
    try {
      opened = setup
        ? await setup.send(win, { instanceId, gateway, connectUrl, confirmNewAccount })
        : await openSetupPage(win, connectUrl);
    } catch (e) {
      opened = { kind: 'error', message: e instanceof Error && e.message ? e.message : 'Please try again in a moment.' };
    }
    if (opened.kind === 'error') {
      await refresh();
      setError(`${title} is installed on your site, but we could not sign you in to WordPress to finish: ${opened.message}`);
      return;
    }
    if (opened.kind === 'confirm') {
      // A site the owner connected themselves has no WordPress administrator
      // with this email: ask once. The yes is its own click, so it opens its
      // own tab.
      const { title: askTitle, detail, confirmLabel } = opened;
      setConfirmRequest({ title: askTitle, detail, confirmLabel, onConfirm: () => addAccountAndFinish(gateway, title, connectUrl) });
      return;
    }
    if (opened.kind === 'blocked') {
      // The browser blocked the new tab. The page is ready, so it is
      // offered as a link the customer opens themselves.
      setBlockedUrl({ url: opened.url, title });
    }
    if (opened.kind === 'fallback') setFallback({ url: opened.url, opened: opened.opened, title, note: opened.note });
    pollUntilConnected();
  };

  /** The yes in the dialog: a new tab inside this click, then the confirmed link. */
  const addAccountAndFinish = async (gateway: StoreGateway, title: string, connectUrl: string) => {
    const win = openSetupTab();
    setConfirmRequest(null);
    setBusy(gateway); setError(null); setBlockedUrl(null); setFallback(null);
    track('payments', 'wp_admin_account_confirmed', gateway);
    try {
      await finishInWpAdmin(win, gateway, title, connectUrl, true);
    } finally {
      setBusy(null);
    }
  };

  // The store's currency, when the page did not pass it: read once, and only
  // for a card that is about to show the gateways (a store that cannot take
  // money yet), never for one that renders nothing.
  const [ownCurrency, setOwnCurrency] = useState<string | null>(null);
  const asksForGateway = needsGateway(status);
  const readsOwnCurrency = currency === undefined && asksForGateway;
  useEffect(() => {
    if (!readsOwnCurrency) return undefined;
    let cancelled = false;
    void readHomeFinance(hostRef.current.transport, instanceId, 'week').then((f) => { if (!cancelled) setOwnCurrency(f?.storeCurrency ?? null); });
    return () => { cancelled = true; };
  }, [readsOwnCurrency, instanceId]);
  const storeCurrency = currency === undefined ? ownCurrency : currency;

  // Not a store, site not answering, or already getting paid: nothing to ask.
  // Only a status the site actually REPORTED can say a store cannot take
  // money. An unreported one (old plugin, no answer) read as "none" on every
  // gateway, so every site was told it could not take money (audit
  // 2026-09-22); the card now stays quiet until the site can say.
  if (!status || status.gateways.length === 0 || status.known === false) return null;
  // Only the ways that can pay a business in the store's currency (604 A):
  // WPMaven Payments where Stripe can, the providers that can.
  const wpmForCurrency = wpmavenOfferedFor(status);
  const gateways = offeredGateways(status);
  // Stripe needs something, or the account was unlinked: shown even beside a connected provider.
  const wpmAttention = !!wpm && (wpm.state === 'action_needed' || (wpm.state === 'disconnected' && wpm.available && wpmForCurrency));
  if (wpm?.state === 'active' && !justConnected) return null;
  if (status.primary && !justConnected && !wpmAttention) return null;
  // WPMaven Payments is offered (not started, or unlinked) or being set up.
  // Offered only while payments are open to new businesses (wpm.available).
  const wpmOffered = !!wpm && wpm.available && wpmForCurrency && (wpm.state === 'not_started' || wpm.state === 'disconnected');
  const wpmInProgress = !!wpm && !needsAccount(wpm.state) && wpm.state !== 'active';
  // No way can pay a business in the store's currency: why, and nothing to press.
  const noWayNote = wpmInProgress ? null : noWayToGetPaidNote(status);
  // A provider of the owner's own half set up keeps the list open, so its Finish setup is in sight.
  const providersPending = status.gateways.some((g) => g.connected === 'pending');

  const primaryTitle = status.primary ? (status.gateways.find((g) => g.id === status.primary)?.title ?? status.primary) : null;

  // Not compact, the card measures itself (wms-getpaid, HOME_SECTIONS_CSS):
  // on Home it sits in the narrow right-hand column, where three gateways
  // side by side had about a hundred pixels each. A viewport breakpoint
  // could not tell that column from the full width. Bare, the measured box
  // is a plain block inside the section card Home gives it.
  // A plain function, not a component declared in render: a new component
  // type on every render would remount the card and drop its dialog's state.
  const frame = (children: React.ReactNode) => (bare
    ? <div className="wms-getpaid">{children}</div>
    : <GlassCard padding={compact ? 16 : 24} className={compact ? undefined : 'wms-getpaid'}>{children}</GlassCard>);

  // Someone who cannot set it up (84 A; from WordPress, any account but the
  // owner's own): beside a connected provider there is nothing to tell them;
  // without one, the store cannot take money yet and the card says who can
  // turn that on, or where.
  if (!setsUp) {
    return status.primary ? null : frame(<GetPaidNeedsOwner reason={host.renderers?.getPaidNeedsOwner?.() ?? GET_PAID_COPY.needsOwner} />);
  }

  return frame(
    <>
      {justConnected && primaryTitle ? (
        <p style={BODY} role="status">You are set up to get paid through {primaryTitle}. Your team takes it from here.</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <h3 style={TITLE}>{GET_PAID_COPY.title}</h3>
            {!noWayNote && (
              <span style={SMALL_DIM}>{wpm && (wpmForCurrency || wpmInProgress) ? 'A few minutes, right here' : 'About two minutes, on the provider\'s own page'}</span>
            )}
          </div>
          {wpmInProgress && wpm ? (
            <div style={{ marginTop: 8 }} data-testid="getpaid-wpmaven-progress">
              <p style={BODY}>{stateLine(wpm)}</p>
              {/* Stripe's banner opens on accounts we created; a linked one shows its own in Stripe. */}
              {wpm.state === 'action_needed' && wpm.mode !== 'connected' && host.renderers?.stripeNotices && (
                <div style={{ marginTop: 12 }}>{host.renderers.stripeNotices(instanceId)}</div>
              )}
              {wpm.state !== 'in_review' && (
                <div style={{ marginTop: 12 }}>
                  <Button variant="primary" size="sm" onClick={getPaid}>{GET_PAID_COPY.onboardingAction}</Button>
                </div>
              )}
            </div>
          ) : noWayNote ? (
            <div data-testid="getpaid-no-way">
              <p style={{ ...BODY_DIM, marginTop: 4 }}>Your storefront is live, but visitors cannot order until a way to get paid is on.</p>
              <p style={{ ...BODY, marginTop: 12 }} role="note">{noWayNote}</p>
            </div>
          ) : (
          <>
          {/* With WPMaven Payments on offer the money can go through the platform;
              otherwise only the owner's own providers are listed. */}
          <p style={{ ...BODY_DIM, marginTop: 4 }}>
            {wpmOffered
              ? 'Your storefront is live, but visitors cannot order until a way to get paid is on.'
              : `Your storefront is live, but visitors cannot order until one of these is connected. The money goes to your own account, never through ${productName()}.`}
          </p>
          {wpmOffered && wpm && (
            <div style={{ marginTop: 16, borderRadius: 'var(--r-card)', padding: 12, border: `1px solid ${ACCENT}` }} data-testid="getpaid-wpmaven">
              <div style={ROW}>
                <span style={NAME}>{GET_PAID_COPY.productName}</span>
                <span style={{ fontSize: 'var(--text-meta)', lineHeight: 1.45, color: ACCENT }}>Recommended</span>
              </div>
              <p style={{ ...SMALL_DIM, marginTop: 4 }}>{wpm.state === 'disconnected' ? stateLine(wpm) : `${GET_PAID_COPY.processedBy} Set up in a few minutes, right here, with no other account to create.`}</p>
              <div style={{ marginTop: 12 }}>
                <Button variant="primary" size="sm" onClick={getPaid}>
                  {wpm.state === 'disconnected' ? GET_PAID_COPY.disconnectedAction : GET_PAID_COPY.notStartedAction}
                </Button>
                {wpm.oauthAvailable && (
                  <Button variant="ghost" size="sm" style={{ marginLeft: 8 }} onClick={getPaid}>
                    {GET_PAID_COPY.useOwnStripe}
                  </Button>
                )}
              </div>
            </div>
          )}
          {/* With WPMaven Payments on offer, the providers of the owner's own
              are folded under one line (2026-10-11): they are the other way,
              and three cards under the recommended one buried it. Open when
              they are the only way, or while one is half set up. */}
          {wpmOffered && !providersPending && (
            <button
              type="button"
              className="wms-getpaid-others-toggle"
              style={{ marginTop: 16 }}
              aria-expanded={othersOpen}
              aria-controls={`getpaid-others-${instanceId}`}
              onClick={() => setOthersOpen((open) => !open)}
            >
              <span>Or connect a provider you already use</span>
              <HiOutlineChevronDown aria-hidden className="wms-getpaid-others-chevron" data-open={othersOpen ? 'true' : 'false'} />
            </button>
          )}
          {wpmOffered && (othersOpen || providersPending) && (
            <p style={{ ...SMALL_DIM, marginTop: 8 }}>The money then goes to your account with that provider.</p>
          )}
          {(!wpmOffered || othersOpen || providersPending) && (
          <div
            id={`getpaid-others-${instanceId}`}
            className={compact ? undefined : 'wms-getpaid-gateways'}
            // Fewer than three providers for the store's currency: as many columns, no empty one.
            data-count={!compact && gateways.length < 3 ? gateways.length : undefined}
            style={{ marginTop: 16, display: 'grid', gap: 12, ...(compact ? { gridTemplateColumns: 'repeat(1, minmax(0, 1fr))' } : {}) }}
          >
            {gateways.map((g) => {
              const live = status.gateways.find((x) => x.id === g.id);
              const pending = live?.connected === 'pending';
              return (
                <div key={g.id} style={{ borderRadius: 'var(--r-card)', padding: 12, border: `1px solid ${g.recommended && !wpmOffered ? ACCENT : 'var(--glass-border)'}` }}>
                  <div style={ROW}>
                    <span style={NAME}>{g.title}</span>
                    {/* One recommendation: WPMaven Payments when it is offered. */}
                    {g.recommended && !wpmOffered && <span style={{ fontSize: 'var(--text-meta)', lineHeight: 1.45, color: ACCENT }}>Recommended</span>}
                  </div>
                  <p style={{ ...SMALL_DIM, marginTop: 4 }}>{g.blurb}</p>
                  <p style={{ ...SMALL_DIM, marginTop: 4 }}>Typical fees {typicalFeeText(g, storeCurrency)} per sale</p>
                  <div style={{ marginTop: 12 }}>
                    {/* Every Connect is the way to get paid, so every one is the
                        primary; the recommended card is marked by its border
                        and its label, not by a weaker button on the others. */}
                    <Button variant="primary" size="sm" onClick={() => void connect(g.id)} isLoading={busy === g.id} disabled={!!busy}>
                      {pending ? 'Finish setup' : 'Connect'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          )}
          </>
          )}
          {blockedUrl && (
            <p role="status" style={{ ...SMALL, marginTop: 12 }}>
              Your browser blocked the new tab.{' '}
              <a href={blockedUrl.url} target="_blank" rel="noopener noreferrer" style={LINK} onClick={() => setBlockedUrl(null)}>
                Open the {blockedUrl.title} setup page
              </a>{' '}
              within a minute to finish, and this card updates when you are done.
            </p>
          )}
          {fallback && (
            <p role="status" style={{ ...SMALL, marginTop: 12 }}>
              {fallback.opened ? (
                <>We opened the {fallback.title} setup page on your site. Sign in to WordPress there to finish. </>
              ) : (
                <>
                  Your browser blocked the new tab.{' '}
                  <a href={fallback.url} target="_blank" rel="noopener noreferrer" style={LINK}>
                    Open the {fallback.title} setup page
                  </a>{' '}
                  and sign in to WordPress to finish.{' '}
                </>
              )}
              {fallback.note}
            </p>
          )}
          {error && <p role="alert" style={{ margin: '12px 0 0', fontSize: 'var(--text-meta)', lineHeight: 1.45, color: 'var(--rose)' }}>{error}</p>}
        </>
      )}
      {host.gatewaySetup?.confirmDialog(confirmRequest, () => setConfirmRequest(null))}
    </>,
  );
};

export default GetPaidCard;
