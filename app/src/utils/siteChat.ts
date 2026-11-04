import { siteBrand, dashboardPhrase, type SiteBrand } from './brand';

/**
 * Chat and AI editing inside WP-admin.
 *
 * The account says per site whether each is on (the site state's
 * features.chat and features.editorAI, GET /sites/me), and the plugin's
 * WEBMAVEN_WP_SITE_TOKEN_CHAT constant can turn both off for a site. The
 * plugin hands the result over per page load, through
 * WEBMAVEN_WP_DATA.siteChat (never on for a WordPress user who is not an
 * administrator). While one is off, every place that would run it shows
 * DashboardOnlyCard instead, and the chat, conversation and SSE providers
 * make no call at all.
 */

/** The chat card's sentence. */
export const SITE_CHAT_CARD_TEXT = 'Chat with your team in your WPMaven dashboard.';
/** The editor's AI panel while AI editing is off: what still works here. */
export const AI_EDITING_OFF_TEXT = 'AI editing is not on for this site yet. You can still change text and images here and publish them.';
/** The SEO panel while AI editing is off. */
export const SEO_AI_OFF_TEXT = 'AI suggestions are not on for this site yet. You can still edit the title and description here.';

/** The chat card's sentence in the site's brand (1.2.31): "your <brand> dashboard", or "your dashboard". */
export function siteChatCardText(b: SiteBrand = siteBrand()): string {
  return b.mode === 'wpmaven' ? SITE_CHAT_CARD_TEXT : `Chat with your team in ${dashboardPhrase(b)}.`;
}

export const DEFAULT_DASHBOARD_URL = 'https://dashboard.wpmaven.ai';

interface SiteChatData {
  enabled?: boolean;
  aiEditing?: boolean;
  dashboardUrl?: string;
}

function siteChatData(): SiteChatData {
  const data = (typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA : null) || {};
  return (data.siteChat as SiteChatData) || {};
}

/** True when the chat runs here, in WP-admin. */
export function isSiteChatEnabled(): boolean {
  return siteChatData().enabled === true;
}

/** True when the page editor's AI (quick edits, smart actions, SEO suggestions) runs here. */
export function isAiEditingEnabled(): boolean {
  return siteChatData().aiEditing === true;
}

/** Where the dashboard card sends the owner: the WPMaven dashboard. */
export function siteChatDashboardUrl(): string {
  const url = siteChatData().dashboardUrl;
  return typeof url === 'string' && /^https?:\/\//.test(url) ? url : DEFAULT_DASHBOARD_URL;
}
