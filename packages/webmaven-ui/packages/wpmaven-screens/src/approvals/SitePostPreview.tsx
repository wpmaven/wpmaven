/**
 * A post, page, product or translation an operator wants to put on the site,
 * drawn the way the site will show it (2026-09-24).
 *
 * An owner saw "Master Class &bull; Specialty Brewing" as flat text with no
 * images: "it should look like the original post, not raw text." This draws
 * the post itself: its title, its featured image, its own HTML and styles,
 * tinted with the business's colors, in a frame that runs no script:
 *
 *   - srcdoc, sandboxed WITHOUT allow-scripts (PREVIEW_SANDBOX), a
 *     Content-Security-Policy first in its <head> (PREVIEW_CSP), and the HTML
 *     sanitized twice (the API, then sanitizePostHtml here);
 *   - the site's address as the base, so its links and images resolve as on
 *     the site, and every link opens in a new tab;
 *   - as tall as the post: measured after it lays out and again as its images
 *     arrive. In a list it is cut at COLLAPSED_PX with "Show the full post";
 *     expanded (the "Open in full" dialog) it is never cut;
 *   - what the change does with it, on top: "Draft", "Will be published"
 *     while it waits, what happened once it is decided ("Published", "Not
 *     made"), and for an update still waiting, After and Before.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { sanitizePostHtml } from './sanitizePostHtml';
import { useOptionalScreensHost } from '../host/HostContext';
import type { ScreensTransport } from '../host/types';
import { CARD_RADIUS, small } from './styles';
import {
  PREVIEW_SANDBOX,
  buildPostDocument,
  canCompareBefore,
  statusChipFor,
  type SitePreviewBeforeAnswer,
  type SitePreviewData,
  type SitePreviewKind,
} from './sitePreview';

/** How much of a post a list shows before "Show the full post". */
export const COLLAPSED_PX = 420;

/** The frame's height before the post has been measured. */
const FIRST_PX = 320;

const KIND_LABEL: Record<SitePreviewKind, string> = {
  post: 'New blog post',
  page: 'New page',
  update: 'Change to a page on your site',
  // Not "New": with overwrite it rewrites the translation there now.
  translation: 'Translation',
  product: 'New product',
};

const NOUN: Record<SitePreviewKind, string> = {
  post: 'post', page: 'page', update: 'page', translation: 'translation', product: 'product',
};

export interface SitePostPreviewProps {
  preview: SitePreviewData;
  /** Never cut the post (the "Open in full" dialog). */
  expanded?: boolean;
  /** The approval, for an update's Before. */
  approvalId?: string;
  /** The approval's status. Decided rows say what happened, not what "will"
   *  happen, and only a change still waiting offers its Before. */
  approvalStatus?: string | null;
  /**
   * Where the Before comes from: by default the host's transport (the
   * owner's own API, or the site's through the plugin's proxy); the staff
   * console passes the staff API.
   */
  loadBefore?: (approvalId: string) => Promise<SitePreviewBeforeAnswer>;
  className?: string;
}

/**
 * The page as it is now, read through the app's transport: asked only when
 * the owner opens an update's Before. A site reads it for its own changes
 * (GET /operators/approvals/:id/before is a site route).
 */
export async function readApprovalBefore(transport: ScreensTransport, approvalId: string): Promise<SitePreviewBeforeAnswer> {
  const answer = await transport.get<SitePreviewBeforeAnswer | null>(`/operators/approvals/${encodeURIComponent(approvalId)}/before`);
  return answer ?? { before: null, reason: 'unavailable' };
}

/** What the Before tab says when it has no page to show. */
export function beforeMessage(answer: SitePreviewBeforeAnswer | null, failed: boolean): string | null {
  if (failed || answer?.reason === 'unavailable') return 'We could not load the current version from your site. Try again in a minute.';
  if (answer?.reason === 'already_changed') return 'This change has already been made, so your site shows the new version now.';
  if (answer?.reason === 'not_made') return 'This change was not made, so your site still shows the page as it was.';
  if (answer && !answer.before) return 'There is no earlier version to show.';
  return null;
}

