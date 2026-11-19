/**
 * The local payment services in Turn on a way to get paid (2026-11-16):
 * one row per service the payment status offers for the business's
 * currency and country, after WooPayments, Stripe and PayPal.
 *
 * A service connected with keys opens a guided form right here: create the
 * account (a link to the service), copy the keys (a link to where they
 * are), paste each key in its box, connect. The keys go to the API in one
 * request and are written into the service's own plugin on the owner's
 * site; the form forgets them once the answer is back. A service whose
 * plugin connects the account itself goes through the card's own setup
 * (install, switch on, its page in WordPress), like the core three.
 */
import React, { useState } from 'react';
import { Button, Input, getLanguage, localeTag } from '@yotako/webmaven-ui';
import { productName } from '@yotako/wpmaven-onboarding/shared';
import type { ScreensHost } from '../host/types';
import { setupErrorMessage, type PaymentStatus } from './getPaid';
import {
  andList, connectWithKeys, fieldsForMode, keysErrorFields, keysPayload, missingKeys, type LocalServiceInfo,
} from './localPayments';
import { LOCAL_PAYMENTS_COPY as COPY } from './localPaymentsCopy';

const SMALL: React.CSSProperties = { margin: 0, fontSize: 'var(--text-meta)', lineHeight: 1.45, color: 'var(--text)' };
const SMALL_DIM: React.CSSProperties = { ...SMALL, color: 'var(--text-dim)' };
const NAME: React.CSSProperties = { margin: 0, fontSize: 'var(--text-body)', lineHeight: 'var(--leading-body)', color: 'var(--text)', fontWeight: 550 };
const LINK: React.CSSProperties = { color: 'inherit', textDecoration: 'underline' };
const ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };
const STEP: React.CSSProperties = { ...SMALL, marginTop: 8 };

/** "A, B and C" in the page's language; English exactly as before (no comma before "and"). */
function methodsList(xs: readonly string[]): string {
  if (getLanguage() === 'en') return andList(xs);
  try {
    const ListFormat = (Intl as unknown as { ListFormat: new (tag: string, o: { type: string }) => { format(x: readonly string[]): string } }).ListFormat;
    return new ListFormat(localeTag(), { type: 'conjunction' }).format(xs);
  } catch {
    return andList(xs);
  }
}

export interface LocalServicesProps {
  host: ScreensHost;
  instanceId: string;
  status: PaymentStatus;
  services: LocalServiceInfo[];
  /** The gateway the card is setting up (its plugin's own page), or null. */
  busy: string | null;
  /** The card's own setup for a service whose plugin connects the account: install, switch on, its page. */
  onPluginConnect(id: string): void;
  /** After keys were sent: the card reads the status again. */
  onConnected(): void | Promise<void>;
  /** A service whose form opens at once (the agent's link names it with ?connect=). */
  initialOpen?: string | null;
}

/** Each local service, under the core gateways. */
export const LocalServices: React.FC<LocalServicesProps> = ({ host, instanceId, status, services, busy, onPluginConnect, onConnected, initialOpen }) => (
  <div data-testid="getpaid-local" style={{ marginTop: 12, display: 'grid', gap: 12 }}>
    {services.map((s) => (
      <LocalServiceRow
        key={s.id}
        host={host}
        instanceId={instanceId}
        service={s}
        live={status.gateways.find((g) => g.id === s.id)}
        busy={busy}
        onPluginConnect={onPluginConnect}
        onConnected={onConnected}
        open={initialOpen === s.id}
      />
    ))}
  </div>
);

interface RowProps {
  host: ScreensHost;
  instanceId: string;
  service: LocalServiceInfo;
  live: (PaymentStatus['gateways'][number] & { mode?: 'live' | 'test' }) | undefined;
  busy: string | null;
  onPluginConnect(id: string): void;
  onConnected(): void | Promise<void>;
  open: boolean;
}

/** One service: what buyers pay with, where the money goes, and its Connect. */
export function LocalServiceRow({ host, instanceId, service, live, busy, onPluginConnect, onConnected, open }: RowProps) {
  const [formOpen, setFormOpen] = useState(open && service.connect === 'keys');
  const [done, setDone] = useState<string | null>(null);
  const pending = live?.connected === 'pending';
  const test = live?.mode === 'test';
  return (
    <div style={{ borderRadius: 'var(--r-card)', padding: 12, border: '1px solid var(--glass-border)' }} data-testid={`getpaid-local-${service.id}`}>
      <div style={ROW}>
        <span style={NAME}>{service.name}</span>
        {pending && test && <span style={SMALL_DIM}>{COPY.testKeysOn}</span>}
      </div>
      <p style={{ ...SMALL_DIM, marginTop: 4 }}>
        {COPY.buyersPayWith(methodsList(service.methods.slice(0, 6)))} {COPY.ownAccount(service.name)}
        {service.subscriptions ? ` ${COPY.renewsSubscriptions}` : ''}
      </p>
      {service.note && <p style={{ ...SMALL_DIM, marginTop: 4 }}>{service.note}</p>}
      {done && <p role="status" style={{ ...SMALL, marginTop: 8 }}>{done}</p>}
      {service.connect === 'plugin' ? (
        <>
          <p style={{ ...SMALL_DIM, marginTop: 4 }}>{COPY.ownPage(service.name)}</p>
          <div style={{ marginTop: 12 }}>
            <Button variant="primary" size="sm" onClick={() => onPluginConnect(service.id)} isLoading={busy === service.id} disabled={!!busy}>
              {pending ? COPY.finishSetup : COPY.connect}
            </Button>
          </div>
        </>
      ) : formOpen ? (
        <KeysForm
          host={host}
          instanceId={instanceId}
          service={service}
          onCancel={() => setFormOpen(false)}
          onDone={async (sentence) => { setDone(sentence); setFormOpen(false); await onConnected(); }}
        />
      ) : (
        <div style={{ marginTop: 12 }}>
          <Button variant="primary" size="sm" onClick={() => { setDone(null); setFormOpen(true); }} disabled={!!busy}>
            {pending ? COPY.finishSetup : COPY.connect}
          </Button>
        </div>
      )}
    </div>
  );
}

