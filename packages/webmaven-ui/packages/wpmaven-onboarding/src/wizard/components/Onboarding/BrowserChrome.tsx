import React from 'react';
import s from './MockBrowser.module.css';
import { PREVIEW_COPY } from './previewCopy';

/**
 * Shared chrome ribbon used by both `MockBrowser` (the styled mock) and
 * `SuccessIframe` (the live homepage iframe in the success step). Renders
 * the macOS-style traffic-light dots, the URL pill with WordPress mark +
 * site host, and the kebab.
 *
 * Single source of truth — previously this was duplicated across both
 * components, including the SVG path data for the WordPress mark.
 */

// Official WordPress mark — path from simple-icons (canonical brand-icon
// source).
export function WordPressIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21.469 6.825c.84 1.537 1.318 3.3 1.318 5.175 0 3.979-2.156 7.456-5.363 9.325l3.295-9.527c.615-1.54.82-2.771.82-3.864 0-.405-.026-.78-.07-1.11m-7.981.105c.647-.03 1.232-.105 1.232-.105.582-.075.514-.93-.067-.899 0 0-1.755.135-2.88.135-1.064 0-2.85-.15-2.85-.15-.585-.03-.661.855-.075.885 0 0 .54.061 1.125.09l1.68 4.605-2.37 7.08L5.354 6.9c.649-.03 1.234-.1 1.234-.1.585-.075.516-.93-.065-.896 0 0-1.746.138-2.874.138-.2 0-.438-.008-.69-.015C4.911 3.15 8.235 1.215 12 1.215c2.809 0 5.365 1.072 7.286 2.833-.046-.003-.091-.009-.141-.009-1.06 0-1.812.923-1.812 1.914 0 .89.513 1.643 1.06 2.531.411.72.89 1.643.89 2.977 0 .915-.354 1.994-.821 3.479l-1.075 3.585-3.9-11.61.001.014zM12 22.784c-1.059 0-2.081-.153-3.048-.437l3.237-9.406 3.315 9.087c.024.053.05.101.078.149-1.12.393-2.325.609-3.582.609M1.211 12c0-1.564.336-3.05.935-4.39L7.29 21.709C3.694 19.96 1.212 16.271 1.211 12M12 0C5.385 0 0 5.385 0 12s5.385 12 12 12 12-5.385 12-12S18.615 0 12 0" />
    </svg>
  );
}

export function KebabIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={s.kebab} aria-hidden>
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

/**
 * Pretty-print a URL as `host[/path]` for the URL bar — falls back to a
 * placeholder if no URL is provided or it fails to parse.
 */
export function prettyHost(url?: string): string {
  if (!url) return PREVIEW_COPY.sampleHost;
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

interface BrowserChromeProps {
  /** Site URL to display in the address pill. */
  siteUrl?: string;
  /**
   * Verbatim pill text (e.g. the site name, or 'preview') — wins over
   * siteUrl. Used by the preview modes, which have a brand name but no
   * real URL yet.
   */
  urlText?: string;
}

export default function BrowserChrome({ siteUrl, urlText }: BrowserChromeProps) {
  return (
    <div className={s.chrome}>
      <div className={s.dots}>
        <span className={`${s.dot} ${s.r}`} />
        <span className={`${s.dot} ${s.y}`} />
        <span className={`${s.dot} ${s.g}`} />
      </div>
      <div className={s.urlBar}>
        <WordPressIcon />
        <span>{urlText || prettyHost(siteUrl)}</span>
      </div>
      <KebabIcon />
    </div>
  );
}
