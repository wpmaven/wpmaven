/**
 * Why an approved piece of work is waiting (status NEEDS_ACTIONS), and what
 * unlocks it (pricing v4 build spec, sections 2.2, 2.6.1 and 3.7).
 *
 *   actions           the month's actions are used: a pack or the reset
 *   long_form_limit   the month's pages or articles are used: a pack adds 1,
 *                     or the month resets
 *   publishes_day_8   written in the $1 first week: publishes when the plan
 *                     starts (day 8), or today with Start my month now
 *
 * The API sends, on each held row of GET /operators/approvals,
 * `heldReason: { reason, code, text, fix, nextStep }` (its own sentence and
 * button) and `nextStep`; the row's stored `result.holdReason` says the same
 * (also on a multi-network result's legs, `result.results[].holdReason`). A
 * bare `holdReason` string and a `holdUntil` date are read too. A row without
 * a reason is waiting for actions, as every held row did before v4.
 *
 * No runtime imports but the onboarding package's guidance and the kit's
 * language helper, so node tests load it directly.
 *
 * Its words are in the page's language (HELD_REASON_COPY; English is the
 * source, the French is written by hand in src/i18n/fr.json, namespace
 * screensHeldReason, the other languages by the dashboard's
 * translation script). The API's own sentences are already
 * in the page's language.
 */
import { localized } from '@yotako/webmaven-ui';
import { cardMoreActionsStep, sanitizeNextStep, type NextStep } from '@yotako/wpmaven-onboarding/shared';
import { formatTag } from '../copyLanguage';

/**
 * Why an approved piece of work waits, on its card and in Home's week, and
 * what unlocks it (namespace 'screensHeldReason'). "Actions" are the plan's
 * monthly allowance of work; an action pack buys more of them.
 */
export const HELD_REASON_COPY_EN = {
  /** Said wherever a held item promises to go out by itself: held longer than 72 hours, it is asked again instead. */
  reask: 'After 72 hours, we ask you again first.',
  /** The badge on a held card (short). */
  badge: {
    /** The month's actions are used. */
    actions: 'Paused, out of actions',
    /** The month's pages or articles are used. */
    long_form_limit: 'Paused, pages or articles used',
    /** A page written in the $1 first week: it publishes when the plan starts. */
    publishes_day_8: 'Publishes when your plan starts',
  },
  /** The badge of an item held because the last payment failed (never "out of actions"). */
  onPaymentBadge: 'Paused, waiting for your card',
  /** The badge of a first-week page still held after the plan started, while the month's payment is on its way. */
  onItsWayBadge: 'Publishes once your payment goes through',
  /**
   * A held page or article, the month's pages used; {0} the API's own
   * sentence about the limit, {1} the 72 hours line (reask).
   */
  longFormApi: (said: string, reask: string) => `You approved this and it is not lost. ${said} Your team makes it by itself as soon as there is room. ${reask}`,
  /** A held page or article, the month's pages used; {0} the 72 hours line (reask). */
  longForm: (reask: string) => `You approved this and it is not lost. Your pages or articles for this month are used, so it is waiting: your team makes it by itself as soon as there is room, when your month resets or right away with an action pack. ${reask}`,
  /** A page written in the first week; {0} the day it publishes ("November 22"). */
  firstWeekOn: (day: string) => `You approved this and it is ready. Pages and articles written in your first week publish on ${day}, when your plan starts. Start your month now to publish it today.`,
  /** The same when that day is not known: the plan's 8th day. */
  firstWeek: 'You approved this and it is ready. Pages and articles written in your first week publish on day 8, when your plan starts. Start your month now to publish it today.',
  /** The button that buys an action pack (on Billing). */
  buyPack: 'Buy an action pack',
  /** The button that starts the paid month now instead of on day 8 (on Billing). */
  startMonth: 'Start my month now',
};

export const HELD_REASON_COPY = localized(HELD_REASON_COPY_EN, 'screensHeldReason');

export type HoldReason = 'actions' | 'long_form_limit' | 'publishes_day_8';

const REASONS: ReadonlySet<string> = new Set<HoldReason>(['actions', 'long_form_limit', 'publishes_day_8']);

/** The fields of an approval row this reads; every one optional but the status. */
export interface HeldRow {
  status: string;
  heldReason?: unknown;
  holdReason?: unknown;
  holdUntil?: unknown;
  result?: unknown;
  nextStep?: unknown;
}

const reasonIn = (v: unknown): HoldReason | null => (typeof v === 'string' && REASONS.has(v) ? (v as HoldReason) : null);

/** The API's own view of the hold, when it sent one: its reason, code and sentence. */
function apiView(row: HeldRow): { reason: HoldReason | null; code: string | null; text: string | null } {
  const v = row.heldReason && typeof row.heldReason === 'object' ? (row.heldReason as { reason?: unknown; code?: unknown; text?: unknown }) : null;
  const text = typeof v?.text === 'string' && v.text.trim() ? v.text.trim() : null;
  const code = typeof v?.code === 'string' && v.code.trim() ? v.code.trim() : null;
  return { reason: reasonIn(v?.reason), code, text };
}

/**
 * The API's code for an out-of-actions hold on a failed payment (PAST_DUE):
 * nothing ran out, and the card, never the reset or a pack,
 * lets it go. Its card says the API's sentence and the card button.
 */
export const PAYMENT_FAILED_HOLD_CODE = 'PAYMENT_FAILED';

