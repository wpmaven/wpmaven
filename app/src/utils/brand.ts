/**
 * Whose name the WP-admin app shows (1.2.31).
 *
 * The plugin decides on the PHP side (backend/wpmaven/includes/class-webmaven-brand.php)
 * from the API's plan read, and hands the answer over as
 * WEBMAVEN_WP_DATA.brand:
 *
 *   mode 'wpmaven'  the site is WPMaven's: every word stays WPMaven's;
 *   mode 'brand'    the site is under an agency's (White label) or a
 *                   wholesale partner's brand: its name, logo and color;
 *   mode 'neutral'  under a brand with no name yet, or one not read yet:
 *                   words that name nobody, never WPMaven.
 *
 * No `brand` at all (an older page, a test) reads as WPMaven's site; a
 * `brand` this file cannot read reads as neutral.
 */

export type BrandMode = 'wpmaven' | 'brand' | 'neutral';

export interface SiteBrand {
  mode: BrandMode;
  /** "WPMaven", the brand's name, or "Site assistant". */
  name: string;
  /** The brand's logo (https), or ''. */
  logoUrl: string;
  /** The brand's color (#rrggbb), or ''. */
  color: string;
  /** Where "open your dashboard" goes. */
  dashboardUrl: string;
}

export const PRODUCT_NAME = 'WPMaven';
export const NEUTRAL_NAME = 'Site assistant';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function wpData(): any {
  return (typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA : null) || {};
}

/** The brand this page shows. */
export function siteBrand(): SiteBrand {
  const raw = wpData().brand;
  if (raw === undefined || raw === null) {
    return { mode: 'wpmaven', name: PRODUCT_NAME, logoUrl: '', color: '', dashboardUrl: '' };
  }
  const dashboardUrl = /^https?:\/\//.test(str(raw?.dashboardUrl)) ? str(raw.dashboardUrl) : '';
  if (typeof raw === 'object' && raw.mode === 'wpmaven') {
    return { mode: 'wpmaven', name: PRODUCT_NAME, logoUrl: '', color: '', dashboardUrl };
  }
  const name = typeof raw === 'object' ? str(raw.name) : '';
  const logoUrl = typeof raw === 'object' && /^https:\/\//.test(str(raw.logoUrl)) ? str(raw.logoUrl) : '';
  const color = typeof raw === 'object' && /^#[0-9a-fA-F]{6}$/.test(str(raw.color)) ? str(raw.color) : '';
  if (typeof raw === 'object' && raw.mode === 'brand' && name !== '') {
    return { mode: 'brand', name, logoUrl, color, dashboardUrl };
  }
  return { mode: 'neutral', name: NEUTRAL_NAME, logoUrl: '', color, dashboardUrl };
}

export function isWpmavenSite(b: SiteBrand = siteBrand()): boolean {
  return b.mode === 'wpmaven';
}

/** "WPMaven", the brand's name, or `neutral` (words that name nobody). */
export function nameOr(neutral: string, b: SiteBrand = siteBrand()): string {
  if (b.mode === 'wpmaven') return PRODUCT_NAME;
  return b.mode === 'brand' ? b.name : neutral;
}

/** "your WPMaven dashboard", "your Acme Studio dashboard", or "your dashboard". */
export function dashboardPhrase(b: SiteBrand = siteBrand()): string {
  if (b.mode === 'neutral') return 'your dashboard';
  return `your ${b.name} dashboard`;
}

/** "your WPMaven account", "your Acme Studio account", or "your account". */
export function accountPhrase(b: SiteBrand = siteBrand()): string {
  if (b.mode === 'neutral') return 'your account';
  return `your ${b.name} account`;
}

/** This site's own name, for a neutral mark. */
export function siteName(): string {
  return str(wpData().site?.name);
}
