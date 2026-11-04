import React from 'react';
import { GlassCard, Button, SiteIcon } from '@yotako/webmaven-ui';
import { siteBrand, dashboardPhrase, type SiteBrand } from '../../utils/brand';
import { dashboardLink, useSiteState, type SiteState } from '../../utils/siteState';
import { withPartner } from '../../utils/dashboardSignIn';
import { siteIconUrl } from '../../utils/thisSite';
import { agentStepLink, completeWithAgentText, installAgentLabel } from './SetupInDashboard';

/**
 * The owner's next step on this site, at the top of Overview, from the
 * account (the site state): publish the business that waits (or publish
 * again after a publish that stopped short), or set one up after choosing
 * to continue in WordPress. Every button opens the dashboard page that does
 * it, in a new tab, on the brand's own address under White label. A store
 * that cannot take money yet is Overview's Turn on a way to get paid (the
 * side column, as on the dashboard's Home), never a step here; a business
 * with nothing left to do shows no card (2026-10-17: the dashboard's Home
 * has none).
 */

export interface NextStepCopy {
  title: string;
  text: string;
  note: string | null;
  action: { label: string; href: string } | null;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** The card's words and link for this state, or null when there is nothing to show yet. */
export function nextStepCopy(state: SiteState, b: SiteBrand = siteBrand()): NextStepCopy | null {
  if (!state.known) return null;
  const dashboard = dashboardPhrase(b);
  if (state.next === 'publish' && state.links.publish) {
    const named = state.draft?.name ?? null;
    const name = named ?? 'your business';
    const stopped = state.lastPublish && state.lastPublish.state !== 'complete' ? state.lastPublish : null;
    if (state.draft?.publishingHere) {
      return { title: `${capitalize(name)} is going live on this site`, text: 'This takes a few minutes. This page updates when it is done.', note: null, action: null };
    }
    const agentLink = agentStepLink(state);
    if (agentLink && (!stopped || stopped.state !== 'partial')) {
      return { title: `${capitalize(name)} is ready`, text: completeWithAgentText(name, b), note: null, action: { label: installAgentLabel(b), href: agentLink } };
    }
    if (stopped) {
      return {
        title: stopped.state === 'partial' ? `${capitalize(name)} is partly on this site` : `${capitalize(name)} is not on this site yet`,
        text: `The last publish to this site did not finish. Publish it again from ${dashboard}.`,
        note: stopped.problems[0]?.message ?? null,
        action: { label: 'Publish again', href: state.links.publish },
      };
    }
    return {
      title: `${capitalize(name)} is ready`,
      text: `Publish it to this site from ${dashboard}.`,
      note: null,
      action: { label: named ? `Publish ${named}` : 'Publish your business', href: state.links.publish },
    };
  }
  if (state.next === 'create' && state.links.create) {
    return {
      title: 'Set up your business',
      text: `Your team can build your business on this site from ${dashboard}.`,
      note: null,
      action: { label: 'Set up my business', href: state.links.create },
    };
  }
  return null;
}

/** "This business is paused...", in the site's brand. */
export function pausedText(b: SiteBrand = siteBrand()): string {
  return `This business is paused, so your team is not working on it. See ${dashboardPhrase(b)}.`;
}

export function PausedBanner() {
  const state = useSiteState();
  if (!state.instance?.paused) return null;
  return (
    <GlassCard padding="16px 20px" style={{ marginBottom: 16 }}>
      <div data-testid="wm-paused-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', lineHeight: 1.5 }}>{pausedText()}</p>
        <a href={dashboardLink(state, '/billing')} target="_blank" rel="noopener noreferrer" title="Opens your dashboard in a new tab" style={{ textDecoration: 'none' }}>
          <Button variant="primary" size="sm">Open billing</Button>
        </a>
      </div>
    </GlassCard>
  );
}

export default function NextStepCard() {
  const state = useSiteState();
  const copy = nextStepCopy(state);
  if (!copy) return null;
  return (
    <GlassCard padding="20px" style={{ marginBottom: 16 }}>
      <div data-testid="wm-next-step" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* The site's own icon beside the title: the step is about this site. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SiteIcon src={siteIconUrl()} size={20} />
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.4, color: 'var(--text)' }}>
            {copy.title}
          </h2>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>{copy.text}</p>
        {copy.note && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>{copy.note}</p>}
        {copy.action && (
          <a href={withPartner(copy.action.href)} target="_blank" rel="noopener noreferrer" title="Opens your dashboard in a new tab" style={{ textDecoration: 'none', alignSelf: 'flex-start' }}>
            <Button variant="primary" size="sm">{copy.action.label}</Button>
          </a>
        )}
      </div>
    </GlassCard>
  );
}
