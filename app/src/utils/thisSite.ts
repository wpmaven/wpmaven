/**
 * This WordPress site as the page's data describes it (WEBMAVEN_WP_DATA):
 * the address visitors see and the icon the owner set.
 */

function wpData(): any {
  return (typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA : null) || {};
}

/**
 * The site's own icon (the Site Icon the owner set in WordPress, Settings >
 * General, at 64px), or null when there is none to show: only a web address
 * counts. The kit's SiteIcon draws it, else its globe.
 */
export function siteIconUrl(): string | null {
  const raw = wpData().site?.iconUrl;
  const url = typeof raw === 'string' ? raw.trim() : '';
  return /^https?:\/\/[^\s"'<>]+$/.test(url) ? url : null;
}

/** The site's home as visitors see it (home_url('/')). */
export function siteHomeUrl(): string {
  const wp = wpData();
  return wp.editor?.siteUrl || wp.site?.url || '/';
}