/** Held because the last payment failed (the API said so on the row). */
export function heldOnPayment(row: HeldRow | null | undefined): boolean {
  return !!row && row.status === 'NEEDS_ACTIONS' && apiView(row).code === PAYMENT_FAILED_HOLD_CODE;
}

/** Why a held row waits, or null when it is not held. */
export function holdReasonOf(row: HeldRow | null | undefined): HoldReason | null {
  if (!row || row.status !== 'NEEDS_ACTIONS') return null;
  const direct = apiView(row).reason ?? reasonIn(row.holdReason);
  if (direct) return direct;
  const r = row.result && typeof row.result === 'object' ? (row.result as { holdReason?: unknown; results?: unknown }) : null;
  const stored = reasonIn(r?.holdReason);
  if (stored) return stored;
  // A multi-network result: the reason of its legs.
  if (Array.isArray(r?.results)) {
    for (const leg of r!.results as unknown[]) {
      const v = leg && typeof leg === 'object' ? reasonIn((leg as { holdReason?: unknown }).holdReason) : null;
      if (v && v !== 'actions') return v;
    }
  }
  return 'actions';
}

/**
 * Held longer than 72 hours after the yes, an item is asked again instead of
 * going out (the API's HELD_POST_FRESHNESS_MS). Said wherever
 * a held item promises to go out by itself; not for TikTok, whose rule is 24
 * hours, in its own words.
 */
export const HELD_REASK_NOTE = HELD_REASON_COPY_EN.reask;

/** The badge on a held card, in the page's language when it is read. */
export const HELD_BADGE: Readonly<Record<HoldReason, string>> = {
  get actions() { return HELD_REASON_COPY.badge.actions; },
  get long_form_limit() { return HELD_REASON_COPY.badge.long_form_limit; },
  get publishes_day_8() { return HELD_REASON_COPY.badge.publishes_day_8; },
};

/** The badge of a row held on a failed payment: never "out of actions". In English, for importers (a card reads HELD_REASON_COPY.onPaymentBadge). */
export const HELD_ON_PAYMENT_BADGE = HELD_REASON_COPY_EN.onPaymentBadge;

/**
 * The API's code for a first-week page still held after day 8 while the
 * month's payment is on its way: the plan has started, so its badge says the
 * payment, never "when your plan starts".
 */
export const PUBLISHES_ON_PAYMENT_CODE = 'PUBLISHES_ON_PAYMENT';
/** In English, for importers (a card reads HELD_REASON_COPY.onItsWayBadge). */
export const HELD_ON_PAYMENT_ON_ITS_WAY_BADGE = HELD_REASON_COPY_EN.onItsWayBadge;

/** The badge for a row the allowance stopped: its reason's, else out of actions. */
export function heldReasonBadge(row: HeldRow): string {
  if (heldOnPayment(row)) return HELD_REASON_COPY.onPaymentBadge;
  if (row.status === 'NEEDS_ACTIONS' && apiView(row).code === PUBLISHES_ON_PAYMENT_CODE) return HELD_REASON_COPY.onItsWayBadge;
  return HELD_BADGE[holdReasonOf(row) ?? 'actions'];
}

/** The day a first-week page publishes, as the owner reads it, or null. */
function publishDay(row: HeldRow): string | null {
  const iso = typeof row.holdUntil === 'string' ? row.holdUntil : null;
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString(formatTag('en-US'), { month: 'long', day: 'numeric' });
}

/**
 * The sentence on a held card for a v4 reason, or null for a row waiting for
 * actions (the card keeps its own sentence for those). The API's own
 * sentence is used when it sent one: it names the plan that includes more
 * (never remove an upsell) and the day, in the owner's zone.
 */
export function heldReasonLine(row: HeldRow): string | null {
  const reason = holdReasonOf(row);
  const api = apiView(row);
  // Held on a failed payment: the API's own sentence (the card, not the
  // reset, lets it go), never the out-of-actions words.
  if (heldOnPayment(row) && api.text) return api.text;
  const c = HELD_REASON_COPY;
  if (reason === 'long_form_limit') {
    if (api.text && api.reason === 'long_form_limit') return c.longFormApi(api.text, c.reask);
    return c.longForm(c.reask);
  }
  if (reason === 'publishes_day_8') {
    if (api.text && api.reason === 'publishes_day_8') return api.text;
    const on = publishDay(row);
    return on ? c.firstWeekOn(on) : c.firstWeek;
  }
  return null;
}

/** The pack, where it adds a page or article (Billing names the section #packs); its label read when it is drawn. */
export const LONG_FORM_STEP: NextStep = {
  get label() { return HELD_REASON_COPY.buyPack; }, href: '/billing#packs', kind: 'long_form', primary: true,
};

/** Start my month now (dash-bridge's one-tap, on Billing); its label read when it is drawn. */
export const START_MONTH_STEP: NextStep = {
  get label() { return HELD_REASON_COPY.startMonth; }, href: '/billing#start-now', kind: 'start_now', primary: true,
};

/**
 * The button on a held card: the API's own step when it sent one, else the
 * one that unlocks this reason, else the way to more actions (the pack, or
 * Billing for an older row the allowance stopped).
 */
export function heldReasonStep(row: HeldRow): NextStep {
  const api = sanitizeNextStep(row.nextStep);
  if (api) return { ...api, primary: true };
  const reason = holdReasonOf(row);
  if (reason === 'long_form_limit') return LONG_FORM_STEP;
  if (reason === 'publishes_day_8') return START_MONTH_STEP;
  return cardMoreActionsStep(row);
}
