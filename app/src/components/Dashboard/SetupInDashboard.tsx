import React, { useState } from 'react';
import { GlassCard, Button } from '@yotako/webmaven-ui';
import { withPartner } from '../../utils/dashboardSignIn';
import BrandMark from '../BrandMark';
import { siteBrand, dashboardPhrase, accountPhrase, type SiteBrand } from '../../utils/brand';
import { wpAdminLinks, type SiteState } from '../../utils/siteState';

/**
 * What an administrator of a connected site sees while the account says the
 * site has no business and the owner did not choose to continue in
 * WordPress (the site state, GET /sites/me). Built around the owner's next
 * step there:
 *
 *   publish  a business the owner made waits in the dashboard: publish it to
 *            this site (or publish again after a publish that stopped short),
 *            or watch it go live when it is already on its way;
 *   create   describe the business in the dashboard, and the team builds it
 *            on this site.
 *
 * The primary button opens the dashboard in a new tab and never records a
 * skip: this page then updates when the business is ready ("Check again"
 * asks now). "Continue in WordPress" records the owner's choice on the
 * account; when WPMaven does not answer, nothing is recorded and the card
 * says so, with a way in for this browser session. A branded or hosted site
 * never gets here: the account gives it no setup link.
 */

export const CONTINUE_LABEL = 'Continue in WordPress';
export const CHECK_AGAIN_LABEL = 'Check again';
export const WAITING_NOTE = 'This page updates when your business is ready.';
export const WP_ADMIN_LABEL = 'Go to WordPress admin';
export const CONTINUE_NOW_LABEL = 'Continue now';
/** A business waits in the dashboard, and this site already holds the owner's content: set up from the site instead. */
export const FROM_SITE_LABEL = 'Start from this site instead';

/** The setup wizard on this site, when the card may offer it (WEBMAVEN_WP_DATA.setupFromSite), else null. */
export function setupFromSiteUrl(state: SiteState): string | null {
  const url = typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA?.setupFromSite : null;
  if (typeof url !== 'string' || !url) return null;
  return state.next === 'publish' && !state.draft?.publishingHere ? url : null;
}

