/**
 * Turn on a way to get paid (moved from the dashboard, 2026-10-17): what the
 * card reads and starts, and its words, one copy for the dashboard's Home
 * and the plugin's Overview.
 *
 *   the store's gateways    GET  /instances/:id/payments/status
 *   one gateway's setup     POST /instances/:id/payments/setup { gateway }
 *   WPMaven Payments        GET  /instances/:id/payments/wpmaven/status
 *
 * The gateways are the store's own (WooPayments, Stripe, PayPal on its
 * WooCommerce), never WPMaven's billing. Their setup is finished on the
 * provider's own screen in WordPress, in a tab opened inside the click
 * (GatewaySetupHost). A site sets one up only from the owner's own
 * WordPress account (the API's route policy).
 */
import type { ReactNode } from 'react';
import type { ScreensTransport } from '../host/types';

const enc = encodeURIComponent;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// ── The store's gateways ─────────────────────────────────────────────────

export type StoreGateway = 'woocommerce_payments' | 'stripe' | 'ppcp';

export type GatewayConnection = 'connected' | 'pending' | 'none';

export interface PaymentStatus {
  gateways: Array<{ id: string; title: string; enabled: boolean; connected: GatewayConnection }>;
  primary: string | null;
  /**
   * False when the site could not report its gateways (an older WPMaven
   * plugin without the handlers, or no answer). Absent on an older API.
   * "none" then means "not reported", never "cannot take money".
   */
  known?: boolean;
  /**
   * The ways that can pay a business in the store's currency: the
   * card offers only these. Absent on an
   * older API and when the store's currency is not known: every gateway is
   * offered then, as before.
   */
  storeCurrency?: StoreCurrencyPayments;
}

/** What the payment status says about the store's currency. */
export interface StoreCurrencyPayments {
  code: string;
  /** The gateways that can pay a business in it, in the card's order; empty when none can. */
  services: StoreGateway[];
  /** WPMaven Payments, processed by Stripe: offered only where Stripe is. */
  wpmavenPayments: boolean;
  /** What the owner reads when none can (the Indian rupee today), else null. */
  note: string | null;
}

export interface PaymentSetupResult {
  gateway: StoreGateway;
  connectUrl: string | null;
  alreadyConnected: boolean;
}

export interface GatewayMeta {
  id: StoreGateway;
  title: string;
  /** Human blurb for the connect card. */
  blurb: string;
  /** Fallback fee model (percent of amount + fixed per-transaction). */
  fee: { pct: number; fixed: number };
  /** Highlighted with a "Recommended" frame in the connect UIs. */
  recommended?: boolean;
  /** Why it is recommended: an unexplained badge on a money decision undercuts it. */
  recommendReason?: string;
}

/**
 * The store payment gateways, with the per-gateway fee model the connect
 * card shows as a typical fee when a gateway does not expose its own. The
 * fee math that counts lives in the API (financeService); keep the two in
 * step.
 */
export const STORE_GATEWAYS: GatewayMeta[] = [
  {
    id: 'woocommerce_payments',
    title: 'WooPayments',
    blurb: 'Accept cards directly in WooCommerce, no extra account needed.',
    fee: { pct: 2.9, fixed: 0.3 },
    recommended: true,
    recommendReason: 'Works natively with your store, no separate account needed.',
  },
  {
    id: 'stripe',
    title: 'Stripe',
    blurb: 'Cards, wallets and more via your Stripe account.',
    fee: { pct: 2.9, fixed: 0.3 },
  },
  {
    id: 'ppcp',
    title: 'PayPal',
    blurb: 'PayPal, Pay Later and card payments.',
    fee: { pct: 3.49, fixed: 0.49 },
  },
];

export function getGatewayMeta(id: string): GatewayMeta | undefined {
  return STORE_GATEWAYS.find((g) => g.id === id);
}

/**
 * The gateways the card offers: the
 * ones that can pay a business in the store's currency (PayPal never for
 * UAE dirhams, only PayPal for Philippine pesos), every one when the API
 * does not say.
 */
