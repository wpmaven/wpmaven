import { ProxyError } from '../services/proxyClient';
import { dashboardPhrase, siteBrand, type SiteBrand } from './brand';

/**
 * The words a screen shows for a failed call (1.3.0), in the site's brand:
 * the API's and the proxy's refusal codes get the app's own sentences, so a
 * White label site never reads "WPMaven"; a code the app does not know keeps
 * the API's own sentence (written for owners) unless it names another brand.
 */

/** "the WPMaven plugin", "the Acme Studio plugin", or "the plugin". */
export function pluginName(b: SiteBrand = siteBrand()): string {
  return b.mode === 'neutral' ? 'the plugin' : `the ${b.name} plugin`;
}

export function errorSentence(err: unknown, fallback?: string, b: SiteBrand = siteBrand()): string {
  const dashboard = dashboardPhrase(b);
  const generic = fallback ?? 'Something went wrong on our side. Try again in a minute.';
  if (!(err instanceof ProxyError)) return generic;
  switch (err.code) {
    case 'SITE_ROLE':
    case 'wpmaven_role':
    case 'rest_forbidden':
      return 'Your WordPress role can\'t use this. An administrator of this site can.';
    case 'SITE_NOT_ENABLED':
      return `This is not on in WordPress yet. Use it from ${dashboard}.`;
    case 'SITE_SESSION_ONLY':
    case 'wpmaven_not_allowed':
      return `This is managed in ${dashboard}.`;
    case 'SITE_PLUGIN_UPDATE_REQUIRED':
    case 'SITE_ACTOR_REQUIRED':
      return `Update ${pluginName(b)} on this site to use this from WordPress.`;
    case 'SITE_ACTOR_INVALID':
      return 'This request could not be checked, so nothing was done. Reload the page. If it keeps happening, check this server\'s clock.';
    case 'SITE_BUSINESS':
    case 'wpmaven_business':
      return 'A WordPress site can only work on its own business.';
    case 'SITE_PAUSED':
      return `This business is paused, so nothing can be changed from WordPress. See ${dashboard}.`;
    case 'SITE_FIRST_WEEK':
      return `AI work from WordPress starts with your first full month. Until then, use ${dashboard}.`;
    case 'SITE_RATE_LIMITED':
      return 'This was asked many times in a short while. Try again a little later.';
    case 'wpmaven_spend_limit':
      return 'AI request limit reached for this hour. Try again later.';
    case 'APPROVAL_IN_DASHBOARD':
      return `Posts, videos and messages to customers wait for your yes in ${dashboard}.`;
    case 'wpmaven_site_not_connected':
      return 'This site is not connected right now. Reconnect it, then try again.';
    case 'rest_cookie_invalid_nonce':
      return 'Your WordPress session expired. Reload the page.';
    case 'network':
      return 'This could not be reached just now. Check your connection and try again.';
    default:
      break;
  }
  if (err.status === 429) return 'This was asked many times in a short while. Try again a little later.';
  if (err.status === 0 || err.status >= 500 || err.code === 'bad_response') return generic;
  const own = err.message && !/^HTTP \d+$/.test(err.message) && !/^Network error/.test(err.message) ? err.message : '';
  if (own && (b.mode === 'wpmaven' || !/WPMaven/.test(own)) && own.length <= 300) return own;
  return generic;
}
