import React from 'react';
import DashboardHome from '../../DashboardHome';
import EditorPage from '../EditorPage';
import SettingsPage from '../SettingsPage';
import ReportsPage from '../ReportsPage';
import FinancePage from '../FinancePage';
import type { PageScreens } from './types';

// Each one its own chunk, loaded when the page opens.
const AnalyticsPage = React.lazy(() => import(/* webpackChunkName: "wm-analytics" */ '../AnalyticsPage'));
const TeamPage = React.lazy(() => import(/* webpackChunkName: "wm-team" */ '../TeamPage'));

export const CORE_SCREENS: PageScreens = {
  home: DashboardHome,
  'site-editor': EditorPage,
  settings: SettingsPage,
  reports: ReportsPage,
  team: TeamPage,
  finance: FinancePage,
  analytics: AnalyticsPage,
};