export const SitePostPreview: React.FC<SitePostPreviewProps> = ({
  preview, expanded = false, approvalId, approvalStatus, loadBefore, className,
}) => {
  // Before and After only while the change waits. Once decided, the site
  // shows either the new version (it ran) or the page it always had (it never
  // ran), so there is nothing to set beside it. A card that moves to History
  // while its Before is open drops back to the post.
  const host = useOptionalScreensHost();
  const before$ = loadBefore ?? (host ? (id: string) => readApprovalBefore(host.transport, id) : null);
  const isUpdate = preview.kind === 'update' && !!approvalId && !!before$ && canCompareBefore(approvalStatus);
  const [chosenView, setView] = useState<'after' | 'before'>('after');
  const view = isUpdate ? chosenView : 'after';
  const [before, setBefore] = useState<SitePreviewBeforeAnswer | null>(null);
  const [loadingBefore, setLoadingBefore] = useState(false);
  const [beforeFailed, setBeforeFailed] = useState(false);

  const showBefore = useCallback(async () => {
    setView('before');
    if (before || loadingBefore || !approvalId || !before$) return;
    setLoadingBefore(true);
    setBeforeFailed(false);
    try {
      setBefore(await before$(approvalId));
    } catch {
      setBeforeFailed(true);
    } finally {
      setLoadingBefore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [before, loadingBefore, approvalId, loadBefore, host]);

  const doc = useMemo(() => {
    if (view === 'before' && before?.before) {
      const b = before.before;
      return buildPostDocument({
        title: b.title, html: sanitizePostHtml(b.html), featuredImageUrl: b.featuredImageUrl,
        baseUrl: preview.baseUrl, brand: preview.brand,
      });
    }
    return buildPostDocument({
      title: preview.title, html: sanitizePostHtml(preview.html), featuredImageUrl: preview.featuredImageUrl,
      baseUrl: preview.baseUrl, brand: preview.brand,
    });
  }, [view, before, preview]);

  const beforeNote = view === 'before' ? beforeMessage(before, beforeFailed) : null;
  const titleForFrame = preview.title ? `Preview of "${preview.title}"` : `Preview of the ${NOUN[preview.kind]}`;

  return (
    <div className={className} data-testid="site-post-preview">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ ...small, fontWeight: 650, color: 'var(--text)' }}>{KIND_LABEL[preview.kind]}</span>
        <span
          style={{
            ...small, display: 'inline-flex', alignItems: 'center', borderRadius: 9999,
            border: '1px solid var(--glass-border)', background: 'var(--bg-raised)', padding: '2px 8px', color: 'var(--text)',
          }}
          data-testid="site-post-status"
        >
          {statusChipFor(preview, approvalStatus)}
        </span>
        {isUpdate && (
          <span role="group" aria-label="Which version to show" style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
            <Button size="sm" variant={view === 'after' ? 'secondary' : 'outline'} aria-pressed={view === 'after'} onClick={() => setView('after')}>
              After this change
            </Button>
            <Button size="sm" variant={view === 'before' ? 'secondary' : 'outline'} aria-pressed={view === 'before'} onClick={() => void showBefore()}>
              Before
            </Button>
          </span>
        )}
      </div>
      {view === 'before' && loadingBefore && (
        <p style={{ ...small, opacity: 0.7 }} role="status">Loading the current version from your site...</p>
      )}
      {view === 'before' && !loadingBefore && beforeNote && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }} role="status">
          <p style={{ ...small, opacity: 0.7 }}>{beforeNote}</p>
          <Button size="sm" variant="outline" onClick={() => setView('after')}>Show the new version</Button>
        </div>
      )}
      {!(view === 'before' && (loadingBefore || beforeNote)) && (
        <PostFrame doc={doc} title={titleForFrame} expanded={expanded} noun={NOUN[preview.kind]} />
      )}
    </div>
  );
};

/**
 * The frame, as tall as the post. The page measures the post's document (the
 * sandbox keeps allow-same-origin for this, and never allow-scripts), once it
 * loads, whenever it resizes, and a few times more while its images arrive.
 */
function PostFrame({ doc, title, expanded, noun }: { doc: string; title: string; expanded: boolean; noun: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>(FIRST_PX);
  const [open, setOpen] = useState(expanded);
  useEffect(() => { if (expanded) setOpen(true); }, [expanded]);

  const measure = useCallback(() => {
    const d = ref.current?.contentDocument;
    // The article, not the document: a document is never shorter than its
    // frame, so measuring it would never let a short post shrink the frame.
    const article = d?.querySelector('.wm-post') as HTMLElement | null | undefined;
    if (!article) return;
    const h = Math.ceil(Math.max(article.scrollHeight, article.getBoundingClientRect().height));
    if (h > 0) setHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const timers: number[] = [];
    const onLoad = () => {
      measure();
      const d = frame.contentDocument;
      if (d?.documentElement && typeof ResizeObserver !== 'undefined') {
        observer?.disconnect();
        observer = new ResizeObserver(() => measure());
        const article = d.querySelector('.wm-post');
        if (article) observer.observe(article);
      }
      for (const ms of [150, 600, 1500, 3500]) timers.push(window.setTimeout(measure, ms));
    };
    frame.addEventListener('load', onLoad);
    if (frame.contentDocument?.readyState === 'complete') onLoad();
    return () => {
      frame.removeEventListener('load', onLoad);
      observer?.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [doc, measure]);

  const cut = !open && height > COLLAPSED_PX;
  return (
    <div>
      <div
        style={{
          position: 'relative', overflow: 'hidden', borderRadius: CARD_RADIUS,
          border: '1px solid var(--glass-border)', background: '#ffffff',
          maxHeight: cut ? COLLAPSED_PX : undefined,
        }}
      >
        <iframe
          ref={ref}
          title={title}
          srcDoc={doc}
          sandbox={PREVIEW_SANDBOX}
          referrerPolicy="no-referrer"
          loading="lazy"
          scrolling="no"
          style={{ display: 'block', width: '100%', height, border: 0 }}
        />
        {cut && (
          <div
            aria-hidden="true"
            style={{
              pointerEvents: 'none', position: 'absolute', left: 0, right: 0, bottom: 0, height: 64,
              background: 'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.95))',
            }}
          />
        )}
      </div>
      {!expanded && (cut || (open && height > COLLAPSED_PX)) && (
        <div style={{ marginTop: 8 }}>
          <Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? `Show less of the ${noun}` : `Show the full ${noun}`}
          </Button>
        </div>
      )}
    </div>
  );
}

export default SitePostPreview;
