/**
 * Whose data the shared screens read in the plugin: this site's business
 * alone (WEBMAVEN_WP_DATA.instanceId, else the account's site state). No
 * import of the pages' registry, so the sidebar's count can read it.
 */
import type { ScreensScope } from '@yotako/wpmaven-screens';
import { getInstanceId } from '../services/proxyClient';
import type { SiteState } from '../utils/siteState';

/** This site's business: WEBMAVEN_WP_DATA.instanceId, else the account's site state. */
export function siteInstanceId(site?: SiteState | null): string {
  return getInstanceId() || site?.instance?.id || '';
}

/** Every read of a shared screen names this site's business. */
export function siteScope(site?: SiteState | null): ScreensScope {
  return { kind: 'site', instanceId: siteInstanceId(site) };
}
