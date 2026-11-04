import React from 'react';
import { GlassCard, Button } from '@yotako/webmaven-ui';
import { errorSentence } from '../../../utils/apiWords';
import { dashboardPhrase, siteBrand } from '../../../utils/brand';
import { dashboardLink, useSiteState } from '../../../utils/siteState';

/**
 * What a screen (or a card of one) shows when it has no data to show
 * (1.3.0), always in words, never an empty box:
 *   loading  the first answer is on its way
 *   empty    nothing yet, in the screen's own words, with its next step
 *   refused  the user's role, a switch or the plugin version said no
 *   off      the account does not let this site show it: where it is instead
 *   failed   it did not work: the reason and Retry
 */
export type ScreenStateProps =
  | { state: 'loading'; label?: string; compact?: boolean }
  | { state: 'empty'; title: string; children?: React.ReactNode; compact?: boolean }
  | { state: 'refused'; error?: unknown; compact?: boolean }
  | { state: 'off'; what: string; dashboardPath: string; compact?: boolean }
  | { state: 'failed'; error?: unknown; fallback?: string; onRetry: () => void; compact?: boolean };

export default function ScreenState(props: ScreenStateProps) {
  const site = useSiteState();
  const brand = siteBrand();
  const pad = props.compact ? '16px' : '24px';
  let body: React.ReactNode;
  switch (props.state) {
    case 'loading':
      body = (
        <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-dim)', fontSize: 13 }}>
          <span className="wpm-auth-loading__spinner" style={{ width: 16, height: 16 }} aria-hidden="true" />
          {props.label ?? 'Loading'}
        </div>
      );
      break;
    case 'empty':
      body = (
        <div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{props.title}</p>
          {props.children && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-dim)' }}>{props.children}</div>}
        </div>
      );
      break;
    case 'refused':
      body = <p role="note" style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{errorSentence(props.error)}</p>;
      break;
    case 'off':
      body = (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{`${props.what} is in ${dashboardPhrase(brand)}.`}</p>
          <a href={dashboardLink(site, props.dashboardPath)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            <Button variant="secondary" size="sm">{`Open ${dashboardPhrase(brand)}`}</Button>
          </a>
        </div>
      );
      break;
    case 'failed':
      body = (
        <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{errorSentence(props.error, props.fallback)}</p>
          <Button variant="secondary" size="sm" onClick={props.onRetry}>Retry</Button>
        </div>
      );
      break;
  }
  return (
    <GlassCard padding={pad}>
      <div data-testid="wm-screen-state" data-state={props.state}>{body}</div>
    </GlassCard>
  );
}