interface FormProps {
  host: ScreensHost;
  instanceId: string;
  service: LocalServiceInfo;
  onCancel(): void;
  onDone(sentence: string): void | Promise<void>;
}

/** The guided form: the account, the keys, each key in its box, connect. */
export function KeysForm({ host, instanceId, service, onCancel, onDone }: FormProps) {
  const [mode, setMode] = useState<'live' | 'test'>('live');
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fields = fieldsForMode(service, mode);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (sending) return;
    setError(null);
    const missing = missingKeys(service, mode, values);
    if (missing.length) {
      setErrors(Object.fromEntries(missing.map((id) => [id, COPY.pasteMissing])));
      return;
    }
    setErrors({});
    setSending(true);
    try {
      const result = await connectWithKeys(host.transport, instanceId, service.id, keysPayload(service, mode, values), mode);
      // The keys are on the site now: the form forgets them.
      setValues({});
      host.track?.('payments', 'local_connected', service.id);
      const sentence = result.connected ? COPY.connectedLive(service.name)
        : result.mode === 'test' ? COPY.connectedTest(service.name)
          : COPY.savedNotTaking(service.name);
      await onDone(sentence);
    } catch (err) {
      const byField = keysErrorFields(err);
      if (byField) setErrors(byField);
      else setError(setupErrorMessage(err, service.name));
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} style={{ marginTop: 12 }} data-testid={`getpaid-keys-${service.id}`} autoComplete="off">
      <p style={STEP}>
        1. {COPY.stepAccount(service.name)}{' '}
        <a href={service.signupUrl} target="_blank" rel="noopener noreferrer" style={LINK}>{COPY.openSignup(service.name)}</a>
      </p>
      <p style={STEP}>
        2. {COPY.stepKeys(service.name)}
        {service.keysUrl && (
          <>
            {' '}
            <a href={service.keysUrl} target="_blank" rel="noopener noreferrer" style={LINK}>{COPY.openKeys(service.name)}</a>
          </>
        )}
      </p>
      <p style={STEP}>3. {COPY.stepPaste}</p>
      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        {fields.map((f) => (
          <div key={f.id}>
            <Input
              label={f.label}
              name={`${service.id}-${f.id}`}
              type={f.secret && !shown[f.id] ? 'password' : 'text'}
              value={values[f.id] ?? ''}
              onChange={(e) => { const v = e.target.value; setValues((x) => ({ ...x, [f.id]: v })); }}
              helperText={f.help}
              error={errors[f.id]}
              autoComplete="off"
              spellCheck={false}
              rightIcon={f.secret ? (
                <button type="button" style={{ ...SMALL_DIM, background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={() => setShown((x) => ({ ...x, [f.id]: !x[f.id] }))}>
                  {shown[f.id] ? COPY.hide : COPY.show}
                </button>
              ) : undefined}
            />
          </div>
        ))}
      </div>
      <p style={{ ...SMALL_DIM, marginTop: 10 }}>{COPY.keysStayYours(productName())}</p>
      {service.testMode && (
        <p style={{ ...SMALL_DIM, marginTop: 6 }}>
          {mode === 'test' && <>{COPY.testKeysNote(service.name)} </>}
          <button
            type="button"
            style={{ ...SMALL, background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => { setMode((m) => (m === 'live' ? 'test' : 'live')); setErrors({}); setError(null); }}
          >
            {mode === 'live' ? COPY.useTestKeys : COPY.useLiveKeys}
          </button>
        </p>
      )}
      {error && <p role="alert" style={{ margin: '10px 0 0', fontSize: 'var(--text-meta)', lineHeight: 1.45, color: 'var(--rose)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <Button variant="primary" size="sm" type="submit" isLoading={sending} disabled={sending}>{COPY.submit(service.name)}</Button>
        <Button variant="ghost" size="sm" type="button" onClick={onCancel} disabled={sending}>{COPY.cancel}</Button>
      </div>
    </form>
  );
}
