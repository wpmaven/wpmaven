import type React from 'react';
import type { NavIconName } from '@yotako/webmaven-ui';
import type { SiteFeature } from '../../../../utils/siteState';
import type { Tier } from '../../../../utils/tier';

/**
 * The sidebar's parts, top to bottom (2026-10-16): Overview and the Editor
 * apart at the top, then what an owner acts on (Waiting for you, Messages,
 * Your team), then the groups that fold: Content, Store and Insights.
 * WordPress's own screens fold under the last group, WordPress, which is not
 * a page of the app (wpAdminLinks).
 */
export type SidebarGroupId = 'pages' | 'work' | 'content' | 'store' | 'insights';

/**
 * One screen of the plugin's app: its address, its place in the sidebar and
 * the account flag it needs. The component lives in the workstream's
 * <name>.screens.tsx, so the dashboard context can read the routes without
 * importing any screen.
 */
export interface PageRoute {
  /** The page id (currentPage): lowercase words and dashes, unique across the app. */
  id: string;
  /** The address after #/ (the browser's back and forward, shareable links); '' is Overview. */
  hash: string;
  /** The sidebar's part the entry sits in; with no group (or no order), the page has no entry. */
  group?: SidebarGroupId;
  /** The entry's place inside its group, smaller first: one number per entry, never shared in a group. */
  order?: number;
  label?: string;
  /** The entry's icon, a name in the kit's NavIcon set (the dashboard's own). */
  icon?: NavIconName;
  /** The account flag (SiteState.features) the screen needs: without it the page sends to Overview. */
  feature?: SiteFeature;
  /** More account flags the screen needs besides `feature`, all of them, with the same rule. */
  alsoNeeds?: readonly SiteFeature[];
  /** With a flag it needs off, the sidebar links to this dashboard page instead (else it hides the entry). */
  dashboardFallback?: { path: string; label?: string; testId?: string };
  /**
   * The WordPress tiers that may open it (utils/tier): absent, any tier.
   * Anyone else never sees the entry, and the page sends them to Overview.
   */
  tiers?: readonly Tier[];
  /**
   * The count beside the entry, as a hook: it reads its own data while the
   * entry is drawn as a page of the app (never for a dashboard link). The
   * entry's bubble shows it, hidden at 0; a folded group shows the sum of its
   * entries' counts.
   */
  useCount?: () => number;
  /** What a screen reader hears for the count ("3 waiting for you"). */
  countLabel?: (count: number) => string;
  /** The sidebar starts open on this page. */
  sidebarOpen?: boolean;
  /** The entry's data-tour value, where a guided tour points at it (tours/tourSteps.ts). */
  tour?: string;
}

/**
 * The component of each page id. A screen of any size should be
 * React.lazy(() => import('...')): it becomes its own chunk, loaded when the
 * page opens (PageRouter waits for it), so the main bundle and the plugin zip
 * stay small.
 */
export type PageScreens = Record<string, React.ComponentType>;
