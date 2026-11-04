/**
 * WooCommerce's order answers (wc/v3/orders, its notes and refunds) as the
 * Store's shapes. The plugin adds a `wpmaven` field: WPMaven Payments,
 * printed lines, tracking and the statuses the owner may set (an order with
 * printed lines completes by its shipping; an unpaid WPMaven Payments order
 * turns paid only through its payment). Money stays in the order's own
 * currency, with the store's decimals.
 */

import { decodeSymbol, fromMinorUnits, toDecimal, toMinorUnits } from '../../../../utils/storeMoney';
import type {
  Decimal, StoreAddress, StoreMoneyFormat, StoreOrderDetail, StoreOrderItem, StoreOrderRow, WpmavenOrderInfo,
} from '../../../../types/store';
import { plainText } from '../shared/media';

/** What the list asks for (wc/v3/orders _fields). */
export const ORDER_LIST_FIELDS = [
  'id', 'number', 'status', 'currency', 'date_created_gmt', 'total', 'line_items', 'billing', 'payment_method',
  'payment_method_title', 'date_paid_gmt', 'wpmaven',
].join(',');

/** The statuses the Store may offer (never refunded, a draft or the trash). */
export const SETTABLE_STATUSES = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'failed'];

export const WPMAVEN_PAYMENTS_GATEWAY = 'webmaven_payments';

/** An order line, with how many of its items a refund can put back in stock. */
export interface AppOrderItem extends StoreOrderItem {
  /** Items of this line that left the stock (WooCommerce's _reduced_stock, lowered by each restock). */
  reducedStock: number;
  /** What a refund of the whole amount left puts back: the items not refunded yet that left the stock. */
  restockQty: number;
}

export interface AppOrderDetail extends StoreOrderDetail {
  items: AppOrderItem[];
  /** WooCommerce recorded the payment. */
  paid: boolean;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? plainText(String(v)) : '');
const bare = (status: unknown): string => (typeof status === 'string' ? status.replace(/^wc-/, '') : '');

