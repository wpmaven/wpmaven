/**
 * Waiting for you, for the store and the form messages (2026-10-08): a reply
 * shows its whole email, an order change what happens to the order, a coupon
 * the coupon itself. Each links the screen where the thing lives (in the
 * dashboard; the plugin's host sends those links there). Plain text only:
 * nothing here is rendered as HTML.
 */

import React from 'react';
import type { OperatorApproval } from './types';
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
  const lines: string[] = [];
  const shipped = p.shipped === true || (p.shipped && typeof p.shipped === 'object');
  if (shipped) {
    lines.push('Marked shipped: its status becomes Completed.');
    const s = typeof p.shipped === 'object' ? p.shipped : {};
    const parcel = [str(s.carrier), str(s.trackingNumber)].filter(Boolean).join(', ');
    if (parcel) lines.push(`Parcel: ${parcel}`);
    lines.push(p.emailCustomer === false ? 'The customer gets no email about it.' : 'The customer gets an email about it.');
  } else if (str(p.status)) {
    lines.push(p.status === 'cancelled' ? 'Cancelled: its items go back into stock, and nothing is refunded.' : `New status: ${str(p.status).replace('-', ' ')}.`);
  }
  if (p.note && typeof p.note === 'object' && str(p.note.text)) {
    lines.push(p.note.toCustomer === true ? `A note emailed to the customer: "${str(p.note.text)}"` : 'A private note on the order.');
  }
  const b = business(row);
  return { order, lines, href: b && /^\d+$/.test(order) ? `/store/orders/${order}?business=${b}` : null };
}

/** A coupon to make, change or stop: the code large, the discount and its limits in words. */
export function couponApprovalView(row: Row): { code: string; discount: string | null; lines: string[] } | null {
  if (row.toolName !== 'save_coupon') return null;
  const p = (row.params ?? {}) as Record<string, any>;
  const code = str(p.code).toUpperCase();
  if (p.action === 'expire') return { code, discount: null, lines: ['Stops working from now. Orders that already used it keep their discount.'] };
  const amount = Number(p.amount);
  const discount = Number.isFinite(amount) && amount > 0
    ? p.discountType === 'percent' ? `${amount}% off`
      : p.discountType === 'fixed_product' ? `${amount.toFixed(2)} off each product`
        : p.discountType === 'fixed_cart' ? `${amount.toFixed(2)} off the order` : null
    : null;
  const lines: string[] = [];
  const per = Number(p.usagePerCustomer);
  if (Number.isInteger(per) && per > 0) lines.push(per === 1 ? 'Each customer can use it once.' : `Each customer can use it ${per} times.`);
  const all = Number(p.usageLimit);
  if (Number.isInteger(all) && all > 0) lines.push(`It can be used ${all} ${all === 1 ? 'time' : 'times'} in all.`);
  if (typeof p.minimumSpend === 'number' && p.minimumSpend > 0) lines.push(`It needs an order of at least ${p.minimumSpend.toFixed(2)}.`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str(p.expires))) {
    const d = new Date(`${p.expires}T12:00:00Z`);
    lines.push(`It ends on ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}.`);
  }
  if (p.freeShipping === true) lines.push('It gives free shipping.');
  if (p.individualUse === true) lines.push('It cannot be combined with other coupons.');
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
        {reply.href && <HostLink to={reply.href} style={linkUnder}>Open the message</HostLink>}
      </div>
    );
  }
  const order = orderApprovalView(approval);
  if (order) {
    return (
      <div className={className} style={{ ...box, ...style }} data-testid="order-approval">
        <p style={strong}>{`Order ${order.order}`}</p>
        <Lines lines={order.lines} />
        {order.href && <HostLink to={order.href} style={linkUnder}>Open the order</HostLink>}
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
