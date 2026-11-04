/**
 * The pieces only the plugin draws inside the shared screens (1.7.0): a
 * change through the edit operations shows the chat's own preview card
 * (components/edits/ChatEditCards.tsx), the preview alone, under the
 * shared card's own Approve and Decline, as the dashboard shows its own.
 *
 * Which rows those are: a row that carries its preview (the API's `edit`,
 * in the row, its parameters or its metadata), or an edit tool's call that
 * names the preview it publishes (params.previewId), read from the site's
 * changes once. A preview that cannot be read leaves the row to the shared
 * preview (the page as it will look, and Before).
 *
 * Overview's Turn on a way to get paid, for any WordPress account but the
 * owner's own (only that account sets up payments from WordPress): the way
 * to the dashboard, where the owner turns it on (getPaidInDashboard).
 */
import React, { useEffect, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import type { ApprovalShape, ScreensRenderers } from '@yotako/wpmaven-screens';
import { ApprovalPreview } from '@yotako/wpmaven-screens/approvals';
import { EditPreviewCardView, parsePreviewCard, previewCardOf } from '../components/edits/ChatEditCards';
import { editsApi } from '../services/edits';
import { DESIGN_OPS, type EditPreviewCard } from '../types/edits';
import { dashboardPhrase } from '../utils/brand';
import { withPartner } from '../utils/dashboardSignIn';
import { dashboardLink, type SiteState } from '../utils/siteState';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The tools that are edit operations: their approvals publish a preview. */
export const EDIT_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...DESIGN_OPS,
  'update_product', 'add_product', 'remove_product', 'update_post', 'add_post', 'remove_post',
  'update_facts', 'update_menu', 'set_front_page', 'undo_edit', 'update_form_settings',
  'rewrite_post', 'update_products', 'set_homepage',
]);

type EditRow = { toolName?: string | null; params?: unknown; edit?: unknown; metadata?: unknown };

/** The preview a row carries, or null. */
export function carriedEditPreview(row: EditRow): EditPreviewCard | null {
  const params = isObj(row.params) ? row.params : null;
  const meta = isObj(row.metadata) ? row.metadata : null;
  for (const candidate of [row.edit, params?.edit, meta?.edit]) {
    const card = parsePreviewCard(candidate);
    if (card) return card;
  }
  return null;
}

/** The preview an edit tool's call publishes, by its id, or null. */
export function editPreviewIdOf(row: EditRow): string | null {
  if (!row.toolName || !EDIT_TOOL_NAMES.has(row.toolName)) return null;
  const id = isObj(row.params) ? row.params.previewId : null;
  return typeof id === 'string' && /^[a-z0-9]{20,40}$/.test(id) ? id : null;
}

/** A change through the edit operations, drawn by the plugin's preview card. */
export function isPluginEditApproval(row: EditRow): boolean {
  return !!carriedEditPreview(row) || !!editPreviewIdOf(row);
}

/** The shared preview, never this file's (the fallback below). */
const SHARED_ONLY: Pick<ScreensRenderers, 'editPreview'> = { editPreview: { matches: () => false, render: () => null } };

/** The preview of a change to the site, under the shared card's decision. */
export function PluginApprovalEditPreview({ approval, className }: { approval: ApprovalShape; className?: string }) {
  const carried = carriedEditPreview(approval);
  const previewId = carried ? null : editPreviewIdOf(approval);
  const [read, setRead] = useState<{ card: EditPreviewCard | null; done: boolean }>({ card: null, done: false });
  useEffect(() => {
    if (!previewId) return undefined;
    let alive = true;
    setRead({ card: null, done: false });
    editsApi.get(previewId)
      .then((r) => previewCardOf({ ...r, previewId: r.previewId || r.operationId }, null))
      .catch(() => null)
      .then((card) => { if (alive) setRead({ card, done: true }); });
    return () => { alive = false; };
  }, [previewId]);
  const card = carried ?? read.card;
  if (card) {
    return (
      <div className={className} data-testid="plugin-edit-preview">
        <EditPreviewCardView card={card} />
      </div>
    );
  }
  // Still reading: nothing yet, so the card does not jump from one look to the other.
  if (previewId && !read.done) return null;
  return <ApprovalPreview approval={approval} className={className} renderers={SHARED_ONLY} />;
}

/**
 * Turn on a way to get paid as a link to the dashboard: the business's page
 * there, whose card sets it up, in a new tab, on the brand's own address.
 */
export function getPaidInDashboard(site: SiteState): React.ReactNode {
  const href = site.links.business ?? (site.instance ? dashboardLink(site, `/instances/${encodeURIComponent(site.instance.id)}`) : dashboardLink(site, '/'));
  const dashboard = dashboardPhrase();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }} data-testid="getpaid-in-dashboard">
      <span>{`Turn it on in ${dashboard}.`}</span>
      <a href={withPartner(href)} target="_blank" rel="noopener noreferrer" title="Opens your dashboard in a new tab" style={{ textDecoration: 'none' }}>
        <Button variant="primary" size="sm">{`Open ${dashboard}`}</Button>
      </a>
    </div>
  );
}

/** The pieces only the plugin draws, for every shared screen. */
export const PLUGIN_RENDERERS: ScreensRenderers = {
  editPreview: {
    matches: isPluginEditApproval,
    render: (approval, { className }) => <PluginApprovalEditPreview approval={approval} className={className} />,
  },
};
