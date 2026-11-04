/**
 * The wizard's long AI steps as jobs on the API: the style step's design
 * directions and the store's products.
 *
 * The directions took 55 s in production while the dashboard's calls gave up
 * after 35 s, and the visitor read "We couldn't reach WPMaven" with the work
 * still running on the server. Now the start (`async: true`) answers at once
 * with where the work stands, and the wizard asks again (`poll: true`) every
 * AI_STEP_POLL_MS:
 *
 *   working  ask again, with no total limit: the server is on it
 *   ready    the step's answer, as the synchronous call gave it
 *   failed   the server says it stopped: AiStepFailedError, in plain words
 *   idle     no job there (the API restarted): started again, once
 *
 * Only a silence ends the wait on this side: no answer at all for
 * AI_STEP_SILENCE_MS (AiStepConnectionLostError, the connection dropped).
 * A start that got no answer may have reached the API, so the next ask is a
 * status read, never a second start; a second start would only join the
 * running job anyway, and pay nothing. An API from before the jobs ignores
 * the flags and answers the start when the work is done: that answer (no
 * state) is the result, as before, inside the start's long ceiling.
 *
 * Runtime imports: the shared error helpers, and the page's language
 * (webmaven-ui's localized; French in src/i18n).
 */
import { localized } from '@yotako/webmaven-ui';
import type { WizardTransport } from '../host/types';
import { noAnswer, userFacingError } from '../shared/errorMessage';
import { API_COPY } from './apiCopy';

/** How often the wizard asks how a working step stands. */
export const AI_STEP_POLL_MS = 3_000;
/** How long the wizard keeps asking while no answer comes back at all, before it says the connection dropped. */
export const AI_STEP_SILENCE_MS = 2 * 60_000;
/** The longest one start may take: an API from before the jobs does the whole step inside it (a new set of directions took up to 55 s). */
export const AI_STEP_START_TIMEOUT_MS = 150_000;
/** The longest one status read may take (the API answers it at once). */
export const AI_STEP_POLL_TIMEOUT_MS = 30_000;
/** Starts that got no answer before the wizard says the connection dropped (each may have reached the API). */
const MAX_UNANSWERED_STARTS = 3;

/** What a step says when it did not finish, in the visitor's words. */
export interface AiStepWords {
  /** The server says the work failed. */
  failed: string;
  /** The server stopped work that showed no sign of life for minutes. */
  stalled: string;
  /** The work was gone from the server twice (it restarted while working). */
  lost: string;
  /** No answer at all for AI_STEP_SILENCE_MS. */
  connectionLost: string;
}

export const DESIGN_DIRECTIONS_WORDS_EN: AiStepWords = {
  failed: 'We could not finish your design directions. Try again.',
  stalled: 'Your design directions took far too long, so we stopped. Try again.',
  lost: 'Your design directions stopped before they were done. Try again.',
  connectionLost: 'Your connection dropped before your design directions were ready. Check your connection, then try again.',
};

/** The design directions' words in the page's language, read when the step stops (French in src/i18n, namespace 'designDirectionsWords'). */
export const DESIGN_DIRECTIONS_WORDS: AiStepWords = localized(DESIGN_DIRECTIONS_WORDS_EN, 'designDirectionsWords');

export const PRODUCTS_WORDS_EN: AiStepWords = {
  failed: 'We could not get your products ready. Try again.',
  stalled: 'Your products took far too long, so we stopped. Try again.',
  lost: 'Your products stopped before they were ready. Try again.',
  connectionLost: 'Your connection dropped before your products were ready. Check your connection, then try again.',
};

/** The products' words in the page's language (French in src/i18n, namespace 'productsWords'). */
export const PRODUCTS_WORDS: AiStepWords = localized(PRODUCTS_WORDS_EN, 'productsWords');

/** The server said the step's work failed (data.state 'failed'), or lost it twice. Its message is written for the visitor. */
export class AiStepFailedError extends Error {
  /** The server's reason ('stalled', 'model_busy', 'error'...), or 'lost'. */
  readonly reason: string;
  readonly userFacing = true;
  constructor(reason: string, message: string) {
    super(message);
    this.name = 'AiStepFailedError';
    this.reason = reason;
  }
}

/** No answer came back at all for AI_STEP_SILENCE_MS: the connection dropped. Its message is written for the visitor. */
export class AiStepConnectionLostError extends Error {
  readonly userFacing = true;
  constructor(message: string) {
    super(message);
    this.name = 'AiStepConnectionLostError';
  }
}

/** The caller stopped waiting (the wizard went away): nothing to show. */
export class AiStepStoppedError extends Error {
  constructor() {
    super('Stopped waiting');
    this.name = 'AiStepStoppedError';
  }
}

export function isAiStepStopped(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AiStepStoppedError';
}

/** What a working step is on, as the server says it (a hint). */
export interface AiStepProgress {
  phase: string;
  done?: number;
  total?: number;
}

export interface AiStepOptions {
  /** Read after each wait, before the next ask: false ends the wait with AiStepStoppedError. */
  stillWanted?: () => boolean;
  /** Each progress hint a working answer carries (null when it has none). */
  onProgress?: (progress: AiStepProgress | null) => void;
}

