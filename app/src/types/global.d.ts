// Global type declarations for WebMaven WordPress
// (asset module declarations live in assets.d.ts — must be in an ambient
//  file, not a module file like this one which has `export {}`)

// Window globals
declare global {
  /** Which plugin the app is built for (webpack's DefinePlugin, build.sh --edition). */
  const __WPMAVEN_EDITION__: 'full' | 'wporg';

  interface Window {
    React: typeof import('react');
    ReactDOM: typeof import('react-dom');
    marked: {
      parse: (markdown: string) => string;
    };
    WEBMAVEN_WP_DATA: WebMavenWPData;
  }
}

// WebMaven WordPress localized data
interface WebMavenWPData {
  restUrl: string;
  /** The app's fonts: null when the plugin's own copy is on the page, else the stylesheet to import. */
  fontsHref?: string | null;
  nonce: string;
  assetsUrl: string;
  settings: {
    theme_color: string;
    accent_color: string;
    position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    offset: { x: number; y: number };
  };
  remoteUrls: {
    oauth: string;
    dashboard: string;
    billing: string;
  };
  userInfo: {
    name: string;
    email: string;
    isAdmin: boolean;
  };
  siteInfo: {
    name: string;
    url: string;
    adminUrl: string;
  };
  userPrefs: {
    colors: Record<string, string>;
    position: string;
    offset: { x: number; y: number };
  };
  /** admin_url(). */
  adminUrl?: string;
  /** The current WordPress user; firstName is their own (the greeting). */
  user?: { id: number; displayName: string; firstName?: string; email: string; isAdmin: boolean };
  /** The account holder's first name (administrators only). */
  account?: { firstName: string; lastName: string; email: string };
  /** The site's title, decoded, and addresses. */
  site?: { name: string; url: string; adminUrl: string };
  editor?: { restUrl: string; siteUrl: string; siteOrigin: string; pluginUrl: string; apiConnected: boolean };
  /** What the account says about this site's business (utils/siteState.ts normalizes it). */
  siteState?: unknown;
  /** An administrator's setup card shows. */
  setupNeeded?: boolean;
  /** For older readers: true unless the account says setup is needed. */
  onboardingCompleted?: boolean;
  /** Chat and AI editing in WP-admin, for this user, per page load. */
  siteChat?: { enabled: boolean; aiEditing?: boolean; switchOn?: boolean; dashboardUrl: string };
  /** WordPress's own screens this user may open ("Advanced"). */
  wpAdminLinks?: Array<{ key: string; label: string; url: string }>;
  /** The store's other payment methods (administrators only). */
  store?: { active: boolean; gateways: string[]; manageUrl: string };
  /** Where this site lives: its identity (WP_HOME, else home) and the edge's primary host. */
  siteIdentity?: { home: string; primaryHost: string };
}

export {};
