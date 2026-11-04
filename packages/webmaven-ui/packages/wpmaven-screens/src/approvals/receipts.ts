/**
 * What the owner is told, where they acted, after a decision (after
 * cancelling a held post, an owner found "nothing in the UI shows it was
 * canceled"; the "Canceled." notice sat at the top of Your team and was
 * missed). The sentence is said once, where the owner acted: in the spot the
 * card left when it moved away (a pending card goes under History), else on
 * the card itself (placeReceipt).
 *
 * The TikTok sentences are TikTok's own copy (decideNotice, TIKTOK_COPY),
 * word for word, so the audit's strings do not change.
 *
 * No runtime imports on purpose: the node unit tests load this file directly.
 */
import type { DecideResult, OperatorApproval, PublishedLink, SiteDecideResult } from './types';
import { TIKTOK_COPY, decideNotice, isPartialOutcome, tiktokPublishBadge, tiktokPublishMessage } from './tiktokPost';
import { type NextStep } from '@yotako/wpmaven-onboarding/shared';
import { HELD_REASK_NOTE, heldReasonLine, heldReasonStep, type HeldRow } from './heldReason';
import { heldPackChoiceOf, type HeldPackChoice } from './heldPack';

export type ReceiptTone = 'done' | 'waiting' | 'problem' | 'neutral';

export interface Receipt {
  /** The approval it is about. */
  id: string;
  message: string;
  tone: ReceiptTone;
  /**
   * The one thing to do next, drawn as the primary button beside the
   * sentence. A yes held for actions ("It waits for your actions to come
   * back") gets the way to more actions: without it the receipt was a dead
   * end: everything should be obvious and guided.
   */
  nextStep?: NextStep;
  /** Set on the receipt of a cancelled held post (cancelReceipt): the card leaves out its own canceled line while it shows. */
  cancelled?: true;
  /**
   * The TikTok sentence this receipt quotes from the decide answer, and the
   * state it described ("Sending to your TikTok inbox. It may take a few
   * minutes to arrive.", PROCESSING). The card keeps following TikTok after
   * the press; the receipt follows it too (followTikTok).
   */
  tiktok?: { state: string; message: string };
  /**
   * The public links of what the yes published ("View on YouTube"), from the
   * decide answer: https only, and set only when there is at least one.
   */
  links?: PublishedLink[];
  /**
   * A yes held because this month's actions are used up: the two choices,
   * buy the pack and it goes out now, or wait. Drawn
   * instead of `nextStep`, which stays the way to bigger plans at the pack
   * limit.
   */
  packChoice?: HeldPackChoice;
}

export const RECEIPT_COPY = {
  rejected: 'Rejected. Nothing was changed or published, and your team will not run it.',
  changesRequested: 'Sent to your team. The new version shows up here for your yes.',
  approvedRunning: 'Approved. Your team is on it.',
  approvedDone: 'Approved and done.',
  // Never a TikTok post: its receipt is TikTok's own (decideNotice), 24 hours.
  approvedHeld: `Approved. It waits for your actions to come back, then goes ahead by itself. ${HELD_REASK_NOTE}`,
  seeInHistory: 'See it in History',
} as const;

/**
 * The receipt for a yes or a no. A TikTok post (or a publish whose networks
 * partly refused) says what decideNotice says at the top of the inbox; every
 * other decision says what happened in plain words: the API's own summary
 * when it sent one ("Published to Facebook, Instagram."), else a sentence for
 * the status.
 */
/** The hold fields a decide answer can carry (pricing v4): why the yes waits. */
type HoldFields = Partial<Pick<HeldRow, 'heldReason' | 'holdReason' | 'holdUntil' | 'result'>>;

export function decisionReceipt(
  id: string,
  approved: boolean,
  res: (Pick<DecideResult, 'status' | 'summary' | 'partial' | 'error' | 'tiktok' | 'nextStep' | 'links' | 'packChoice'> & HoldFields) | null | undefined,
  ctx: { tiktokConsentSent?: boolean } = {},
): Receipt {
  if (!approved) return { id, message: RECEIPT_COPY.rejected, tone: 'neutral' };
  const sentence = decisionSentence(id, res, ctx);
  const links = httpsLinks(res?.links);
  const receipt = links.length ? { ...sentence, links } : sentence;
  // Held for actions: the button to more actions, the pack or Billing as
  // the API says (the held notice's own button). Held for the month's pages
  // or articles, or until day 8 (pricing v4, holdReason): the pack, or Start
  // my month now, when the API sent no button of its own.
  if (res?.status !== 'NEEDS_ACTIONS') return receipt;
  // This month's actions are used up: buy the pack and it goes out now, or wait.
  const packChoice = heldPackChoiceOf(res.packChoice);
  return { ...receipt, nextStep: heldReasonStep(res), ...(packChoice ? { packChoice } : {}) };
}

