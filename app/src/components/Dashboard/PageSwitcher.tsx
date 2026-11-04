import React from 'react';
import { useDashboard, DashboardPage } from '../../contexts/DashboardContext';
import { NavIcon, SegmentedControl, type NavIconName } from '@yotako/webmaven-ui';
import { routeAllowsTier, routeById } from './pages/registry/routes';

/** The two modes, with the sidebar's own icons for them. */
const PAGES: ReadonlyArray<{ key: DashboardPage; label: string; icon: NavIconName; tour: string }> = [
  { key: 'home', label: 'Overview', icon: 'sparkles', tour: 'switch-overview' },
  { key: 'site-editor', label: 'Editor', icon: 'pencil-square', tour: 'switch-editor' },
];

/**
 * Overview or the Editor, on those two pages only (MinimalTopBar). The kit's
 * SegmentedControl, whose options are the kit's Buttons (2026-10-17): the
 * page that is open the primary, with its turning ring, the other the
 * secondary, at the Button's own size and --r-btn corners. It was the kit's
 * pill Tabs, whose open tab wp-admin's buttons washed out, then a filled
 * accent switch.
 */
function PageSwitcher() {
  const { currentPage, setCurrentPage } = useDashboard();
  // Only the pages this WordPress user may open: no Editor for a role
  // the editor would refuse. With Overview alone there is nothing to switch.
  const options = PAGES.filter((p) => routeAllowsTier(routeById(p.key)))
    .map((p) => ({ key: p.key, label: p.label, icon: <NavIcon name={p.icon} size={18} />, tour: p.tour }));
  if (options.length < 2) return null;

  return (
    <SegmentedControl
      className="wm-page-switcher"
      testId="wm-page-switcher"
      tour="switch"
      ariaLabel="Page"
      options={options}
      value={currentPage}
      onChange={(key) => setCurrentPage(key as DashboardPage)}
    />
  );
}

export default PageSwitcher;
