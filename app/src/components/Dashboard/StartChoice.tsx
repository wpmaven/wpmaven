/**
 * WPMaven's first page in WordPress (2026-10-26): two ways to start.
 *
 *   Build my business with WPMaven   the dashboard's onboarding for this
 *                                    site, which asks where it lives (this
 *                                    WordPress, with WPMaven Agent, or hosted)
 *                                    and ends on the plans: paid when it is
 *                                    published
 *   Manage my current site           free, here: the site's details, the
 *                                    team that works on it, and what can be
 *                                    better (ManageSite)
 *
 * Signed out, both start with a free account: the choice is kept for the
 * round trip to the sign-up (startIntent) and the plugin goes on with it on
 * the way back. Signed in, on a site with nothing set up yet, the same two
 * choices, without the account lines.
 */
import React from 'react';
import { Button } from '@yotako/webmaven-ui';
import BrandMark from '../BrandMark';
import type { SiteBrand } from '../../utils/brand';

export type StartIntent = 'build' | 'manage';

export const START_INTENT_KEY = 'wpmaven_start_intent';

export const START_COPY = {
  title: 'Welcome to WPMaven',
  line: 'Two ways to start. Both are free to try, and nothing changes on your site until you say so.',
  buildTitle: 'Build my business with WPMaven',
  buildLine: 'Describe your business in a sentence. WPMaven designs a complete site, writes every page, sets up your store, and puts an AI team to work on it.',
  buildPoints: ['See it finished before you pay anything', 'Publish it on this site, or let WPMaven host it'],
  buildButton: 'Build my business',
  buildFoot: 'Free to build and preview. A plan when you publish.',
  manageTitle: 'Manage my current site',
  manageLine: 'WPMaven reads your site, fills in your business details and checks what can be better. Your AI team fixes what it can and shows you how to fix the rest.',
  managePoints: ['Your form messages in one inbox, and the AI assistants that visit you', 'Nothing on your site changes without your yes'],
  manageButton: 'Manage my site',
  manageFoot: 'Free, with a WPMaven account.',
  account: 'Both start with a free WPMaven account. Already have one?',
  signIn: 'Sign in',
} as const;

/** Keep the choice for the round trip to the sign-up. */
export function rememberStartIntent(intent: StartIntent): void {
  try { window.localStorage.setItem(START_INTENT_KEY, intent); } catch { /* the plugin asks again on the way back */ }
}

/**
 * The choice to go on with, once: the page's own (?start=manage, from the
 * dashboard's Home) or the one kept before the sign-up. Read and forgotten.
 */
export function takeStartIntent(search: string = window.location.search): StartIntent | null {
  const fromPage = new URLSearchParams(search).get('start');
  let kept: string | null = null;
  try {
    kept = window.localStorage.getItem(START_INTENT_KEY);
    window.localStorage.removeItem(START_INTENT_KEY);
  } catch {
    kept = null;
  }
  const v = fromPage || kept;
  return v === 'build' || v === 'manage' ? v : null;
}

const card: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 12, padding: 28, borderRadius: 16, textAlign: 'left',
  background: 'var(--bg-raised, #fff)', border: '1px solid var(--glass-border, #E2E4EA)',
};
const featured: React.CSSProperties = {
  ...card,
  border: '2px solid transparent',
  background: 'linear-gradient(var(--bg-raised, #fff), var(--bg-raised, #fff)) padding-box, linear-gradient(90deg, #47C8D8, #5B9BD5, #8E85C2, #D08EC8, #E8919F, #F2AA84) border-box',
};
const icon: React.CSSProperties = {
  width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center',
  background: 'var(--bg, #F5F6F8)', border: '1px solid var(--glass-border, #E2E4EA)',
};
const cardTitle: React.CSSProperties = { margin: 0, fontFamily: 'var(--font-title)', fontWeight: 400, fontSize: 26, lineHeight: 1.15, color: 'var(--text)' };
const line: React.CSSProperties = { margin: 0, fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-soft, var(--text-dim))' };
const foot: React.CSSProperties = { fontSize: 12.5, color: 'var(--text-dim)' };