export function offeredGateways(status: PaymentStatus | null | undefined): GatewayMeta[] {
  const services = status?.storeCurrency?.services;
  return Array.isArray(services) ? STORE_GATEWAYS.filter((g) => services.includes(g.id)) : STORE_GATEWAYS;
}

/** Whether WPMaven Payments may be offered for the store: processed by Stripe, so where Stripe can pay the business. */
export function wpmavenOfferedFor(status: PaymentStatus | null | undefined): boolean {
  return status?.storeCurrency?.wpmavenPayments !== false;
}

/**
 * What the card says when no way can pay a business in the store's
 * currency (the Indian rupee today: "WooPayments, Stripe and PayPal cannot
 * pay a business in India in Indian rupees (INR) yet."), else null.
 */
export function noWayToGetPaidNote(status: PaymentStatus | null | undefined): string | null {
  const s = status?.storeCurrency;
  if (!s || !Array.isArray(s.services) || s.services.length > 0 || s.wpmavenPayments) return null;
  return typeof s.note === 'string' && s.note.trim() ? s.note.trim() : null;
}

/** "2.9% + 0.30": a light, currency-free fee hint. */
export function formatFeeModel(meta: GatewayMeta): string {
  return `${meta.fee.pct}% + ${meta.fee.fixed.toFixed(2)}`;
}

/** The currency the gateway fee table (STORE_GATEWAYS) is written in: its figures are the US rates. */
const FEE_TABLE_CURRENCY = 'USD';

/**
 * The typical fee, with its fixed part's currency named only when it is true
 * (prod check 2026-09-27). The line is currency-free ("2.9% + 0.30") because
 * the table holds US rates: a US-dollar store reads "2.9% + $0.30", and
 * every other store keeps the currency-free line. Putting the store's own
 * symbol on the US figures claimed fees nobody verified ("3.49% + €0.49")
 * and some that mean nothing ("¥0.30"). Unknown, it stays currency-free too.
 */
export function typicalFeeText(meta: GatewayMeta, currency: string | null | undefined): string {
  const code = (currency ?? '').trim().toUpperCase();
  if (code !== FEE_TABLE_CURRENCY) return formatFeeModel(meta);
  return `${meta.fee.pct}% + $${meta.fee.fixed.toFixed(2)}`;
}

/**
 * The last answer per business, and the read on its way, so the dashboard's
 * guided tour and Help menu know whether a store still cannot take money
 * without asking the site a second time (the status is a round trip to the
 * customer's own WordPress). Only what was read this visit.
 */
const lastRead = new Map<string, PaymentStatus | null>();
const reading = new Map<string, Promise<PaymentStatus | null>>();

/** The last status read for this business this visit: undefined when none has answered yet. */
export function peekPaymentStatus(instanceId: string): PaymentStatus | null | undefined {
  return lastRead.has(instanceId) ? lastRead.get(instanceId) : undefined;
}

/** The status read on its way for this business, if one is. */
export function paymentStatusOnItsWay(instanceId: string): Promise<PaymentStatus | null> | undefined {
  return reading.get(instanceId);
}

/**
 * A store that cannot take money yet: the site REPORTED its gateways and
 * none is connected. Not a store, no answer, or an unreported status (an
 * older plugin) is never read as "cannot take money".
 * The card asks exactly when this is true: not for a store whose currency
 * no way can pay a business in (the card only says why).
 */
export function needsGateway(status: PaymentStatus | null | undefined): boolean {
  return !!status && status.gateways.length > 0 && status.known !== false && !status.primary
    && (offeredGateways(status).length > 0 || wpmavenOfferedFor(status));
}

/** The store's gateways; null when the site did not answer or has no store (an older plugin, a site without WooCommerce). */
export async function readPaymentStatus(transport: ScreensTransport, instanceId: string): Promise<PaymentStatus | null> {
  const read = (async () => {
    try {
      const data = await transport.get<unknown>(`/instances/${enc(instanceId)}/payments/status`);
      return isObj(data) && Array.isArray(data.gateways) ? (data as unknown as PaymentStatus) : null;
    } catch {
      return null;
    }
  })();
  reading.set(instanceId, read);
  const status = await read;
  if (reading.get(instanceId) === read) reading.delete(instanceId);
  lastRead.set(instanceId, status);
  return status;
}

