import React, { useEffect, useState } from 'react';
import { GlassCard, Toggle } from '@yotako/webmaven-ui';
import { dashboardPhrase, isWpmavenSite, siteBrand } from '../../../../utils/brand';
import { choicesFor, type ChoiceKey } from '../../../../utils/siteChoices';

/**
 * What this site shares, the owner's to choose (administrators): visitor
 * statistics, the copy of the store's customers for email campaigns, and the
 * "Built with WPMaven" link in the footer. Each is off until it is turned on
 * here (the plugin's GET and POST /choices); a switch shows its new place
 * once the site saved it.
 */

export { choicesFor, type ChoiceKey } from '../../../../utils/siteChoices';

type Choices = Record<ChoiceKey, boolean>;

export default function ChoicesCard() {
  const wp = (window as any).WEBMAVEN_WP_DATA || {};
  const rest = wp.restUrl || '/wp-json/webmaven_wp/v1';
  const headers = { 'X-WP-Nonce': wp.nonce || '' };
  const [choices, setChoices] = useState<Choices | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<ChoiceKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${rest}/choices`, { headers, credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json) => { if (!cancelled) setChoices(json as Choices); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rest]);

  const change = async (key: ChoiceKey, on: boolean) => {
    setSaving(key);
    setError(null);
    try {
      const res = await fetch(`${rest}/choices`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ [key]: on }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // The switch moves once the site saved it.
      setChoices((await res.json()) as Choices);
    } catch {
      setError('This could not be saved. Try again in a minute.');
    } finally {
      setSaving(null);
    }
  };

  const store = !!wp.store?.active;
  const list = choicesFor({ store, ours: isWpmavenSite(), dashboard: dashboardPhrase(siteBrand()) });

  return (
    <GlassCard padding="20px" style={{ marginTop: 20 }}>
      <div data-testid="wm-choices">
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>What your site shares</h2>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 12px' }}>Each is off until you turn it on.</p>
        {failed && (
          <p role="alert" style={{ fontSize: 13, color: 'var(--rose)', margin: 0 }}>Your choices could not be loaded. Try again in a minute.</p>
        )}
        {!failed && !choices && <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>Loading your choices</p>}
        {choices && list.map((choice) => (
          <label
            key={choice.key}
            data-testid={`wm-choice-${choice.key}`}
            style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '12px 0', borderTop: '1px solid var(--glass-border)', cursor: 'pointer' }}
          >
            <span>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{choice.title}</span>
              <span style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.5 }}>{choice.text}</span>
            </span>
            <Toggle checked={!!choices[choice.key]} disabled={saving !== null} onChange={(on) => change(choice.key, on)} />
          </label>
        ))}
        {error && <p role="alert" style={{ fontSize: 13, color: 'var(--rose)', margin: '10px 0 0' }}>{error}</p>}
      </div>
    </GlassCard>
  );
}
