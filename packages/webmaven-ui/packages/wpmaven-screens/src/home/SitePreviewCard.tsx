/**
 * The business's site, as a picture (moved from the dashboard's Home,
 * 2026-10-17): the dashboard's Home and the plugin's Overview draw this
 * card at the top of their side column.
 */
import React, { useState } from 'react';
import { GlassCard } from '@yotako/webmaven-ui';
import { HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import type { ScreensHost } from '../host/types';
import { useHomeSectionStyles } from './styles';

export const SITE_PREVIEW_TEXT = 'Visit your site';

export interface SitePreviewCardProps {
  siteUrl?: string | null;
  /**
   * The screenshot: the instance's own thumbnailUrl, the one the site cards
   * and All Sites show (a site reads it in its state).
   */
  thumbnailUrl?: string | null;
  /** The business's name, for the picture's words. */
  name: string;
  /** For the app's analytics; absent: nothing is tracked. */
  host?: ScreensHost | null;
}

/**
 * The site's screenshot filling the whole card, and the whole card a link
 * to the live site (2026-10-11). On hover and keyboard focus a dark veil
 * says "Visit your site"; a phone, with no hover, gets a small label in the
 * corner instead (wms-site-preview, HOME_SECTIONS_CSS).
 *
 * Without a screenshot, or when it does not load, there is no card at all:
 * an empty frame would say nothing.
 */
export const SitePreviewCard: React.FC<SitePreviewCardProps> = ({ siteUrl, thumbnailUrl, name, host }) => {
  useHomeSectionStyles();
  const [broken, setBroken] = useState(false);
  if (!siteUrl || !thumbnailUrl || broken) return null;
  return (
    <GlassCard padding={0} className="wms-site-preview" data-testid="home-site-preview">
      <a
        href={siteUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="wms-site-preview-link"
        aria-label={`${SITE_PREVIEW_TEXT}, ${name}. Opens the live site in a new tab`}
        onClick={() => host?.track?.('instances', 'action', 'open_site_home_preview')}
      >
        <img src={thumbnailUrl} alt={`Your site, ${name}`} loading="lazy" onError={() => setBroken(true)} />
        <span className="wms-site-preview-veil" aria-hidden="true">
          {SITE_PREVIEW_TEXT}
          <HiOutlineArrowTopRightOnSquare style={{ width: 18, height: 18 }} />
        </span>
        <span className="wms-site-preview-tag" aria-hidden="true">
          Visit site
          <HiOutlineArrowTopRightOnSquare style={{ width: 14, height: 14 }} />
        </span>
      </a>
    </GlassCard>
  );
};

export default SitePreviewCard;