/** The words of a made change's address on a site's receipt. */
export const SITE_LIVE_LABEL = 'See it on your site';

/** What a held yes says to a site when the API sent no sentence (its SITE_HELD_TEXT). */
export const SITE_HELD_RECEIPT = "Approved. It waits for your plan's actions. See your dashboard.";

/**
 * The receipt for a yes or a no in a site's view (the plugin, 2026-10-16):
 * the API's own sentence for the site (its decisionForSite), never a pack, a
 * price or the next step to buy actions. A held yes offers Open billing in
 * the dashboard (the API's dashboardPath); a made change says where it
 * shows on the site.
 */
export function siteDecisionReceipt(id: string, approved: boolean, res: SiteDecideResult | null | undefined): Receipt {
  if (!approved) return { id, message: RECEIPT_COPY.rejected, tone: 'neutral' };
  const status = res?.status ?? '';
  const tone: ReceiptTone = status === 'FAILED' || res?.partial ? 'problem' : status === 'NEEDS_ACTIONS' ? 'waiting' : 'done';
  const summary = typeof res?.summary === 'string' ? res.summary.trim() : '';
  let message: string;
  if (status === 'FAILED') {
    const why = typeof res?.error === 'string' && res.error.trim() ? ` ${res.error.trim()}` : '';
    message = `Approved, but it did not go through.${why}`;
  } else if (status === 'NEEDS_ACTIONS') {
    message = (typeof res?.heldText === 'string' && res.heldText.trim()) || summary || SITE_HELD_RECEIPT;
  } else if (summary) {
    message = summary;
  } else {
    message = status === 'EXECUTED' ? RECEIPT_COPY.approvedDone : RECEIPT_COPY.approvedRunning;
  }
  const live = typeof res?.liveUrl === 'string' && res.liveUrl ? [{ network: 'site', url: res.liveUrl, label: SITE_LIVE_LABEL }] : [];
  const links = httpsLinks([...(Array.isArray(res?.links) ? res!.links : []), ...live]);
  const receipt: Receipt = { id, message, tone, ...(links.length ? { links } : {}) };
  if (status !== 'NEEDS_ACTIONS') return receipt;
  const href = typeof res?.dashboardPath === 'string' && res.dashboardPath.startsWith('/') ? res.dashboardPath : '/billing';
  return { ...receipt, nextStep: { label: 'Open billing', href, kind: 'billing', primary: true } };
}

/**
 * The links a receipt or a card may draw: well-formed, https only, each with
 * the API's label. Anything else sent is dropped.
 */
export function httpsLinks(links: unknown): PublishedLink[] {
  if (!Array.isArray(links)) return [];
  const out: PublishedLink[] = [];
  for (const l of links) {
    if (!l || typeof l !== 'object') continue;
    const { network, url, label } = l as Record<string, unknown>;
    if (typeof url !== 'string' || !/^https:\/\/\S+$/i.test(url.trim())) continue;
    if (typeof label !== 'string' || !label.trim()) continue;
    out.push({ network: typeof network === 'string' ? network : '', url: url.trim(), label: label.trim() });
  }
  return out;
}

/**
 * The card whose way to more actions is already on screen, on the receipt
 * where the owner pressed Approve (the spot the card left): that card, now
 * under History, does not draw it again. Null when the receipt carries no
 * step, or is not drawn in that spot (`inPlace` false: the card stayed where
 * it was, and its own button is the one).
 */
export function stepShownOnReceipt(receipt: Receipt | null | undefined, inPlace: boolean): string | null {
  return receipt && inPlace && receipt.nextStep ? receipt.id : null;
}

