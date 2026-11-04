/**
 * Buy a pack and publish, or wait, for an item held because this month's
 * actions are used up (the API's held-pack choice).
 *
 * The API sends, on such a held row of GET /operators/approvals and on the
 * decide answer, `packChoice`:
 *   { kind: 'buy' | 'limit', text, buy: { units, cents, price, label, title } | null,
 *     wait: { label, title, until, text } }
 * `text` is the card's sentence ("This month's actions are used up, so this
 * is waiting. Buy 4 actions for $10 and it goes out now, or wait until
 * November 1, 2026, ..."). At this month's pack limit `buy` is null and the
 * card keeps the way to bigger plans.
 *
 * No runtime imports, so node tests load it directly.
 */

export interface HeldPackChoice {
  kind: 'buy' | 'limit';
  text: string;
  buy: { units: number; cents: number; price: string; label: string; title: string } | null;
  wait: { label: string; title: string; until: string | null; text: string };
}

const str = (v: unknown, max = 600): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/** The API's choice, checked field by field; null when it is missing or malformed. */
export function heldPackChoiceOf(raw: unknown): HeldPackChoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind === 'buy' || r.kind === 'limit' ? r.kind : null;
  const text = str(r.text, 1200);
  const w = r.wait && typeof r.wait === 'object' ? (r.wait as Record<string, unknown>) : null;
  const wait = w && str(w.label, 80) && str(w.text, 600)
    ? { label: str(w.label, 80)!, title: str(w.title, 40) ?? str(w.label, 40)!, until: str(w.until, 40), text: str(w.text, 600)! }
    : null;
  if (!kind || !text || !wait) return null;
  let buy: HeldPackChoice['buy'] = null;
  if (kind === 'buy') {
    const b = r.buy && typeof r.buy === 'object' ? (r.buy as Record<string, unknown>) : null;
    const units = whole(b?.units);
    const cents = whole(b?.cents);
    const label = str(b?.label, 80);
    const price = str(b?.price, 20);
    if (!b || units === null || cents === null || !label || !price) return null;
    buy = { units, cents, price, label, title: str(b.title, 40) ?? label };
  }
  return { kind, text, buy, wait };
}

/** A held row's choice: its own `packChoice`, else the one inside `heldReason`. Only while it is held. */
export function packChoiceOfRow(row: { status?: string; packChoice?: unknown; heldReason?: unknown } | null | undefined): HeldPackChoice | null {
  if (!row || row.status !== 'NEEDS_ACTIONS') return null;
  const nested = row.heldReason && typeof row.heldReason === 'object' ? (row.heldReason as { packChoice?: unknown }).packChoice : undefined;
  return heldPackChoiceOf(row.packChoice ?? nested);
}

/**
 * "Charge $10 to your card ending 4242?" as the dialog's title and "You get 4
 * actions and this goes out now." under it.
 */
export function splitQuestion(text: string): { title: string; detail: string } {
  const at = text.indexOf('? ');
  if (at < 0) return { title: text, detail: '' };
  return { title: text.slice(0, at + 1), detail: text.slice(at + 2).trim() };
}

