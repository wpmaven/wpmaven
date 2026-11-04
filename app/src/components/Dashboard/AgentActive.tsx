/**
 * WPMaven Agent was just activated (the redirect after its activation,
 * ?agent=activated; 2026-10-26) on a site whose business is still being
 * set up: the owner installed it from the dashboard's onboarding, which
 * goes on in its own tab. Said here, with the way back there, instead of
 * WPMaven's first page again.
 */
import React from 'react';
import { GlassCard, Button } from '@yotako/webmaven-ui';
import BrandMark from '../BrandMark';
import { siteBrand } from '../../utils/brand';

export const AGENT_ACTIVE_COPY = {
  title: 'WPMaven Agent is active',
  line: 'Everything WPMaven can do on this site is unlocked. Go back to your WPMaven tab to describe your business: it goes on this site once you choose a plan.',
  back: 'Back to WPMaven',
} as const;

/** The page was opened by the redirect after Agent's activation. Pure. */
export function agentJustActivated(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get('agent') === 'activated';
}

export default function AgentActive({ onBack }: { onBack: (() => void) | null }) {
  return (
    <div data-testid="wm-agent-active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'var(--wm-app-height, 100vh)', background: 'var(--bg)', padding: 24 }}>
      <GlassCard padding="48px 40px" style={{ maxWidth: 460, width: '100%', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <BrandMark size={36} brand={siteBrand()} />
        </div>
        <h1 style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-title)', fontWeight: 400, lineHeight: 1.25, color: 'var(--text)', margin: '0 0 8px' }}>
          {AGENT_ACTIVE_COPY.title}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', margin: '0 0 24px', lineHeight: 1.6 }}>{AGENT_ACTIVE_COPY.line}</p>
        {onBack && (
          <Button variant="primary" onClick={onBack} style={{ width: '100%', justifyContent: 'center' }}>{AGENT_ACTIVE_COPY.back}</Button>
        )}
      </GlassCard>
    </div>
  );
}
