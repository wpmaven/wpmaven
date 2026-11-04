/**
 * What happened to a change to the site, in the words the chat's receipts
 * say (components/edits/chatReceipt.ts). Waiting for you says its own, the
 * shared screen's (@yotako/wpmaven-screens).
 */

/** What a yes or a no did to the change, by the decide answer's status. */
export const DECIDE_TEXT = {
  EXECUTED: 'Done. The change is on your site.',
  NEEDS_ACTIONS: "Approved. It waits for your plan's actions, and your team makes it by itself when they come back.",
  REJECTED: 'Declined. Nothing changes on your site.',
  PENDING: 'Your team prepared it again. It waits for your yes here.',
  FAILED: 'Approved, but the change did not go through.',
  /** Approved and still being made. */
  APPROVED: 'Approved. Your team makes the change now.',
} as const;

/** A held change canceled: the API's sentence (HELD_TEXT.cancelledChange), when its answer has none. */
export const CANCELLED_TEXT = 'Canceled. Your site did not change, and this change will not be made when your actions come back.';
