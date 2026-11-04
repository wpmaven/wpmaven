import React from 'react';
import type { PageScreens } from './types';

// Each screen is its own chunk, loaded when the page opens.
const ApprovalsPage = React.lazy(() => import(/* webpackChunkName: "wm-approvals" */ '../parity/ApprovalsPage'));
const PaymentsPage = React.lazy(() => import(/* webpackChunkName: "wm-payments" */ '../parity/PaymentsPage'));
const ActivityPage = React.lazy(() => import(/* webpackChunkName: "wm-activity" */ '../parity/ActivityPage'));

/** The components of parity.routes.tsx, by page id. */
export const PARITY_SCREENS: PageScreens = {
  approvals: ApprovalsPage,
  payments: PaymentsPage,
  activity: ActivityPage,
};
