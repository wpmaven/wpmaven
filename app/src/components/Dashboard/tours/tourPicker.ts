/**
 * Which tour opens, and when (1.7.0), as plain functions.
 *
 *  - The first visit to Overview opens the full tour, or the WordPress one
 *    for someone who came in through a dashboard sign-in link (the plugin
 *    marks them: WEBMAVEN_WP_DATA.tours.arrivedFromDashboard). "First" means
 *    neither of the two was ever started by this WordPress user.
 *  - The first visit to the editor opens the editor's tour: from the
 *    dashboard's Edit your site, from the Editor entry, or right after the
 *    full tour's last step, whose click on the Editor opens it.
 *  - The "?" in the top bar replays them: Take the tour (the full or the
 *    WordPress one, by the same mark), Tour of the editor, and the guides.
 */
import type { TourEnd, TourRecord } from '@yotako/webmaven-ui';
import { isWpmavenSite, siteBrand, type SiteBrand } from '../../../utils/brand';
import type { PluginTourId } from './tourSteps';

/** The help site, as the dashboard links it; on a WPMaven site only. */
export const GUIDES_URL = 'https://wpmaven.ai/docs';

function wpData(): any {
  return (typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA : null) || {};
}

/** This WordPress user last came in through a dashboard sign-in link. */
export function arrivedFromDashboard(data: any = wpData()): boolean {
  const at = data?.tours?.arrivedFromDashboard;
  return typeof at === 'number' && Number.isFinite(at) && at > 0;
}

/** The tour of Overview for this person: the WordPress one when the dashboard already showed them the rest. */
export function overviewTourId(arrived: boolean): 'full' | 'wordpress' {
  return arrived ? 'wordpress' : 'full';
}

type RecordOf = (tourId: string) => TourRecord | null | undefined;

/**
 * The tour Overview opens by itself, or null: only when neither Overview
 * tour was ever started (both records read, both empty).
 */
export function overviewTourToOpen(record: RecordOf, arrived: boolean): PluginTourId | null {
  const full = record('full');
  const wordpress = record('wordpress');
  if (full === undefined || wordpress === undefined) return null;
  if (full !== null || wordpress !== null) return null;
  return overviewTourId(arrived);
}

/**
 * Whether the editor's tour follows a tour that just ended: the full tour,
 * finished by the click on the Editor its last step waited for, and an
 * editor tour never started (or the full tour was taken again from the "?").
 */
export function editorFollows(end: TourEnd, editorRecord: TourRecord | null | undefined, replay: boolean): boolean {
  if (end.tourId !== 'full' || end.outcome !== 'done' || !end.clicked) return false;
  return replay || editorRecord === null;
}

/** The guides in the "?" menu: the help site on a WPMaven site, none under another brand. */
export function guidesUrl(brand: SiteBrand = siteBrand()): string | null {
  return isWpmavenSite(brand) ? GUIDES_URL : null;
}
