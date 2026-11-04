/**
 * Your team > Connect, one tab for both apps (2026-10-16): the business's
 * channels from GET /operators/connect, each on its card, in the order of
 * the dashboard's Settings > Channels, under one line that says how many can
 * take a post.
 *
 * Connecting a channel is the account's (a channel belongs to the owner's
 * account, not to a site, choice 6):
 *  - the account's screen (the dashboard) brings its own connect flows
 *    through the host (renderers.teamConnect): the buttons that open each
 *    network's sign-in, the Page picker, the linking page, what a sign-in
 *    window said when it came back. They stay the dashboard's;
 *  - a site's screen (the plugin) reads the same cards, and Connect or
 *    Reconnect opens the dashboard's Connect tab in a new tab (host.link).
 *
 * A card's badge follows `postable`: "Live" only where a post can go out;
 * "Connected, not posting yet" where the network has not cleared WPMaven;
 * "Needs reconnecting" where the login died, with the reason.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, NavIcon, Skeleton } from '@yotako/webmaven-ui';
import { errorMessage, productName } from '@yotako/wpmaven-onboarding/shared';
import type { ScreensHost } from '../host/types';
import { isAbsoluteAddress } from '../host/HostLink';
import {
  CHANNEL_CARD_MIN_PX, CHANNEL_GRID_GAP_PX, accountLabel, connectBlockedReason, connectSummaryLine, evenGridColumns,
  inChannelOrder, isPostable, networkGates, networkStatus, reconnectBlockedReason, reconnectReason,
  type ConnectCenter, type ConnectNetwork,
} from './connectRules';
import { ChannelRevokeNote } from './ChannelTerms';
import { readConnectCenter } from './reads';
import { useWidth } from './useWidth';

export const CONNECT_COPY = {
  loadFailed: 'Could not load the Connect Center.',
  refresh: 'Refresh',
  notConfigured: 'Multi-network linking is not enabled on this server yet. Only the native X connection applies.',
  noAccount: 'No account yet?',
  createOne: 'Create one',
  live: 'Live',
  notPostingBadge: 'Connected, not posting yet',
  reconnectBadge: 'Needs reconnecting',
  notConnected: 'Not connected',
  notPostingWithReason: 'We cannot post here yet, for the reason below.',
  notPosting: 'We cannot post here yet.',
  /** A site's note over its cards: where connecting happens. */
  siteNote: () => `Channels belong to your ${productName()} account. Connect opens your dashboard in a new tab.`,
};

/** The places a team's channel card leaves to the app (the dashboard's connect flows). */
export interface TeamConnectSlots {
  /** Above the summary: the app's own notices (what a sign-in window said when it came back). */
  top?: React.ReactNode;
  /** At the end of the summary line: the app's help. */
  help?: React.ReactNode;
  /** Beside Refresh: the app's own buttons (Connect accounts). */
  actions?: React.ReactNode;
  /** Right under the row of buttons: what its buttons left to say. */
  underActions?: React.ReactNode;
  /** In each card, under its account lines: the app's connect flow for that channel. */
  card?: (network: ConnectNetwork) => React.ReactNode;
}

/** What the app's connect flows get, to draw the tab with their pieces in place. */
export interface TeamConnectFlowProps {
  instanceId: string;
  /** The channels; null while they load. */
  center: ConnectCenter | null;
  /** Read the channels again (a sign-in came back, a Page was switched). */
  reload: () => void;
  /** Draws the tab with the app's pieces in their places. */
  render: (slots: TeamConnectSlots) => React.ReactNode;
}

