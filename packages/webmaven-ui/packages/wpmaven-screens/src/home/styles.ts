import { useInsertionEffect } from 'react';
import type React from 'react';
import { SCREENS_VERSION } from '../version';

/**
 * The few rules the Home sections cannot say inline (2026-10-16): each one
 * measures the room it really has with a container query (the dashboard's
 * columns, the plugin's page), as the dashboard's stylesheet did before they
 * were shared. Every other style is inline, on the kit's tokens.
 *
 *   the growth card   from 640px inside it, the chart and the milestones side
 *                     by side, the chart about two thirds; one alone takes
 *                     the row;
 *   the work strip    with 24 months (the 2-year view), the number above each
 *                     bar only from 560px of strip;
 *   the milestones    one line per step, the current step's buttons at the
 *                     right end of its own line; under 400px a button shows
 *                     its icon and one word, a row of two its icons alone;
 *                     the full label from 560px;
 *   the site preview  the site's screenshot fills its card at 16:10, so it
 *                     never jumps while it loads; hover or keyboard focus
 *                     lays a dark veil over it with "Visit your site" (dark
 *                     in both themes: it sits on a picture), a screen with
 *                     no hover a small label in the corner;
 *   get paid          the three gateways side by side only when the card
 *                     itself is 600px wide, else one under the other (never
 *                     two and an orphan); the line that folds the owner's
 *                     own providers, with a chevron that turns when open.
 *
 * Put once in the page's head by the first section drawn (a host imports
 * nothing), under the package's version.
 */
export const HOME_SECTIONS_CSS = `
.wms-growth { container: wms-growth / inline-size; }
.wms-growth-grid { display: grid; gap: 20px; grid-template-columns: minmax(0, 1fr); align-items: start; }
@container wms-growth (min-width: 640px) {
  .wms-growth-grid { grid-template-columns: minmax(0, 2fr) minmax(250px, 1fr); gap: 24px; }
  .wms-growth-grid > :only-child { grid-column: 1 / -1; }
}
.wms-work-strip { container: wms-workstrip / inline-size; }
.wms-work-strip--dense .wms-work-count { visibility: hidden; }
@container wms-workstrip (min-width: 560px) {
  .wms-work-strip--dense .wms-work-count { visibility: visible; }
}
.wms-milestones { container: wms-milestones / inline-size; }
.wms-ms-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.wms-ms-main { flex: 1 1 0; min-width: 80px; display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; }
.wms-ms-name { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.wms-ms-progress { flex: none; display: inline-flex; align-items: center; gap: 6px; }
.wms-ms-actions { flex: none; margin-left: auto; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.wms-ms-share-note { flex-basis: 100%; min-width: 0; padding-left: 30px; }
.wms-ms-btn-full { display: none; }
.wms-ms-row--two .wms-ms-btn-short { display: none; }
.wms-ms-row .wms-ms-btn { padding: 0 9px; gap: 5px; }
.wms-ms-row--two .wms-ms-btn { padding: 0 8px; }
@container wms-milestones (min-width: 400px) {
  .wms-ms-row { column-gap: 10px; }
  .wms-ms-row--two .wms-ms-btn-short { display: inline; }
  .wms-ms-row .wms-ms-btn,
  .wms-ms-row--two .wms-ms-btn { padding: 0 13px; gap: 6px; }
}
@container wms-milestones (min-width: 560px) {
  .wms-ms-btn-short,
  .wms-ms-row--two .wms-ms-btn-short { display: none; }
  .wms-ms-btn-full { display: inline; }
}
.wms-site-preview { overflow: hidden; }
.wms-site-preview:has(.wms-site-preview-link:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.wms-site-preview-link { position: relative; display: block; aspect-ratio: 16 / 10; color: #fff; text-decoration: none; outline: none; }
.wms-site-preview-link img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.wms-site-preview-veil {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px;
  background: rgba(14, 15, 19, 0.55); color: #fff; font-size: var(--text-body); font-weight: 600;
  opacity: 0; transition: opacity 0.15s ease;
}
.wms-site-preview-link:hover .wms-site-preview-veil,
.wms-site-preview-link:focus-visible .wms-site-preview-veil { opacity: 1; }
.wms-site-preview-tag {
  position: absolute; right: 10px; bottom: 10px; display: none; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 999px; background: rgba(14, 15, 19, 0.72); color: #fff;
  font-size: var(--text-meta); font-weight: 600;
}
@media (hover: none) {
  .wms-site-preview-tag { display: inline-flex; }
}
@media (prefers-reduced-motion: reduce) {
  .wms-site-preview-veil { transition: none; }
}
.wms-getpaid { container: wms-getpaid / inline-size; }
.wms-getpaid-gateways { grid-template-columns: minmax(0, 1fr); }
@container wms-getpaid (min-width: 600px) {
  .wms-getpaid-gateways { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .wms-getpaid-gateways[data-count='2'] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .wms-getpaid-gateways[data-count='1'] { grid-template-columns: minmax(0, 1fr); }
}
.wms-getpaid-others-toggle {
  display: flex; align-items: center; gap: 6px;
  padding: 0; border: 0; background: none; cursor: pointer;
  font-family: inherit; font-size: 12px; color: var(--text-dim); text-align: left;
}
.wms-getpaid-others-toggle:hover { color: var(--text); }
.wms-getpaid-others-toggle:focus-visible { outline: 2px solid var(--accent, #6962AD); outline-offset: 2px; border-radius: 4px; }
.wms-getpaid-others-chevron { width: 14px; height: 14px; flex-shrink: 0; transition: transform 0.15s ease; }
.wms-getpaid-others-chevron[data-open='true'] { transform: rotate(180deg); }
`;

/** The id of the one style element, per version of the package. */
export const HOME_STYLE_ID = `wpmaven-screens-home-${SCREENS_VERSION}`;

/** Puts HOME_SECTIONS_CSS in the page's head once (nothing on the server). */
export function useHomeSectionStyles(): void {
  useInsertionEffect(() => {
    if (typeof document === 'undefined' || document.getElementById(HOME_STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = HOME_STYLE_ID;
    el.textContent = HOME_SECTIONS_CSS;
    document.head.appendChild(el);
  }, []);
}

/** Read by a screen reader, never seen: the words of a chart or a check, without a stylesheet class. */
export const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', borderWidth: 0,
};

/**
 * The small uppercase label every Home section opens with. A div, not a
 * heading: the dashboard sets its h1 and h2 in the display serif, which is
 * the page title's voice, not a section label's.
 */
export const SECTION_LABEL: React.CSSProperties = {
  fontSize: 'var(--text-label)', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-dim)',
};
