import React, { useCallback, useEffect, useState } from 'react';
import { NavIcon, NavItem, SiteIcon, type NavIconName } from '@yotako/webmaven-ui';
import { useDashboard, DashboardPage } from '../../contexts/DashboardContext';
import BrandMark from '../BrandMark';
import EditorSidebar from './EditorSidebar';
import AccountMenu from './AccountMenu';
import NavGroup from './NavGroup';
import { dashboardLink, useSiteState, wpAdminLinks, type WpAdminLink } from '../../utils/siteState';
import { siteBrand, dashboardPhrase } from '../../utils/brand';
import { siteHomeUrl, siteIconUrl } from '../../utils/thisSite';
import { SIDEBAR_GROUPS, routeAllowsTier, routeFeaturesOn, sidebarGroupRoutes } from './pages/registry/routes';
import type { PageRoute, SidebarGroupId } from './pages/registry/types';

/**
 * Whether the WordPress group (WordPress's own screens) is open, per browser.
 * It was "Advanced" until 2026-10-16: the key stays, so whoever had it open
 * finds it open.
 */
export const ADVANCED_OPEN_KEY = 'webmaven-sidebar-advanced';

/** One icon per WordPress screen, from the kit's set; the grid for any other. */
const WP_SCREEN_ICONS: Record<string, NavIconName> = {
  'wp-admin': 'wordpress',
  products: 'shopping-bag',
  orders: 'credit-card',
  posts: 'newspaper',
  pages: 'document-text',
  media: 'photo',
  appearance: 'sparkles',
  plugins: 'squares-2x2',
  settings: 'cog-6-tooth',
};

/**
 * WordPress: WordPress's own screens, for this user's role (the plugin builds
 * the list from capabilities, with WordPress's own translated labels). The
 * full-screen app hides the admin menu; these open the screens in the same
 * tab, where the admin menu shows again and the brand's entry near its top
 * comes back here. Closed until the person opens it; the choice is kept per
 * browser.
 */
export function WordPressGroup({ links }: { links: WpAdminLink[] }) {
  if (links.length === 0) return null;
  return (
    <NavGroup id="wordpress" label="WordPress" storageKey={ADVANCED_OPEN_KEY} testId="wm-navgroup-wordpress" tour="group-wordpress">
      {links.map((link) => (
        <NavItem
          key={link.key}
          href={link.url}
          icon={<NavIcon name={WP_SCREEN_ICONS[link.key] ?? 'squares-2x2'} />}
          label={link.label}
          testId={`wm-advanced-${link.key}`}
        />
      ))}
    </NavGroup>
  );
}

