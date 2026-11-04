import React from 'react';
import BrowserChrome from './BrowserChrome';
import s from './MockBrowser.module.css';
import { PREVIEW_COPY } from './previewCopy';

/**
 * The preview pane's browser shell — ONE source of truth for the synthetic
 * browser look: the rounded frame (radius / border / shadow tokens from
 * MockBrowser.module.css), the chrome ribbon on top (traffic-light dots +
 * URL pill + kebab, via BrowserChrome), and a viewport slot that fills the
 * rest of the frame.
 *
 * MockBrowser composes this for the styled mock; the preview modes (full-page
 * mock image, srcdoc homepage, in-browser WP) wrap their viewport content in
 * it so the browser chrome stays visible in every mode instead of the content
 * covering the whole pane.
 *
 * The viewport slot is a flex column: give the child `flex: 1; min-height: 0`
 * (ScaledSiteFrame and the existing .content/.mockScroll classes already do)
 * and it fills the area below the chrome exactly.
 */
export interface BrowserFrameProps {
  /**
   * Verbatim URL-pill text (site name / 'preview') — wins over siteUrl.
   */
  urlText?: string;
  /** Real URL — pretty-printed to host[/path] in the pill when urlText is absent. */
  siteUrl?: string;
  /** Success state: accent border + glow (MockBrowser's `done` treatment). */
  done?: boolean;
  /** Forwarded to the frame element (MockBrowser passes its --mock-* vars here). */
  style?: React.CSSProperties;
  className?: string;
  /** Accessible label for the frame. */
  ariaLabel?: string;
  /** Viewport content, rendered in the flex-fill slot below the chrome. */
  children?: React.ReactNode;
}

export default function BrowserFrame({
  urlText,
  siteUrl,
  done = false,
  style,
  className,
  ariaLabel = PREVIEW_COPY.sitePreview,
  children,
}: BrowserFrameProps) {
  const cls = [s.frame, done ? s.done : '', className || ''].filter(Boolean).join(' ');
  return (
    <div className={cls} style={style} aria-label={ariaLabel}>
      <BrowserChrome siteUrl={siteUrl} urlText={urlText} />
      <div className={s.viewport}>{children}</div>
    </div>
  );
}
