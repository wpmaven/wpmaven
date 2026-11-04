/**
 * Editor config bridge — maps WEBMAVEN_WP_DATA to the wmeConfig shape
 * that the editor components expect.
 *
 * This is injected into the global scope so existing editor code works
 * without modification.
 */

interface WmeConfig {
  siteUrl: string;
  restUrl: string;
  nonce: string;
  postId: number;
  pluginUrl: string;
  adminUrl: string;
  siteOrigin: string;
  hasApiKey: boolean;
  settingsUrl: string;
  instanceId: string;
}

export function initEditorConfig(postId: number = 0): void {
  const wpData = (window as any).WEBMAVEN_WP_DATA;
  if (!wpData) return;

  const editorData = wpData.editor || {};

  (window as any).wmeConfig = {
    siteUrl: editorData.siteUrl || wpData.site?.url || window.location.origin,
    restUrl: editorData.restUrl || wpData.restUrl?.replace('webmaven_wp/v1', 'webmaven/v1') || '/wp-json/webmaven/v1',
    nonce: wpData.nonce || '',
    postId: postId,
    pluginUrl: editorData.pluginUrl || wpData.assets?.logo?.replace('/assets/logo.png', '/') || '',
    adminUrl: wpData.adminUrl || wpData.site?.adminUrl || '/wp-admin/',
    siteOrigin: editorData.siteOrigin || wpData.site?.url || window.location.origin,
    hasApiKey: editorData.apiConnected || false,
    settingsUrl: (wpData.adminUrl || '/wp-admin/') + 'admin.php?page=webmaven-dashboard',
    instanceId: wpData.instanceId || '',
  } satisfies WmeConfig;
}

export function updateEditorPostId(postId: number): void {
  if ((window as any).wmeConfig) {
    (window as any).wmeConfig.postId = postId;
  }
}
