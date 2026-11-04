import type { PageRoute } from './types';
import { useWaitingCount } from '../parity/waitingCount';

/**
 * The business pages the dashboard has, in WordPress (1.3.0): each one only
 * where the account turned it on for this site (its feature) and only for
 * the WordPress roles that may use it (its tiers); off, the sidebar links to
 * the dashboard page that does the job. The component goes in
 * parity.screens.tsx.
 */
export const PARITY_ROUTES: PageRoute[] = [
  {
    id: 'approvals', hash: 'approvals', group: 'work', order: 1, label: 'Waiting for you', feature: 'approvals', tiers: ['owner'],
    useCount: useWaitingCount,
    countLabel: (n) => `${n} waiting for you`,
    dashboardFallback: { path: '/waiting', testId: 'wm-sidebar-approvals-link' },
    icon: 'bell-alert',
    tour: 'waiting',
  },
  {
    id: 'payments', hash: 'payments', group: 'store', order: 2, label: 'Payments', feature: 'payments', tiers: ['owner', 'store'],
    dashboardFallback: { path: '/get-paid', testId: 'wm-sidebar-payments-link' },
    icon: 'credit-card',
  },
  {
    id: 'activity', hash: 'activity', group: 'insights', order: 3, label: 'Activity', feature: 'activity', tiers: ['owner'],
    dashboardFallback: { path: '/instances', testId: 'wm-sidebar-activity-link' },
    icon: 'clock',
  },
];
