/**
 * Your website, as a Home section (moved from the dashboard's Home,
 * 2026-10-17): the site's address, its Share (ShareYourSite, quiet) and
 * Feature on WPMaven (quiet), in the dashboard's Home side column and the
 * plugin's Overview.
 *
 * The share is kept reachable forever, one line and no louder than the
 * address it sits next to. The dashboard's launch card is ONE-SHOT (consumed
 * on mount), and a missed moment must not mean the share is gone for good;
 * the alternative to a quiet permanent line is a prompt that comes back,
 * which is the one thing this must never become. No counter, no badge, no
 * unshared state, nothing that changes depending on whether it has been
 * used. It steps aside while the launch card shows (`share` false), so the
 * moment is not two offers of the same thing.
 */
import React from 'react';
import { GlassCard } from '@yotako/webmaven-ui';
import type { ScreensHost } from '../host/types';
import { teamBusiness } from '../team/reads';
import { FeatureOnWpmaven } from './FeatureOnWpmaven';
import { ShareYourSite } from './ShareYourSite';
import { SHARE_ROW_GAP, prettyHost } from './share';
import { SECTION_LABEL } from './styles';

export const YOUR_WEBSITE_TITLE = 'Your website';

export interface YourWebsiteCardProps {
  host: ScreensHost;
  /** The business (the account's scope); a site's scope is its own. */
  instanceId?: string | null;
  /** The site's address. Nothing is drawn without one. */
  siteUrl: string | null | undefined;
  /** The share sheet's title. */
  siteName?: string | null;
  /** The share and Feature on WPMaven beside the address (default); false while the launch card offers them. */
  share?: boolean;
  /** In its own card, under its title (the default), or bare inside the app's card. */
  card?: boolean;
}

/** The address, the share and Feature on WPMaven, as one wrapping row. */
export const YourWebsiteRow: React.FC<Omit<YourWebsiteCardProps, 'card'>> = ({ host, instanceId, siteUrl, siteName, share = true }) => {
  const business = teamBusiness(host.scope, instanceId);
  if (!siteUrl) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: SHARE_ROW_GAP }}>
      <a
        href={siteUrl}
        target="_blank" rel="noreferrer"
        style={{ fontSize: 'var(--text-meta)', color: 'var(--text-dim)', overflowWrap: 'anywhere' }}
      >
        {prettyHost(siteUrl)}
      </a>
      {share && (
        <>
          <ShareYourSite host={host} variant="quiet" siteUrl={siteUrl} siteName={siteName} />
          {business && <FeatureOnWpmaven host={host} instanceId={business} variant="quiet" />}
        </>
      )}
    </div>
  );
};

/** Your website, as a Home section: nothing without an address. */
export const YourWebsiteCard: React.FC<YourWebsiteCardProps> = ({ card = true, ...props }) => {
  if (!props.siteUrl) return null;
  if (!card) return <YourWebsiteRow {...props} />;
  return (
    <GlassCard padding={24} data-testid="your-website-card">
      <h3 style={{ ...SECTION_LABEL, margin: '0 0 10px', fontFamily: 'var(--font-ui)' }}>{YOUR_WEBSITE_TITLE}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <YourWebsiteRow {...props} />
      </div>
    </GlassCard>
  );
};

export default YourWebsiteCard;