/** The sentence of an approval's receipt (decisionReceipt). */
function decisionSentence(
  id: string,
  res: (Pick<DecideResult, 'status' | 'summary' | 'partial' | 'error' | 'tiktok'> & HoldFields) | null | undefined,
  ctx: { tiktokConsentSent?: boolean },
): Receipt {
  const status = res?.status ?? '';
  const partial = isPartialOutcome(res);
  const tone: ReceiptTone = status === 'FAILED' || partial
    ? 'problem'
    : status === 'NEEDS_ACTIONS'
      ? 'waiting'
      : 'done';
  const notice = decideNotice(res, { approved: true, tiktokConsentSent: !!ctx.tiktokConsentSent });
  if (notice) {
    const tiktok = res?.tiktok?.message ? { state: String(res.tiktok.state ?? ''), message: res.tiktok.message } : null;
    return tiktok ? { id, message: notice, tone, tiktok } : { id, message: notice, tone };
  }
  const summary = typeof res?.summary === 'string' ? res.summary.trim() : '';
  if (status === 'FAILED') {
    const why = typeof res?.error === 'string' && res.error.trim() ? ` ${res.error.trim()}` : '';
    return { id, message: `Approved, but it did not go through.${why}`, tone };
  }
  if (summary) return { id, message: summary, tone };
  // Held for the month's pages or articles, or until day 8 (pricing v4):
  // that wait in words, never "waits for your actions".
  const heldLine = status === 'NEEDS_ACTIONS' && res ? heldReasonLine(res) : null;
  if (heldLine) return { id, message: heldLine, tone };
  if (status === 'NEEDS_ACTIONS') return { id, message: RECEIPT_COPY.approvedHeld, tone };
  if (status === 'EXECUTED') return { id, message: RECEIPT_COPY.approvedDone, tone };
  return { id, message: RECEIPT_COPY.approvedRunning, tone };
}

/** After "Request changes". */
export function changesReceipt(id: string): Receipt {
  return { id, message: RECEIPT_COPY.changesRequested, tone: 'neutral' };
}

/** After cancelling a held TikTok post: the API's sentence, else TikTok's copy. */
export function cancelReceipt(id: string, apiMessage?: string | null, fallback: string = TIKTOK_COPY.cancelledNotice): Receipt {
  const m = typeof apiMessage === 'string' && apiMessage.trim() ? apiMessage.trim() : fallback;
  return { id, message: m, tone: 'neutral', cancelled: true };
}

/**
 * A card's held line ("You approved this and it is not lost ...", or TikTok's
 * held paragraph) is left out while the receipt of that yes is on screen for
 * the card, in the spot it left or on the card itself: the receipt already
 * says it waits, with the day and the way to more actions. After a reload,
 * with no receipt, the card says it again.
 */
export function heldSaidOnReceipt(receipt: Receipt | null | undefined, id: string, onScreen: boolean): boolean {
  return !!receipt && onScreen && receipt.id === id && receipt.tone === 'waiting';
}

/**
 * Where the in-place receipt goes in a list the card has left: at the index
 * the card had, clamped to the list. -1 when the card is still in the list
 * (its own confirmation is enough) or had no place in it.
 */
export function receiptSlot(listIds: string[], receiptId: string, indexWhenActed: number): number {
  if (indexWhenActed < 0 || listIds.includes(receiptId)) return -1;
  return Math.min(indexWhenActed, listIds.length);
}

/**
 * The sentence an approval card's TikTok status line says ("Sent to TikTok.
 * It may take a few minutes to process and appear on your profile."), or null
 * when the card draws none. Same test as the card's own (TeamPage).
 */
export function cardStatusLine(approval: Pick<OperatorApproval, 'tiktokPublish'> | null | undefined): string | null {
  const p = approval?.tiktokPublish ?? null;
  return p && tiktokPublishBadge(p) ? tiktokPublishMessage(p) : null;
}

/**
 * The TikTok sentence a receipt quoted, as the card says it NOW.
 *
 * The receipt is written once, from the decide answer, while the card under
 * History follows TikTok (the inbox re-reads the list while a post is on its
 * way). After Send to TikTok drafts the card moved to "In your TikTok inbox"
 * within a minute, and the receipt in the spot the card left kept saying
 * "Sending to your TikTok inbox. It may take a few minutes to arrive." for as
 * long as the page stayed open (recording, 2026-09-24: 14 minutes). Null when
 * the receipt quotes no TikTok sentence, the card is not in the list, or the
 * card still says what the receipt says.
 */