/**
 * The body fields only the first ask carries: a reroll is asked for once.
 * The API counts a reroll when it receives one, so a later ask (a status
 * read, a start again) never carries it: it reads, joins or reuses the set
 * the first one made, and an API from before the jobs (which ignores the
 * flags) answers the set it has.
 */
const ASKED_ONCE = ['regenerate'] as const;

let sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
let now = (): number => Date.now();

/** Tests: a clock that does not wait (null restores the real one). */
export function setAiStepClockForTests(clock: { sleep?: (ms: number) => Promise<void>; now?: () => number } | null): void {
  sleep = clock?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  now = clock?.now ?? (() => Date.now());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = { success?: boolean; error?: unknown; data?: any } | null | undefined;

function progressOf(v: unknown): AiStepProgress | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as { phase?: unknown; done?: unknown; total?: unknown };
  if (typeof p.phase !== 'string' || !p.phase) return null;
  return {
    phase: p.phase,
    ...(typeof p.done === 'number' && Number.isFinite(p.done) ? { done: p.done } : {}),
    ...(typeof p.total === 'number' && Number.isFinite(p.total) ? { total: p.total } : {}),
  };
}

/** The API answered with its own error (5xx in its envelope): a status read asks again within the silence. */
function serverError(e: unknown): boolean {
  const status = (e as { response?: { status?: number } } | null)?.response?.status ?? 0;
  return status >= 500 && status < 600;
}

/**
 * Run one long AI step: start it (or join the job running for the session),
 * then ask how it stands until it is ready or the server says it failed.
 * Resolves with the step's data (as the synchronous call had it, a build
 * limit's card included); rejects with the transport's error for a refusal
 * (402, 403, 429...), AiStepFailedError, AiStepConnectionLostError or
 * AiStepStoppedError.
 */
export async function runAiStep<T>(
  transport: WizardTransport,
  path: string,
  body: Record<string, unknown>,
  words: AiStepWords,
  opts: AiStepOptions = {},
): Promise<T> {
  let mode: 'start' | 'poll' = 'start';
  let sendBody = body;
  const laterBody = Object.fromEntries(Object.entries(body).filter(([k]) => !(ASKED_ONCE as readonly string[]).includes(k)));
  // The API answered a start with a job (a later 'idle' means it lost it).
  let jobSeen = false;
  let restarted = false;
  let unansweredStarts = 0;
  let lastAnswerAt = now();
  // Between two asks: the wait, then whether the answer is still wanted.
  const pause = async () => {
    await sleep(AI_STEP_POLL_MS);
    if (opts.stillWanted && !opts.stillWanted()) throw new AiStepStoppedError();
  };
  for (;;) {
    const polling = mode === 'poll';
    let data: Body;
    try {
      data = await transport.request<Body>({
        method: 'POST',
        path,
        body: { ...sendBody, async: true, ...(polling ? { poll: true } : {}) },
        timeoutMs: polling ? AI_STEP_POLL_TIMEOUT_MS : AI_STEP_START_TIMEOUT_MS,
      });
    } catch (e) {
      sendBody = laterBody;
      const silent = noAnswer(e);
      // A refusal (402, 403, 429...) or a start the API itself failed: as before.
      if (!silent && !(polling && serverError(e))) throw e;
      if (!polling) unansweredStarts += 1;
      if (now() - lastAnswerAt >= AI_STEP_SILENCE_MS || unansweredStarts >= MAX_UNANSWERED_STARTS) {
        if (silent) throw new AiStepConnectionLostError(words.connectionLost);
        throw e;
      }
      // The start may have reached the API: ask how it stands, never start twice.
      mode = 'poll';
      await pause();
      continue;
    }
    lastAnswerAt = now();
    sendBody = laterBody;
    if (!data?.success) {
      throw userFacingError(typeof data?.error === 'string' && data.error.trim() ? data.error : API_COPY.somethingWrong);
    }
    const d = data.data;
    const state = d && typeof d === 'object' ? (d as { state?: unknown }).state : undefined;
    if (state === 'working') {
      jobSeen = true;
      opts.onProgress?.(progressOf((d as { job?: { progress?: unknown } }).job?.progress));
      mode = 'poll';
      await pause();
      continue;
    }
    if (state === 'failed') {
      const reason = typeof (d as { reason?: unknown }).reason === 'string' && (d as { reason: string }).reason ? (d as { reason: string }).reason : 'error';
      throw new AiStepFailedError(reason, reason === 'stalled' ? words.stalled : words.failed);
    }
    if (state === 'idle') {
      // A start is never answered idle: nothing to wait for.
      if (!polling) throw new AiStepFailedError('lost', words.lost);
      // No job there: the start never reached the API, or the API restarted
      // while it worked. Start again (once for a lost job), without a
      // reroll: it joins or reuses the set the API keeps.
      if (jobSeen) {
        if (restarted) throw new AiStepFailedError('lost', words.lost);
        restarted = true;
        jobSeen = false;
      }
      mode = 'start';
      continue;
    }
    // 'ready', or no state: an API from before the jobs, or a refusal card (build_limit).
    return d as T;
  }
}
