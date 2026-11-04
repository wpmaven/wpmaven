/**
 * The two refusals a visitor on the anonymous create flow can meet before the
 * team starts, told apart from any other failure so the screen can offer the
 * right way forward instead of "Request failed with status code 403".
 *
 *  - The bot check turned the request away (403 whose body is the API's
 *    human-verification sentence). The way forward is a fresh check.
 *  - Too many builds from one network within the hour (429 from the API's
 *    rate limiter, which sends `retryAfter` in seconds). The way forward is
 *    waiting, so the screen says until when.
 *
 * One runtime import: webmaven-ui's language helper (the sentences read in
 * the page's language, namespace 'requestProblem').
 */
import { localized } from '@yotako/webmaven-ui';

export const HUMAN_CHECK_MESSAGE =
  "We couldn't confirm you're a person. Check your connection or turn off blockers for this page, then try again.";

export const RATE_LIMITED_MESSAGE =
  'Lots of businesses are being built from your network right now. Try again in a few minutes.';

/** The sentences of this file, word for word (HUMAN_CHECK_MESSAGE and RATE_LIMITED_MESSAGE stay the English ones). */
export const REQUEST_PROBLEM_EN = {
  humanCheck: HUMAN_CHECK_MESSAGE,
  rateLimited: RATE_LIMITED_MESSAGE,
  inSeconds: (seconds: number) => `You can try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
  inMinutes: (minutes: number) => `You can try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
} as const;

/** Those sentences in the page's language. */
export const REQUEST_PROBLEM = localized(REQUEST_PROBLEM_EN, 'requestProblem');

/** When the API gives no usable wait, the visitor may try again after this. */
export const DEFAULT_RETRY_AFTER_SEC = 60;
/** The API's longest window is an hour; anything longer is not believed. */
const MAX_RETRY_AFTER_SEC = 60 * 60;

export type RequestProblem =
  | { kind: 'human_check' }
  | { kind: 'rate_limited'; retryAfterSec: number }
  | { kind: 'other' };

interface ErrorShape {
  response?: {
    status?: number;
    data?: { error?: unknown; message?: unknown; retryAfter?: unknown; code?: unknown };
    headers?: Record<string, unknown>;
  };
}

// The API's two human-check refusals (onboarding.routes.ts), by their codes
// since the api answers in the page's language (734 A); an older api says
// them only in English: "Human verification failed. Please complete the
// check and try again." on analyze, "Verification required. Please complete
// the human check on the first step." on the later steps. Any other 403
// ("Access denied") is not the bot check.
const HUMAN_CHECK_CODES = new Set(['HUMAN_VERIFICATION_FAILED', 'HUMAN_VERIFICATION_REQUIRED']);
const HUMAN_CHECK_RE = /human verification|verification required|human check/i;

function seconds(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_RETRY_AFTER_SEC, Math.ceil(n));
}

export function requestProblem(e: unknown): RequestProblem {
  const res = (e as ErrorShape | null | undefined)?.response;
  const status = res?.status ?? 0;
  if (status === 429) {
    const headers = res?.headers ?? {};
    const retryAfterSec =
      seconds(res?.data?.retryAfter) ??
      seconds(headers['retry-after'] ?? headers['Retry-After']) ??
      DEFAULT_RETRY_AFTER_SEC;
    return { kind: 'rate_limited', retryAfterSec };
  }
  if (status === 403) {
    if (typeof res?.data?.code === 'string' && HUMAN_CHECK_CODES.has(res.data.code)) return { kind: 'human_check' };
    const said = [res?.data?.error, res?.data?.message].find((v) => typeof v === 'string') as string | undefined;
    if (said && HUMAN_CHECK_RE.test(said)) return { kind: 'human_check' };
  }
  return { kind: 'other' };
}

/**
 * The line beside a disabled button while the wait runs, e.g. "You can try
 * again in 40 seconds." It must stay true for as long as it shows, so it is
 * recomputed as the clock moves and never rounds the wait down.
 */
export function readyAgainText(untilMs: number, nowMs: number): string | undefined {
  const left = Math.ceil((untilMs - nowMs) / 1000);
  if (left <= 0) return undefined;
  if (left < 60) return REQUEST_PROBLEM.inSeconds(left);
  const minutes = Math.ceil(left / 60);
  return REQUEST_PROBLEM.inMinutes(minutes);
}

/**
 * What the create screen shows after Analyze was refused: the sentence, and
 * which way forward applies (a fresh check, or a wait until a time). Anything
 * that is neither reads by status (errorMessage), never as transport text.
 */
export function refusalState(
  e: unknown,
  nowMs: number,
  fallback: string,
  wordByStatus: (e: unknown, fallback: string) => string,
): { message: string; humanCheckFailed: boolean; rateLimitedUntil: number | null } {
  const problem = requestProblem(e);
  if (problem.kind === 'human_check') return { message: REQUEST_PROBLEM.humanCheck, humanCheckFailed: true, rateLimitedUntil: null };
  if (problem.kind === 'rate_limited') {
    return { message: REQUEST_PROBLEM.rateLimited, humanCheckFailed: false, rateLimitedUntil: nowMs + problem.retryAfterSec * 1000 };
  }
  return { message: wordByStatus(e, fallback), humanCheckFailed: false, rateLimitedUntil: null };
}
