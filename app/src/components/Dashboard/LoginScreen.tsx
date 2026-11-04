import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';
import { dashboardSignInUrl, openDashboard } from '../../utils/dashboardSignIn';
import { GlassCard, Button } from '@yotako/webmaven-ui';
import Loader from '../BrandLoader';
import { LOADING_SIZE } from '../AppLoading';
import BrandMark from '../BrandMark';
import { siteBrand, nameOr, accountPhrase, type SiteBrand } from '../../utils/brand';
import { siteChatDashboardUrl } from '../../utils/siteChat';
import StartChoice, { rememberStartIntent, type StartIntent } from './StartChoice';

/** Why Sign In and Create Account are off for anyone but an administrator (1.2.14). */
export const ADMIN_ONLY_TEXT = 'Only an administrator of this site can connect it to WPMaven.';
/** The site could not give out a link token. */
export const LINK_START_FAILED_TEXT = 'We could not start the connection from this site. Reload this page and try again.';
/**
 * What connecting shares, said before the owner connects (1.2.29). A
 * connected site sends its sales, bookings and form figures every hour
 * (class-alert-detector.php, POST /metrics/report), and the team reads and
 * changes the site through the plugin. Visitor statistics and the copy of the
 * store's customers for email campaigns (class-contact-sync.php) are the
 * owner's choice, asked once connected (ChoicesQuestion): the line says so.
 */
export const DATA_NOTICE_TEXT =
  "Connecting lets WPMaven read and change this site, and send figures such as sales, bookings and form submissions to your WPMaven account for your reports. Visitor statistics and the copy of your store's customers for email campaigns are your choice, asked once you are connected.";
export const PRIVACY_POLICY_URL = 'https://wpmaven.ai/privacy-policy.html';

/*
 * The same words on a site under an agency's or a partner's brand (1.2.31,
 * utils/brand.ts): its name instead of ours, and words that name nobody
 * while the brand is unknown. On a WPMaven site they are the constants above.
 */
export function adminOnlyText(b: SiteBrand = siteBrand()): string {
  if (b.mode === 'wpmaven') return ADMIN_ONLY_TEXT;
  return b.mode === 'brand'
    ? `Only an administrator of this site can connect it to ${b.name}.`
    : 'Only an administrator of this site can connect it.';
}

export function dataNoticeText(b: SiteBrand = siteBrand()): string {
  if (b.mode === 'wpmaven') return DATA_NOTICE_TEXT;
  const who = nameOr('the service that runs this site', b);
  return `Connecting lets ${who} read and change this site, and send figures such as sales, bookings and form submissions to ${accountPhrase(b)} for your reports. Visitor statistics and the copy of your store's customers for email campaigns are your choice, asked once you are connected.`;
}

export function headlineText(reconnect: boolean, b: SiteBrand = siteBrand()): string {
  if (b.mode === 'neutral') return reconnect ? 'Reconnect this site' : 'Welcome';
  return reconnect ? `Reconnect this site to ${b.name}` : `Welcome to ${b.name}`;
}

export function reconnectText(b: SiteBrand = siteBrand()): string {
  return `This site lost its link to ${accountPhrase(b)}. Sign in to connect it again.`;
}

/** The site's stored connection no longer decrypts, after a restore (1.6.0). */
export function unreadableText(b: SiteBrand = siteBrand()): string {
  const to = b.mode === 'neutral' ? '' : ` to ${b.name}`;
  return `This site's connection could not be read after a restore. Reconnect it${to}.`;
}

export function takingYouText(b: SiteBrand = siteBrand()): string {
  return b.mode === 'neutral' ? 'Taking you to sign-in…' : `Taking you to ${b.name} sign-in…`;
}

