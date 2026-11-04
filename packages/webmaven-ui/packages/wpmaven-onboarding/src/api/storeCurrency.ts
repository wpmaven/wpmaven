/**
 * Store currency: the currency a store sells in.
 *
 *  - GET  /store-currencies                          the offered currencies (public)
 *  - PUT  /onboarding/store-currency/:sessionId      the setup confirm step's choice
 *  - GET  /instances/:id/store-currency              the business page card
 *  - GET  /instances/:id/store-currency/quote?to=    the dialog's Keep and Convert examples
 *  - PUT  /instances/:id/store-currency              the owner's change, with Keep or Convert
 *
 * Every answer is `{ success: true, data }` or `{ success: false, code, error }`
 * where `error` is the sentence the owner reads. A body of the wrong shape is
 * read as no answer (null), never half-read.
 */
import type { WizardTransport } from '../host/types';
import { errorMessage } from '../shared/errorMessage';
import { requestProblem, REQUEST_PROBLEM } from '../shared/requestProblem';
import {
  STORE_CURRENCY_FALLBACK,
  currencyNaming,
  liveCurrencyCode,
  normalizeCurrencyCode,
  refusalText,
  type CurrencyExample,
  type CurrencyNaming,
} from '../shared/storeCurrencyCopy';
import { inPageLanguage } from './pageLanguage';

const enc = encodeURIComponent;

export type StoreCurrencyOption = CurrencyNaming;

const CODE_RE = /^[A-Z]{3}$/;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const digitsOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4 ? v : null;

/**
 * A currency's code, name and digits, or null. The label is optional in a
 * few answers. `live`: a code the store holds (a store in lev says BGN, and
 * stays BGN); otherwise a choice, where the lev reads as the euro.
 */
