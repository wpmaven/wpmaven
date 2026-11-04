/**
 * The words the Store's screens share: statuses, stock, printing and the
 * sentences an owner reads about printed products, prices and refunds.
 */

import { operatorTitle } from '../../../utils/team';
import { formatStoreMoney } from '../../../utils/storeMoney';
import { nameOr, siteBrand, type SiteBrand } from '../../../utils/brand';
import type { Decimal, StoreMoneyFormat } from '../../../types/store';

/** The statuses a product change can set. */
export const PRODUCT_STATUSES: Array<{ value: 'publish' | 'draft' | 'private'; label: string }> = [
  { value: 'publish', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'private', label: 'Private' },
];

export const PRODUCT_STATUS_LABEL: Record<string, string> = {
  publish: 'Published', draft: 'Draft', pending: 'Pending review', private: 'Private', future: 'Scheduled',
};

export const STOCK_LABEL: Record<string, string> = {
  instock: 'In stock', outofstock: 'Out of stock', onbackorder: 'On backorder',
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting for payment',
  processing: 'Processing',
  'on-hold': 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  failed: 'Failed',
  'checkout-draft': 'Draft',
};

/** The printing status of a WPMaven Payments order (the ledger's fulfillment). */
export const PRINTING_LABEL: Record<string, string> = {
  draft: 'Not sent to print',
  pending: 'Waiting to print',
  in_production: 'Being made',
  shipped: 'Shipped',
  failed: 'Print problem',
  on_hold: 'On hold',
  cancelled: 'Print cancelled',
};

export const CHANGED_ELSEWHERE_SENTENCE = 'This product changed after you opened it. Reload to see the latest version.';
export const PRINTING_SENTENCE = 'WPMaven prints and ships this product when someone buys it.';
export const PRINTED_OPTIONS_SENTENCE = 'These are the colors and sizes WPMaven prints. You can hide any of them.';
export const NEW_DESIGN_SENTENCE = 'WPMaven draws a new design for this product and makes new photos. It takes a few minutes and uses AI time. Your name, prices and descriptions stay as they are.';
/** Moving a product to the trash: what the owner reads before, in a confirm. */
export const TRASH_COPY = {
  button: 'Move to trash',
  title: 'Move this product to the trash?',
  keep: 'Keep it',
  printed: 'Orders already placed for it are still made and shipped.',
};

/** The confirm's message: the product, the undo, where a designed page still shows its card, and printed orders. */
export function trashMessage(name: string, warnings: string[], printed: boolean): string {
  return [
    `"${name}" comes off your store and its page. You can undo this right after.`,
    ...warnings,
    ...(printed ? [TRASH_COPY.printed] : []),
  ].join(' ');
}

export const PRINTED_PHOTO_SENTENCE = 'Printed products show the real printed item. Upload a photo of it, or choose New design.';
export const SAMPLE_SENTENCE = 'This is a sample listing. Add a real photo, check the price and stock, then mark it ready.';

/*
 * The sentences that say who prints and who draws, on a site under an
 * agency's or a partner's brand (utils/brand.ts): its name instead of ours,
 * and words that name nobody while the brand has no name. On a WPMaven site
 * they are the constants above and the same words as before.
 */
export function printingSentence(b: SiteBrand = siteBrand()): string {
  if (b.mode === 'wpmaven') return PRINTING_SENTENCE;
  return b.mode === 'brand'
    ? `${b.name} prints and ships this product when someone buys it.`
    : 'This product is printed and shipped when someone buys it.';
}

export function printedOptionsSentence(b: SiteBrand = siteBrand()): string {
  if (b.mode === 'wpmaven') return PRINTED_OPTIONS_SENTENCE;
  return b.mode === 'brand'
    ? `These are the colors and sizes ${b.name} prints. You can hide any of them.`
    : 'These are the colors and sizes that can be printed. You can hide any of them.';
}

export function newDesignSentence(b: SiteBrand = siteBrand()): string {
  if (b.mode === 'wpmaven') return NEW_DESIGN_SENTENCE;
  return `${nameOr('AI', b)} draws a new design for this product and makes new photos. It takes a few minutes and uses AI time. Your name, prices and descriptions stay as they are.`;
}

/** While a new design is being drawn. */
export function drawingSentence(b: SiteBrand = siteBrand()): string {
  return `${nameOr('AI', b)} is drawing the new design. This takes a few minutes.`;
}

/** The hint under "Create a photo with AI". */
export function aiPhotoHint(): string {
  return `Say what the photo should show. Your ${operatorTitle('web_designer')} makes it in your site's style and uses AI time.`;
}

/** Why a printed product has no stock to count. */
export function madeToOrderSentence(b: SiteBrand = siteBrand()): string {
  return b.mode === 'neutral'
    ? 'Each one is printed when it sells, so there is no stock to count.'
    : `${b.name} prints each one when it sells, so there is no stock to count.`;
}

/** Why an order with printed items that have not shipped cannot be set to Completed. */
export function printingNotShippedSentence(b: SiteBrand = siteBrand()): string {
  return b.mode === 'neutral'
    ? 'Part of this order is made to order. It turns Completed by itself when the printed items ship.'
    : `${b.name} prints part of this order. It turns Completed by itself when the printed items ship.`;
}

/** The Printing panel of an order whose printing has no status yet. */
export function printedItemsSentence(b: SiteBrand = siteBrand()): string {
  return b.mode === 'neutral'
    ? 'The printed items of this order are made to order.'
    : `${b.name} prints the printed items of this order.`;
}

/** "Lowest price: $17.00. At $20.00 you earn about $2.60 per sale." (the second part only when both are known). */
export function floorSentence(floor: Decimal, price: Decimal | null, earnings: Decimal | null, money: StoreMoneyFormat): string {
  const lowest = `Lowest price: ${formatStoreMoney(floor, money)}.`;
  if (!price || !earnings) return lowest;
  return `${lowest} At ${formatStoreMoney(price, money)} you earn about ${formatStoreMoney(earnings, money)} per sale.`;
}

/** Said before a WPMaven Payments refund: what Stripe keeps (`fee` already formatted, or null). */
export function refundFeeNote(fee: string | null): string {
  return fee ? `Stripe keeps its card fee of ${fee} when you refund.` : 'Stripe keeps its card fee when you refund.';
}
