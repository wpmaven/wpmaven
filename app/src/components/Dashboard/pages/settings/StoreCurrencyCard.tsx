import React, { useState } from 'react';
import { GlassCard, Button, Radio } from '@yotako/webmaven-ui';
import { getInstanceId, proxy } from '../../../../services/proxyClient';
import { useProxyQuery } from '../../../../hooks/useProxyQuery';
import { errorSentence } from '../../../../utils/apiWords';
import { isOwnerTier, isStaffLogin } from '../../../../utils/tier';
import ScreenState from '../../ui/ScreenState';

/**
 * The store's currency (1.3.0), as the dashboard's card does it: what the
 * store sells in, and for an administrator the change, where the owner
 * chooses what happens to the prices (Keep the same numbers, or Convert at
 * today's rate), each shown with prices from the store. Nothing changes
 * before the confirm. A Shop manager reads it.
 */

interface Option { code: string; name: string; label: string; digits: number }

interface Setting {
  hasStore: boolean;
  reachable: boolean;
  currency: string | null;
  name: string | null;
  canChange: boolean;
  whyNot: string | null;
  options: Option[];
}

interface Quote {
  from: { code: string; name: string };
  to: { code: string; name: string };
  hasPrices: boolean;
  rate: { text: string; date: string; dateText: string } | null;
  examples: Array<{ label: string; from: string; keep: string; convert: string | null }>;
  convertAvailable: boolean;
  convertUnavailableReason: string | null;
  pluginNotes?: string[];
  pluginPricesListed?: boolean;
}

const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' };

const CONVERT_OFF: Record<string, string> = {
  rate_not_offered: 'Convert is not offered for this currency: there is no daily rate for it.',
  rate_unavailable: 'Today\'s rate is not available yet, so Convert is off for now. Keep works.',
  too_many_prices: 'This store has too many prices to convert in one go. Keep works.',
  unsupported_products: 'Some products in this store cannot be converted here. Keep works.',
};

export default function StoreCurrencyCard() {
  const instanceId = getInstanceId() || '';
  const setting = useProxyQuery<Setting>(instanceId ? `instances/${instanceId}/store-currency` : null);
  const owner = isOwnerTier() && !isStaffLogin();
  const [to, setTo] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [mode, setMode] = useState<'keep' | 'convert' | null>(null);
  const [busy, setBusy] = useState<'quote' | 'change' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (setting.status === 'loading' || setting.status === 'idle') return <div style={{ marginBottom: 20 }}><ScreenState state="loading" label="Loading your store currency" compact /></div>;
  if (setting.status === 'refused') return <div style={{ marginBottom: 20 }}><ScreenState state="refused" error={setting.error} compact /></div>;
  if (setting.status === 'failed') {
    return <div style={{ marginBottom: 20 }}><ScreenState state="failed" error={setting.error} fallback="Your store currency could not be read. Try again in a minute." onRetry={setting.refetch} compact /></div>;
  }
  const s = setting.data;
  if (!s || !s.hasStore) return null;

  const review = async () => {
    if (!to) return;
    setBusy('quote');
    setError(null);
    setDone(null);
    try {
      const q = await proxy.get<Quote>(`instances/${instanceId}/store-currency/quote`, { to });
      setQuote(q);
      setMode(q.hasPrices ? null : 'keep');
    } catch (err) {
      setError(errorSentence(err, 'The change could not be prepared. Try again in a minute.'));
    } finally {
      setBusy(null);
    }
  };

  const change = async () => {
    if (!quote || !mode) return;
    setBusy('change');
    setError(null);
    try {
      const result = await proxy.put<{ message: string }>(`instances/${instanceId}/store-currency`, {
        currency: quote.to.code,
        mode,
        expectedFrom: s.currency,
        ...(mode === 'convert' && quote.rate ? { rateDate: quote.rate.date } : {}),
        ...(quote.pluginPricesListed ? { pluginPricesShown: true } : {}),
      });
      setDone(result?.message || `Your store now sells in ${quote.to.name}.`);
      setQuote(null);
      setTo('');
      void setting.refetch();
    } catch (err) {
      setError(errorSentence(err, 'The currency did not change. Try again in a minute.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <GlassCard padding="24px" style={{ marginBottom: 20 }}>
      <div data-testid="wm-store-currency">
        <span style={LABEL}>Store currency</span>
        <p style={{ fontSize: 14, color: 'var(--text)', margin: '8px 0 0' }}>
          {s.currency ? `Your store sells in ${s.name || s.currency} (${s.currency}).` : 'Your store currency could not be read from the site right now.'}
        </p>
        {!owner && <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '6px 0 0' }}>An administrator of this site can change it.</p>}
        {owner && !s.canChange && s.whyNot && <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '6px 0 0' }}>{s.whyNot}</p>}
        {owner && s.canChange && !quote && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <label htmlFor="wm-currency-to" style={{ fontSize: 13, color: 'var(--text-dim)' }}>Change to</label>
            <select id="wm-currency-to" className="wm-select" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose a currency</option>
              {s.options.filter((o) => o.code !== s.currency).map((o) => (
                <option key={o.code} value={o.code}>{`${o.label} (${o.code})`}</option>
              ))}
            </select>
            <Button variant="secondary" size="sm" disabled={!to || !!busy} onClick={review}>{busy === 'quote' ? 'Preparing' : 'Review the change'}</Button>
          </div>
        )}
        {owner && quote && (
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{`Change your store currency to ${quote.to.name} (${quote.to.code})?`}</p>
            {quote.hasPrices ? (
              <>
                <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '6px 0 8px' }}>Your prices change with it. Choose what happens to them:</p>
                <div role="radiogroup" aria-label="What happens to your prices" style={{ display: 'grid', gap: 8 }}>
                  <Radio
                    name="wm-currency-mode"
                    value="keep"
                    checked={mode === 'keep'}
                    onChange={() => setMode('keep')}
                    label={`Keep the same numbers${quote.examples[0] ? `: ${quote.examples[0].label} ${quote.examples[0].from} becomes ${quote.examples[0].keep}` : ''}`}
                  />
                  <Radio
                    name="wm-currency-mode"
                    value="convert"
                    disabled={!quote.convertAvailable}
                    checked={mode === 'convert'}
                    onChange={() => setMode('convert')}
                    label={quote.convertAvailable
                      ? `Convert at today's rate${quote.rate ? ` (${quote.rate.text}, ${quote.rate.dateText})` : ''}${quote.examples[0]?.convert ? `: ${quote.examples[0].label} ${quote.examples[0].from} becomes ${quote.examples[0].convert}` : ''}`
                      : (CONVERT_OFF[quote.convertUnavailableReason || ''] ?? 'Convert is not available for this change. Keep works.')}
                  />
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '6px 0 0' }}>Your store has no prices yet, so nothing else changes.</p>
            )}
            {(quote.pluginNotes ?? []).map((note) => <p key={note} style={{ fontSize: 13, color: 'var(--text)', margin: '8px 0 0' }}>{note}</p>)}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button variant="primary" size="sm" disabled={!mode || !!busy} onClick={change}>{busy === 'change' ? 'Changing' : 'Change the currency'}</Button>
              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => { setQuote(null); setMode(null); }}>Cancel</Button>
            </div>
          </div>
        )}
        {error && <p role="alert" style={{ fontSize: 13, color: 'var(--rose)', margin: '10px 0 0' }}>{error}</p>}
        {done && <p role="status" style={{ fontSize: 13, color: 'var(--text)', margin: '10px 0 0' }}>{done}</p>}
      </div>
    </GlassCard>
  );
}
