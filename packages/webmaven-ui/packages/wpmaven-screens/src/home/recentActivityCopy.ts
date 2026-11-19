/**
 * Recent activity, a Home section (RecentActivityCard.tsx, the WordPress
 * plugin's Overview): the newest rows of the business's activity log, one
 * sentence each (the API writes them, already in the page's language), with
 * See all to the whole log.
 *
 * English is the source; the French is written by hand (src/i18n/fr.json,
 * namespace screensRecentActivity), the other languages by the dashboard's
 * translation script.
 */
import { localized } from '@yotako/webmaven-ui';

export const RECENT_ACTIVITY_COPY_EN = {
  /** The section's title. */
  title: 'Recent activity',
  /** The link to the whole activity log. */
  seeAll: 'See all',
  /** When the log has no row yet. */
  empty: 'Nothing has happened here yet.',
  /** Read by screen readers while the rows load. */
  loading: 'Loading the activity',
  /** The rows could not be loaded. */
  loadFailed: 'The activity could not be loaded. Try again in a minute.',
};

export const RECENT_ACTIVITY_COPY = localized(RECENT_ACTIVITY_COPY_EN, 'screensRecentActivity');
