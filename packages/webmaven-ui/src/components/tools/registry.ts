import { ToolRendererMap } from './types';
import { JsonFallback } from './JsonFallback';
import { PluginCard } from './PluginCard';
import { ThemeCard } from './ThemeCard';
import { SearchResults } from './SearchResults';
import { ImageGrid } from './ImageGrid';
import { PostPreview } from './PostPreview';
import { AuditIssuesList } from './AuditIssuesList';
import { CommandOutput } from './CommandOutput';
import { StatusLine } from './StatusLine';
import { FileDiff } from './FileDiff';

/**
 * Default renderer map. Keys match the `uiSpec.resultComponent` strings
 * each tool emits from the backend (see registerChatTools.ts +
 * registerSubagentTools.ts).
 *
 * Frontends override per-key for embedded surfaces (e.g. an editor
 * overrides `image_generation.result` with one that has "Insert into
 * selection") via the `overrides` prop on AgentTimeline.
 */
export const defaultToolRenderers: ToolRendererMap = {
  // --- Plugin / theme ---
  'plugin_search.result': PluginCard,
  'wp.install_plugin.result': PluginCard,
  // (activate_plugin / deactivate_plugin don't ship a uiSpec yet, but
  // when they do this same widget covers them — keys can be added here.)

  'theme_search.result': ThemeCard,
  'wp.install_theme.result': ThemeCard,

  // --- Web ---
  'web_search.result': SearchResults,
  'web_fetch.result': SearchResults,

  // --- Content ---
  'image_generation.result': ImageGrid,
  'content_generation.result': PostPreview,
  'wp.create_post.result': PostPreview,
  'wp.create_page.result': PostPreview,

  // --- Audits / reflective tools ---
  // (seo_optimize, accessibility_checker, etc. don't all set their
  //  resultComponent yet — when they do, point them here.)
  'report.result': AuditIssuesList,
  'analytics.result': AuditIssuesList,

  // --- Commands ---
  // (execute_command's webhookTool factory doesn't set a resultComponent
  //  by default; uiSpec.summaryTemplate handles the start line.)

  // Subagent tools (content sub-tools) — fall through to JsonFallback.
};

/**
 * Compose a final renderer map: defaults + caller-provided overrides.
 * Used by AgentTimeline; exported separately for callers that want to
 * pre-build the map.
 */
export function mergeRenderers(overrides?: ToolRendererMap): ToolRendererMap {
  return { ...defaultToolRenderers, ...(overrides || {}) };
}

export { JsonFallback };