/** Only an https page is opened (the secure payment page the API made). */
export function safePaymentUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * What a link to a held card asks for: open the buy question (the chat's and
 * the bell's "Buy 4 actions for $10 and publish": &buy=1), say it waits
 * (&wait=1), or say how the secure payment page ended (&pack=success or
 * canceled).
 */
export type HeldIntent = 'buy' | 'wait' | 'paid' | 'canceled' | null;

export function heldIntentFrom(params: { get(name: string): string | null } | null | undefined): HeldIntent {
  if (!params) return null;
  if (params.get('buy') === '1') return 'buy';
  if (params.get('wait') === '1') return 'wait';
  const pack = params.get('pack');
  if (pack === 'success') return 'paid';
  if (pack === 'canceled') return 'canceled';
  return null;
}

/** The figures the owner's yes to a one-tap pack is bound to (the API charges only these). */
export interface HeldPackExpect {
  units: number;
  cents: number;
  totalCents: number;
  last4: string;
}

/**
 * The answer of POST /operators/approvals/:id/held-pack: the question before
 * any charge ("Charge $10 to your card ending 4242? ..."), what happened after
 * the yes, or why there is nothing to buy. `text` is always the owner's words.
 */
export type HeldPackAnswer =
  | { kind: 'confirm'; text: string; confirmLabel: string; title: string; expect: HeldPackExpect; upgradeSentence: string | null }
  | { kind: 'checkout'; reason: string; url: string; text: string }
  | { kind: 'bought'; text: string; status: string; partial?: boolean; units: number; granted: number; totalCents: number }
  | { kind: 'changed'; text: string; quote: HeldPackAnswer }
  | { kind: 'in_progress' | 'not_held' | 'released' | 'unavailable' | 'failed' | 'not_found'; text: string; upgradeSentence?: string | null; status?: string };

export type HeldPackTone = 'done' | 'waiting' | 'problem' | 'neutral';

/** What the card shows next, from the API's answer. */
export type HeldPackStep =
  | { show: 'confirm'; title: string; detail: string; confirmLabel: string; expect: HeldPackExpect; notice: string | null }
  | { show: 'checkout'; text: string; url: string }
  | { show: 'note'; text: string; tone: HeldPackTone; reload: boolean };

/**
 * The next screen for an answer: the yes to give (a dialog naming the amount
 * and the card), the secure payment page to open, or a sentence on the card.
 * A changed price or card asks the new question, saying why.
 */
export function stepFor(answer: HeldPackAnswer | null | undefined, notice: string | null = null): HeldPackStep {
  if (!answer || typeof answer !== 'object' || typeof (answer as { kind?: unknown }).kind !== 'string') {
    return { show: 'note', text: HELD_PACK_COPY.failed, tone: 'problem', reload: true };
  }
  switch (answer.kind) {
    case 'confirm': {
      const { title, detail } = splitQuestion(answer.text);
      return {
        show: 'confirm',
        title,
        detail: [detail, answer.upgradeSentence].filter(Boolean).join(' '),
        confirmLabel: answer.confirmLabel,
        expect: answer.expect,
        notice,
      };
    }
    case 'checkout': {
      const url = safePaymentUrl(answer.url);
      return url
        ? { show: 'checkout', text: answer.text, url }
        : { show: 'note', text: HELD_PACK_COPY.failed, tone: 'problem', reload: false };
    }
    case 'changed':
      return answer.quote ? stepFor(answer.quote, answer.text) : { show: 'note', text: answer.text, tone: 'neutral', reload: true };
    case 'bought':
    case 'released': {
      const status = answer.status ?? '';
      const tone: HeldPackTone = status === 'FAILED' ? 'problem' : status === 'EXECUTED' && !(answer as { partial?: boolean }).partial ? 'done' : 'waiting';
      return { show: 'note', text: answer.text, tone, reload: true };
    }
    case 'in_progress':
      return { show: 'note', text: answer.text, tone: 'waiting', reload: true };
    case 'unavailable':
      return { show: 'note', text: [answer.text, answer.upgradeSentence].filter(Boolean).join(' '), tone: 'neutral', reload: false };
    case 'not_held':
      return { show: 'note', text: answer.text, tone: 'neutral', reload: true };
    default:
      return { show: 'note', text: answer.text || HELD_PACK_COPY.failed, tone: 'problem', reload: true };
  }
}

export const HELD_PACK_COPY = {
  checkoutTitle: 'Pay on the secure payment page',
  checkoutButton: 'Open the secure payment page',
  notNow: 'Not now',
  paidReturn: 'Payment received. It goes out as soon as the payment goes through.',
  canceledReturn: 'Nothing was charged. It still waits for actions.',
  failed: 'That did not go through, and nothing was charged. Reload and try again.',
} as const;
