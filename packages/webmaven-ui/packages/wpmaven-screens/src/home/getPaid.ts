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
 *
 * The card's words are in the page's language: English is the source; the
 * French is written by hand (src/i18n/fr.json, namespaces screensGetPaid,
 * screensGetPaidWords and screensGetPaidCard), the other languages by the
 * dashboard's translation script.
 * Payment providers are named as they are; a provider's own product names
 * (PayPal's Pay Later) as the provider writes them in that language.
 */
import type { ReactNode } from 'react';
import { localized } from '@yotako/webmaven-ui';
import type { ScreensTransport } from '../host/types';
import { offeredLocalServices } from './localPayments';
import { formatKept, formatTag } from '../copyLanguage';

const enc = encodeURIComponent;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// ── The store's gateways ─────────────────────────────────────────────────

/**
 * Turn on a way to get paid, a card on Home for a business that cannot take
 * money online yet: its own payment providers (namespace
 * 'screensGetPaidWords'), the payments account's state, and the setup's
 * errors.
 */
export const GET_PAID_WORDS_EN = {
  /** Under WooPayments (a payment provider, named as it is). */
  wooBlurb: 'Accept cards directly in WooCommerce, no extra account needed.',
  /** Why WooPayments is recommended, beside its Recommended label. */
  wooRecommend: 'Works natively with your store, no separate account needed.',
  /** Under Stripe. */
  stripeBlurb: 'Cards, wallets and more via your Stripe account.',
  /** Under PayPal; "Pay Later" is PayPal's product, named as PayPal writes it in this language. */
  paypalBlurb: 'PayPal, Pay Later and card payments.',
  /** A provider's typical fee; {0} the percentage ("2.9"), {1} the fixed part per sale ("0.30" or "$0.30"). */
  fee: (pct: string, fixed: string) => `${pct}% + ${fixed}`,
  /** The setup was refused for too many requests. */
  tooManyRequests: 'Too many requests at once. Wait a minute and try again.',
  /** The setup could not start; {0} the provider's name. */
  setupFailed: (provider: string) => `We could not start the ${provider} setup on your site. Please try again in a moment.`,
  /** The new tab's title and words while the provider's setup page in WordPress is on its way. */
  openingAdmin: 'Opening WordPress admin',
  /** The payments account's line: not set up yet. */
  notStarted: 'Take card payments on your store, set up in a few minutes right here.',
  /** The payments account's line: setup started. */
  onboarding: 'You started setting up payments. Stripe still needs a few details.',
  /** The payments account's line: Stripe is checking. */
  inReview: 'Stripe is checking your details. It usually takes a few minutes, sometimes a day or two.',
  /** The payments account's line: Stripe needs details by a date; {0} the date ("October 14"). */
  actionNeededBy: (date: string) => `Stripe needs a few more details by ${date} to keep your payments on.`,
  /** The payments account's line: Stripe needs details. */
  actionNeeded: 'Stripe needs a few more details to keep your payments on.',
  /** The payments account's line: it takes payments. */
  active: 'Your store takes payments. Payouts go to your bank every week.',
  /** The payments account's line: the Stripe account was unlinked. */
  disconnected: 'Your Stripe account is no longer linked to this store.',
};

export const GET_PAID_WORDS = localized(GET_PAID_WORDS_EN, 'screensGetPaidWords');

/**
 * A gateway the card sets up: WooPayments, Stripe, PayPal, or since
 * 2026-11-16 a local payment service's id ("razorpay", "mollie"), named by
 * the payment status (localPayments.ts).
 */
export type StoreGateway = 'woocommerce_payments' | 'stripe' | 'ppcp' | (string & Record<never, never>);

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
    get blurb() { return GET_PAID_WORDS.wooBlurb; },
    fee: { pct: 2.9, fixed: 0.3 },
    recommended: true,
    get recommendReason() { return GET_PAID_WORDS.wooRecommend; },
  },
  {
    id: 'stripe',
    title: 'Stripe',
    get blurb() { return GET_PAID_WORDS.stripeBlurb; },
    fee: { pct: 2.9, fixed: 0.3 },
  },
  {
    id: 'ppcp',
    title: 'PayPal',
    get blurb() { return GET_PAID_WORDS.paypalBlurb; },
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
  return GET_PAID_WORDS.fee(feePercent(meta), formatKept(meta.fee.fixed, (v) => v.toFixed(2), { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

/** The fee's percentage as the page's language writes it ("2.9"). */
function feePercent(meta: GatewayMeta): string {
  return formatKept(meta.fee.pct, String, { maximumFractionDigits: 2 });
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
  return GET_PAID_WORDS.fee(feePercent(meta), formatKept(meta.fee.fixed, (v) => `$${v.toFixed(2)}`, {
    style: 'currency', currency: FEE_TABLE_CURRENCY, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }));
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
    && (offeredGateways(status).length > 0 || wpmavenOfferedFor(status) || offeredLocalServices(status).length > 0);
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
  if (status === 429) return GET_PAID_WORDS.tooManyRequests;
  return GET_PAID_WORDS.setupFailed(title);
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
  placeholder = GET_PAID_WORDS.openingAdmin,
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
 * What the card says about the product's payments account, WPMaven Payments
 * (namespace 'screensGetPaid'). The account is the owner's own, processed by
 * Stripe; the product never holds the money. The dashboard reads these too.
 */
/**
 * Our payment service's name, the same on every address: the service and its
 * terms are ours (the dashboard's Payments sentences say "WPMaven Payments"
 * too). A product name, never translated.
 */
export const PAYMENTS_SERVICE_NAME = 'WPMaven Payments';

export const GET_PAID_COPY_EN = {
  /** The card's title. */
  title: 'Turn on a way to get paid',
  /** The payments account's name, our payment service on every address (PAYMENTS_SERVICE_NAME, never translated; not a text of its own). */
  get productName(): string {
    return PAYMENTS_SERVICE_NAME;
  },
  /** Under the payments account's name. */
  processedBy: 'Payments are processed by Stripe and paid out to your bank.',
  /** The second button: link a Stripe account the owner already has. */
  useOwnStripe: 'I already use Stripe',
  /** The main button before setup. */
  notStartedAction: 'Get paid',
  /** The main button while setup is not finished. */
  onboardingAction: 'Finish setup',
  /** The main button after the Stripe account was unlinked. */
  disconnectedAction: 'Set up again',
  /** What a person who cannot set it up reads, in the account (the owner and admins can). */
  needsOwner: 'Only the account owner or an admin can set up how this store gets paid.',
} as const;

export const GET_PAID_COPY = localized(GET_PAID_COPY_EN, 'screensGetPaid');

/**
 * The card's own sentences around the providers (namespace
 * 'screensGetPaidCard'): why it shows, the providers' fees, and the setup
 * finished on the provider's own page in WordPress.
 */
export const GET_PAID_CARD_COPY_EN = {
  /** Under the title: why the card shows. */
  storefrontLive: 'Your storefront is live, but visitors cannot order until a way to get paid is on.',
  /** The same when only the owner's own providers are offered; {0} the product's name. */
  storefrontLiveOwn: (product: string) => `Your storefront is live, but visitors cannot order until one of these is connected. The money goes to your own account, never through ${product}.`,
  /** Beside the title: how long setting up takes, on this card. */
  fewMinutes: 'A few minutes, right here',
  /** Beside the title: how long it takes on a provider's page. */
  twoMinutes: "About two minutes, on the provider's own page",
  /** The label beside the recommended way. */
  recommended: 'Recommended',
  /** After the payments account's line: how it is set up. */
  setUpHere: 'Set up in a few minutes, right here, with no other account to create.',
  /** The toggle that shows the owner's own providers under the recommended way. */
  otherProviders: 'Or connect a provider you already use',
  /** Under that toggle. */
  moneyToProvider: 'The money then goes to your account with that provider.',
  /** Under a provider; {0} its typical fee ("2.9% + 0.30"). */
  typicalFees: (fee: string) => `Typical fees ${fee} per sale`,
  /** A provider's button while its setup is not finished. */
  finishSetup: 'Finish setup',
  /** A provider's button. */
  connect: 'Connect',
  /** In place of a provider's name that is not known. */
  thatProvider: 'that provider',
  /** The site sent no setup page; {0} the provider's name. */
  noSetupPage: (provider: string) => `Your site did not send back a setup page for ${provider}. Please try again, or pick another provider.`,
  /** After "...to finish:" when the sign-in failed with no reason. */
  tryAgain: 'Please try again in a moment.',
  /** The provider is installed but the sign-in to WordPress failed; {0} the provider's name, {1} why. */
  signInFailed: (provider: string, why: string) => `${provider} is installed on your site, but we could not sign you in to WordPress to finish: ${why}`,
  /** Once connected; {0} the provider's name. */
  connected: (provider: string) => `You are set up to get paid through ${provider}. Your team takes it from here.`,
  /** The browser blocked the setup tab: the sentence before the link. */
  blockedTab: 'Your browser blocked the new tab.',
  /** The link to the setup page; {0} the provider's name. */
  openSetupPage: (provider: string) => `Open the ${provider} setup page`,
  /** After that link: the link works for a minute. */
  blockedAfter: 'within a minute to finish, and this card updates when you are done.',
  /** An older plugin: the setup page was opened on the site's own WordPress sign-in; {0} the provider's name. */
  fallbackOpened: (provider: string) => `We opened the ${provider} setup page on your site. Sign in to WordPress there to finish.`,
  /** An older plugin, tab blocked: after the link to the setup page. */
  fallbackAfter: 'and sign in to WordPress to finish.',
};

export const GET_PAID_CARD_COPY = localized(GET_PAID_CARD_COPY_EN, 'screensGetPaidCard');

/** "October 14" (or "October 14, 2027" in another year); null for none or a date that does not parse. */
export function dueByText(iso: string | null, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString(formatTag('en-US'), d.getFullYear() === now.getFullYear()
    ? { month: 'long', day: 'numeric' }
    : { month: 'long', day: 'numeric', year: 'numeric' });
}

/** The short line for each account state (the card, the income pages). */
export function stateLine(status: { state: WpmPaymentsState; dueBy: string | null }, now = new Date()): string {
  const w = GET_PAID_WORDS;
  switch (status.state) {
    case 'not_started':
      return w.notStarted;
    case 'onboarding':
      return w.onboarding;
    case 'in_review':
      return w.inReview;
    case 'action_needed': {
      const by = dueByText(status.dueBy, now);
      return by ? w.actionNeededBy(by) : w.actionNeeded;
    }
    case 'active':
      return w.active;
    case 'disconnected':
      return w.disconnected;
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
