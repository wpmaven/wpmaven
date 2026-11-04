/**
 * Sign In and Create Account in WP-admin open the WPMaven dashboard with this
 * site's address, its name and the link token the site gave its
 * administrator (1.2.14). The dashboard hands the token to WPMaven with the
 * address, and the site accepts the credentials WPMaven sends back only when
 * they carry it (backend/wpmaven/includes/class-webmaven-link-guard.php).
 *
 * The token goes after the #, never in the query: the browser does not send
 * that part to any server, so the dashboard's request logs and the Referer of
 * its own requests never hold it. The dashboard takes it
 * from there and off the address as the page loads.
 *
 * A site installed from a hosting partner's panel carries the partner's code
 * (1.2.31, backend/wpmaven/includes/class-webmaven-partner.php). It goes on these
 * links as ?partner= (and the partner's own customer reference as ?pref=),
 * which the dashboard keeps for 90 days and sends once the account exists,
 * so the customer counts for that partner.
 */
export interface DashboardSignIn {
  dashboardUrl: string;
  siteUrl: string;
  siteName: string;
  linkToken: string;
  /** The hosting partner's code and reference; sitePartner() when left out. */
  partner?: SitePartner | null;
  /** The way the owner chose on WPMaven's first page: the dashboard sends "manage" back here once connected. */
  start?: 'build' | 'manage' | null;
}

export interface SitePartner {
  code: string;
  ref: string;
}

// The API's partner codes: WPM-P- and six of an alphabet with no 0, O, 1, I or L.
const PARTNER_CODE_RE = /^WPM-P-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const PARTNER_REF_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** The partner code this site carries (WEBMAVEN_WP_DATA.partner), or null. */
export function sitePartner(): SitePartner | null {
  const raw = (typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA?.partner : null) || null;
  const code = typeof raw?.code === 'string' ? raw.code.trim().toUpperCase() : '';
  if (!PARTNER_CODE_RE.test(code)) return null;
  const ref = typeof raw?.ref === 'string' && PARTNER_REF_RE.test(raw.ref.trim()) ? raw.ref.trim() : '';
  return { code, ref };
}

/** `url` with the partner's code (and reference) in its query; unchanged without a code. */
export function withPartner(url: string, partner: SitePartner | null = sitePartner()): string {
  if (!partner || !PARTNER_CODE_RE.test(partner.code)) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.searchParams.set('partner', partner.code);
  if (partner.ref && PARTNER_REF_RE.test(partner.ref)) parsed.searchParams.set('pref', partner.ref);
  return parsed.toString();
}

export function dashboardSignInUrl(path: '/login' | '/register', p: DashboardSignIn): string {
  const url = new URL(path, p.dashboardUrl);
  url.searchParams.set('site_url', p.siteUrl);
  url.searchParams.set('site_name', p.siteName);
  if (p.start === 'build' || p.start === 'manage') url.searchParams.set('start', p.start);
  url.hash = new URLSearchParams({ link_token: p.linkToken }).toString();
  return withPartner(url.toString(), p.partner === undefined ? sitePartner() : p.partner);
}

/** Leave WP-admin for the dashboard in the same tab (a function, so a test can stand in for it). */
export function openDashboard(url: string): void {
  window.location.assign(url);
}