function LoginScreen() {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { loading: authLoading, connection, connectionReason } = useAuth();
  // Linked before, but WPMaven no longer accepts the link (1.2.9).
  const reconnect = connection === 'reconnect';
  const wpData = (window as any).WEBMAVEN_WP_DATA || {};
  // Which WPMaven account runs this site is an administrator's choice
  // (1.2.14): the site only accepts a link its administrator started.
  const isAdmin = !!wpData.user?.isAdmin;
  // Whose name this screen carries (1.2.31). A site under a brand was
  // linked before, by that brand's account: it is signed in again, never
  // used to open a new account.
  const brand = siteBrand();
  const offerCreate = brand.mode === 'wpmaven';

  // Same-tab navigation, not a popup: the dashboard's success page ends with
  // "Go back to your site" pointing right back at this admin page, so the
  // round trip is seamless and never leaves an orphan tab behind.
  //
  // The site first gives this administrator a link token (1.2.14). The
  // dashboard hands it to WPMaven with the site's address, and the site
  // accepts the credentials WPMaven sends back only when they carry it.
  const goToDashboard = async (path: '/login' | '/register', start: StartIntent | null = null) => {
    setConnecting(true);
    setError(null);
    try {
      const link = await api.startLink();
      const linkToken = link && link.success && typeof link.linkToken === 'string' ? link.linkToken : '';
      if (!linkToken) {
        throw new Error('The site gave out no link token');
      }
      openDashboard(dashboardSignInUrl(path, {
        dashboardUrl: wpData.remotes?.dashboardUrl || siteChatDashboardUrl(),
        siteUrl: wpData.site?.url || window.location.origin,
        // The site's title; with none, the account names the business after its address.
        siteName: wpData.site?.name || '',
        linkToken,
        start,
      }));
    } catch (err) {
      console.error('Failed to open dashboard auth:', err instanceof Error ? err.message : 'unknown error');
      setError(LINK_START_FAILED_TEXT);
      setConnecting(false);
    }
  };

  const handleSignIn = () => goToDashboard('/login');
  const handleSignUp = (start: StartIntent | null = null) => goToDashboard('/register', start);

  const notice = (
    <>
      {dataNoticeText(brand)}{' '}
      <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
        Privacy policy
      </a>
    </>
  );

  // WPMaven's first page (2026-10-26): build a business, or manage this site
  // for free. Each starts with a free account; the choice is kept for the way
  // back (StartChoice). A reconnect, or a site under a brand, signs in as before.
  if (!reconnect && offerCreate && !connecting) {
    return (
      <StartChoice
        brand={brand}
        disabled={authLoading || !isAdmin}
        onBuild={() => { rememberStartIntent('build'); void handleSignUp('build'); }}
        onManage={() => { rememberStartIntent('manage'); void handleSignUp('manage'); }}
        signedOut={{ onSignIn: handleSignIn, notice }}
      >
        {!isAdmin && (
          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '18px 0 0', lineHeight: 1.5 }}>{adminOnlyText(brand)}</p>
        )}
        {error && (
          <p role="alert" style={{ fontSize: 13, color: 'var(--rose, #e8919f)', margin: '18px 0 0', lineHeight: 1.5 }}>{error}</p>
        )}
      </StartChoice>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'var(--wm-app-height, 100vh)', background: 'var(--bg)', padding: 24 }}>
      <GlassCard padding="48px 40px" style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <div style={{ marginBottom: 32 }}>
          {/* Side by side at 36, as on the dashboard's sign-in. The lockup is a
              block, so the row centres it: the card's text-align does not. */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <BrandMark size={36} brand={brand} />
          </div>
          <h1 style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-title)', fontWeight: 400, lineHeight: 1.25, color: 'var(--text)', margin: '0 0 8px' }}>
            {headlineText(reconnect, brand)}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-dim)', margin: 0, lineHeight: 1.6 }}>
            {reconnect
              ? (connectionReason === 'unreadable' ? unreadableText(brand) : reconnectText(brand))
              : 'Connect your account to unlock AI-powered site management.'}
          </p>
        </div>

        {connecting ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 0' }}>
            {/* The loading screen's size: the mark reads about 64px wide. */}
            <Loader size={LOADING_SIZE} />
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', margin: 0 }}>
              {takingYouText(brand)}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>
              You'll come right back here once you're signed in.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Button variant="primary" onClick={handleSignIn} disabled={authLoading || !isAdmin} style={{ width: '100%', justifyContent: 'center', padding: '12px 24px', fontSize: 15 }}>
              Sign In
            </Button>
            {offerCreate && (
              <Button variant="ghost" onClick={() => void handleSignUp()} disabled={authLoading || !isAdmin} style={{ width: '100%', justifyContent: 'center', padding: '12px 24px', fontSize: 15 }}>
                Create Account
              </Button>
            )}
            {!isAdmin && (
              <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: '6px 0 0', lineHeight: 1.5 }}>
                {adminOnlyText(brand)}
              </p>
            )}
            {error && (
              <p role="alert" style={{ fontSize: 13, color: 'var(--rose, #e8919f)', margin: '6px 0 0', lineHeight: 1.5 }}>
                {error}
              </p>
            )}
          </div>
        )}

        <p data-testid="wm-data-notice" style={{ fontSize: 12, color: 'var(--text-dim)', margin: '28px 0 0', lineHeight: 1.5 }}>
          {dataNoticeText(brand)}
          {/* Our privacy policy only where the site is ours: under a brand,
              the agency or partner tells its clients about its own. */}
          {brand.mode === 'wpmaven' && (
            <>
              {' '}
              <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                Privacy policy
              </a>
            </>
          )}
        </p>
      </GlassCard>
    </div>
  );
}

export default LoginScreen;