/** A plain left click: the app opens the page itself. A middle click or a modifier opens the address in a new tab. */
const plainClick = (e: React.MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

const noCount = (): number => 0;

interface EntryProps {
  route: PageRoute;
  active: boolean;
  onNavigate: (page: DashboardPage) => void;
  /** A group sums its entries' counts: each entry tells it its own. */
  onCount?: (id: string, count: number) => void;
}

/**
 * A page of the app: a link to its address (#/team), so it opens in a new
 * tab like any link, while a plain click switches the page in place, through
 * the navigation guard. Its count, when the route has one, is read here.
 */
function AppEntry({ route, active, onNavigate, onCount }: EntryProps) {
  const useCount = route.useCount ?? noCount;
  const count = useCount();
  useEffect(() => { onCount?.(route.id, count); }, [onCount, route.id, count]);
  useEffect(() => () => { onCount?.(route.id, 0); }, [onCount, route.id]);
  return (
    <NavItem
      href={`#/${route.hash}`}
      icon={route.icon ? <NavIcon name={route.icon} /> : undefined}
      label={route.label}
      active={active}
      badge={count}
      badgeLabel={count > 0 && route.countLabel ? route.countLabel(count) : undefined}
      testId={`wm-sidebar-${route.id}`}
      data-tour={route.tour}
      onClick={(e: React.MouseEvent<HTMLElement>) => {
        if (!plainClick(e)) return;
        e.preventDefault();
        onNavigate(route.id);
      }}
    />
  );
}

/** A page the account does not let this site show: the dashboard page that does its job, in a new tab. */
function DashboardEntry({ route }: { route: PageRoute }) {
  const site = useSiteState();
  const brand = siteBrand();
  const fallback = route.dashboardFallback!;
  return (
    <NavItem
      href={dashboardLink(site, fallback.path)}
      external
      externalLabel={`(opens ${dashboardPhrase(brand)})`}
      title={`Opens ${dashboardPhrase(brand)}`}
      icon={route.icon ? <NavIcon name={route.icon} /> : undefined}
      label={fallback.label ?? route.label}
      testId={fallback.testId ?? `wm-sidebar-${route.id}-link`}
      data-tour={route.tour}
    />
  );
}

/** What a route draws for this user and this site: a page of the app, a dashboard link, or nothing. */
function shown(route: PageRoute, features: (route: PageRoute) => boolean): 'app' | 'dashboard' | null {
  // A page this WordPress role cannot use is not listed at all.
  if (!routeAllowsTier(route)) return null;
  if (features(route)) return 'app';
  return route.dashboardFallback ? 'dashboard' : null;
}

function Entry(props: EntryProps & { kind: 'app' | 'dashboard' }) {
  return props.kind === 'app' ? <AppEntry {...props} /> : <DashboardEntry route={props.route} />;
}

/** A group that folds: its entries, and the sum of their counts for the closed row. */
function RouteGroup({ id, label, entries, currentPage, onNavigate }: {
  id: string;
  label: string;
  entries: Array<{ route: PageRoute; kind: 'app' | 'dashboard' }>;
  currentPage: string;
  onNavigate: (page: DashboardPage) => void;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const onCount = useCallback((routeId: string, n: number) => {
    setCounts((c) => (c[routeId] === n ? c : { ...c, [routeId]: n }));
  }, []);
  if (entries.length === 0) return null;
  const sum = entries.reduce((total, e) => total + (counts[e.route.id] ?? 0), 0);
  return (
    <NavGroup
      id={id}
      label={label}
      hasActive={entries.some((e) => e.kind === 'app' && e.route.id === currentPage)}
      count={sum}
      testId={`wm-navgroup-${id}`}
      tour={`group-${id}`}
    >
      {entries.map(({ route, kind }) => (
        <Entry key={route.id} kind={kind} route={route} active={currentPage === route.id} onNavigate={onNavigate} onCount={onCount} />
      ))}
    </NavGroup>
  );
}

/**
 * The sidebar (2026-10-16), the dashboard's rows (the kit's NavItem and
 * NavIcon) in the plugin's own order:
 *
 *   the lockup
 *   Overview, Editor              apart at the top, as the switch is
 *   ─────
 *   Waiting for you (n), Messages, Your team
 *   Content, Store, Insights      groups that fold
 *   WordPress                     WordPress's own screens, folded
 *   ─────
 *   View site                     pinned, where the dashboard has Add a business
 *   the account
 *
 * On the Editor page, the editor's own items take the place of everything
 * under the lockup: its tabs (Pages, Posts, Products), a search, the list,
 * then Add by the tab ("Add a page", 2026-10-17), right above View site
 * (EditorSidebar). Overview and Editor are not drawn there either
 * (2026-10-17): the top bar's switch, always on that page, does their job.
 * The other entries, the groups and WordPress come back with Overview.
 *
 * The sidebar is one window tall and never scrolls itself: the list between
 * the line under the Editor and View site (the editor's list, on its page)
 * takes what is left and scrolls in its place, so View site and the account
 * stay at the bottom.
 */
function SlideoverSidebar() {
  const { currentPage, setCurrentPage, sidebarOpen, sidebarMobileOpen, toggleMobileSidebar, editorViewUrl } = useDashboard();

  const site = useSiteState();
  const isEditor = currentPage === 'site-editor';
  // In the editor, what it shows (2026-10-19); anywhere else, the homepage.
  const siteUrl = (isEditor && editorViewUrl) || siteHomeUrl();

  const isVisible = sidebarOpen || sidebarMobileOpen;

  const handleNav = useCallback((page: DashboardPage) => {
    setCurrentPage(page);
    if (sidebarMobileOpen) toggleMobileSidebar();
  }, [setCurrentPage, sidebarMobileOpen, toggleMobileSidebar]);

  // Every page of the registry with a place in the sidebar. A page the
  // account does not let this site show is a link to the dashboard page
  // that does it, or hidden.
  const has = (route: PageRoute) => routeFeaturesOn(route, site);
  const entriesOf = (group: SidebarGroupId) => sidebarGroupRoutes(group)
    .map((route) => ({ route, kind: shown(route, has) }))
    .filter((e): e is { route: PageRoute; kind: 'app' | 'dashboard' } => e.kind !== null);
  const row = ({ route, kind }: { route: PageRoute; kind: 'app' | 'dashboard' }) => (
    <Entry key={route.id} kind={kind} route={route} active={currentPage === route.id} onNavigate={handleNav} />
  );

  return (
    <>
      {sidebarMobileOpen && (
        <div className="wm-sidebar-backdrop" onClick={toggleMobileSidebar} aria-hidden="true" />
      )}

      <aside className={`wm-sidebar ${isVisible ? 'wm-sidebar--open' : 'wm-sidebar--closed'} ${sidebarMobileOpen ? 'wm-sidebar--mobile-open' : ''} ${isEditor ? 'wm-sidebar--editor' : ''}`}>
        <div className="wm-sidebar__header">
          {/* The brand's mark under an agency's or a partner's brand (1.2.31). */}
          <BrandMark size={42} />
        </div>

        {/* On the Editor page there is no menu: the top bar's switch takes
            Overview and Editor, and the editor's own items the rest. */}
        {!isEditor && (
          <nav className="wm-sidebar__nav" aria-label="Menu">
            <div className="wm-sidebar__top">
              {entriesOf('pages').map(row)}
            </div>
            <div className="wm-sidebar__divider" />
            <div className="wm-sidebar__scroll" data-testid="wm-navlist">
              {entriesOf('work').map(row)}
              {SIDEBAR_GROUPS.filter((g) => g.folds).map((g) => (
                <RouteGroup key={g.id} id={g.id} label={g.label ?? g.id} entries={entriesOf(g.id)} currentPage={currentPage} onNavigate={handleNav} />
              ))}
              <WordPressGroup links={wpAdminLinks()} />
            </div>
          </nav>
        )}

        {isEditor && (
          <div className="wm-sidebar__editor">
            <EditorSidebar />
          </div>
        )}

        {/* View site, pinned under the list, where the dashboard has Add a
            business: the site's own icon (else the globe), in a new tab; in
            the editor, the page, post or product it shows. */}
        <div className="wm-sidebar__pinned">
          <NavItem
            href={siteUrl}
            external
            icon={<SiteIcon src={siteIconUrl()} size={20} />}
            label="View site"
            testId="wm-view-site"
            data-tour="view-site"
          />
        </div>

        {/* The account: Settings, Billing and the theme, in a menu that opens upward. */}
        <div className="wm-sidebar__footer">
          <AccountMenu onSettings={() => handleNav('settings')} />
        </div>
      </aside>
    </>
  );
}

export default SlideoverSidebar;
