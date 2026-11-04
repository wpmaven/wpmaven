import React from 'react';
import Loader from './BrandLoader';
import { siteBrand } from '../utils/brand';

/**
 * The loader's box on a loading screen. The kit draws the Hand-off mark at
 * about 80% of its box, so the mark reads about 64px wide, as wide as the
 * loader art it replaced. WordPress's first paint (backend/wpmaven/includes/class-admin.php)
 * draws its mark in a box of the same size, so the swap to this screen does
 * not move it.
 */
export const LOADING_SIZE = 80;

/** The editor's one loading line, wherever it waits. */
export const EDITOR_LOADING_TEXT = 'Loading the editor...';

/**
 * The line under the loader, in the site's brand (1.2.31). WordPress's first
 * paint says the same line (WebMaven_Admin::loading_text()).
 */
export function loadingText(): string {
  const b = siteBrand();
  return b.mode === 'neutral' ? 'Loading...' : `Loading ${b.name}...`;
}

/**
 * The app's loading screen: the brand's animated mark and its line. The
 * gate shows it while the connection is read, and the setup wizard while
 * its chunk and its first answer load, so the owner sees one screen.
 */
export default function AppLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 'var(--wm-app-height, 100vh)', background: 'var(--bg)', gap: 16 }}>
      <Loader size={LOADING_SIZE} />
      <p style={{ color: 'var(--text-dim)', fontFamily: '"Inter", sans-serif', fontSize: 13, lineHeight: 1.5, margin: 0 }}>{loadingText()}</p>
    </div>
  );
}

/**
 * The same loader inside the dashboard: a page whose code is still on its
 * way, and the editor while it opens.
 */
export function PageLoading({ text = loadingText() }: { text?: string }) {
  return (
    <div className="wpm-auth-loading" role="status">
      <Loader size={LOADING_SIZE} />
      <p className="wpm-auth-loading__text">{text}</p>
    </div>
  );
}
