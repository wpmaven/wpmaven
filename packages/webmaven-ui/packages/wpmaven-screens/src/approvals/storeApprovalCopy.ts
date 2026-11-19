/**
 * Waiting for you, for online orders and the form messages
 * (storeApprovalViews.tsx): a reply to someone who wrote through the site's
 * forms, a change to an order the business received online (shipped, a new
 * status, a note), and a discount coupon to make, change or stop, each with
 * the link to where it lives. Order statuses are said in the usual words of
 * online shops in this language.
 *
 * English is the source; the French is written by hand (src/i18n/fr.json,
 * namespace screensStoreApprovals), the other languages by the dashboard's
 * translation script.
 */
import { localized } from '@yotako/webmaven-ui';
import { formatKept } from '../copyLanguage';

export const STORE_APPROVAL_COPY_EN = {
  /** The link under a reply to a form message: opens the message. */
  openMessage: 'Open the message',
  /** An order change's title; {0} the order's number ("1042"). */
  order: (order: string) => `Order ${order}`,
  /** The link under an order change: opens the order. */
  openOrder: 'Open the order',
  /** An order marked shipped ("Completed" is the order status online shops use). */
  markedShipped: 'Marked shipped: its status becomes Completed.',
  /** The parcel of a shipped order; {0} the carrier and tracking number ("UPS, 1Z999"). */
  parcel: (parcel: string) => `Parcel: ${parcel}`,
  /** A shipped order: the customer gets no email. */
  noEmail: 'The customer gets no email about it.',
  /** A shipped order: the customer gets an email. */
  email: 'The customer gets an email about it.',
  /** An order canceled: what happens to it. */
  cancelled: 'Cancelled: its items go back into stock, and nothing is refunded.',
  /** An order's new status; {0} the status, in lower case ("on hold"). */
  newStatus: (status: string) => `New status: ${status}.`,
  /** The order statuses, in lower case, inside "New status: ...". */
  statuses: {
    /** Waiting for payment. */
    pending: 'pending',
    /** Paid, being prepared. */
    processing: 'processing',
    /** Waiting for something before it goes on. */
    'on-hold': 'on hold',
    /** Done (shipped or delivered). */
    completed: 'completed',
    /** Refunded. */
    refunded: 'refunded',
    /** The payment failed. */
    failed: 'failed',
  },
  /** A note sent to the customer by email; {0} its words, as the team wrote them. */
  noteToCustomer: (text: string) => `A note emailed to the customer: "${text}"`,
  /** A note only the business sees. */
  privateNote: 'A private note on the order.',
  /** A coupon being stopped. */
  expires: 'Stops working from now. Orders that already used it keep their discount.',
  /** A coupon's discount; {0} the percentage ("15"). */
  percentOff: (amount: number) => `${amount}% off`,
  /** A coupon's discount; {0} the amount ("5.00"), in the business's currency. */
  offEachProduct: (amount: string) => `${amount} off each product`,
  /** A coupon's discount; {0} the amount ("10.00"), in the business's currency. */
  offOrder: (amount: string) => `${amount} off the order`,
  /** How often each customer may use the coupon; {0} the times (a count). */
  perCustomer: (n: number) => (n === 1 ? 'Each customer can use it once.' : `Each customer can use it ${n} times.`),
  /** How often the coupon may be used in all; {0} the times (a count). */
  usageLimit: (n: number) => `It can be used ${n} ${n === 1 ? 'time' : 'times'} in all.`,
  /** The smallest order the coupon needs; {0} the amount ("50.00"), in the business's currency. */
  minimumSpend: (amount: string) => `It needs an order of at least ${amount}.`,
  /** The coupon's last day; {0} the date ("31 December 2026"). */
  endsOn: (date: string) => `It ends on ${date}.`,
  /** The coupon gives free shipping. */
  freeShipping: 'It gives free shipping.',
  /** The coupon cannot be used with another one. */
  individualUse: 'It cannot be combined with other coupons.',
};

export const STORE_APPROVAL_COPY = localized(STORE_APPROVAL_COPY_EN, 'screensStoreApprovals');

/** An amount with two decimals in the page's language; English keeps the "1234.50" it always showed. */
export function twoDecimals(n: number): string {
  return formatKept(n, (v) => v.toFixed(2), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
