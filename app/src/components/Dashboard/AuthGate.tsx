import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import AppLoading, { loadingText } from '../AppLoading';
import LoginScreen from './LoginScreen';
import SetupInDashboard from './SetupInDashboard';
import { useWizardGate, WizardMount, WIZARD_IN_BUILD } from '../../onboarding/gate';
import SetupNotice from '../../onboarding/SetupNotice';
import OwnerStepGate from './OwnerStepScreen';
import StartChoice, { takeStartIntent, type StartIntent } from './StartChoice';
import ManageSite from './ManageSite';
import AgentActive, { agentJustActivated } from './AgentActive';
import ChoicesQuestion, { choicesKnownAnswered } from './ChoicesQuestion';
import { siteBrand, isWpmavenSite } from '../../utils/brand';
import { withPartner } from '../../utils/dashboardSignIn';

export { loadingText };

interface AuthGateProps {
  children: React.ReactNode;
}

function AuthGate({ children }: AuthGateProps) {
  const {
    isAuthenticated, loading, setupNeeded, continuedForNow, skipFailed, siteState,
    skipOnboarding, continueForNow, refreshStatus,
  } = useAuth();
  const isAdmin = !!(window as any).WEBMAVEN_WP_DATA?.user?.isAdmin;
  const wizard = useWizardGate({ ready: !loading && isAuthenticated, isAdmin, siteState, continuedForNow });
  // WPMaven's first page in the WordPress.org edition (StartChoice): the
  // choice made before the sign-up (or ?start=manage from the dashboard's
  // Home) goes on once; "Manage my site" opens here (ManageSite).
  const [intent] = useState<StartIntent | null>(() => takeStartIntent());
  const [manage, setManage] = useState(intent === 'manage');
  const [choicesAnswered, setChoicesAnswered] = useState(choicesKnownAnswered);

  if (loading) {
    return <AppLoading />;
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // What the site shares (ChoicesQuestion): once connected, before anything
  // else, an administrator answers each choice the site has no answer for.
  if (isAdmin && !choicesAnswered) {
    return <ChoicesQuestion onDone={() => setChoicesAnswered(true)} />;
  }

  // The setup wizard, the dashboard's own (onboarding/gate.tsx says when):
  // full screen, in its own chunk. It hands the page back when the owner
  // leaves it or WPMaven does not open it here, and this gate goes on.
  if (wizard.show) {
    return <WizardMount onDone={wizard.close}>{children}</WizardMount>;
  }

  // The setup card: only when the account says this site has no business
  // and the owner did not choose to continue in WordPress (the site state),
  // only for an administrator (its steps are the owner's), and not after
  // "Continue now" in this browser session. No answer from the account
  // never blocks anyone: the app opens and the next read decides. A branded
  // or hosted site never needs setup.
  // Without the wizard in this build (the WordPress.org edition), the "Set
  // up your business" menu entry opens this card, also after a skip.
  const fromMenu = !WIZARD_IN_BUILD && (window as any).WEBMAVEN_WP_DATA?.page === 'onboarding';
  // The first page, Manage my site and Agent's screen speak as WPMaven: a site
  // under another brand keeps the setup card, which says the brand's words.
  if (!WIZARD_IN_BUILD && isAdmin && isWpmavenSite()) {
    const build = siteState?.links.create ? () => window.location.assign(withPartner(siteState.links.create!)) : null;
    // A business kept from the site with its fixes not chosen yet: step 3.
    if (siteState?.business?.fixesToChoose) {
      return <ManageSite startAt="better" onDone={() => { void refreshStatus(); }} onBuild={null} />;
    }
    if ((setupNeeded && !continuedForNow) || fromMenu) {
      if (siteState?.next !== 'publish') {
        // Agent installed from the dashboard's onboarding, which goes on in its own tab.
        if (agentJustActivated() && !manage) {
          // The dashboard opened this tab: closing it goes back there; a tab the browser keeps open goes to the dashboard.
          const back = () => {
            window.close();
            window.setTimeout(() => { if (siteState?.dashboardUrl) window.location.assign(siteState.dashboardUrl); }, 300);
          };
          return <AgentActive onBack={back} />;
        }
        if (manage) return <ManageSite onDone={() => { setManage(false); void refreshStatus(); }} onBuild={build} />;
        if (intent === 'build' && build) { build(); return <AppLoading />; }
        if (build) return <StartChoice brand={siteBrand()} onBuild={build} onManage={() => setManage(true)} />;
      }
    }
  }
  if (isAdmin && ((setupNeeded && !continuedForNow) || fromMenu)) {
    const card = (
      <SetupInDashboard
        state={siteState}
        onSkip={skipOnboarding}
        onContinueForNow={continueForNow}
        onCheckAgain={refreshStatus}
        skipFailed={skipFailed}
      />
    );
    // A saved business waits for this site (Skip for now, publish later):
    // the owner's details first (OwnerStepScreen), then the card.
    return siteState?.next === 'publish' ? <OwnerStepGate>{card}</OwnerStepGate> : card;
  }

  // Someone who is not an administrator gets the app and, while the site
  // has no business, a bar saying an administrator can set it up here.
  if (!isAdmin) {
    return <SetupNotice show={siteState?.onboarding === 'needed'}>{children}</SetupNotice>;
  }

  // Once the business is live: the owner's details first (OwnerStepScreen), until done once.
  if (siteState?.onboarding !== 'needed') {
    return <OwnerStepGate>{children}</OwnerStepGate>;
  }
  return <>{children}</>;
}

export default AuthGate;
