import React, { useEffect, useState } from 'react';
import { Button, Checkbox } from '@yotako/webmaven-ui';
import { wpRest } from '../../../../services/wpRest';
import { errorSentence } from '../../../../services/storeApi';
import { formatOrderMoney, fromMinorUnits, moneyInputText, parseStoreMoney, toMinorUnits } from '../../../../utils/storeMoney';
import type { PaymentsLedgerRow, StoreMoneyFormat } from '../../../../types/store';
import { Drawer, ErrorLine, Field } from '../shared/ui';
import { refundFeeNote } from '../storeCopy';
import type { AppOrderDetail } from './orderMapper';

type Gateway = 'checking' | 'refunds' | 'manual';

/** What WPMaven Payments can still refund on this order (its engine's limit), in minor units; null without a ledger row. */
export function engineLeft(ledger: PaymentsLedgerRow | null): number | null {
  if (!ledger) return null;
  if (ledger.status !== 'paid' && ledger.status !== 'partially_refunded') return 0;
  return Math.max(0, ledger.amountCents - ledger.refundedCents);
}

/**
 * A refund through WooCommerce: WPMaven Payments and any gateway that
 * refunds send the money back themselves; another gateway gets the refund
 * recorded, and the owner sends the money back. At most what is left to
 * refund. "Put items back in stock" (lines whose stock went down) goes with
 * a refund of the whole amount left, as WPMaven's own refunds do.
 */
export default function RefundDialog({ order, ledger, money, onClose, onDone }: {
  order: AppOrderDetail;
  ledger: PaymentsLedgerRow | null;
  money: StoreMoneyFormat;
  onClose: () => void;
  onDone: (sentence: string) => void;
}) {
  const d = money.decimals;
  const payments = order.wpmaven.paymentsWpmaven;
  const [gateway, setGateway] = useState<Gateway>(payments ? 'refunds' : 'checking');
  const fmt = (amount: string) => formatOrderMoney(amount, order.currencySymbol, money);
  const wooLeft = toMinorUnits(order.refundable, d) ?? 0;
  const engine = payments ? engineLeft(ledger) : null;
  const maxMinor = engine === null ? wooLeft : Math.min(wooLeft, engine);
  const max = fromMinorUnits(maxMinor, d);
  const [amount, setAmount] = useState(moneyInputText(max, money));
  const [reason, setReason] = useState('');
  const restockable = order.items.filter((i) => i.restockQty > 0);
  const [restock, setRestock] = useState(false);
  const chooseRestock = (on: boolean) => {
    setRestock(on);
    if (on) setAmount(moneyInputText(max, money));
  };
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (payments) return undefined;
    if (!order.paymentMethod) {
      setGateway('manual');
      return undefined;
    }
    let live = true;
    wpRest.get<{ method_supports?: unknown }>(`wc/v3/payment_gateways/${encodeURIComponent(order.paymentMethod)}`, { query: { _fields: 'id,method_supports' } }).then(
      (answer) => live && setGateway(Array.isArray(answer.data?.method_supports) && answer.data.method_supports.includes('refunds') ? 'refunds' : 'manual'),
      () => live && setGateway('manual'),
    );
    return () => {
      live = false;
    };
  }, [payments, order.paymentMethod]);

  const parsed = parseStoreMoney(amount, money);
  const parsedMinor = parsed === null ? null : toMinorUnits(parsed, d);
  const amountError = parsedMinor === null || parsedMinor <= 0
    ? `Enter an amount like ${moneyInputText('18.50', money)}.`
    : parsedMinor > maxMinor ? `You can refund up to ${fmt(max)}.`
      : restock && parsedMinor !== maxMinor ? 'Putting items back in stock works when the whole amount left is refunded.' : null;
  const fee = payments && ledger && typeof ledger.stripeFeeCents === 'number' ? fmt(fromMinorUnits(ledger.stripeFeeCents, d)) : null;
  const method = order.paymentMethodTitle || 'This payment method';

  const submit = async () => {
    setTried(true);
    if (amountError || gateway === 'checking' || !parsed) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { amount: parsed, reason: reason.trim(), api_refund: gateway === 'refunds', api_restock: restock };
      if (restock && restockable.length) body.line_items = restockable.map((i) => ({ id: i.id, quantity: i.restockQty, refund_total: 0 }));
      await wpRest.post(`wc/v3/orders/${order.id}/refunds`, body);
      onDone(gateway === 'refunds' ? `Refunded ${fmt(parsed)}.` : `Recorded a refund of ${fmt(parsed)}. Send the money back to the customer yourself.`);
    } catch (err) {
      setError(errorSentence(err, 'The refund did not go through. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      title={`Refund order #${order.number}`}
      onClose={onClose}
      testId="store-refund"
      footer={(
        <>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="dangerSolid" onClick={() => void submit()} isLoading={busy} disabled={gateway === 'checking' || maxMinor <= 0} data-testid="store-refund-confirm">
            {gateway === 'manual' ? 'Record the refund' : parsed && !amountError ? `Refund ${fmt(parsed)}` : 'Refund'}
          </Button>
        </>
      )}
    >
      <form className="wm-store-form" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <Field label="Amount" htmlFor="wm-refund-amount" hint={maxMinor > 0 ? `Up to ${fmt(max)}.` : 'Nothing is left to refund on this order.'}>
          <input
            id="wm-refund-amount"
            className="wm-store-input"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            readOnly={restock}
            aria-invalid={tried && !!amountError}
            aria-describedby={tried && amountError ? 'wm-refund-amount-error' : undefined}
            data-testid="store-refund-amount"
          />
        </Field>
        {tried && amountError && <p id="wm-refund-amount-error" className="wm-store-field__error" role="alert">{amountError}</p>}
        <Field label="Reason (optional)" htmlFor="wm-refund-reason" hint="WooCommerce keeps it with the order.">
          <input id="wm-refund-reason" className="wm-store-input" value={reason} maxLength={450} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {restockable.length > 0 && (
          <div className="wm-store-field">
            <Checkbox checked={restock} onChange={chooseRestock} label={<span data-testid="store-refund-restock">Put items back in stock</span>} />
            <span className="wm-store-field__hint">It goes with a refund of the whole amount left.</span>
          </div>
        )}
      </form>
      <div className="wm-store-note" data-testid="store-refund-note">
        {payments ? (
          <>
            <p className="wm-store-plain">WPMaven Payments sends the money back to the customer&apos;s card.</p>
            <p className="wm-store-plain" data-testid="store-refund-fee">{refundFeeNote(fee)}</p>
          </>
        ) : gateway === 'checking' ? (
          <p className="wm-store-plain">Checking how this order was paid.</p>
        ) : gateway === 'refunds' ? (
          <p className="wm-store-plain">{`${method} sends the money back to the customer.`}</p>
        ) : (
          <p className="wm-store-plain">{`${method} cannot send money back from here. WooCommerce records the refund, and you send the money back to the customer yourself.`}</p>
        )}
      </div>
      <ErrorLine message={error} />
    </Drawer>
  );
}
