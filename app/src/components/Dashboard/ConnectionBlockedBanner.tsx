import React, { useEffect, useState } from 'react';
import { GlassCard } from '@yotako/webmaven-ui';
import { wpRest } from '../../services/wpRest';
import { nameOr, siteBrand, type SiteBrand } from '../../utils/brand';
import { useSiteState } from '../../utils/siteState';
import { currentTier } from '../../utils/tier';

/**
 * The line Overview shows administrators when the site's own check
 * (GET webmaven_wp/v1/connection-check) finds the route WPMaven's service
 * calls blocked, most often by a security plugin: what to allow, in plain
 * words. Nothing when the route answers, or when the check could not tell.
 */

/** The address the owner allows in the security plugin's settings. */
export const WEBHOOK_PATH = '/wp-json/wpmaven/v1/webhook';

/** The sentence, in the site's brand (WPMaven, the agency's name, or words that name nobody). */
export function blockedText(b: SiteBrand = siteBrand()): string {
  return `A security plugin on your site is blocking ${nameOr('your site team', b)}. In its settings, allow this address: ${WEBHOOK_PATH}`;
}

/** Whether the check's answer says the route is blocked. */
export function isBlocked(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).rest === 'blocked';
}

export default function ConnectionBlockedBanner() {
  const state = useSiteState();
  const owner = currentTier() === 'owner';
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    // Only a connected site's administrators: the route matters once the
    // service calls the site, and the check is theirs to run.
    if (!owner || !state.known) return undefined;
    let alive = true;
    wpRest
      .get<unknown>('webmaven_wp/v1/connection-check')
      .then((answer) => {
        if (alive) setBlocked(isBlocked(answer.data));
      })
      .catch(() => {
        // The check itself failed: nothing to tell the owner.
      });
    return () => {
      alive = false;
    };
  }, [owner, state.known]);

  if (!blocked) return null;
  return (
    <GlassCard padding="16px 20px" style={{ marginBottom: 16 }}>
      <p data-testid="wm-connection-blocked" style={{ margin: 0, fontSize: 14, color: 'var(--text)', lineHeight: 1.5 }}>
        {blockedText()}
      </p>
    </GlassCard>
  );
}
