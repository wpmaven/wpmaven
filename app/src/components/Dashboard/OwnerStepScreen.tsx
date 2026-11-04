import React, { useEffect, useRef, useState } from 'react';
import { Button, GlassCard, PageHeader } from '@yotako/webmaven-ui';
import AppLoading from '../AppLoading';
import {
  OWNER_STEP_COPY, formFrom, ownerStepRequired, readDetails, readOwner, readStoreCurrency, saveBlocker, saveOwnerStep,
  type OwnerStepForm,
} from '../../utils/ownerStep';
import { useSiteState } from '../../utils/siteState';

/**
 * The required step in WPMaven's screens (utils/ownerStep): once the site's
 * business is live, before the rest, for administrators, until it is done
 * once. The owner's names, the business details to review (the fields the
 * site shows; the opening hours stay the dashboard's) and, for a store, its
 * currency, with the dashboard for a change (it asks how the prices move).
 * The API's answer decides; one that does not come holds nobody.
 */

const FIELDS: Array<{ key: keyof OwnerStepForm; label: string; type?: string; auto?: string }> = [
  { key: 'name', label: OWNER_STEP_COPY.businessName, auto: 'organization' },
  { key: 'phone', label: OWNER_STEP_COPY.phone, type: 'tel', auto: 'tel' },
  { key: 'email', label: OWNER_STEP_COPY.email, type: 'email', auto: 'email' },
  { key: 'street', label: OWNER_STEP_COPY.street, auto: 'street-address' },
  { key: 'city', label: OWNER_STEP_COPY.city, auto: 'address-level2' },
  { key: 'postcode', label: OWNER_STEP_COPY.postcode, auto: 'postal-code' },
  { key: 'country', label: OWNER_STEP_COPY.country, auto: 'country' },
];

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 10, border: '1px solid var(--glass-border)',
  background: 'var(--bg-raised)', color: 'var(--text)', fontSize: 14,
};

function Field({ id, label, value, onChange, type = 'text', auto }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; auto?: string }) {
  return (
    <label htmlFor={id} style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, color: 'var(--text-mid)' }}>
      {label}
      <input id={id} type={type} autoComplete={auto} value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} maxLength={120} />
    </label>
  );
}

export function OwnerStepView({ form, onChange, fromCheckout, currency, businessLink, saving, failed, onSave }: {
  form: OwnerStepForm;
  onChange: (key: keyof OwnerStepForm, value: string) => void;
  fromCheckout: boolean;
  currency: { code: string; name: string } | null;
  businessLink: string | null;
  saving: boolean;
  failed: string | null;
  onSave: () => void;
}) {
  const blocker = saveBlocker(form);
  const heading: React.CSSProperties = { margin: '0 0 10px', fontSize: 15, fontWeight: 600, color: 'var(--text)' };
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 };
  return (
    <div style={{ maxWidth: 760, margin: '24px auto', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 18 }} data-testid="wm-owner-step">
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{OWNER_STEP_COPY.eyebrow}</div>
        <PageHeader title={OWNER_STEP_COPY.title} subtitle={OWNER_STEP_COPY.lead} />
      </div>
      <GlassCard>
        <div style={{ padding: 18 }}>
          <h2 style={heading}>{OWNER_STEP_COPY.you}</h2>
          {fromCheckout && <p role="note" style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-dim)' }}>{OWNER_STEP_COPY.fromCheckout}</p>}
          <div style={grid}>
            <Field id="wm-owner-first" label={OWNER_STEP_COPY.firstName} value={form.firstName} onChange={(v) => onChange('firstName', v)} auto="given-name" />
            <Field id="wm-owner-last" label={OWNER_STEP_COPY.lastName} value={form.lastName} onChange={(v) => onChange('lastName', v)} auto="family-name" />
          </div>
        </div>
      </GlassCard>
      <GlassCard>
        <div style={{ padding: 18 }}>
          <h2 style={heading}>{OWNER_STEP_COPY.business}</h2>
          <div style={grid}>
            {FIELDS.map((f) => (
              <Field key={f.key} id={`wm-owner-${f.key}`} label={f.label} value={form[f.key]} onChange={(v) => onChange(f.key, v)} type={f.type} auto={f.auto} />
            ))}
          </div>
          {currency && (
            <p style={{ margin: '14px 0 0', fontSize: 13.5, color: 'var(--text)' }} data-testid="wm-owner-currency">
              {OWNER_STEP_COPY.currency(currency.name, currency.code)}{' '}
              {businessLink && <a href={`${businessLink}#store-currency`} target="_blank" rel="noopener noreferrer">{OWNER_STEP_COPY.changeCurrency}</a>}
            </p>
          )}
        </div>
      </GlassCard>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        <Button variant="primary" onClick={onSave} disabled={saving || !!blocker} data-testid="wm-owner-save">
          {saving ? OWNER_STEP_COPY.saving : OWNER_STEP_COPY.save}
        </Button>
        {blocker && !saving && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }} data-testid="wm-owner-why">{blocker}</p>}
        {failed && <p role="alert" style={{ margin: 0, fontSize: 13.5, color: 'var(--danger, #c0392b)' }}>{failed}</p>}
      </div>
    </div>
  );
}