function namingOf(v: unknown, live = false): CurrencyNaming | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const code = live ? liveCurrencyCode(o.code) : normalizeCurrencyCode(o.code);
  const name = str(o.name);
  const digits = digitsOf(o.digits);
  if (!CODE_RE.test(code) || !name || digits === null) return null;
  const label = str(o.label) ?? `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  return { code, name, label, digits };
}

/** The offered list (sorted by label, as the API sends it), or null when the body is not one. */
export function storeCurrencyListOf(v: unknown): StoreCurrencyOption[] | null {
  const list = (v as { currencies?: unknown } | null)?.currencies;
  if (!Array.isArray(list)) return null;
  const out = list.map((x) => namingOf(x)).filter((o): o is StoreCurrencyOption => o !== null);
  return out.length ? out : null;
}

/** The `data` of an answer's body, as the transport resolves it. */
function dataOf(body: unknown): unknown {
  return body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined;
}

// ── The offered list ───────────────────────────────────────────────────────

let listCache: Promise<StoreCurrencyOption[]> | null = null;

/** The built-in list, sorted by label like the API's. */
function fallbackList(): StoreCurrencyOption[] {
  return [...STORE_CURRENCY_FALLBACK].sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

/**
 * The offered currencies. Asked once per page load (the API caches it for a
 * day); never throws: when the list cannot be read the built-in one answers,
 * and the next call asks again.
 */
export function loadStoreCurrencies(transport: WizardTransport): Promise<StoreCurrencyOption[]> {
  if (!listCache) {
    listCache = transport
      .request({ method: 'GET', path: '/store-currencies' })
      .then((body) => {
        const list = storeCurrencyListOf(dataOf(body));
        if (!list) throw new Error('no currency list');
        return list;
      })
      .catch(() => {
        listCache = null;
        return fallbackList();
      });
  }
  return listCache;
}

/** Tests: forget the cached list. */
export function resetStoreCurrencyListCache(): void {
  listCache = null;
}

// ── Refusals ───────────────────────────────────────────────────────────────

/** Codes whose `error` is a sentence written for the owner. */
const OWNER_CODES = new Set([
  'UNSUPPORTED_CURRENCY', 'SAME_CURRENCY', 'BUILD_STARTED', 'CHANGE_IN_PROGRESS', 'SITE_UNREACHABLE',
  'PLUGIN_TOO_OLD', 'CURRENCY_CHANGED', 'MODE_REQUIRED', 'RATE_UNAVAILABLE', 'RATE_CHANGED',
  'TOO_MANY_PRICES', 'UNSUPPORTED_PRODUCTS', 'STORE_CHANGED', 'NOT_SAVED', 'NOT_RESTORED',
  'CHANGE_RUNNING', 'CHANGE_UNCONFIRMED', 'CURRENCY_UNREADABLE', 'NO_STORE',
]);

/**
 * How long the change may take before this screen stops waiting: longer
 * than the API's own worst case (its read, up to 2 minutes for the site to
 * convert and save every value, a read again, the forecast), so a slow
 * Convert is never shown as a failed connection while it finishes.
 */
export const STORE_CURRENCY_CHANGE_TIMEOUT_MS = 240_000;

/** The request gave up waiting (the answer never came, not a refusal). */
function timedOut(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown; response?: unknown } | null;
  if (!err || err.response) return false;
  return err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || /timeout/i.test(String(err.message ?? ''));
}

export interface StoreCurrencyRefusal {
  /** The API's code (RATE_CHANGED, BUILD_STARTED, ...), or null. */
  code: string | null;
  status: number;
  /** What the owner reads. */
  text: string;
  /** RATE_CHANGED carries the new quote, so the dialog shows the new rate at once. */
  quote: StoreCurrencyQuote | null;
}

/**
 * A refusal in the owner's words: the API's own sentence for a store
 * currency code (a 502 NOT_RESTORED names the prices it could not put back,
 * so it is shown whole), the sentence for the code when it sent none, and
 * otherwise the app's usual reading of an error, with `fallback` last.
 */
export function storeCurrencyRefusalOf(e: unknown, fallback: string): StoreCurrencyRefusal {
  // No answer in time: the change may still be running on the site, so the
  // owner is never told it failed (or that nothing changed).
  if (timedOut(e)) return { code: 'CLIENT_TIMEOUT', status: 0, text: refusalText('CLIENT_TIMEOUT') ?? fallback, quote: null };
  const res = (e as { response?: { status?: number; data?: Record<string, unknown> } } | null)?.response;
  const status = res?.status ?? 0;
  const body = res?.data ?? {};
  const code = typeof body.code === 'string' ? body.code : null;
  const quote = storeCurrencyQuoteOf(body.quote ?? body.data);
  if (code && OWNER_CODES.has(code)) {
    const text = str(body.error) ?? refusalText(code) ?? fallback;
    return { code, status, text, quote };
  }
  const problem = requestProblem(e);
  const text = problem.kind === 'human_check' ? REQUEST_PROBLEM.humanCheck : errorMessage(e, fallback);
  return { code, status, text, quote };
}

// ── The setup confirm step ─────────────────────────────────────────────────

export interface StoreCurrencyConversion {
  from: string;
  to: string;
  rate: number;
  /** "1 EUR = 0.8572 GBP" */
  rateText: string;
  date: string | null;
  /** "September 29, 2026" */
  dateText: string | null;
  /** False for a rate that is not today's: the line says its day. Null when the answer did not say. */
  fresh: boolean | null;
}

export interface OnboardingStoreCurrencyChange {
  storeCurrency: StoreCurrencyOption;
  /** The plan in the new currency (with its scenario); null when the session has none. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  businessPlan: any | null;
  conversion: StoreCurrencyConversion | null;
}

function conversionOf(v: unknown): StoreCurrencyConversion | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const from = normalizeCurrencyCode(o.from);
  const to = normalizeCurrencyCode(o.to);
  const rateText = str(o.rateText);
  if (!CODE_RE.test(from) || !CODE_RE.test(to) || !rateText) return null;
  const rate = typeof o.rate === 'number' && Number.isFinite(o.rate) ? o.rate : 0;
  return { from, to, rate, rateText, date: str(o.date), dateText: str(o.dateText), fresh: typeof o.fresh === 'boolean' ? o.fresh : null };
}

/**
 * The confirm step's answer, or null when the body is not one. The currency
 * is read leniently (a bare code, or the plan's own), because an answer that
 * changed the plan must never read as a failure: the plan on screen would
 * then disagree with the one the build uses.
 */
export function onboardingChangeOf(v: unknown): OnboardingStoreCurrencyChange | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const plan = o.businessPlan && typeof o.businessPlan === 'object' && Array.isArray((o.businessPlan as { products?: unknown }).products)
    ? (o.businessPlan as { currency?: unknown })
    : null;
  const raw = o.storeCurrency;
  const code = normalizeCurrencyCode(typeof raw === 'string' ? raw : (raw as { code?: unknown } | null)?.code ?? plan?.currency);
  if (!CODE_RE.test(code)) return null;
  const storeCurrency = namingOf(raw) ?? currencyNaming(code) ?? { code, name: code, label: code, digits: 2 };
  return { storeCurrency, businessPlan: plan, conversion: conversionOf(o.conversion) };
}

// ── The business page setting ──────────────────────────────────────────────

export interface StoreCurrencySetting {
  /** False: no WooCommerce on the site (the card hides). */
  hasStore: boolean;
  reachable: boolean;
  /** The live currency, or the saved one when the site did not answer. */
  currency: string | null;
  name: string | null;
  digits: number | null;
  /** Someone changed it in WordPress since WPMaven last saw it. */
  changedOutside: { from: string; to: string } | null;
  counts: { prices: number; fixedCoupons: number; shippingCosts: number } | null;
  canChange: boolean;
  /** Why Change is off (the API's sentence or code); null when it is on. */
  whyNot: string | null;
  /** Every offered currency except the current one. */
  options: StoreCurrencyOption[];
}

/** The setting, or null when the body is not one. */
export function storeCurrencySettingOf(v: unknown): StoreCurrencySetting | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (typeof s.hasStore !== 'boolean') return null;
  const currency = liveCurrencyCode(s.currency);
  const co = s.changedOutside as Record<string, unknown> | null | undefined;
  const coFrom = liveCurrencyCode(co?.from);
  const coTo = liveCurrencyCode(co?.to);
  const c = s.counts as Record<string, unknown> | null | undefined;
  const options = Array.isArray(s.options)
    ? s.options.map((x) => namingOf(x)).filter((o): o is StoreCurrencyOption => o !== null && o.code !== currency)
    : [];
  return {
    hasStore: s.hasStore,
    reachable: s.reachable !== false,
    currency: CODE_RE.test(currency) ? currency : null,
    name: str(s.name),
    digits: digitsOf(s.digits),
    changedOutside: CODE_RE.test(coFrom) && CODE_RE.test(coTo) ? { from: coFrom, to: coTo } : null,
    counts: c && typeof c === 'object'
      ? { prices: count(c.prices), fixedCoupons: count(c.fixedCoupons), shippingCosts: count(c.shippingCosts) }
      : null,
    canChange: s.canChange === true,
    whyNot: str(s.whyNot),
    options,
  };
}

export interface StoreCurrencyQuoteSide {
  code: string;
  name: string;
  digits: number;
}

export interface StoreCurrencyQuote {
  from: StoreCurrencyQuoteSide;
  to: StoreCurrencyQuoteSide;
  /** False: nothing in the store has a price, so only the currency changes. */
  hasPrices: boolean;
  rate: { value: number; text: string; date: string; dateText: string; fresh: boolean } | null;
  /** Up to 3 of the store's own prices, formatted. */
  examples: CurrencyExample[];
  convertAvailable: boolean;
  /** Why Convert is off (the API's sentence or code). */
  convertUnavailableReason: string | null;
  follows: { coupons: boolean; shippingCosts: boolean };
  /** Values neither choice touches (formula shipping costs). */
  notConvertible: Array<{ label: string; value: string }>;
  /** The product kinds that stop Convert, when the API names them. */
  otherProductTypes: string[];
  /** The currency whose rate is missing, when Convert is off for a rate; null otherwise. */
  rateUnavailableFor: { code: string; name: string } | null;
  /**
   * What happens to each plugin on the site with a currency of its own (a
   * booking calendar, room booking, online ordering...), in the owner's
   * words; [] when the site has none.
   */
  pluginNotes: string[];
  /** A note lists a plugin's prices the change would relabel: the change says they were shown (pluginPricesShown). */
  pluginPricesListed: boolean;
}

function sideOf(v: unknown): StoreCurrencyQuoteSide | null {
  const n = namingOf(v, true);
  return n ? { code: n.code, name: n.name, digits: n.digits } : null;
}

function exampleOf(v: unknown): CurrencyExample | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const label = str(o.label);
  const from = str(o.from);
  const keep = str(o.keep);
  if (!label || !from || !keep) return null;
  const kind = o.kind === 'coupon' || o.kind === 'shipping' || o.kind === 'price' ? o.kind : undefined;
  return { ...(kind ? { kind } : {}), label, from, keep, convert: str(o.convert), exact: str(o.exact) };
}

/** The quote, or null when the body is not one. */
export function storeCurrencyQuoteOf(v: unknown): StoreCurrencyQuote | null {
  if (!v || typeof v !== 'object') return null;
  const q = v as Record<string, unknown>;
  const from = sideOf(q.from);
  const to = sideOf(q.to);
  if (!from || !to || typeof q.hasPrices !== 'boolean') return null;
  const r = q.rate as Record<string, unknown> | null | undefined;
  const rate = r && typeof r === 'object' && typeof r.value === 'number' && Number.isFinite(r.value) && str(r.text)
    ? { value: r.value, text: str(r.text)!, date: str(r.date) ?? '', dateText: str(r.dateText) ?? '', fresh: r.fresh === true }
    : null;
  const f = q.follows as Record<string, unknown> | null | undefined;
  const notConvertible = Array.isArray(q.notConvertible)
    ? q.notConvertible
      .map((x) => {
        const o = x as Record<string, unknown> | null;
        const label = str(o?.label);
        return label ? { label, value: str(o?.value) ?? '' } : null;
      })
      .filter((x): x is { label: string; value: string } => x !== null)
    : [];
  const examples = Array.isArray(q.examples)
    ? q.examples.map(exampleOf).filter((x): x is CurrencyExample => x !== null).slice(0, 3)
    : [];
  const kindsRaw = q.otherProductTypes ?? q.other_product_types;
  return {
    from,
    to,
    hasPrices: q.hasPrices,
    rate,
    examples,
    // Convert needs a fresh rate; an answer that says otherwise is not believed.
    convertAvailable: q.convertAvailable === true && !!rate && rate.fresh,
    convertUnavailableReason: str(q.convertUnavailableReason),
    follows: { coupons: f?.coupons === true, shippingCosts: f?.shippingCosts === true },
    notConvertible,
    otherProductTypes: Array.isArray(kindsRaw) ? kindsRaw.map(str).filter((k): k is string => !!k) : [],
    rateUnavailableFor: (() => {
      const r = q.rateUnavailableFor as Record<string, unknown> | null | undefined;
      const code = liveCurrencyCode(r?.code);
      const name = str(r?.name);
      return CODE_RE.test(code) && name ? { code, name } : null;
    })(),
    pluginNotes: Array.isArray(q.pluginNotes) ? q.pluginNotes.map(str).filter((n): n is string => !!n).slice(0, 12) : [],
    pluginPricesListed: q.pluginPricesListed === true,
  };
}

export type StoreCurrencyMode = 'keep' | 'convert';

export interface StoreCurrencyChangeResult {
  currency: string;
  mode: StoreCurrencyMode | 'none';
  converted: { prices: number; coupons: number; shippingCosts: number };
  rate: { value: number; text: string; date: string } | null;
  notConverted: Array<{ label: string; value: string }>;
  /** What happened, in the owner's words (role=status). */
  message: string;
}

/** The change's answer, or null when the body is not one. */
export function storeCurrencyResultOf(v: unknown): StoreCurrencyChangeResult | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const currency = liveCurrencyCode(o.currency);
  const mode = o.mode === 'keep' || o.mode === 'convert' || o.mode === 'none' ? o.mode : null;
  if (!CODE_RE.test(currency) || !mode) return null;
  const c = o.converted as Record<string, unknown> | null | undefined;
  const r = o.rate as Record<string, unknown> | null | undefined;
  return {
    currency,
    mode,
    converted: { prices: count(c?.prices), coupons: count(c?.coupons), shippingCosts: count(c?.shippingCosts) },
    rate: r && typeof r === 'object' && typeof r.value === 'number' && str(r.text)
      ? { value: r.value, text: str(r.text)!, date: str(r.date) ?? '' }
      : null,
    notConverted: Array.isArray(o.notConverted)
      ? o.notConverted
        .map((x) => {
          const n = x as Record<string, unknown> | null;
          const label = str(n?.label);
          return label ? { label, value: str(n?.value) ?? '' } : null;
        })
        .filter((x): x is { label: string; value: string } => x !== null)
      : [],
    message: str(o.message) ?? '',
  };
}

export interface StoreCurrencyChangeRequest {
  currency: string;
  /** Omitted when the store holds no prices (the API answers MODE_REQUIRED if that changed meanwhile). */
  mode?: StoreCurrencyMode;
  /** The currency the owner saw; a different live one is refused (CURRENCY_CHANGED). */
  expectedFrom: string;
  /** The rate's date the owner saw (YYYY-MM-DD); required for Convert. */
  rateDate?: string;
  /** The dialog listed the prices the site's other plugins hold (quote.pluginPricesListed): Keep brings them along. */
  pluginPricesShown?: boolean;
}

/** What the onboarding's store currency step needs to know about the session. */
export interface StoreCurrencySession {
  getSessionId(): string | null;
  /** A draft's anonymous id; null for a site (never sent then). */
  getAnonId(): string | null;
}

/**
 * The store currency calls on a host's transport. `session` is the wizard's
 * (its onboarding api): the confirm step's choice is made on its session.
 */
export function createStoreCurrencyApi(hostTransport: WizardTransport, session?: StoreCurrencySession | null) {
  // The page's language on every call (734 A): the api answers the owner in it.
  const transport = inPageLanguage(hostTransport);
  return {
    list: () => loadStoreCurrencies(transport),

    /**
     * PUT /onboarding/store-currency/:sessionId: the setup confirm step's
     * choice. The plan on screen goes along (with the owner's edits), and the
     * answer's plan, converted at today's rate, replaces it.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async changeOnboarding(currency: string, businessPlan?: any | null, sessionId?: string): Promise<OnboardingStoreCurrencyChange> {
      const sid = sessionId || session?.getSessionId();
      if (!sid) throw new Error('no onboarding session');
      const anonId = session?.getAnonId() ?? null;
      const body = await transport.request({
        method: 'PUT',
        path: `/onboarding/store-currency/${enc(sid)}`,
        body: {
          currency,
          ...(anonId && !sessionId ? { anonId } : {}),
          ...(businessPlan ? { businessPlan } : {}),
        },
      });
      const out = onboardingChangeOf(dataOf(body));
      if (!out) throw new Error('store currency answer of the wrong shape');
      return out;
    },

    /** GET /instances/:instanceId/store-currency */
    async get(instanceId: string): Promise<StoreCurrencySetting | null> {
      const body = await transport.request({ method: 'GET', path: `/instances/${enc(instanceId)}/store-currency` });
      return storeCurrencySettingOf(dataOf(body));
    },

    /** GET /instances/:instanceId/store-currency/quote?to=XXX */
    async quote(instanceId: string, to: string): Promise<StoreCurrencyQuote | null> {
      const body = await transport.request({ method: 'GET', path: `/instances/${enc(instanceId)}/store-currency/quote`, query: { to } });
      return storeCurrencyQuoteOf(dataOf(body));
    },

    /**
     * PUT /instances/:instanceId/store-currency. It waits longer than the
     * API's worst case (STORE_CURRENCY_CHANGE_TIMEOUT_MS): a Convert of a large
     * store takes a while, and the site keeps going if the screen gives up.
     */
    async change(instanceId: string, req: StoreCurrencyChangeRequest): Promise<StoreCurrencyChangeResult | null> {
      const body = await transport.request({
        method: 'PUT',
        path: `/instances/${enc(instanceId)}/store-currency`,
        body: {
          currency: req.currency,
          ...(req.mode ? { mode: req.mode } : {}),
          expectedFrom: req.expectedFrom,
          ...(req.mode === 'convert' && req.rateDate ? { rateDate: req.rateDate } : {}),
          ...(req.pluginPricesShown ? { pluginPricesShown: true } : {}),
        },
        timeoutMs: STORE_CURRENCY_CHANGE_TIMEOUT_MS,
      });
      return storeCurrencyResultOf(dataOf(body));
    },
  };
}

/** The store currency calls for one host (createStoreCurrencyApi). */
export type StoreCurrencyApi = ReturnType<typeof createStoreCurrencyApi>;
