import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Radio } from '@yotako/webmaven-ui';
import { wpRest } from '../../../../services/wpRest';
import { errorSentence, storeApi } from '../../../../services/storeApi';
import { formatOrderMoney, fromMinorUnits, toMinorUnits } from '../../../../utils/storeMoney';
import type { PaymentsLedgerRow, StoreAddress } from '../../../../types/store';
import { useStoreContext } from '../shared/storeContext';
import { useStableMoney } from '../useStableMoney';
import { ErrorLine, Loading, shortDate } from '../shared/ui';
import { ORDER_STATUS_LABEL, PRINTING_LABEL, printedItemsSentence, printingNotShippedSentence, refundFeeNote } from '../storeCopy';
import { allowedStatusesFor, orderDetailFrom, type AppOrderDetail } from './orderMapper';
import { statusColor } from './OrdersPanel';
import RefundDialog from './RefundDialog';
import OwnShipment from './OwnShipment';

const safeUrl = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : null);

function Address({ title, address }: { title: string; address: StoreAddress }) {
  return (
    <div className="wm-store-address">
      <span className="wm-store-field__label">{title}</span>
      {address.name && <span>{address.name}</span>}
      {address.company && <span>{address.company}</span>}
      {address.lines.map((l) => <span key={l}>{l}</span>)}
      {address.country && <span>{address.country}</span>}
    </div>
  );
}

const sameAddress = (a: StoreAddress | null, b: StoreAddress | null) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