export interface SetupCopy {
  title: string;
  text: string;
  /** The first problem of a publish that stopped short, in the owner's words. */
  note: string | null;
  primary: { label: string; href: string } | null;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** WPMaven Agent is not on this site (WEBMAVEN_WP_DATA.hasAgent false): WPMaven from WordPress.org alone. */
export function agentMissing(): boolean {
  return typeof window !== 'undefined' && (window as any).WEBMAVEN_WP_DATA?.hasAgent === false;
}

/** WPMaven Agent by the site's brand: "WPMaven Agent", "Acme Studio Agent", or "the Agent plugin". */
export function agentName(b: SiteBrand = siteBrand()): string {
  return b.mode === 'neutral' ? 'the Agent plugin' : `${b.name} Agent`;
}

/** The Agent step's button. */
export function installAgentLabel(b: SiteBrand = siteBrand()): string {
  return `Install ${agentName(b)}`;
}

/**
 * On a site running WPMaven from WordPress.org alone, a waiting business goes
 * on through the dashboard's WPMaven Agent step (links.installAgent): once
 * Agent is active, it is published by itself. Null when that is not the case.
 */
export function agentStepLink(state: SiteState): string | null {
  return agentMissing() && state.links.installAgent ? state.links.installAgent : null;
}

/** The words of that step, the business named. */
export function completeWithAgentText(name: string, b: SiteBrand = siteBrand()): string {
  return `Complete your site: install ${agentName(b)}, and ${name} goes live on this site by itself.`;
}

/** The words and the door for this state, in the site's brand. Null when there is no step to show. */
export function setupCopy(state: SiteState, b: SiteBrand = siteBrand()): SetupCopy | null {
  const dashboard = dashboardPhrase(b);
  if (state.next === 'publish' && state.links.publish) {
    const named = state.draft?.name ?? null;
    const name = named ?? 'your business';
    const stopped = state.lastPublish && state.lastPublish.state !== 'complete' ? state.lastPublish : null;
    if (state.draft?.publishingHere) {
      return {
        title: `${capitalize(name)} is going live on this site`,
        text: 'This takes a few minutes. This page updates when it is done.',
        note: null,
        primary: null,
      };
    }
    const agentLink = agentStepLink(state);
    if (agentLink && (!stopped || stopped.state !== 'partial')) {
      return {
        title: `${capitalize(name)} is ready`,
        text: completeWithAgentText(name, b),
        note: null,
        primary: { label: installAgentLabel(b), href: agentLink },
      };
    }
    if (stopped) {
      const problem = stopped.problems[0]?.message ?? null;
      return stopped.state === 'partial'
        ? {
          title: `Finish putting ${name} on this site`,
          text: `${capitalize(name)} is partly on this site. Publish it again from ${dashboard} to finish it.`,
          note: problem,
          primary: { label: 'Publish again', href: state.links.publish },
        }
        : {
          title: `${capitalize(name)} is not on this site yet`,
          text: `The last publish to this site did not finish. Publish it again from ${dashboard}.`,
          note: problem,
          primary: { label: 'Publish again', href: state.links.publish },
        };
    }
    // Saved for later at the end of the build (2026-10-26): the plans, then
    // it goes on this site by itself.
    return {
      title: `${capitalize(name)} is saved`,
      text: `Choose a plan in ${dashboard} and ${name} goes live on this site right after the payment.`,
      note: null,
      primary: { label: 'Choose a plan and publish', href: state.links.publish },
    };
  }
  if (state.links.create) {
    return {
      title: 'Set up your business',
      text: `This site is connected to ${accountPhrase(b)}. Describe your business in ${dashboard}, and your team builds it on this site.`,
      note: null,
      primary: { label: 'Set up my business', href: state.links.create },
    };
  }
  return null;
}

/** When the skip was not recorded: what happened, and that the card comes back. */
export function skipNotSavedText(b: SiteBrand = siteBrand()): string {
  const who = b.mode === 'wpmaven' ? 'WPMaven' : b.mode === 'brand' ? b.name : 'your dashboard';
  return `Your choice was not saved because ${who} did not answer. You can continue now, and this screen comes back next time.`;
}

interface SetupInDashboardProps {
  state: SiteState;
  /** Records "Continue in WordPress" on the account; resolves false when it was not recorded. */
  onSkip: () => Promise<boolean> | boolean;
  /** Lets the owner in for this browser session after a skip that was not recorded. */
  onContinueForNow: () => void;
  /** Reads the state again now. */
  onCheckAgain: () => Promise<void> | void;
  /** The last skip was not recorded. */
  skipFailed: boolean;
}

export default function SetupInDashboard({ state, onSkip, onContinueForNow, onCheckAgain, skipFailed }: SetupInDashboardProps) {
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [checking, setChecking] = useState(false);
  const brand = siteBrand();
  const copy = setupCopy(state, brand);
  const wpAdmin = wpAdminLinks()[0] ?? null;

  const skip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSkip();
    } finally {
      setBusy(false);
    }
  };

  const checkAgain = async () => {
    if (checking) return;
    setChecking(true);
    try {
      await onCheckAgain();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      data-testid="wm-setup-in-dashboard"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'var(--wm-app-height, 100vh)', background: 'var(--bg)', padding: 24 }}
    >
      <GlassCard padding="48px 40px" style={{ maxWidth: 460, width: '100%', textAlign: 'center' }}>
        <div style={{ marginBottom: 28 }}>
          {/* Side by side at 36, as on the dashboard's sign-in, centred by the row. */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <BrandMark size={36} brand={brand} />
          </div>
          {/* A unitless line height: wp-admin's 1.4em on body would be
              inherited as a fixed 18px, and two lines of this heading overlap. */}
          <h1 style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-title)', fontWeight: 400, lineHeight: 1.25, color: 'var(--text)', margin: '0 0 8px' }}>
            {copy?.title ?? 'Set up your business'}
          </h1>
          {copy && (
            <p style={{ fontSize: 14, color: 'var(--text-dim)', margin: 0, lineHeight: 1.6 }}>
              {copy.text}
            </p>
          )}
          {state.draft?.publishingHere && state.draft.buildProgress && (
            <ol data-testid="wm-setup-steps" style={{ listStyle: 'none', margin: '18px 0 0', padding: '4px 16px', borderRadius: 14, border: '1px solid var(--glass-border, #E2E4EA)', textAlign: 'left' }}>
              {state.draft.buildProgress.steps.map((step, i, all) => (
                <li key={step.id} data-state={step.state} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < all.length - 1 ? '1px solid var(--glass-border, #E2E4EA)' : 'none', fontSize: 14, color: step.state === 'todo' ? 'var(--text-dim)' : 'var(--text)' }}>
                  <span
                    aria-hidden
                    className={step.state === 'running' ? 'wm-spin' : undefined}
                    style={{
                      flex: 'none', width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, boxSizing: 'border-box',
                      ...(step.state === 'done'
                        ? { background: 'var(--success, #2E9E63)', color: '#fff' }
                        : step.state === 'running'
                          ? { border: '2.5px solid var(--glass-border, #E2E4EA)', borderTopColor: '#6A4BFF' }
                          : { border: '1.5px dashed var(--glass-border, #CDD0DA)' }),
                    }}
                  >
                    {step.state === 'done' ? '✓' : null}
                  </span>
                  {step.label}
                </li>
              ))}
            </ol>
          )}
          {copy?.note && (
            <p data-testid="wm-setup-note" style={{ fontSize: 13, color: 'var(--text-dim)', margin: '10px 0 0', lineHeight: 1.5 }}>
              {copy.note}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* A new tab keeps this page, which updates when the business is
              ready; opening the dashboard records nothing. A hosting
              partner's code rides along (1.2.31). */}
          {copy?.primary && (
            <a
              href={withPartner(copy.primary.href)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpened(true)}
              style={{ textDecoration: 'none' }}
            >
              <Button variant="primary" style={{ width: '100%', justifyContent: 'center', padding: '12px 24px', fontSize: 15 }}>
                {copy.primary.label}
              </Button>
            </a>
          )}
          {setupFromSiteUrl(state) && (
            <a href={setupFromSiteUrl(state)!} data-testid="wm-setup-from-site" style={{ textDecoration: 'none' }}>
              <Button variant="ghost" style={{ width: '100%', justifyContent: 'center', padding: '12px 24px', fontSize: 15 }}>
                {FROM_SITE_LABEL}
              </Button>
            </a>
          )}
          {opened && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{WAITING_NOTE}</span>
              <Button variant="ghost" size="sm" onClick={() => { void checkAgain(); }} disabled={checking}>
                {CHECK_AGAIN_LABEL}
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            onClick={() => { void skip(); }}
            disabled={busy}
            style={{ width: '100%', justifyContent: 'center', padding: '12px 24px', fontSize: 15 }}
          >
            {CONTINUE_LABEL}
          </Button>
          {skipFailed && (
            <div data-testid="wm-setup-skip-failed" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <p role="alert" style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>
                {skipNotSavedText(brand)}
              </p>
              <Button variant="ghost" size="sm" onClick={onContinueForNow}>
                {CONTINUE_NOW_LABEL}
              </Button>
            </div>
          )}
          {wpAdmin && (
            <a href={wpAdmin.url} style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>
              {WP_ADMIN_LABEL}
            </a>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
