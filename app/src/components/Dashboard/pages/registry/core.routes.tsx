/**
 * The app's own screens. Every workstream lists its screens in its own pair
 * of files (<name>.routes.tsx and <name>.screens.tsx, gathered by routes.ts
 * and screens.ts), so screens added side by side never touch the same lines.
 */
import type { PageRoute } from './types';

export const CORE_ROUTES: PageRoute[] = [
  // Overview keeps the sparkle it had before the kit's icon set (Heroicons'
  // sparkles, for its old four-point star), never the house.
  { id: 'home', hash: '', group: 'pages', order: 1, label: 'Overview', icon: 'sparkles', tour: 'overview' },
  // The editor's changes go through routes that take an administrator only
  // (manage_options, as the edits route and the API do), so no other role
  // gets an editor that would refuse every change.
  { id: 'site-editor', hash: 'editor', group: 'pages', order: 2, label: 'Editor', tiers: ['owner'], sidebarOpen: true, icon: 'pencil-square', tour: 'editor' },
  // Each page only where the account lets this site show it; else hidden
  // (Your team) or a link to the dashboard page that does it.
  // Your team (1.7.0, once Tasks): the dashboard's own screen for this
  // business, its plan, progress and channels, the tab after #/team
  // (#/team/progress). It reads the business's whole plan, which the
  // account gives a site with teamPlan, besides the tasks; without either
  // flag it is hidden, as Tasks was. The old #/tasks opens its Plan.
  {
    id: 'team', hash: 'team', group: 'work', order: 3, label: 'Your team', feature: 'tasks', alsoNeeds: ['teamPlan'], tiers: ['owner'],
    icon: 'user-group', tour: 'team',
  },
  // The website's visitors, for the roles Home's charts are for; the channels stay in the dashboard.
  {
    id: 'analytics', hash: 'analytics', group: 'insights', order: 1, label: 'Analytics', feature: 'analytics', tiers: ['owner', 'store'],
    dashboardFallback: { path: '/analytics', testId: 'wm-sidebar-analytics-link' },
    icon: 'chart-bar',
  },
  {
    id: 'reports', hash: 'reports', group: 'insights', order: 2, label: 'Reports', feature: 'reports', tiers: ['owner', 'store'],
    dashboardFallback: { path: '/reports', testId: 'wm-sidebar-reports-link' },
    icon: 'document-text',
  },
  // "Income", the dashboard's word (2026-10-16); its address stays #/finance.
  {
    id: 'finance', hash: 'finance', group: 'store', order: 3, label: 'Income', feature: 'finance', tiers: ['owner', 'store'],
    dashboardFallback: { path: '/income', testId: 'wm-sidebar-income-link' },
    icon: 'banknotes',
  },
  // The account menu at the bottom of the sidebar opens it.
  { id: 'settings', hash: 'settings' },
];