function Points({ items }: { items: readonly string[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((p) => (
        <li key={p} style={{ display: 'flex', gap: 10, fontSize: 14, lineHeight: 1.45, color: 'var(--text)' }}>
          <span aria-hidden style={{ flex: 'none', width: 6, height: 6, marginTop: 7, borderRadius: '50%', background: 'var(--purple, #6962AD)' }} />
          {p}
        </li>
      ))}
    </ul>
  );
}

export interface StartChoiceProps {
  brand: SiteBrand;
  onBuild: () => void;
  onManage: () => void;
  /** Signed out: the account line with Sign in, and what connecting shares. */
  signedOut?: { onSignIn: () => void; notice: React.ReactNode } | null;
  /** The buttons wait (an administrator only, the link starting). */
  disabled?: boolean;
  children?: React.ReactNode;
}

export default function StartChoice({ brand, onBuild, onManage, signedOut, disabled, children }: StartChoiceProps) {
  return (
    // Its own scroll (WPMaven's screen in WordPress is a fixed box), centred when it fits.
    <div style={{ height: 'var(--wm-app-height, 100vh)', overflowY: 'auto', background: 'var(--bg)' }}>
    <div
      data-testid="wm-start-choice"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%', padding: '48px 24px', boxSizing: 'border-box' }}
    >
      <div style={{ textAlign: 'center', maxWidth: 620, marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <BrandMark size={36} brand={brand} />
        </div>
        <h1 style={{ margin: '0 0 8px', fontFamily: 'var(--font-title)', fontSize: 34, fontWeight: 400, lineHeight: 1.1, color: 'var(--text)' }}>{START_COPY.title}</h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--text-dim)' }}>{START_COPY.line}</p>
      </div>

      <div className="wm-start-pair" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, width: '100%', maxWidth: 900 }}>
        <section data-testid="wm-start-build" style={featured}>
          <div aria-hidden style={icon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6A4BFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
          </div>
          <h2 style={cardTitle}>{START_COPY.buildTitle}</h2>
          <p style={line}>{START_COPY.buildLine}</p>
          <Points items={START_COPY.buildPoints} />
          <div style={{ flex: 1 }} />
          <Button variant="primary" onClick={onBuild} disabled={disabled} style={{ width: '100%', justifyContent: 'center' }} data-testid="wm-start-build-go">
            {START_COPY.buildButton}
          </Button>
          <div style={foot}>{START_COPY.buildFoot}</div>
        </section>

        <section data-testid="wm-start-manage" style={card}>
          <div aria-hidden style={icon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text)' }}><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M3 8h18" /><path d="M8 13l2 2 4-4" /></svg>
          </div>
          <h2 style={cardTitle}>{START_COPY.manageTitle}</h2>
          <p style={line}>{START_COPY.manageLine}</p>
          <Points items={START_COPY.managePoints} />
          <div style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onManage} disabled={disabled} style={{ width: '100%', justifyContent: 'center' }} data-testid="wm-start-manage-go">
            {START_COPY.manageButton}
          </Button>
          <div style={foot}>{START_COPY.manageFoot}</div>
        </section>
      </div>

      {children}

      {signedOut && (
        <div style={{ marginTop: 26, textAlign: 'center', maxWidth: 560 }}>
          <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 18 }}>
            {START_COPY.account}{' '}
            <button type="button" onClick={signedOut.onSignIn} disabled={disabled} data-testid="wm-start-sign-in" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', color: 'var(--purple, #6962AD)', fontWeight: 550, textDecoration: 'underline', textUnderlineOffset: 3 }}>
              {START_COPY.signIn}
            </button>
          </div>
          <div data-testid="wm-data-notice" style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text-dim)' }}>{signedOut.notice}</div>
        </div>
      )}
    </div>
    </div>
  );
}
