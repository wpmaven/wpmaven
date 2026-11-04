import React, { useCallback, useEffect, useState } from 'react';
import { editsApi } from '../services/edits';
import type { SiteMap } from '../types/edits';
import { pluginName } from '../utils/apiWords';
import { siteBrand, type SiteBrand } from '../utils/brand';
import { hasFeature, useSiteState } from '../utils/siteState';
import { EDITOR_LOADING_TEXT, PageLoading } from '../components/AppLoading';
import { useDashboardOptional } from '../contexts/DashboardContext';
import { TEMPLATE_OF_MAP, TEMPLATE_TITLES, type EditorTemplate } from '../utils/editorAddress';

// The section editor: its own chunk.
const GenstudioEditor = React.lazy(() => import('./genstudio/GenstudioEditor'));

type Mode = 'loading' | 'sections' | 'unavailable';

/**
 * The template pages a site map offers (2026-10-19): the product page when
 * it has a designed one (woo_single), the post page when it has a designed
 * one (post_single), each with the record the map opens it on.
 */
export function templatesOf(map: SiteMap | null): EditorTemplate[] {
  if (!map || map.engine !== 'genstudio') return [];
  const out: EditorTemplate[] = [];
  for (const kind of ['product', 'post'] as const) {
    const page = map.pages.find((p) => p.template && TEMPLATE_OF_MAP[p.template] === kind);
    if (page) out.push({ kind, title: TEMPLATE_TITLES[kind], showing: page.showing ?? null });
  }
  return out;
}

interface EditorAppProps {
  selectedItem?: { type: string; id: string | number; title: string; url?: string; slug?: string } | null;
}

/**
 * Whether a site opens the section editor: WPMaven built it and edits run
 * for it (its first change starts the editor when its design has no live
 * head yet), or WPMaven did not design it and its plugin edits its pages'
 * blocks.
 */
export function genstudioReady(map: SiteMap | null): boolean {
  if (!map || !map.editable) return false;
  if (map.engine === 'wordpress') return true;
  return map.engine === 'genstudio' && (!!map.head.operationId || map.reason === 'NO_LIVE_RUN');
}

/**
 * Why the editor cannot open now, in the owner's words. Under an agency's or
 * a partner's brand the words name it (utils/brand.ts).
 */
export function unavailableText(map: SiteMap | null, b: SiteBrand = siteBrand()): string {
  if (!map) return 'The editor could not read your site just now. Try again in a moment.';
  if (map.reason === 'PLUGIN_UPDATE_REQUIRED') return `Update ${pluginName(b)} to change this site section by section.`;
  return 'Changing this site from here is paused for a moment. You can still change your pages in WordPress.';
}

/** The app's loader with the editor's line, as the editor page shows it before. */
function Loading() {
  return <PageLoading text={EDITOR_LOADING_TEXT} />;
}

/**
 * The editor page's app: the section editor on every site (sections, header
 * and footer, menus, facts, pictures, colours and fonts, pages, history with
 * undo), or what keeps it closed for now.
 */
export default function EditorApp({ selectedItem }: EditorAppProps) {
  const site = useSiteState();
  const edits = hasFeature(site, 'edits');
  // A site the account says WPMaven built opens at once; the site map confirms.
  const [mode, setMode] = useState<Mode>(() => (edits && site.business?.engine === 'genstudio' ? 'sections' : edits ? 'loading' : 'unavailable'));
  const [siteMap, setSiteMap] = useState<SiteMap | null>(null);
  const [loadingMap, setLoadingMap] = useState(edits);
  const [why, setWhy] = useState<string>(() => (edits ? '' : 'Changing this site from here is paused for a moment. You can still change your pages in WordPress.'));

  // The sidebar beside the editor lists the template pages the map offers.
  const setEditorTemplates = useDashboardOptional()?.setEditorTemplates;
  const load = useCallback(async (first: boolean) => {
    try {
      const map = await editsApi.siteMap();
      setSiteMap(map);
      setEditorTemplates?.(templatesOf(map));
      if (genstudioReady(map)) {
        setMode('sections');
      } else {
        setMode('unavailable');
        setWhy(unavailableText(map));
      }
    } catch {
      // The map could not be read. A site the account says WPMaven built keeps
      // the section editor (its sections carry their own addresses).
      if (first) {
        setMode((m) => (m === 'sections' ? 'sections' : 'unavailable'));
        setWhy(unavailableText(null));
      }
    } finally {
      setLoadingMap(false);
    }
  }, [setEditorTemplates]);

  useEffect(() => {
    if (edits) void load(true);
  }, [edits, load]);

  const refresh = useCallback(() => { void load(false); }, [load]);

  return (
    <div
      data-testid="editor-root"
      data-mode={mode}
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}
    >
      {mode === 'loading' && <Loading />}
      {mode === 'sections' && (
        <React.Suspense fallback={<Loading />}>
          <GenstudioEditor siteMap={siteMap} loadingMap={loadingMap} onRefreshSiteMap={refresh} selectedItem={selectedItem} />
        </React.Suspense>
      )}
      {mode === 'unavailable' && (
        <div data-testid="editor-unavailable" role="status" style={{ margin: 'auto', maxWidth: 440, padding: 24, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <p style={{ margin: 0 }}>{why}</p>
          {edits && (
            <button
              type="button"
              data-testid="editor-retry"
              onClick={() => { setMode('loading'); setLoadingMap(true); void load(true); }}
              style={{ border: '1px solid var(--glass-border)', background: 'var(--bg)', color: 'var(--purple)', borderRadius: 999, padding: '4px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