/** One order: its items and totals, the customer, the payment and printing, notes, status and refunds. */
export default function OrderDetail({ orderId, onBack }: { orderId: number; onBack: () => void }) {
  const { money: contextMoney, caps, context, refresh } = useStoreContext();
  const money = useStableMoney(contextMoney);
  const adminUrl = useRef(context?.adminUrl || String((window as any).WEBMAVEN_WP_DATA?.adminUrl || '/wp-admin/')).current;
  const [order, setOrder] = useState<AppOrderDetail | null>(null);
  const [ledger, setLedger] = useState<PaymentsLedgerRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState('');
  const [toCustomer, setToCustomer] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  // Stable, so the open refund panel keeps its focus while the order reads again.
  const closeRefund = useCallback(() => setRefunding(false), []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [o, notes, refunds] = await Promise.all([
        wpRest.get<Record<string, any>>(`wc/v3/orders/${orderId}`),
        wpRest.get<Array<Record<string, any>>>(`wc/v3/orders/${orderId}/notes`).then((a) => (Array.isArray(a.data) ? a.data : []), () => null),
        wpRest.get<Array<Record<string, any>>>(`wc/v3/orders/${orderId}/refunds`, { query: { _fields: 'id,date_created_gmt,amount,reason,line_items' } })
          .then((a) => (Array.isArray(a.data) ? a.data : null), () => null),
      ]);
      const detail = orderDetailFrom(o.data ?? {}, notes, refunds, money, adminUrl);
      setOrder(detail);
      setNextStatus('');
      if (detail.wpmaven.paymentsWpmaven) {
        storeApi.paymentsOrders([detail.id]).then(
          (rows) => setLedger(rows.find((r) => Number(r.orderId) === detail.id) ?? null),
          () => setLedger(null),
        );
      }
    } catch (error) {
      setLoadError(errorSentence(error, 'This order did not load. Try again.'));
    }
  }, [orderId, money, adminUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!order) {
    return (
      <div className="wm-store-order" data-testid="store-order-detail">
        <button type="button" className="wm-store-back" onClick={onBack}>&lsaquo; Orders</button>
        {loadError ? <ErrorLine message={loadError} onRetry={() => void load()} /> : <Loading label="Reading the order" />}
      </div>
    );
  }

  const fmt = (amount: string) => formatOrderMoney(amount, order.currencySymbol, money);
  const d = money.decimals;
  const allowed = caps.orderChanges ? allowedStatusesFor(order) : [];
  const left = toMinorUnits(order.refundable, d) ?? 0;
  // Only money that came in goes back: a paid order, or one WooCommerce counts as paid.
  const canRefund = caps.refunds && left > 0 && order.status !== 'refunded'
    && (order.paid || order.status === 'processing' || order.status === 'completed');
  const printing = ledger ? PRINTING_LABEL[ledger.fulfillment] : '';
  const tracking = safeUrl(ledger?.trackingUrl) || safeUrl(order.wpmaven.tracking?.url);
  const firstName = order.customer.name.split(' ')[0] || 'the customer';

  const changeStatus = async () => {
    if (!nextStatus) return;
    setStatusBusy(true);
    setMessage(null);
    try {
      await wpRest.put(`wc/v3/orders/${order.id}`, { status: nextStatus }, { query: { _fields: 'id,status' } });
      setMessage({ ok: true, text: `The order is now ${(ORDER_STATUS_LABEL[nextStatus] ?? nextStatus).toLowerCase()}.` });
      refresh();
      await load();
    } catch (error) {
      setMessage({ ok: false, text: errorSentence(error, 'The status did not change. Try again.') });
    } finally {
      setStatusBusy(false);
    }
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = note.trim();
    if (!text) return;
    setNoteBusy(true);
    setNoteError(null);
    try {
      await wpRest.post(`wc/v3/orders/${order.id}/notes`, { note: text, customer_note: toCustomer });
      setNote('');
      setToCustomer(false);
      await load();
    } catch (error) {
      setNoteError(errorSentence(error, 'The note did not go through. Try again.'));
    } finally {
      setNoteBusy(false);
    }
  };

  const totals: Array<[string, string, boolean]> = [
    ['Items', order.totals.subtotal, true],
    ['Discount', `-${order.totals.discount}`, (toMinorUnits(order.totals.discount, d) ?? 0) > 0],
    ['Shipping', order.totals.shipping, (toMinorUnits(order.totals.shipping, d) ?? 0) > 0],
    ['Tax', order.totals.tax, (toMinorUnits(order.totals.tax, d) ?? 0) > 0],
  ];

  return (
    <div className="wm-store-order" data-testid="store-order-detail">
      <div className="wm-store-editor__head">
        <button type="button" className="wm-store-back" onClick={onBack}>&lsaquo; Orders</button>
        <h2 className="wm-store-editor__title">Order #{order.number}</h2>
        <span className="wm-store-muted">{shortDate(order.createdAt)}</span>
        <Badge color={statusColor(order.status)}>{ORDER_STATUS_LABEL[order.status] ?? order.status}</Badge>
        {allowed.length > 0 && (
          <span className="wm-store-inline wm-store-push">
            <select
              className="wm-select"
              aria-label="New status"
              value={nextStatus}
              onChange={(e) => setNextStatus(e.target.value)}
              data-testid="store-order-status"
            >
              <option value="">Change the status</option>
              {allowed.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s] ?? s}</option>)}
            </select>
            <Button type="button" size="sm" variant="secondary" onClick={() => void changeStatus()} disabled={!nextStatus} isLoading={statusBusy} data-testid="store-order-status-save">
              Change
            </Button>
          </span>
        )}
        {canRefund && (
          <Button type="button" size="sm" variant="danger" onClick={() => setRefunding(true)} className={allowed.length ? undefined : 'wm-store-push'} data-testid="store-order-refund">
            Refund
          </Button>
        )}
      </div>
      {message && (
        <p className={`wm-store-note ${message.ok ? '' : 'wm-store-note--error'}`} role={message.ok ? 'status' : 'alert'} data-testid="store-order-message">{message.text}</p>
      )}
      {order.wpmaven.printed && !order.wpmaven.tracking && caps.orderChanges && (
        <p className="wm-store-muted">{printingNotShippedSentence()}</p>
      )}

      <div className="wm-store-split">
        <div className="wm-store-stack">
          <section className="wm-store-panel" aria-labelledby="od-items">
            <h3 id="od-items" className="wm-store-panel__title">Items</h3>
            <ul className="wm-store-plainlist wm-store-items">
              {order.items.map((item) => (
                <li key={item.id} className="wm-store-item">
                  <span className="wm-store-thumb">
                    {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : <span className="wm-store-nophoto">No photo</span>}
                  </span>
                  <span className="wm-store-grow">
                    <span className="wm-store-strong">{item.quantity} &times; {item.name}</span>
                    {item.options.length > 0 && (
                      <span className="wm-store-muted">{item.options.map((o) => `${o.label}: ${o.value}`).join(', ')}</span>
                    )}
                  </span>
                  <span>{fmt(item.total)}</span>
                </li>
              ))}
            </ul>
            <dl className="wm-store-totals">
              {totals.filter(([, , shown]) => shown).map(([label, amount]) => (
                <React.Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{fmt(amount)}</dd>
                </React.Fragment>
              ))}
              <dt className="wm-store-strong">Total</dt>
              <dd className="wm-store-strong" data-testid="store-order-total">{fmt(order.totals.total)}</dd>
              {order.refunds.length > 0 && (
                <>
                  <dt>Refunded</dt>
                  <dd>{fmt(order.totals.refunded)}</dd>
                </>
              )}
            </dl>
            {order.refunds.length > 0 && (
              <ul className="wm-store-plainlist wm-store-muted">
                {order.refunds.map((r) => (
                  <li key={r.id}>
                    {`Refunded ${fmt(r.amount)}${r.at ? ` on ${shortDate(r.at, false)}` : ''}${r.reason ? `: ${r.reason}` : '.'}`}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(printing || tracking || order.wpmaven.printed) && (
            <section className="wm-store-panel" aria-labelledby="od-printing">
              <h3 id="od-printing" className="wm-store-panel__title">Printing</h3>
              <p className="wm-store-plain" data-testid="store-order-printing">
                {printing || (order.wpmaven.tracking ? 'Shipped' : printedItemsSentence())}
              </p>
              {tracking && <a className="wm-store-link" href={tracking} target="_blank" rel="noopener noreferrer">Track the parcel</a>}
            </section>
          )}

          <OwnShipment
            orderId={order.id}
            parcels={order.wpmaven.shipments ?? []}
            completes={order.wpmaven.allowedStatuses.includes('completed')}
            canChange={caps.orderChanges && !['cancelled', 'refunded', 'failed'].includes(order.status)}
            firstName={order.customer.name.split(' ')[0] || ''}
            onDone={(text) => {
              setMessage({ ok: true, text });
              refresh();
              void load();
            }}
          />

          <section className="wm-store-panel" aria-labelledby="od-notes">
            <h3 id="od-notes" className="wm-store-panel__title">Notes</h3>
            {order.notes.length === 0 && <p className="wm-store-muted">No notes yet.</p>}
            <ul className="wm-store-plainlist wm-store-notes">
              {order.notes.map((n) => (
                <li key={n.id} className="wm-store-notes__item">
                  <span className="wm-store-muted">
                    {shortDate(n.at)}
                    {n.customer ? ' · to the customer' : ''}
                  </span>
                  <span className="wm-store-plain">{n.text}</span>
                </li>
              ))}
            </ul>
            {caps.orderChanges && (
              <form className="wm-store-form" onSubmit={addNote}>
                <label className="wm-store-field">
                  <span className="wm-store-field__label">Add a note</span>
                  <textarea className="wm-store-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid="store-order-note" />
                </label>
                <div className="wm-store-toolbar" role="radiogroup" aria-label="Who sees the note">
                  <Radio name="wm-note-to" value="private" checked={!toCustomer} onChange={() => setToCustomer(false)} label="Private" />
                  <Radio name="wm-note-to" value="customer" checked={toCustomer} onChange={() => setToCustomer(true)} label={`To ${firstName} (sent by email)`} />
                  <Button type="submit" size="sm" variant="secondary" disabled={!note.trim()} isLoading={noteBusy} className="wm-store-push">Add the note</Button>
                </div>
                <ErrorLine message={noteError} />
              </form>
            )}
          </section>
        </div>

        <div className="wm-store-stack">
          {caps.orders && (
            <section className="wm-store-panel" aria-labelledby="od-customer" data-testid="store-order-customer">
              <h3 id="od-customer" className="wm-store-panel__title">Customer</h3>
              <span className="wm-store-strong">{order.customer.name}</span>
              {order.customer.email && <a className="wm-store-link wm-store-link--plain" href={`mailto:${order.customer.email}`}>{order.customer.email}</a>}
              {order.customer.phone && <a className="wm-store-link wm-store-link--plain" href={`tel:${order.customer.phone.replace(/[^\d+]/g, '')}`}>{order.customer.phone}</a>}
              {order.customer.shipping && <Address title="Ships to" address={order.customer.shipping} />}
              {order.customer.billing && !sameAddress(order.customer.billing, order.customer.shipping) && <Address title="Billing" address={order.customer.billing} />}
              {order.customer.note && (
                <div className="wm-store-address">
                  <span className="wm-store-field__label">Note from the customer</span>
                  <p className="wm-store-plain">{order.customer.note}</p>
                </div>
              )}
            </section>
          )}

          <section className="wm-store-panel" aria-labelledby="od-payment" data-testid="store-order-payment">
            <h3 id="od-payment" className="wm-store-panel__title">Payment</h3>
            <span>
              {!order.paymentMethodTitle ? 'No payment method' : order.paid ? `Paid with ${order.paymentMethodTitle}` : `Not paid yet. Payment method: ${order.paymentMethodTitle}`}
            </span>
            {ledger && (
              <>
                <span>{`WPMaven fee ${fmt(fromMinorUnits(ledger.applicationFeeCents, d))}`}</span>
                {ledger.refundedCents > 0 && <span className="wm-store-muted">{`Refunded through WPMaven Payments: ${fmt(fromMinorUnits(ledger.refundedCents, d))}`}</span>}
                {canRefund && (
                  <span className="wm-store-muted">
                    {refundFeeNote(typeof ledger.stripeFeeCents === 'number' ? fmt(fromMinorUnits(ledger.stripeFeeCents, d)) : null)}
                  </span>
                )}
              </>
            )}
          </section>

          <a className="wm-store-link wm-store-woo" href={order.editUrl}>Open in WooCommerce</a>
        </div>
      </div>

      {refunding && (
        <RefundDialog
          order={order}
          ledger={ledger}
          money={money}
          onClose={closeRefund}
          onDone={(sentence) => {
            setRefunding(false);
            setMessage({ ok: true, text: sentence });
            refresh();
            void load();
          }}
        />
      )}
    </div>
  );
}
