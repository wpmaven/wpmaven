/**
 * A post, page or product waiting for the owner's yes, as a card on Home
 * (2026-09-24, shared 2026-10-16): its picture, its title, what the change
 * does with it ("Draft", "Will be published"), its first words, and one
 * button to the approval's own card, where the whole post is drawn as the
 * site will show it. Home used to show the page's words run together in a
 * quote block.
 */
import React, { useEffect, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { clip, sitePreviewNoun, type SitePreviewData } from './sitePreview';

/** How much of the words a Home card shows; the rest is one tap away. */
export const SUMMARY_CHARS = 180;

export function SiteChangeSummary({ site, onOpen }: { site: SitePreviewData; onOpen: () => void }) {
  const image = site.images[0] ?? null;
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [image]);
  const noun = sitePreviewNoun(site.kind);
  return (
    <div
      data-testid="site-change-summary"
      style={{
        display: 'flex', gap: 12, alignItems: 'flex-start', margin: '0 0 10px', padding: '10px 12px',
        border: '1px solid var(--glass-border)', borderRadius: 10, background: 'var(--bg)',
      }}
    >
      {image && !broken && (
        <img
          src={image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 8, flexShrink: 0, background: 'var(--glass)' }}
        />
      )}
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {site.title && (
            <span style={{ fontSize: 'var(--text-body)', fontWeight: 700, color: 'var(--text)' }}>{site.title}</span>
          )}
          <span
            style={{
              fontSize: 'var(--text-meta)', color: 'var(--text)', border: '1px solid var(--glass-border)',
              borderRadius: 999, padding: '1px 8px', background: 'var(--bg-raised)',
            }}
          >
            {site.statusLabel}
          </span>
        </div>
        {site.excerpt && (
          <p style={{ margin: 0, fontSize: 'var(--text-data)', lineHeight: 'var(--leading-body)', color: 'var(--text)' }}>
            {clip(site.excerpt, SUMMARY_CHARS)}
          </p>
        )}
        <div>
          <Button size="sm" variant="outline" onClick={onOpen}>
            {`See the full ${noun}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default SiteChangeSummary;
