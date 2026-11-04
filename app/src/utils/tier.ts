/**
 * What the signed-in WordPress user may reach in the WPMaven API (1.3.0):
 * their tier, computed by the plugin from capabilities (WebMaven_Actor) and
 * handed over as WEBMAVEN_WP_DATA.user.tier. The app shows only the screens
 * and actions of this tier; the API enforces it again from the signed claim.
 *
 *   owner    an Administrator: everything
 *   store    a Shop manager: reports, the bell, finance, traffic, payments
 *   content  an Editor: traffic and goals
 *   null     below: the editor and the content counts only
 */

export type Tier = 'owner' | 'store' | 'content';

export const TIERS: readonly Tier[] = ['owner', 'store', 'content'];

function wpData(): any {
  return (typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA : null) || {};
}

/** The signed-in user's tier, or null. */
export function currentTier(): Tier | null {
  const user = wpData().user || {};
  if (typeof user.tier === 'string' && (TIERS as readonly string[]).includes(user.tier)) return user.tier as Tier;
  if (user.tier === null) return null;
  // A page drawn by a plugin without tiers: administrators only.
  return user.isAdmin ? 'owner' : null;
}

/** Whether the tier is one of these (no list: anyone with a tier). */
export function tierIn(tiers: readonly Tier[] | undefined, tier: Tier | null = currentTier()): boolean {
  if (tier === null) return false;
  return !tiers || tiers.includes(tier);
}

/** An Administrator. */
export function isOwnerTier(tier: Tier | null = currentTier()): boolean {
  return tier === 'owner';
}

/** A login WPMaven support uses on this site. */
export function isStaffLogin(): boolean {
  return wpData().user?.wpm === 'staff';
}

/**
 * The owner's own WordPress account: the one the dashboard's sign-in link
 * made for them (the user meta WebMaven_Cap_Admin_Login::MARKER_META is
 * 'owner', handed over as WEBMAVEN_WP_DATA.user.wpm). Only that account
 * decides money (a refund, a payments setup) from WordPress; the API says
 * it again on each row.
 */
export function isOwnerLogin(): boolean {
  return wpData().user?.wpm === 'owner';
}
