/**
 * Items held for actions.
 *
 * An item the owner approved while their actions were used up waits
 * (NEEDS_ACTIONS) and goes out by itself when actions come back, but only
 * within 72 hours of the yes (the API's HELD_POST_FRESHNESS_MS): held longer,
 * it goes back to the approvals as a fresh ask instead of out, with the day
 * it was held since (result.staleHoldSince). TikTok keeps its own, shorter
 * rule (24 hours) and its own words.
 *
 * Every held item can be canceled until it goes out, by the owner only
 * (POST /operators/approvals/:id/cancel-held; staff viewing as the owner are
 * refused, HELD_OWNER_ONLY). A TikTok post keeps the words of the audited
 * Post to TikTok flow (TIKTOK_COPY); a change to the site speaks of the
 * change, never of a post; any other item says these.
 */
import { TIKTOK_COPY, cancelHeldDetail } from './tiktokPost';
import type { OperatorApproval } from './types';
import { HELD_REASK_NOTE, heldReasonLine, type HeldRow } from './heldReason';
import { packChoiceOfRow } from './heldPack';

export { HELD_REASK_NOTE };

/** Any held item, whatever it goes to. */
export function canCancelHeld(approval: Pick<OperatorApproval, 'status'>): boolean {
  return approval.status === 'NEEDS_ACTIONS';
}

export const HELD_CANCEL_COPY = {
  button: 'Cancel this post',
  title: 'Cancel this post?',
  detail: 'It will not be published.',
  // The same confirm as TikTok's.
  confirm: TIKTOK_COPY.cancelHeldConfirm,
  keep: TIKTOK_COPY.cancelHeldKeep,
  cancelledLine: 'You canceled this before it went out. Nothing was posted.',
  cancelledNotice: 'Canceled. Nothing was posted, and it will not go out when your actions come back.',
  staffRefusal: 'Only the account owner can cancel this.',
} as const;

/**
 * A change to the site is made, not posted: a page, a product or a new
 * design waits for actions the same way (every change asks, 2026-09-22), and
 * "Nothing was posted" would send the owner looking for a post.
 */
export const HELD_SITE_CHANGE_CANCEL_COPY = {
  button: 'Cancel this change',
  title: 'Cancel this change?',
  detail: 'Your site stays as it is, and the change is not made when your actions come back.',
  confirm: 'Cancel the change',
  keep: TIKTOK_COPY.cancelHeldKeep,
  cancelledLine: 'You canceled this before it was made. Your site did not change.',
  // The API's own answer to the cancel of a change to the site (HELD_TEXT.cancelledChange).
  cancelledNotice: 'Canceled. Your site did not change, and this change will not be made when your actions come back.',
  staffRefusal: HELD_CANCEL_COPY.staffRefusal,
} as const;

export interface HeldCancelWords {
  button: string;
  title: string;
  detail: string;
  confirm: string;
  keep: string;
  cancelledLine: string;
  cancelledNotice: string;
  staffRefusal: string;
  testId: string;
}

/**
 * The cancel's words for this item: TikTok's own for a TikTok post (naming
 * the other networks), the change's for a change to the site (the API's
 * changesSite), these for any other.
 */
export function heldCancelWords(goesToTikTok: boolean, otherNetworkLabels: string[] = [], changesSite = false): HeldCancelWords {
  if (goesToTikTok) {
    return {
      button: TIKTOK_COPY.cancelHeldButton,
      title: TIKTOK_COPY.cancelHeldTitle,
      detail: cancelHeldDetail(otherNetworkLabels),
      confirm: TIKTOK_COPY.cancelHeldConfirm,
      keep: TIKTOK_COPY.cancelHeldKeep,
      cancelledLine: TIKTOK_COPY.cancelledLine,
      cancelledNotice: TIKTOK_COPY.cancelledNotice,
      staffRefusal: TIKTOK_COPY.staffRefusal,
      testId: 'tt-cancel-held',
    };
  }
  return { ...(changesSite ? HELD_SITE_CHANGE_CANCEL_COPY : HELD_CANCEL_COPY), testId: 'cancel-held' };
}

/**
 * The sentence on a held card, and on a Co-CEO receipt of a held change:
 * the buy-or-wait choice's own sentence when the API sent one, the reason's
 * (pricing v4, a failed payment), TikTok's paragraph, or what happens by
 * itself when actions come back. A change to the site is made, not
 * published. Only a page, post, product, form or translation costs an
 * action (2026-09-22, deliverables only), so a held site change is one of
 * those, never a plugin or a setting, and "publishes" would still be wrong
 * for a draft page.
 */
export function heldLine(row: HeldRow & { packChoice?: unknown; changesSite?: boolean }, goesToTikTok = false): string {
  const choice = packChoiceOfRow(row);
  if (choice) return choice.text;
  const reason = heldReasonLine(row);
  if (reason) return reason;
  if (goesToTikTok) return TIKTOK_COPY.heldTikTok;
  return row.changesSite
    ? `You approved this and it is not lost. Your action allowance is used up, so it is waiting: your team makes this change by itself as soon as actions come back. ${HELD_REASK_NOTE}`
    : `You approved this and it is not lost. Your action allowance is used up, so it is waiting: it publishes by itself as soon as actions come back. ${HELD_REASK_NOTE}`;
}

/**
 * "Held since October 1: we asked you again before posting." for an item the
 * API asked again after 72 hours (back to PENDING with result.staleHoldSince),
 * "... before making this change." for a change to the site, or null.
 */
export function staleHoldLine(
  approval: Pick<OperatorApproval, 'status' | 'result'> & Partial<Pick<OperatorApproval, 'changesSite'>>,
): string | null {
  if (approval.status !== 'PENDING') return null;
  const r = approval.result && typeof approval.result === 'object' ? (approval.result as { staleHoldSince?: unknown }) : null;
  const iso = typeof r?.staleHoldSince === 'string' ? r.staleHoldSince : null;
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  // In UTC, as the API's own ask says it (heldSinceText): the card and the
  // bell, email or WhatsApp message name the same day.
  const day = new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  return `Held since ${day}: we asked you again before ${approval.changesSite ? 'making this change' : 'posting'}.`;
}