/** Installs and turns on the gateway on the site, and answers its setup page there. */
export async function setupGateway(transport: ScreensTransport, instanceId: string, gateway: StoreGateway): Promise<PaymentSetupResult> {
  return transport.post<PaymentSetupResult>(`/instances/${enc(instanceId)}/payments/setup`, { gateway });
}

/**
 * The sentence to show when setting a gateway up failed.
 *
 * A refusal the API wrote for the owner (a 4xx, for example a 409 saying the
 * site's plugin must update first) is shown as written. Anything else is
 * ours: a 5xx body here is often the site's own answer passed through, and it
 * reached the screen as "HTTP 500: {...}" JSON.
 */
export function setupErrorMessage(err: unknown, title: string): string {
  const res = (err as { response?: { status?: number; data?: { error?: unknown; message?: unknown } } })?.response;
  const status = res?.status ?? 0;
  const said = typeof res?.data?.error === 'string' ? res.data.error
    : typeof res?.data?.message === 'string' ? res.data.message
      : null;
  const readable = !!said && said.trim().length > 0 && !/^\s*HTTP\s*\d{3}/i.test(said) && !/[{[]/.test(said);
  if (status >= 400 && status < 500 && readable) return said!;
  if (status === 429) return 'Too many requests at once. Wait a minute and try again.';
  return `We could not start the ${title} setup on your site. Please try again in a moment.`;
}

// ── Finishing a setup in WordPress ───────────────────────────────────────

/** The tab a setup opens inside the click, before its address is known. */
export interface PendingTab {
  location: { href: string };
  close(): void;
  opener?: unknown;
  document?: { title: string; body?: { textContent: string | null } | null };
}

/**
 * A tab opened inside the click (popup blockers), with a placeholder while
 * the setup page is on its way; null when the browser blocked it.
 */
export function openSetupTab(
  open: (url: string, target: string) => PendingTab | null = (u, t) => window.open(u, t) as PendingTab | null,
  placeholder = 'Opening WordPress admin',
): PendingTab | null {
  const tab = open('', '_blank');
  if (!tab) return null;
  try { tab.opener = null; } catch { /* some browsers make it read-only */ }
  try {
    if (tab.document) {
      tab.document.title = placeholder;
      if (tab.document.body) tab.document.body.textContent = `${placeholder}...`;
    }
  } catch { /* the placeholder is cosmetic */ }
  return tab;
}

/** What became of sending the setup tab to the provider's own screen in WordPress. */
export type GatewayTabResult =
  | { kind: 'opened' }
  /** The browser blocked the tab: the address is offered as a link (a sign-in link works for one minute). */
  | { kind: 'blocked'; url: string }
  | { kind: 'error'; message: string }
  /** A WordPress administrator account must be added first: asked in the app's dialog, then sent again. */
  | { kind: 'confirm'; title: string; detail: string; confirmLabel: string }
  /** An older plugin: the site's own WordPress sign-in, opened (or offered when blocked), with a note. */
  | { kind: 'fallback'; url: string; opened: boolean; note: string };

/** The app's way to finish a setup in WordPress (ScreensHost.gatewaySetup). */
export interface GatewaySetupHost {
  /**
   * Points the tab (opened inside the click; null when blocked) at the
   * provider's screen in wp-admin. `confirmNewAccount`: the person said yes
   * to adding a WordPress administrator account.
   */
  send(
    tab: PendingTab | null,
    ctx: { instanceId: string; gateway: StoreGateway; connectUrl: string; confirmNewAccount: boolean },
  ): Promise<GatewayTabResult>;
  /** The question of a 'confirm' result in the app's own dialog; null closes it. */
  confirmDialog(
    request: { title: string; detail: string; confirmLabel: string; onConfirm(): void | Promise<void> } | null,
    onClose: () => void,
  ): ReactNode;
}

/** Without the app's own: the tab opens the setup page the site sent, where the person is signed in already. */
export async function openSetupPage(tab: PendingTab | null, connectUrl: string): Promise<GatewayTabResult> {
  if (!tab) return { kind: 'blocked', url: connectUrl };
  tab.location.href = connectUrl;
  return { kind: 'opened' };
}

// ── WPMaven Payments ─────────────────────────────────────────────────────

export type WpmPaymentsState = 'not_started' | 'onboarding' | 'in_review' | 'action_needed' | 'active' | 'disconnected';

/** The business's WPMaven Payments account, as the card reads it. */
export interface WpmPaymentsStatus {
  state: WpmPaymentsState;
  mode: 'created' | 'connected' | null;
  /** When the earliest due requirement becomes blocking (ISO), or null. */
  dueBy: string | null;
  /** False while payments cannot open for new businesses (the API's keys or webhooks are not all set). */
  available: boolean;
  /** True when an existing Stripe account can be linked ("I already use Stripe"). */
  oauthAvailable: boolean;
}

const WPM_STATES: readonly WpmPaymentsState[] = ['not_started', 'onboarding', 'in_review', 'action_needed', 'active', 'disconnected'];

/** WPMaven Payments for the business; null when the API did not answer (the card is then the providers alone). */
export async function readWpmPayments(transport: ScreensTransport, instanceId: string): Promise<WpmPaymentsStatus | null> {
  try {
    const d = await transport.get<unknown>(`/instances/${enc(instanceId)}/payments/wpmaven/status`);
    if (!isObj(d) || !WPM_STATES.includes(d.state as WpmPaymentsState)) return null;
    return {
      state: d.state as WpmPaymentsState,
      mode: d.mode === 'created' || d.mode === 'connected' ? d.mode : null,
      dueBy: typeof d.dueBy === 'string' ? d.dueBy : null,
      available: d.available === true,
      oauthAvailable: d.oauthAvailable === true,
    };
  } catch {
    return null;
  }
}

/**
 * What the card says about WPMaven Payments. The account is the owner's
 * own, processed by Stripe; WPMaven never holds the money.
 */
export const GET_PAID_COPY = {
  title: 'Turn on a way to get paid',
  productName: 'WPMaven Payments',
  processedBy: 'Payments are processed by Stripe and paid out to your bank.',
  useOwnStripe: 'I already use Stripe',
  notStartedAction: 'Get paid',
  onboardingAction: 'Finish setup',
  disconnectedAction: 'Set up again',
  /** What a person who cannot set it up reads, in the account (the owner and admins can). */
  needsOwner: 'Only the account owner or an admin can set up how this store gets paid.',
} as const;

/** "October 14" (or "October 14, 2027" in another year); null for none or a date that does not parse. */
export function dueByText(iso: string | null, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString('en-US', d.getFullYear() === now.getFullYear()
    ? { month: 'long', day: 'numeric' }
    : { month: 'long', day: 'numeric', year: 'numeric' });
}

/** The short line for each account state (the card, the income pages). */
export function stateLine(status: { state: WpmPaymentsState; dueBy: string | null }, now = new Date()): string {
  switch (status.state) {
    case 'not_started':
      return 'Take card payments on your store, set up in a few minutes right here.';
    case 'onboarding':
      return 'You started setting up payments. Stripe still needs a few details.';
    case 'in_review':
      return 'Stripe is checking your details. It usually takes a few minutes, sometimes a day or two.';
    case 'action_needed': {
      const by = dueByText(status.dueBy, now);
      return by ? `Stripe needs a few more details by ${by} to keep your payments on.` : 'Stripe needs a few more details to keep your payments on.';
    }
    case 'active':
      return 'Your store takes payments. Payouts go to your bank every week.';
    case 'disconnected':
      return 'Your Stripe account is no longer linked to this store.';
    default:
      return '';
  }
}

/** The Get paid step goes straight to Stripe's questions once an account exists. */
export function needsAccount(state: WpmPaymentsState): boolean {
  return state === 'not_started' || state === 'disconnected';
}

/**
 * The dashboard's Get paid step for a business. `from` is the page that
 * opens it (Income, Home, the business's page): finishing the step, or
 * leaving it for later, goes back there.
 */
export function getPaidPath(instanceId: string, from?: string): string {
  const path = `/get-paid?business=${enc(instanceId)}`;
  return from ? `${path}&next=${enc(from)}` : path;
}