/** What WPMaven asks TikTok for, in TikTok's own words, what each is for, and whether TikTok granted it. */
export function ChannelPermissions({ network }: { network: ConnectNetwork }) {
  const perms = network.permissions ?? [];
  if (perms.length === 0) return null;
  return (
    <details style={{ marginTop: 8, fontSize: 12 }} open={networkStatus(network) !== 'not_connected'} data-testid="tt-permissions">
      <summary style={{ cursor: 'pointer', userSelect: 'none', color: 'var(--text-dim)' }}>
        What {productName()} can do with this TikTok account
      </summary>
      <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {perms.map((p) => (
          <li key={p.scope} data-scope={p.scope} style={{ margin: 0 }}>
            <span style={{ fontWeight: 500 }}>{p.consentLabel}</span>
            {p.granted === false && <span style={{ color: 'var(--danger)' }}> (not allowed)</span>}
            <span style={{ color: 'var(--text-dim)' }}>: {p.use}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

const meta: React.CSSProperties = { fontSize: 'var(--text-meta, 12.5px)', color: 'var(--text-dim)' };

/**
 * One channel: its name and where it stands, the account it is connected
 * to, what keeps it from posting, the app's connect flow for it (`flow`),
 * where to make an account when there is none, and the network's own rules.
 */
export const TeamChannelCard: React.FC<{ network: ConnectNetwork; flow?: React.ReactNode }> = ({ network: n, flow }) => {
  const status = networkStatus(n);
  const postable = isPostable(n);
  const gates = networkGates(n);
  const account = accountLabel(n.account);
  return (
    <div data-testid={`connect-card-${n.id}`} style={{ minWidth: 0 }}>
      <Card>
        <CardContent>
          <div style={{ minWidth: 0, overflowWrap: 'break-word' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 'var(--text-body, 15px)', fontWeight: 550, color: 'var(--text)' }}>{n.label}</span>
              {/* A badge states the status, never a verb: the button is below. */}
              {postable
                ? <Badge color="cyan">{CONNECT_COPY.live}</Badge>
                : status === 'connected'
                  ? <Badge color="peach">{CONNECT_COPY.notPostingBadge}</Badge>
                  : status === 'needs_reconnect'
                    ? <Badge color="rose">{CONNECT_COPY.reconnectBadge}</Badge>
                    : <span style={meta}>{CONNECT_COPY.notConnected}</span>}
            </div>
            {/* A handle is one unbroken token (Pinterest sends an opaque id):
                it breaks anywhere rather than run past the card. */}
            {account && (
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-dim)', overflowWrap: 'anywhere' }} data-testid="connect-account">
                {account}
              </p>
            )}
            {status === 'connected' && !postable && (
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-dim)' }} data-testid="connect-not-posting">
                {gates.length > 0 ? CONNECT_COPY.notPostingWithReason : CONNECT_COPY.notPosting}
              </p>
            )}
            {/* YouTube asks that the owner be told Google can take our access
                away too, wherever the channel shows as connected. */}
            {status === 'connected' && <ChannelRevokeNote channelId={n.id} style={{ marginTop: 4 }} />}
            <ChannelPermissions network={n} />
            {flow}
            {status === 'not_connected' && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                <span style={meta}>{CONNECT_COPY.noAccount}</span>
                {/* A real control: for someone with no account this IS the first step. */}
                <Button size="sm" variant="ghost" onClick={() => window.open(n.createUrl, '_blank', 'noopener')}>
                  {CONNECT_COPY.createOne}
                </Button>
              </div>
            )}
            {gates.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 16, listStyle: 'disc', ...meta }}>
                {gates.map((g, i) => <li key={i} style={{ margin: 0 }}>{g}</li>)}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

/**
 * A site's connect flow on a card: what keeps it from posting, and Connect
 * or Reconnect, which opens the dashboard's Connect tab for this business in
 * a new tab (the connection is the account's).
 */
export const SiteChannelFlow: React.FC<{ host: ScreensHost; instanceId: string; network: ConnectNetwork }> = ({ host, instanceId, network: n }) => {
  const status = networkStatus(n);
  const askReconnect = status === 'needs_reconnect' || (status === 'connected' && !!n.reconnect);
  const blocked = connectBlockedReason(n);
  const to = `/team?tab=connect&business=${encodeURIComponent(instanceId)}`;
  const open = () => {
    host.track?.('team', 'connect_in_dashboard', n.id);
    const href = host.link(to);
    if (isAbsoluteAddress(href) && typeof window !== 'undefined') window.open(href, '_blank', 'noopener,noreferrer');
    else host.navigate(to);
  };
  const button = (words: string) => (
    <Button size="sm" variant="primary" rightIcon={<NavIcon name="arrow-top-right-on-square" size={14} />} onClick={open} data-testid="connect-in-dashboard">
      {words}
    </Button>
  );
  if (askReconnect) {
    return (
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }} data-testid="tt-reconnect">
        <p style={{ margin: 0, fontSize: 12, color: status === 'needs_reconnect' ? 'var(--text)' : 'var(--text-dim)' }}>
          {reconnectReason(n, n.label, false)}
        </p>
        {n.connectVia ? button(`Reconnect ${n.label}`) : <p style={{ margin: 0, ...meta }}>{reconnectBlockedReason(n, n.label)}</p>}
      </div>
    );
  }
  if (status !== 'not_connected') return null;
  if (n.connectVia) return <div style={{ marginTop: 8 }}>{button(`Connect ${n.label}`)}</div>;
  return blocked ? <p style={{ margin: '8px 0 0', ...meta }} data-testid="connect-blocked">{blocked}</p> : null;
};

/** The tab as drawn, from what it read and the app's pieces: pure, so the tests render it. */
export const TeamConnectView: React.FC<{
  center: ConnectCenter | null;
  error?: string | null;
  onRefresh: () => void;
  slots?: TeamConnectSlots;
  /** A site's scope: its note over the cards, and no server note. */
  site?: boolean;
  /** The cards' flow when the app brings none (a site's link to the dashboard). */
  defaultFlow?: (network: ConnectNetwork) => React.ReactNode;
  /** For the tests: the grid's width, instead of measuring it. */
  width?: number;
}> = ({ center, error = null, onRefresh, slots = {}, site = false, defaultFlow, width }) => {
  const [gridRef, measured] = useWidth<HTMLDivElement>();
  if (error && !center) return <p role="alert" style={{ margin: 0, fontSize: 14, color: 'var(--danger)' }} data-testid="connect-error">{error}</p>;
  if (!center) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {slots.top}
        <Skeleton height={160} rounded="lg" />
      </div>
    );
  }
  const networks = inChannelOrder(center.networks);
  const columns = evenGridColumns(networks.length, width ?? measured, CHANNEL_CARD_MIN_PX, CHANNEL_GRID_GAP_PX);
  const flow = slots.card ?? defaultFlow;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="connect-tab">
      {slots.top}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 'var(--text-body, 15px)', color: 'var(--text-dim)' }} data-testid="connect-summary">
          {connectSummaryLine(networks)}
          {slots.help}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {slots.actions}
          <Button size="sm" variant="ghost" leftIcon={<NavIcon name="arrow-path" size={16} />} onClick={onRefresh}>
            {CONNECT_COPY.refresh}
          </Button>
        </div>
      </div>
      {slots.underActions}
      {site && <p style={{ margin: 0, fontSize: 14, color: 'var(--text-dim)' }} data-testid="connect-site-note">{CONNECT_COPY.siteNote()}</p>}
      {!site && !center.configured && (
        <Card>
          <CardContent>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-dim)' }}>{CONNECT_COPY.notConfigured}</p>
          </CardContent>
        </Card>
      )}
      {/* Connecting a channel is this tab's whole job: every card's button
          is a primary, equal choices with equal weight. The columns come from
          the grid's own width (even columns, every row full, each card wide
          enough for its longest button). */}
      <div
        ref={gridRef}
        style={{ display: 'grid', gap: CHANNEL_GRID_GAP_PX, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        data-testid="connect-grid"
        data-columns={columns}
      >
        {networks.map((n) => <TeamChannelCard key={n.id} network={n} flow={flow?.(n)} />)}
      </div>
    </div>
  );
};

