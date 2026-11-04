import React, { useMemo, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { KIND_LABEL, PREVIEW_SANDBOX, clip, previewDocument } from '../utils/sitePostPreview';

/**
 * What the owner is asked to approve when the assistant wants to put a post,
 * a page or a product on the site (2026-09-24): its title, what the change
 * does with it ("Draft", "Will be published"), its picture, its first words,
 * and Open preview, which draws the post in the card the way the site will
 * show it. The card used to print the call's parameters as JSON.
 *
 * The preview frame runs no script and has no origin of its own (sandbox
 * without allow-scripts or allow-same-origin), a Content-Security-Policy
 * leads its document, and the post's HTML is cleaned before it is drawn.
 */
function SitePostCard({ post, siteUrl }) {
  const [open, setOpen] = useState(false);
  const doc = useMemo(() => (open ? previewDocument(post, siteUrl) : ''), [open, post, siteUrl]);
  const picture = post.images[0] || null;
  const noun = post.kind === 'product' ? 'product' : post.kind === 'page' || post.kind === 'update' ? 'page' : post.kind === 'translation' ? 'translation' : 'post';

  return (
    <div data-testid="site-post-card" style={{ margin: '0 0 12px' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{KIND_LABEL[post.kind]}</span>
        <span style={{ fontSize: 12, color: 'var(--text)', border: '1px solid var(--glass-border)', borderRadius: 999, padding: '1px 8px' }}>
          {post.statusLabel}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {picture && (
          <img
            src={picture}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
          />
        )}
        <div style={{ minWidth: 0 }}>
          {post.title && (
            <strong style={{ display: 'block', fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>{post.title}</strong>
          )}
          {post.excerpt && (
            <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>{clip(post.excerpt, 220)}</p>
          )}
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <Button
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{ fontSize: 12, padding: '6px 14px' }}
        >
          {open ? 'Close preview' : 'Open preview'}
        </Button>
      </div>
      {open && (
        <iframe
          title={post.title ? `Preview of "${post.title}"` : `Preview of the ${noun}`}
          srcDoc={doc}
          sandbox={PREVIEW_SANDBOX}
          referrerPolicy="no-referrer"
          style={{ display: 'block', width: '100%', height: 420, marginTop: 8, border: '1px solid var(--glass-border)', borderRadius: 8, background: '#fff' }}
        />
      )}
    </div>
  );
}

export default SitePostCard;
