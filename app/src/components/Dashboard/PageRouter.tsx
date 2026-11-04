import React, { useEffect } from 'react';
import { useDashboard, type DashboardPage } from '../../contexts/DashboardContext';
import { useSiteState, type SiteFeature } from '../../utils/siteState';
import { PAGE_ROUTES, routeAllowsTier, routeById, routeFeaturesOn } from './pages/registry/routes';
import { PAGE_SCREENS } from './pages/registry/screens';
import { PageLoading } from '../AppLoading';

/** The pages that run only where the account lets this site show them. */
export const PAGE_FEATURE: Partial<Record<DashboardPage, SiteFeature>> = Object.fromEntries(
  PAGE_ROUTES.filter((r) => r.feature).map((r) => [r.id, r.feature as SiteFeature]),
);

function PageRouter() {
  const { currentPage, setCurrentPage } = useDashboard();
  const site = useSiteState();
  const route = routeById(currentPage);
  const Screen = route ? PAGE_SCREENS[route.id] : undefined;
  const blocked = !Screen || !routeFeaturesOn(route, site) || !routeAllowsTier(route);

  // A page this site cannot show (a saved page, a pasted #/team link) sends to Overview.
  useEffect(() => {
    if (blocked && currentPage !== 'home') setCurrentPage('home');
  }, [blocked, currentPage, setCurrentPage]);

  const Shown = blocked ? PAGE_SCREENS.home : Screen;
  // A screen may be React.lazy (its own chunk, loaded when opened): the
  // app's own loader and line while it comes.
  return (
    <React.Suspense fallback={<PageLoading />}>
      <Shown />
    </React.Suspense>
  );
}

export default PageRouter;
