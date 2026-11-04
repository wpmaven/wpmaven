/**
 * Turn an unknown thrown value into something an owner should read.
 *
 * The pattern this replaces was `e instanceof Error ? e.message : fallback`,
 * which looks defensive and is not: an axios rejection IS an Error, so the
 * fallback never ran and the customer got the transport string verbatim
 * ("Request failed with status code 503"). That is our plumbing, not their
 * problem, and it happened on the Facebook card in the Connect Center.
 *
 * Order of preference:
 *   1. A message the API deliberately sent us (`data.error` / `data.message`).
 *   2. A sentence written for the status code, or for no answer at all.
 *   3. The caller's fallback.
 * The raw Error.message is never shown, unless our own code wrote it for the
 * reader (userFacingError).
 *
 * Runtime imports: lib/productName, and webmaven-ui's language helper (the
 * sentences read in the page's language: namespaces 'errorStatus' and
 * 'errorWords').
 */
import { localized } from '@yotako/webmaven-ui';
import { productName } from './productName';

interface ApiErrorShape {
  response?: { status?: number; data?: { error?: unknown; message?: unknown; code?: unknown; field?: unknown } };
  isAxiosError?: boolean;
  code?: unknown;
  request?: unknown;
  userFacing?: boolean;
  message?: unknown;
}

/** Plain sentences for a status with no usable API message. Each one says
 *  what to do next. 404 and 409 keep the caller's fallback, which is written
 *  for that screen and says more than any generic line could. */
export const STATUS_SENTENCES_EN = {
  401: 'Your session has ended. Sign in again to continue.',
  403: "You don't have access to that. Sign in again, or ask the account owner.",
  413: 'That file is too large. Try a smaller one.',
  429: 'Too many requests at once. Wait a minute and try again.',
  5: 'Our side had a problem. Try again in a minute.',
  /** The brand's name on a branded address (lib/productName). */
  get network(): string {
    return ERROR_WORDS.networkFor(productName());
  },
} as const;

/** The status sentences in the page's language (namespace 'errorStatus'). */
export const STATUS_SENTENCES = localized(STATUS_SENTENCES_EN, 'errorStatus');

/**
 * An Error whose message was written for the person reading it (our own
 * services throw these with the API's sentence). errorMessage() shows it;
 * every other Error's message is plumbing and never shown.
 */
export function userFacingError(message: string): Error {
  return Object.assign(new Error(message), { userFacing: true });
}

const NETWORK_CODES = new Set(['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET']);

/**
 * No answer came back: the call timed out, the
 * connection dropped, or a gateway answered in the API's place (a 502, 503 or
 * 504 that is not the API's own JSON). The request may still be running on
 * the server, so its outcome is unknown, not failed. A screen follows it or
 * says so, and never tells someone whose payment went through, or whose post
 * is going out, to check their connection.
 */
export function noAnswer(e: unknown): boolean {
  const err = e as ApiErrorShape | null | undefined;
  if (!err || typeof err !== 'object') return false;
  const res = err.response;
  if (!res) {
    if (err.userFacing) return false;
    const code = typeof err.code === 'string' ? err.code : '';
    return NETWORK_CODES.has(code) || (!!err.isAxiosError && !!err.request);
  }
  const status = res.status ?? 0;
  if (status !== 502 && status !== 503 && status !== 504) return false;
  // The API always answers in its own envelope ({ success: false, error });
  // a gateway's page (HTML, or nothing) means the API never answered at all.
  const data = res.data as unknown;
  return !(data && typeof data === 'object' && 'success' in (data as Record<string, unknown>));
}

/**
 * Said when an approve or a reject got no answer (a publish to several
 * networks can outlast any wait): it may have gone through, so the list is
 * refreshed and the owner looks before pressing again.
 */
export const DECISION_OUTCOME_UNKNOWN =
  'We did not hear back in time, so we cannot tell yet whether that went through. We refreshed the list: check it before you press again.';

/** The other sentences of this file, word for word (the product's name filled in). */
export const ERROR_WORDS_EN = {
  networkFor: (name: string) => `We couldn't reach ${name}. Check your connection and try again.`,
  decisionUnknown: DECISION_OUTCOME_UNKNOWN,
} as const;

/** Those sentences in the page's language (namespace 'errorWords'). */
export const ERROR_WORDS = localized(ERROR_WORDS_EN, 'errorWords');

/** An approve or reject that failed: the unknown outcome when nothing answered, else errorMessage. */
export function decisionErrorMessage(e: unknown, fallback: string): string {
  return noAnswer(e) ? ERROR_WORDS.decisionUnknown : errorMessage(e, fallback);
}

/** The parts of an API refusal a screen may branch on. Never throws. */
export function apiErrorInfo(e: unknown): { status: number; code: string | null; field: string | null } {
  const res = (e as ApiErrorShape)?.response;
  return {
    status: res?.status ?? 0,
    code: typeof res?.data?.code === 'string' ? res.data.code : null,
    field: typeof res?.data?.field === 'string' ? res.data.field : null,
  };
}

export function errorMessage(e: unknown, fallback: string): string {
  const err = e as ApiErrorShape | null | undefined;
  const res = err?.response;
  const data = res?.data;
  const status = res?.status ?? 0;
  if (!res) {
    if (err?.userFacing && typeof err.message === 'string' && err.message.trim()) return err.message;
    // No answer at all: the request never reached us or timed out.
    const code = typeof err?.code === 'string' ? err.code : '';
    if (NETWORK_CODES.has(code) || (err?.isAxiosError && err?.request)) return STATUS_SENTENCES.network;
    return fallback;
  }
  const fromApi = typeof data?.error === 'string' ? data.error
    : typeof data?.message === 'string' ? data.message
      : null;
  // TikTok refusals (400 and 409 with a TIKTOK_* code) are written for the
  // owner and some carry the link to the Post to TikTok screen, which runs
  // past the length cap below. TikTok's guidelines want the owner to read
  // exactly why a post did not go ("Please try again later."), so they are
  // shown whole.
  const tiktokCode = typeof data?.code === 'string' && data.code.startsWith('TIKTOK_');
  if (tiktokCode && status >= 400 && status < 500 && fromApi && fromApi.trim()) return fromApi;
  // A 4xx body usually explains a business rule the owner needs ("that
  // channel is already connected"). A 5xx body is the server having a bad
  // day and its phrasing is for us, not them ("Service unavailable"), so
  // ours wins there. A 429 that explains itself ("That is a lot of business
  // changes in one hour. Try again in 12 minutes.") is kept; the generic
  // limiter's bare "Rate limit exceeded" is plumbing and gets our sentence.
  const apiSpeaksToTheUser = status >= 400 && status < 500;
  const limiterPlumbing = status === 429 && !!fromApi && /^rate limit exceeded\.?$/i.test(fromApi.trim());
  if (apiSpeaksToTheUser && !limiterPlumbing && fromApi && /\s/.test(fromApi) && fromApi.length <= 200) return fromApi;

  switch (status) {
    case 401: return STATUS_SENTENCES[401];
    case 403: return STATUS_SENTENCES[403];
    case 404: return fallback;
    case 409: return fallback;
    case 413: return STATUS_SENTENCES[413];
    case 429: return STATUS_SENTENCES[429];
    default: return status >= 500 && status < 600 ? STATUS_SENTENCES[5] : fallback;
  }
}

export default errorMessage;
