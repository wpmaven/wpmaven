/**
 * Waiting for you, for the store and the form messages (2026-10-08): a reply
 * shows its whole email, an order change what happens to the order, a coupon
 * the coupon itself. Each links the screen where the thing lives (in the
 * dashboard; the plugin's host sends those links there). Plain text only:
 * nothing here is rendered as HTML. In the page's language
 * (storeApprovalCopy.ts; dates and amounts as the language writes them).
 */

import React from 'react';
import type { OperatorApproval } from './types';
import { STORE_APPROVAL_COPY, twoDecimals } from './storeApprovalCopy';
import { formatTag } from '../copyLanguage';
import { HostLink } from '../host/HostLink';
import { TYPE, bareList, recessed, small, textLink } from './styles';

type Row = Pick<OperatorApproval, 'params'> & Partial<Pick<OperatorApproval, 'toolName' | 'instanceId'>>;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const business = (row: Row) => (row.instanceId ? encodeURIComponent(row.instanceId) : null);

/** A reply to someone who wrote through the site's forms: its subject and whole text. */
export function replyApprovalView(row: Row): { subject: string; body: string; href: string | null } | null {
  if (row.toolName !== 'reply_to_message') return null;
  const p = (row.params ?? {}) as Record<string, unknown>;
  const id = Number(p.messageId);
  const b = business(row);
  return {
    subject: str(p.subject),
    body: str(p.message ?? p.body),
    href: b && Number.isInteger(id) && id > 0 ? `/messages?business=${b}&message=${id}` : null,
  };
}

/** An order change: the order, what happens to it, the parcel, the note. */
export function orderApprovalView(row: Row): { order: string; lines: string[]; href: string | null } | null {
  if (row.toolName !== 'update_order') return null;
  const p = (row.params ?? {}) as Record<string, any>;
  const order = str(String(p.order ?? '')).replace(/^#/, '');
  const c = STORE_APPROVAL_COPY;
  const lines: string[] = [];
  const shipped = p.shipped === true || (p.shipped && typeof p.shipped === 'object');
  if (shipped) {
    lines.push(c.markedShipped);
    const s = typeof p.shipped === 'object' ? p.shipped : {};
    const parcel = [str(s.carrier), str(s.trackingNumber)].filter(Boolean).join(', ');
    if (parcel) lines.push(c.parcel(parcel));
    lines.push(p.emailCustomer === false ? c.noEmail : c.email);
  } else if (str(p.status)) {
    lines.push(p.status === 'cancelled' ? c.cancelled : c.newStatus(statusWords(str(p.status))));
  }
  if (p.note && typeof p.note === 'object' && str(p.note.text)) {
    lines.push(p.note.toCustomer === true ? c.noteToCustomer(str(p.note.text)) : c.privateNote);
  }
  const b = business(row);
  return { order, lines, href: b && /^\d+$/.test(order) ? `/store/orders/${order}?business=${b}` : null };
}

/** An order status in words: the store's own word in the page's language, else the status as written ("on hold"). */
function statusWords(status: string): string {
  const known: Record<string, string> = STORE_APPROVAL_COPY.statuses;
  return Object.prototype.hasOwnProperty.call(known, status) ? known[status] : status.replace('-', ' ');
}

/** A coupon to make, change or stop: the code large, the discount and its limits in words. */
export function couponApprovalView(row: Row): { code: string; discount: string | null; lines: string[] } | null {
  if (row.toolName !== 'save_coupon') return null;
  const p = (row.params ?? {}) as Record<string, any>;
  const c = STORE_APPROVAL_COPY;
  const code = str(p.code).toUpperCase();
  if (p.action === 'expire') return { code, discount: null, lines: [c.expires] };
  const amount = Number(p.amount);
  const discount = Number.isFinite(amount) && amount > 0
    ? p.discountType === 'percent' ? c.percentOff(amount)
      : p.discountType === 'fixed_product' ? c.offEachProduct(twoDecimals(amount))
        : p.discountType === 'fixed_cart' ? c.offOrder(twoDecimals(amount)) : null
    : null;
  const lines: string[] = [];
  const per = Number(p.usagePerCustomer);
  if (Number.isInteger(per) && per > 0) lines.push(c.perCustomer(per));
  const all = Number(p.usageLimit);
  if (Number.isInteger(all) && all > 0) lines.push(c.usageLimit(all));
  if (typeof p.minimumSpend === 'number' && p.minimumSpend > 0) lines.push(c.minimumSpend(twoDecimals(p.minimumSpend)));
  if (/^\d{4}-\d{2}-\d{2}$/.test(str(p.expires))) {
    const d = new Date(`${p.expires}T12:00:00Z`);
    lines.push(c.endsOn(d.toLocaleDateString(formatTag('en-GB'), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })));
  }
  if (p.freeShipping === true) lines.push(c.freeShipping);
  if (p.individualUse === true) lines.push(c.individualUse);
  return { code, discount, lines };
}

const box: React.CSSProperties = { ...recessed, fontSize: TYPE.body, lineHeight: TYPE.bodyLeading, color: 'var(--text)' };
const strong: React.CSSProperties = { margin: 0, fontWeight: 550, color: 'var(--text)', overflowWrap: 'break-word' };
const linkUnder: React.CSSProperties = { ...small, ...textLink, display: 'inline-block', marginTop: 8 };
/** The order's or the coupon's lines, dimmer, close together. */
const Lines: React.FC<{ lines: string[] }> = ({ lines }) => (
  <ul style={{ ...bareList, marginTop: 4, color: 'var(--text-dim)' }}>
    {lines.map((l, i) => <li key={l} style={{ marginTop: i === 0 ? 0 : 2, overflowWrap: 'break-word' }}>{l}</li>)}
  </ul>
);

/** The view for one of these rows, or null for any other approval. Its links go through the host (the plugin's lead to the dashboard). */
export function StoreApprovalView({ approval, className, style }: { approval: Row; className?: string; style?: React.CSSProperties }): React.ReactElement | null {
  const reply = replyApprovalView(approval);
  if (reply) {
    return (
      <div className={className} style={{ ...box, ...style }} data-testid="reply-approval">
        {reply.subject && <p style={strong}>{reply.subject}</p>}
        <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', color: 'var(--text)' }} data-testid="reply-approval-body">{reply.body}</p>
        {reply.href && <HostLink to={reply.href} style={linkUnder}>{STORE_APPROVAL_COPY.openMessage}</HostLink>}
      </div>
    );
  }
  const order = orderApprovalView(approval);
  if (order) {
    return (
      <div className={className} style={{ ...box, ...style }} data-testid="order-approval">
        <p style={strong}>{STORE_APPROVAL_COPY.order(order.order)}</p>
        <Lines lines={order.lines} />
        {order.href && <HostLink to={order.href} style={linkUnder}>{STORE_APPROVAL_COPY.openOrder}</HostLink>}
      </div>
    );
  }
  const coupon = couponApprovalView(approval);
  if (coupon) {
    return (
      <div className={className} style={{ ...box, ...style }} data-testid="coupon-approval">
        <p style={{ margin: 0, fontSize: 'var(--text-lead, 17px)', lineHeight: 1.4, fontWeight: 650, letterSpacing: '0.025em', color: 'var(--text)', wordBreak: 'break-all' }}>{coupon.code}</p>
        {coupon.discount && <p style={{ margin: 0, color: 'var(--text)' }}>{coupon.discount}</p>}
        <Lines lines={coupon.lines} />
      </div>
    );
  }
  return null;
}
