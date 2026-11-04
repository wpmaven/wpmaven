import React, { useState } from 'react';
import { GlassCard } from '@yotako/webmaven-ui';
import { getInstanceId, proxy } from '../../../../services/proxyClient';
import { useProxyQuery } from '../../../../hooks/useProxyQuery';
import { errorSentence } from '../../../../utils/apiWords';
import { dashboardLink, useSiteState } from '../../../../utils/siteState';
import { dashboardPhrase, siteBrand } from '../../../../utils/brand';
import ScreenState from '../../ui/ScreenState';

/**
 * How often this business gets a report (1.3.0), for administrators. Reports
 * arrive in the dashboard, and on WhatsApp when the owner turned that on in
 * the dashboard (the owner's phone: never changed from WordPress).
 */

interface ReportConfig {
  frequencies: string[];
  deliveryChannels: string[];
  whatsappDelivery: boolean;
}

const OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
];

export default function ReportScheduleCard() {
  const instanceId = getInstanceId() || '';
  const site = useSiteState();
  const q = useProxyQuery<ReportConfig>(instanceId ? `instances/${instanceId}/report-config` : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (q.status === 'loading' || q.status === 'idle') return <div style={{ marginTop: 20 }}><ScreenState state="loading" label="Loading your report schedule" compact /></div>;
  if (q.status === 'refused') return <div style={{ marginTop: 20 }}><ScreenState state="refused" error={q.error} compact /></div>;
  if (q.status === 'failed') {
    return <div style={{ marginTop: 20 }}><ScreenState state="failed" error={q.error} fallback="Your report schedule could not be loaded. Try again in a minute." onRetry={q.refetch} compact /></div>;
  }
  const config = q.data ?? { frequencies: [], deliveryChannels: ['dashboard'], whatsappDelivery: false };
  const frequencies = Array.isArray(config.frequencies) ? config.frequencies : [];
  const whatsapp = config.whatsappDelivery === true || (Array.isArray(config.deliveryChannels) && config.deliveryChannels.includes('whatsapp'));

  const toggle = async (key: string) => {
    const next = frequencies.includes(key) ? frequencies.filter((f) => f !== key) : [...frequencies, key];
    setSaving(true);
    setError(null);
    try {
      await proxy.patch(`instances/${instanceId}/report-config`, { frequencies: next });
      // Shown as saved only once the API said so.
      q.setData((prev) => (prev ? { ...prev, frequencies: next } : { ...config, frequencies: next }));
    } catch (err) {
      setError(errorSentence(err, 'The schedule could not be saved. Try again in a minute.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassCard padding="20px" style={{ marginTop: 20 }}>
      <div data-testid="wm-report-schedule">
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '0 0 8px' }}>Report schedule</h2>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 12px' }}>
          {`Choose how often you get a report on this site. Reports arrive in ${dashboardPhrase(siteBrand())}.`}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {OPTIONS.map((opt) => {
            const active = frequencies.includes(opt.key);
            return (
              <button
                key={opt.key}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(opt.key)}
                disabled={saving}
                style={{
                  padding: '6px 14px', borderRadius: 999,
                  border: `1px solid ${active ? 'var(--purple)' : 'var(--glass-border)'}`,
                  background: active ? 'color-mix(in srgb, var(--purple) 15%, transparent)' : 'transparent',
                  color: active ? 'var(--purple)' : 'var(--text-dim)',
                  fontSize: 13, fontWeight: 500, cursor: 'pointer', opacity: saving ? 0.6 : 1,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '12px 0 0' }}>
          {whatsapp ? 'Reports also go to your WhatsApp. ' : 'Reports do not go to WhatsApp. '}
          <a href={dashboardLink(site, '/settings?tab=channels')} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--purple)' }}>
            {`Change this in ${dashboardPhrase(siteBrand())}`}
          </a>
        </p>
        {error && <p role="alert" style={{ fontSize: 13, color: 'var(--rose)', margin: '10px 0 0' }}>{error}</p>}
      </div>
    </GlassCard>
  );
}