const EMPTY: OwnerStepForm = { firstName: '', lastName: '', name: '', phone: '', email: '', street: '', city: '', postcode: '', country: '' };

/** Known to be done (or not needed) in this browser session: no read on the next page. */
const DONE_KEY = 'wm_owner_step_done';

function knownDone(): boolean {
  try { return sessionStorage.getItem(DONE_KEY) === '1'; } catch { return false; }
}

function rememberDone(): void {
  try { sessionStorage.setItem(DONE_KEY, '1'); } catch { /* private mode: the next page reads again */ }
}

/** Before the rest of WPMaven's screens, while the step is required. */
export default function OwnerStepGate({ children }: { children: React.ReactNode }) {
  const site = useSiteState();
  const [phase, setPhase] = useState<'checking' | 'step' | 'done'>(() => (knownDone() ? 'done' : 'checking'));
  const [form, setForm] = useState<OwnerStepForm>(EMPTY);
  const [fromCheckout, setFromCheckout] = useState(false);
  const [currency, setCurrency] = useState<{ code: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const current = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (knownDone()) return undefined;
    let cancelled = false;
    // Never more than a few seconds before the app: an answer that does not come holds nobody.
    const limit = window.setTimeout(() => { if (!cancelled) setPhase((p) => (p === 'checking' ? 'done' : p)); }, 4000);
    (async () => {
      const required = await ownerStepRequired();
      if (cancelled) return;
      if (!required) { rememberDone(); setPhase('done'); return; }
      const [owner, details, store] = await Promise.all([readOwner(), readDetails(), readStoreCurrency()]);
      if (cancelled) return;
      current.current = details;
      const f = formFrom(owner, details);
      setFromCheckout(f.fromCheckout);
      setForm({ ...EMPTY, ...f });
      setCurrency(store);
      setPhase('step');
    })();
    return () => { cancelled = true; window.clearTimeout(limit); };
  }, []);

  if (phase === 'checking') return <AppLoading />;
  if (phase === 'done') return <>{children}</>;

  const save = async () => {
    setSaving(true);
    setFailed(null);
    try {
      await saveOwnerStep(form, current.current);
      rememberDone();
      setPhase('done');
    } catch (e) {
      setFailed(e instanceof Error && e.message && !/^HTTP \d+$/.test(e.message) ? e.message : OWNER_STEP_COPY.failed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <OwnerStepView
      form={form}
      onChange={(key, value) => setForm((f) => ({ ...f, [key]: value }))}
      fromCheckout={fromCheckout}
      currency={currency}
      businessLink={site?.links.business ?? null}
      saving={saving}
      failed={failed}
      onSave={() => void save()}
    />
  );
}