/** The symbol of an order's currency: the store's own, else the browser's name for it, else its code. */
export function currencySymbolFor(code: string, money: StoreMoneyFormat): string {
  const upper = (code || '').toUpperCase();
  if (!upper || upper === money.code.toUpperCase()) return decodeSymbol(money.symbol);
  try {
    const part = new Intl.NumberFormat('en', { style: 'currency', currency: upper, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find((p) => p.type === 'currency');
    if (part?.value) return part.value;
  } catch {
    // A code the browser does not know: shown as the code.
  }
  return upper;
}

function fallbackStatuses(status: string, paymentsWpmaven: boolean, paid: boolean): string[] {
  return SETTABLE_STATUSES.filter((s) => s !== status && !(paymentsWpmaven && !paid && (s === 'processing' || s === 'completed')));
}

export function orderInfoFrom(raw: unknown, order: Record<string, any>): WpmavenOrderInfo {
  const status = bare(order.status);
  const needsAction = status === 'processing' || status === 'on-hold';
  if (!isObj(raw)) {
    const payments = order.payment_method === WPMAVEN_PAYMENTS_GATEWAY;
    return { paymentsWpmaven: payments, printed: false, tracking: null, allowedStatuses: fallbackStatuses(status, payments, !!order.date_paid_gmt), needsAction };
  }
  const t = isObj(raw.tracking) ? raw.tracking : null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    paymentsWpmaven: raw.paymentsWpmaven === true,
    printed: raw.printed === true,
    tracking: t ? { url: str(t.url), number: str(t.number), carrier: str(t.carrier) } : null,
    allowedStatuses: Array.isArray(raw.allowedStatuses) ? raw.allowedStatuses.filter((s: unknown): s is string => typeof s === 'string') : [],
    needsAction: typeof raw.needsAction === 'boolean' ? raw.needsAction : needsAction,
    ...(Array.isArray(raw.shipments) && raw.shipments.length ? {
      shipments: raw.shipments.filter(isObj).map((x: Record<string, any>) => ({
        carrier: str(x.carrier) ?? '',
        number: str(x.number) ?? '',
        url: typeof x.url === 'string' && /^https?:\/\//i.test(x.url) ? x.url : '',
        at: typeof x.at === 'string' ? x.at : '',
      })),
    } : {}),
  };
}

/**
 * The statuses the menu offers: the plugin's list, never the current one or
 * one the Store does not set, and never Completed while printed items have
 * not shipped.
 */
export function allowedStatusesFor(order: Pick<StoreOrderRow, 'status' | 'wpmaven'>): string[] {
  const w = order.wpmaven;
  return w.allowedStatuses.filter((s) => SETTABLE_STATUSES.includes(s) && s !== order.status && !(s === 'completed' && w.printed && !w.tracking));
}

function customerName(billing: unknown): string {
  if (!isObj(billing)) return 'Guest';
  const name = [billing.first_name, billing.last_name].map(text).filter(Boolean).join(' ').trim();
  return name || text(billing.company) || 'Guest';
}

export function orderRowFrom(raw: Record<string, any>, money: StoreMoneyFormat): StoreOrderRow {
  const currency = typeof raw.currency === 'string' && raw.currency ? raw.currency : money.code;
  const lines = Array.isArray(raw.line_items) ? raw.line_items : [];
  return {
    id: Number(raw.id),
    number: String(raw.number || raw.id),
    status: bare(raw.status),
    createdAt: typeof raw.date_created_gmt === 'string' ? raw.date_created_gmt : '',
    currency,
    currencySymbol: typeof raw.currency_symbol === 'string' && raw.currency_symbol ? decodeSymbol(raw.currency_symbol) : currencySymbolFor(currency, money),
    total: toDecimal(raw.total ?? null, money.decimals) ?? fromMinorUnits(0, money.decimals),
    itemCount: lines.reduce((n: number, li: any) => n + (Number(li?.quantity) || 0), 0),
    customerName: customerName(raw.billing),
    paymentMethodTitle: text(raw.payment_method_title),
    wpmaven: orderInfoFrom(raw.wpmaven, raw),
  };
}

export function addressFrom(a: unknown): StoreAddress | null {
  if (!isObj(a)) return null;
  const name = [a.first_name, a.last_name].map(text).filter(Boolean).join(' ');
  const city = [text(a.postcode), text(a.city)].filter(Boolean).join(' ');
  const lines = [text(a.address_1), text(a.address_2), [city, text(a.state)].filter(Boolean).join(', ')].filter(Boolean);
  if (!name && !text(a.company) && !lines.length) return null;
  return { name, company: text(a.company), lines, country: text(a.country) };
}

/** How many items of each line earlier refunds took back (refund lines name theirs in _refunded_item_id). */
function refundedQuantities(refunds: Array<Record<string, any>> | null): Record<number, number> {
  const out: Record<number, number> = {};
  for (const r of refunds ?? []) {
    for (const li of isObj(r) && Array.isArray(r.line_items) ? r.line_items : []) {
      const meta = isObj(li) && Array.isArray(li.meta_data) ? li.meta_data : [];
      const ref = meta.find((m: any) => isObj(m) && m.key === '_refunded_item_id');
      const id = ref ? Number(ref.value) : 0;
      if (id > 0) out[id] = (out[id] ?? 0) + Math.abs(Number(li.quantity) || 0);
    }
  }
  return out;
}

function itemFrom(li: Record<string, any>, money: StoreMoneyFormat, refunded: Record<number, number>): AppOrderItem {
  const name = text(li.name);
  const inName = name.includes(' - ') ? name.split(' - ').slice(1).join(' - ').split(', ') : [];
  const meta = Array.isArray(li.meta_data) ? li.meta_data.filter(isObj) : [];
  const reduced = meta.find((m) => m.key === '_reduced_stock');
  const reducedStock = reduced ? Math.max(0, Math.trunc(Number(reduced.value) || 0)) : 0;
  const quantity = Number(li.quantity) || 0;
  const restockQty = Math.max(0, Math.min(reducedStock, quantity - (refunded[Number(li.id)] ?? 0)));
  const options = meta
    .filter((m) => typeof m.key === 'string' && !m.key.startsWith('_'))
    .map((m) => ({ label: text(m.display_key || m.key), value: text(m.display_value ?? m.value) }))
    .filter((o) => o.label && o.value && !inName.includes(o.value));
  return {
    id: Number(li.id),
    productId: Number(li.product_id) || 0,
    variationId: Number(li.variation_id) > 0 ? Number(li.variation_id) : null,
    name,
    quantity,
    total: toDecimal(li.total ?? null, money.decimals) ?? fromMinorUnits(0, money.decimals),
    options,
    imageUrl: isObj(li.image) && typeof li.image.src === 'string' && li.image.src ? li.image.src : null,
    printed: false,
    restockable: restockQty > 0,
    reducedStock,
    restockQty,
  };
}

const minor = (amount: Decimal | string | number | null | undefined, decimals: number) => toMinorUnits(amount ?? null, decimals) ?? 0;

export function orderDetailFrom(
  raw: Record<string, any>,
  notes: Array<Record<string, any>> | null,
  refunds: Array<Record<string, any>> | null,
  money: StoreMoneyFormat,
  adminUrl: string,
): AppOrderDetail {
  const d = money.decimals;
  const row = orderRowFrom(raw, money);
  const refundedQty = refundedQuantities(refunds);
  const items = (Array.isArray(raw.line_items) ? raw.line_items : []).filter(isObj).map((li) => itemFrom(li, money, refundedQty));
  const refundList = Array.isArray(refunds)
    ? refunds.filter(isObj).map((r) => ({
      id: Number(r.id),
      at: typeof r.date_created_gmt === 'string' ? r.date_created_gmt : '',
      amount: fromMinorUnits(Math.abs(minor(r.amount, d)), d),
      reason: text(r.reason),
    }))
    : (Array.isArray(raw.refunds) ? raw.refunds : []).filter(isObj).map((r) => ({
      id: Number(r.id), at: '', amount: fromMinorUnits(Math.abs(minor(r.total, d)), d), reason: text(r.reason),
    }));
  const refunded = refundList.reduce((n, r) => n + minor(r.amount, d), 0);
  const total = minor(raw.total, d);
  const subtotal = (Array.isArray(raw.line_items) ? raw.line_items : []).reduce((n: number, li: any) => n + minor(li?.subtotal, d), 0);
  const billing = addressFrom(raw.billing);
  return {
    ...row,
    paymentMethod: typeof raw.payment_method === 'string' ? raw.payment_method : '',
    paid: !!raw.date_paid_gmt || !!raw.date_paid,
    customer: {
      name: row.customerName,
      email: isObj(raw.billing) ? text(raw.billing.email) : '',
      phone: isObj(raw.billing) ? text(raw.billing.phone) : '',
      billing,
      shipping: addressFrom(raw.shipping),
      note: text(raw.customer_note),
    },
    items,
    totals: {
      subtotal: fromMinorUnits(subtotal, d),
      shipping: fromMinorUnits(minor(raw.shipping_total, d), d),
      tax: fromMinorUnits(minor(raw.total_tax, d), d),
      discount: fromMinorUnits(minor(raw.discount_total, d), d),
      refunded: fromMinorUnits(refunded, d),
      total: fromMinorUnits(total, d),
    },
    notes: (notes ?? []).filter(isObj).map((n) => ({
      id: Number(n.id),
      at: typeof n.date_created_gmt === 'string' ? n.date_created_gmt : '',
      text: text(n.note),
      customer: n.customer_note === true,
      author: text(n.author),
    })),
    refunds: refundList,
    refundable: fromMinorUnits(Math.max(0, total - refunded), d),
    gatewayRefunds: false,
    editUrl: `${adminUrl}post.php?post=${row.id}&action=edit`,
  };
}