/**
 * Your team > Connect: reads the business's channels on the app's
 * transport and draws them, with the app's connect flows when it brings
 * them (the account's), else a site's link to the dashboard on each card.
 */
export const ConnectTab: React.FC<{ host: ScreensHost; instanceId: string }> = ({ host, instanceId }) => {
  const errorText = host.errorText ?? errorMessage;
  const [center, setCenter] = useState<ConnectCenter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const site = host.scope.kind === 'site';

  const load = useCallback(() => {
    readConnectCenter(host.transport, instanceId)
      .then((c) => { setCenter(c); setError(null); })
      .catch((e) => setError(errorText(e, CONNECT_COPY.loadFailed)));
    // The host may be a new object on each render: read again only for another business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  useEffect(() => { setCenter(null); setError(null); load(); }, [load]);

  const draw = (slots: TeamConnectSlots = {}) => (
    <TeamConnectView
      center={center}
      error={error}
      onRefresh={load}
      slots={slots}
      site={site}
      defaultFlow={site ? (n) => <SiteChannelFlow host={host} instanceId={instanceId} network={n} /> : undefined}
    />
  );

  const flows = !site ? host.renderers?.teamConnect : undefined;
  return <>{flows ? flows({ instanceId, center, reload: load, render: draw }) : draw()}</>;
};
