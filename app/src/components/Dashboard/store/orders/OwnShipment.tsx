import React, { useState } from 'react';
import { Button, Checkbox } from '@yotako/webmaven-ui';
import { errorSentence, storeApi } from '../../../../services/storeApi';
import type { OwnShipment as Parcel } from '../../../../types/store';
import { shortDate } from '../shared/ui';

const safeUrl = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url) ? url : null);

/** What the owner reads once the parcel is kept, in plain words. */
export function shippedSentence(completes: boolean, emailed: string | undefined, firstName: string): string {
  const who = firstName || 'The customer';
  const head = completes ? 'The order is marked shipped.' : 'The parcel is kept on the order.';
  if (emailed === 'note' || emailed === 'completed_email') return `${head} ${who} gets the tracking by email.`;
  return `${head} No email went to ${firstName || 'the customer'}.`;
}

/**
 * The parcels the owner sent themselves, and the form that marks the order
 * shipped with one: carrier, tracking number, link, and whether the customer
 * gets it by email. An order with printed products not shipped yet keeps its
 * status (the printing completes it); its parcel is still kept and sent.
 */
export default function OwnShipment({ orderId, parcels, completes, canChange, firstName, onDone }: {
  orderId: number;
  parcels: Parcel[];
  /** Marking it shipped makes it Completed (the order allows it). */
  completes: boolean;
  canChange: boolean;
  firstName: string;
  onDone: (sentence: string) => void;
}) {
  const [carrier, setCarrier] = useState('');
  const [number, setNumber] = useState('');
  const [url, setUrl] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canChange && parcels.length === 0) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim() && !safeUrl(url.trim())) {
      setError('The tracking link starts with https://.');
      return;
    }
    if (!carrier.trim() && !number.trim() && !url.trim() && !completes) {
      setError('Add the tracking number, the carrier or the tracking link.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await storeApi.markShipped(orderId, { carrier: carrier.trim(), number: number.trim(), url: url.trim(), notify });
      setCarrier('');
      setNumber('');
      setUrl('');
      onDone(shippedSentence(completes, r?.customerEmailed, firstName));
    } catch (err) {
      setError(errorSentence(err, 'The order was not marked shipped. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="wm-store-panel" aria-labelledby="od-shipping" data-testid="store-order-shipping">
      <h3 id="od-shipping" className="wm-store-panel__title">Shipping</h3>
      {parcels.length > 0 && (
        <ul className="wm-store-plainlist">
          {parcels.map((p, i) => (
            <li key={`${p.number}-${i}`} data-testid="store-order-parcel">
              <span>{['Shipped', p.carrier && `with ${p.carrier}`, p.number && `(${p.number})`].filter(Boolean).join(' ')}</span>
              {p.at && <span className="wm-store-muted"> {shortDate(p.at, false)}</span>}
              {safeUrl(p.url) && (
                <> <a className="wm-store-link" href={safeUrl(p.url)!} target="_blank" rel="noopener noreferrer">Track the parcel</a></>
              )}
            </li>
          ))}
        </ul>
      )}
      {canChange && (
        <form onSubmit={(e) => void submit(e)} className="wm-store-stack" data-testid="store-order-ship-form">
          <span className="wm-store-inline">
            <input className="wm-store-input" aria-label="Carrier" placeholder="Carrier, like UPS" value={carrier} maxLength={60} onChange={(e) => setCarrier(e.target.value)} />
            <input className="wm-store-input" aria-label="Tracking number" placeholder="Tracking number" value={number} maxLength={80} onChange={(e) => setNumber(e.target.value)} />
          </span>
          <input className="wm-store-input" aria-label="Tracking link" placeholder="https://" value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} />
          <Checkbox checked={notify} onChange={setNotify} label={<span data-testid="store-order-ship-notify">{`Email ${firstName || 'the customer'} the tracking`}</span>} />
          {error && <p className="wm-store-note wm-store-note--error" role="alert">{error}</p>}
          <span>
            <Button type="submit" size="sm" variant="secondary" isLoading={busy} data-testid="store-order-ship">
              {completes ? 'Mark shipped' : 'Send the tracking'}
            </Button>
          </span>
        </form>
      )}
    </section>
  );
}
