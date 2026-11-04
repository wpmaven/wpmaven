import React from 'react';
import { GlassCard, Badge } from '@yotako/webmaven-ui';
import { getInstanceId } from '../../../../services/proxyClient';
import { useProxyQuery } from '../../../../hooks/useProxyQuery';
import { dashboardLink, useSiteState } from '../../../../utils/siteState';
import { dashboardPhrase, isWpmavenSite, siteBrand } from '../../../../utils/brand';
import ScreenState from '../../ui/ScreenState';

/**
 * Social accounts (1.3.0), read only, for administrators: which networks
 * this business posts to, and whether its launch may be shared. Connecting,
 * disconnecting and consent are the owner's own accounts and choices: they
 * are made in the dashboard.
 */

interface XStatus { connected: boolean; username: string | null; consent: boolean }
interface Connect { networks: Array<{ id: string; label: string; state: 'live' | 'connect'; status?: string }> }

const LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' };

export default function SocialCard() {
  const instanceId = getInstanceId() || '';
  const site = useSiteState();
  const x = useProxyQuery<XStatus>(instanceId ? `instances/${instanceId}/social/x/status` : null);
  const connect = useProxyQuery<Connect>(instanceId ? 'operators/connect' : null, { instanceId });
  const brand = siteBrand();

  if (x.status === 'loading' || connect.status === 'loading') return <div style={{ marginBottom: 20 }}><ScreenState state="loading" label="Loading your social accounts" compact /></div>;
  const failed = [x, connect].find((r) => r.status === 'failed' || r.status === 'refused');
  if (failed) {
    return (
      <div style={{ marginBottom: 20 }}>
        {failed.status === 'refused'
          ? <ScreenState state="refused" error={failed.error} compact />
          : <ScreenState state="failed" error={failed.error} fallback="Your social accounts could not be loaded. Try again in a minute." onRetry={() => { void x.refetch(); void connect.refetch(); }} compact />}
      </div>
    );
  }
  const networks = (connect.data?.networks ?? []).filter((n) => n.id !== 'x');
  return (
    <GlassCard padding="24px" style={{ marginBottom: 20 }}>
      <div data-testid="wm-social">
        <span style={LABEL}>Social</span>
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <li style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ minWidth: 90 }}>X</span>
            {x.data?.connected ? <Badge color="cyan">{x.data.username ? `connected as ${x.data.username}` : 'connected'}</Badge> : <span style={{ color: 'var(--text-dim)' }}>Not connected</span>}
          </li>
          {networks.map((n) => (
            <li key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ minWidth: 90 }}>{n.label}</span>
              {n.state === 'live' ? <Badge color="cyan">connected</Badge> : <span style={{ color: 'var(--text-dim)' }}>Not connected</span>}
            </li>
          ))}
        </ul>
        {isWpmavenSite() && (
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '12px 0 0' }}>
            {x.data?.consent ? 'Sharing your launch on WPMaven\'s X account is on.' : 'Sharing your launch on WPMaven\'s X account is off.'}
          </p>
        )}
        <a href={dashboardLink(site, '/team?tab=connect')} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 12, fontSize: 13, color: 'var(--purple)' }}>
          {`Manage in ${dashboardPhrase(brand)}`}
        </a>
      </div>
    </GlassCard>
  );
}
