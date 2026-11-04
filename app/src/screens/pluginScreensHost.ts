/**
 * The host the plugin gives the screens it shares with the dashboard
 * (@yotako/wpmaven-screens, 1.7.0): its REST proxy as the transport, this
 * site alone as the scope, its own pages for the dashboard's addresses it
 * has (the dashboard in a new tab for the others), what this WordPress user
 * may decide, its error sentences and its edit preview, its brand and the
 * referral link it can vouch for (its dashboard's address), and the way to
 * the dashboard for whoever may not set up payments here.
 *
 * The dashboard builds its own host on its API client, for the account.
 */
import { useMemo } from 'react';
import { isScreensApiError, type ScreensHost } from '@yotako/wpmaven-screens';
import { setHostProductName } from '@yotako/wpmaven-onboarding/shared';
import { ProxyError } from '../services/proxyClient';
import { EditsRequestError } from '../services/edits';
import { errorSentence } from '../utils/apiWords';
import { siteBrand } from '../utils/brand';
import { dashboardLink, useSiteState, type SiteState } from '../utils/siteState';
import { isOwnerLogin, isOwnerTier, isStaffLogin } from '../utils/tier';
import { navigateHash } from '../hooks/useHashRoute';
import { PluginScreensError, pluginScreensTransport } from './screensTransport';
import { pluginHref, pluginPlace, type PluginPlace } from './pluginLinks';
import { PLUGIN_RENDERERS, getPaidInDashboard } from './pluginRenderers';
import { siteInstanceId } from './siteScope';

export { siteInstanceId, siteScope } from './siteScope';

/**
 * A failure in the plugin's own words (utils/apiWords), in the site's
 * brand: the proxy's error the screens' one was made from, its codes
 * (SITE_ROLE, wpmaven_business...) said as everywhere else in the plugin.
 */
export function pluginErrorText(e: unknown, fallback: string): string {
  if (e instanceof PluginScreensError && e.source instanceof EditsRequestError) return e.source.message || fallback;
  if (e instanceof PluginScreensError && e.source instanceof ProxyError) return errorSentence(e.source, fallback);
  if (isScreensApiError(e)) {
    const code = e.code === 'ERR_NETWORK' ? 'network' : e.code;
    return errorSentence(new ProxyError(e.message, e.status, '', code, null, e.data), fallback);
  }
  return errorSentence(e, fallback);
}

/** The product's name the shared sentences say: the brand's on a branded site, else WPMaven. */
function nameTheProduct(): void {
  const brand = siteBrand();
  setHostProductName(brand.mode === 'wpmaven' ? null : brand.name);
}

/** Opens a place: the plugin's own page, or the dashboard in a new tab. */
export function openPluginPlace(place: PluginPlace): void {
  if (place.kind === 'app') navigateHash(place.hash);
  else window.open(place.url, '_blank', 'noopener,noreferrer');
}

/** Opens a dashboard address: the plugin's own page, or the dashboard in a new tab. */
export function openPluginAddress(to: string, site: SiteState, instanceId: string): void {
  openPluginPlace(pluginPlace(to, site, instanceId));
}

/** Whether two addresses share an origin (scheme, host, port); false for one that does not parse. */
export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** The plugin's host for this site, for the person signed in to WordPress. */
export function pluginScreensHost(site: SiteState): ScreensHost {
  nameTheProduct();
  const instanceId = siteInstanceId(site);
  return {
    transport: pluginScreensTransport,
    scope: { kind: 'site', instanceId },
    navigate: (to) => openPluginAddress(to, site, instanceId),
    link: (to) => pluginHref(pluginPlace(to, site, instanceId)),
    viewer: {
      // Money is decided only by the owner's own WordPress account; the
      // API's per-row `decidable` says it again and wins.
      decidesMoney: isOwnerLogin(),
      // WPMaven support signed in here: a post to TikTok or an upload to
      // YouTube stays the owner's own.
      staffViewing: isStaffLogin(),
      // Overview's Goals: an administrator adds one (the API's route table
      // gives POST /analytics/:id/goals to the owner tier only).
      addsGoals: isOwnerTier(),
      // Turn on a way to get paid is money: set up only from the owner's own
      // WordPress account (the API's ownerLogin); anyone else gets the way
      // to the dashboard (renderers.getPaidNeedsOwner).
      setsUpPayments: isOwnerLogin(),
      // Check what your site says about you: administrators.
      editsBusinessDetails: isOwnerTier(),
      // Feature on WPMaven is public work the owner's own account decides.
      featuresBusiness: isOwnerLogin(),
    },
    renderers: { ...PLUGIN_RENDERERS, getPaidNeedsOwner: () => getPaidInDashboard(site) },
    errorText: pluginErrorText,
    // A site under another brand, or naming nobody, never names WPMaven's
    // programs: no referral link, no Feature on WPMaven.
    whiteLabel: siteBrand().mode !== 'wpmaven',
    // The referral link is recorded where the dashboard runs: a share
    // carries it only when it points there.
    referralLinkAttributes: (shareUrl) => sameOrigin(shareUrl, dashboardLink(site, '/')),
  };
}

/** The host, kept while the site state is the same. */
export function usePluginScreensHost(): ScreensHost {
  const site = useSiteState();
  return useMemo(() => pluginScreensHost(site), [site]);
}
