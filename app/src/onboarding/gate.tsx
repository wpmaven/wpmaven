import React, { useCallback, useState } from 'react';
import AppLoading from '../components/AppLoading';
import type { SiteState } from '../utils/siteState';

/**
 * When the WP-admin app shows the setup wizard (AuthGate asks here).
 *
 * The wizard is its own chunk (onboarding.js and onboarding.css, from the
 * plugin's assets/), loaded only when it opens: the app's bundle and the
 * plugin's zip carry the dashboard's wizard once, in that chunk.
 */
const WizardScreen = __WPMAVEN_EDITION__ === 'wporg'
  // The WordPress.org edition carries no wizard: the dashboard sets the
  // business up (the setup card), so the chunk is left out of its build.
  ? null
  : React.lazy(() => import(/* webpackChunkName: "onboarding" */ './WizardScreen'));

/** Whether this build carries the setup wizard (not the WordPress.org edition's). */
export const WIZARD_IN_BUILD = WizardScreen !== null;

/** The page WordPress drew: 'onboarding' is the "Set up your business" menu entry. */
function wpPage(): string {
  const page = typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA?.page : null;
  return typeof page === 'string' ? page : '';
}

export interface WizardGateInput {
  isAdmin: boolean;
  siteState: SiteState | null | undefined;
  /** "Continue now" in this browser session, after a skip WPMaven did not record. */
  continuedForNow: boolean;
  page?: string;
}

/**
 * Whether an administrator gets the setup wizard. Its steps reach WPMaven,
 * which only an administrator does from WordPress, so nobody else ever
 * does. An administrator gets it while the account says the site has no
 * business and the owner did not choose to continue in WordPress
 * (onboarding 'needed'), unless a business made in the dashboard waits to
 * go live here (next 'publish': the setup card keeps that door) or the
 * owner chose "Continue now" in this browser session; and while a site
 * kept by Fix and improve has its fixes still to choose (a reload, another
 * browser: "What your team fixes" again). The "Set up your business" menu
 * entry always opens it, also after a skip.
 */
export function wizardWanted({ isAdmin, siteState, continuedForNow, page = wpPage() }: WizardGateInput): boolean {
  if (!WIZARD_IN_BUILD || !isAdmin || !siteState) return false;
  if (page === 'onboarding') return true;
  if (siteState.business?.fixesToChoose) return !continuedForNow;
  return siteState.onboarding === 'needed' && siteState.next !== 'publish' && !continuedForNow;
}

/**
 * The gate's decision, kept for the page view: once the wizard shows, it
 * stays until it hands the page back (the owner left, or WPMaven does not
 * open it here), so a read of the account in the middle (the publish that
 * completes the setup, the tab coming back) never pulls it away from under
 * the owner.
 */
export function useWizardGate(input: WizardGateInput & { ready: boolean }): { show: boolean; close(): void } {
  const [kept, setKept] = useState(false);
  const [closed, setClosed] = useState(false);
  const wanted = !closed && input.ready && wizardWanted(input);
  if (wanted && !kept) setKept(true);
  const close = useCallback(() => setClosed(true), []);
  return { show: !closed && (kept || wanted), close };
}

/** A wizard that could not load or broke hands the page back: never a blank screen. */
class WizardBoundary extends React.Component<{ onFail(): void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('The setup wizard stopped; the app opens instead.', error);
    this.props.onFail();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The setup wizard, full screen; `children` is the app, for a site that already has its business. */
export function WizardMount({ onDone, children }: { onDone(): void; children: React.ReactNode }) {
  return (
    <WizardBoundary onFail={onDone}>
      <React.Suspense fallback={<AppLoading />}>
        {WizardScreen ? <WizardScreen onDone={onDone}>{children}</WizardScreen> : children}
      </React.Suspense>
    </WizardBoundary>
  );
}
