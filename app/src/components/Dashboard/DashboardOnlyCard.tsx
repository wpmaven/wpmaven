import React from 'react';
import { GlassCard, Button } from '@yotako/webmaven-ui';
import { AI_EDITING_OFF_TEXT, SEO_AI_OFF_TEXT, siteChatCardText } from '../../utils/siteChat';
import { siteBrand } from '../../utils/brand';
import { dashboardLink, useSiteState } from '../../utils/siteState';

export type DashboardOnlyVariant = 'chat' | 'editorAI' | 'seo';

interface DashboardOnlyCardProps {
  /** Which surface is off: the chat (with a way to the dashboard's chat), the editor's AI, or SEO suggestions. */
  variant?: DashboardOnlyVariant;
  /** Tighter spacing, for narrow panels (the editor's AI panel, SEO). */
  compact?: boolean;
  /** Drop the card's own glass background when it sits inside another panel. */
  bare?: boolean;
}

export const OPEN_CHAT_LABEL = 'Open chat';

/**
 * What shows wherever chat or AI editing would run inside WP-admin while the
 * account has not turned it on for this site (or the plugin's
 * WEBMAVEN_WP_SITE_TOKEN_CHAT turned it off). The chat card says where the
 * chat is and opens it in a new tab; the editor's and the SEO panel's say
 * what still works here, with no button to a dashboard that has no editor.
 */
export default function DashboardOnlyCard({ variant = 'chat', compact = false, bare = false }: DashboardOnlyCardProps) {
  // In the site's brand (1.2.31): "your <brand> dashboard", or "your dashboard".
  const brand = siteBrand();
  const site = useSiteState();
  const text = variant === 'editorAI' ? AI_EDITING_OFF_TEXT : variant === 'seo' ? SEO_AI_OFF_TEXT : siteChatCardText(brand);
  const body = (
    <div
      data-testid="wm-dashboard-only-card"
      data-variant={variant}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: compact ? 10 : 16 }}
    >
      <p
        style={{
          margin: 0,
          fontSize: compact ? 13 : 15,
          lineHeight: 1.5,
          color: 'var(--text)',
          fontWeight: compact ? 500 : 600,
        }}
      >
        {text}
      </p>
      {variant === 'chat' && (
        <a
          href={dashboardLink(site, '/dashboard')}
          target="_blank"
          rel="noopener noreferrer"
          title="Opens your dashboard in a new tab"
          style={{ textDecoration: 'none' }}
        >
          <Button variant="primary" size={compact ? 'sm' : undefined} style={{ fontSize: 13 }}>
            {OPEN_CHAT_LABEL}
          </Button>
        </a>
      )}
    </div>
  );

  if (bare) {
    return <div style={{ padding: compact ? '12px 16px' : '24px' }}>{body}</div>;
  }
  return <GlassCard padding={compact ? '16px' : '24px'}>{body}</GlassCard>;
}