export function tiktokSentenceNow(
  receipt: Receipt | null | undefined,
  approval: Pick<OperatorApproval, 'tiktokPublish'> | null | undefined,
): { from: string; to: string; state: string } | null {
  const quoted = receipt?.tiktok;
  const p = approval?.tiktokPublish ?? null;
  if (!quoted || !p) return null;
  const to = cardStatusLine(approval);
  if (!to || sameWords(to, quoted.message)) return null;
  return { from: quoted.message, to, state: p.state };
}

/**
 * The receipt with its TikTok sentence brought up to date (tiktokSentenceNow):
 * the card's own sentence, word for word, so the card and the receipt never
 * disagree and placeReceipt still says it once. A post TikTok refused turns
 * the receipt into a problem; one TikTok never confirmed is no longer "done".
 */
export function followTikTok(
  receipt: Receipt,
  approval: Pick<OperatorApproval, 'tiktokPublish'> | null | undefined,
): Receipt {
  const now = tiktokSentenceNow(receipt, approval);
  if (!now) return receipt;
  const message = receipt.message.includes(now.from) ? receipt.message.replace(now.from, now.to) : now.to;
  const tone: ReceiptTone = now.state === 'FAILED'
    ? 'problem'
    : now.state === 'UNCONFIRMED' && receipt.tone === 'done' ? 'neutral' : receipt.tone;
  return { ...receipt, message, tone, tiktok: { state: now.state, message: now.to } };
}

/** The notice at the top of the inbox, with the same TikTok sentence brought up to date. */
export function followTikTokNotice(
  notice: string | null,
  receipt: Receipt | null | undefined,
  approval: Pick<OperatorApproval, 'tiktokPublish'> | null | undefined,
): string | null {
  const now = notice ? tiktokSentenceNow(receipt, approval) : null;
  return notice && now && notice.includes(now.from) ? notice.replace(now.from, now.to) : notice;
}

/** The same sentence, whatever the spacing. */
function sameWords(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  return typeof a === 'string' && typeof b === 'string' && norm(a) !== '' && norm(a) === norm(b);
}

export interface ReceiptPlacement {
  /** Draw the notice at the top of the inbox. */
  notice: boolean;
  /** Draw the receipt in the spot the card left. */
  inPlace: boolean;
  /** The card that says the receipt as its own confirmation, or null. */
  onCard: string | null;
  /**
   * The card whose TikTok status line leaves out its sentence, because the
   * receipt in the spot the card left says the same words; the card keeps
   * its badge and links.
   */
  statusLineOnReceipt: string | null;
}

/**
 * Where the answer to a press is said: once, where the owner acted (review
 * 2026-09-24). The same sentence used to be drawn up to four times after one
 * decision on Your team > Approvals: the top notice, the receipt in the spot
 * the card left, the card's confirmation and, for a post sent to TikTok, the
 * card's own TikTok status line ("Sent to TikTok. It may take a few minutes
 * ..." four times; a held post's message three times).
 *
 * - The receipt goes in the spot the card left when it left one (`slot`, from
 *   receiptSlot). There it carries the sentence, the way to more actions and
 *   "See it in History"; the card under History draws neither a confirmation
 *   nor, when its TikTok status line would say the same words, that sentence.
 * - Otherwise the card says it where it is: as its confirmation, or through
 *   its TikTok status line when that already says the same words.
 * - The top notice only when neither is on screen, or when it says something
 *   the receipt does not.
 *
 * TikTok's sentences are not reworded: each is drawn once, as written.
 */
export function placeReceipt(opts: {
  notice: string | null;
  receipt: Receipt | null;
  /** receiptSlot's answer: the spot the card left, or -1. */
  slot: number;
  /** The acted-on card is in the list on screen (waiting or under History). */
  cardShown: boolean;
  /** That card's TikTok status line (cardStatusLine), if it draws one. */
  cardStatusLine?: string | null;
}): ReceiptPlacement {
  const r = opts.receipt;
  if (!r) return { notice: !!opts.notice, inPlace: false, onCard: null, statusLineOnReceipt: null };
  const inPlace = opts.slot >= 0;
  const lineSaysIt = opts.cardShown && sameWords(r.message, opts.cardStatusLine);
  const onCard = !inPlace && opts.cardShown && !lineSaysIt ? r.id : null;
  const statusLineOnReceipt = inPlace && lineSaysIt ? r.id : null;
  const receiptOnScreen = inPlace || opts.cardShown;
  const notice = !!opts.notice && !inPlace && !(receiptOnScreen && sameWords(opts.notice, r.message));
  return { notice, inPlace, onCard, statusLineOnReceipt };
}
