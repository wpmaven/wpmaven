import React, { useEffect, useState } from 'react';
import { Button, Checkbox } from '@yotako/webmaven-ui';
import { getSEOData } from '../services/api';
import { isAiEditingEnabled } from '../../utils/siteChat';
import { hasFeature, useSiteState } from '../../utils/siteState';
import { fetchSeoCheck, fetchSeoSuggestion, fetchSiteSearch, generateShareImage, generateSiteShareImage, type CheckFinding, type SeoCheck, type SiteSearch } from '../../services/edits';
import { siteName } from '../../utils/brand';
import type { EditOperation, SeoFields } from '../../types/edits';
import { pageFor } from './bindings';
import { useAppliedFollows, type EditorEnv } from './env';
import { MediaPicker } from './ImagePanel';
import { EditErrorBanner, EditResultLine, PanelFrame, PreviewFlow, Working } from './ui';
import { useEditOperation } from './useEditOperation';

/** What search engines show in full (the counters' goal). */
export const SEO_TITLE_GOAL = 60;
export const SEO_DESCRIPTION_GOAL = 155;
/** The longest values kept. */
export const SEO_TITLE_MAX = 300;
export const SEO_DESCRIPTION_MAX = 1000;

type Tab = 'page' | 'site';

/**
 * Search and sharing. Two tabs:
 *  - This page: how the page in the frame shows in search results and when
 *    it is shared (title, description, sharing picture and words, whether
 *    search engines may show it), saved as a change to the page. Where the
 *    account allows it (features.shareImage, 1.8.0), a picture for sharing
 *    is made for the page ("Generate a picture", and Suggest for a page
 *    without one): it lands in the media library and fills the form like a
 *    picture chosen there, kept only when the owner saves.
 *  - Whole site: whether search engines may list the site at all (hiding it
 *    always asks first), the picture a shared page without its own shows
 *    (made here too, 1.9.0, from the site's name and tagline), the tagline,
 *    and the check of how search engines see the site, each finding with
 *    its fix.
 * Every save is a change with a row in History and its undo.
 */
export function SeoPanel({ env, postId }: { env: EditorEnv; postId: number }) {
  const [tab, setTab] = useState<Tab>('page');
  const page = env.siteMap?.pages.find((p) => p.postId === postId) ?? pageFor(env.siteMap, env.currentPage);
  return (
    <PanelFrame
      chip="Search"
      color="var(--purple)"
      title={tab === 'page' ? (page?.title ? `${page.title} in search results` : 'In search results') : 'Your whole site'}
      sub={tab === 'page' ? 'The title, the line under it, and how it looks when shared' : 'What search engines and shared links get from every page'}
      onClose={env.closePanel}
    >
      <div className="wme-gs-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'page'} data-testid="seo-tab-page" className={`wme-gs-tab${tab === 'page' ? ' is-on' : ''}`} onClick={() => setTab('page')}>This page</button>
        <button type="button" role="tab" aria-selected={tab === 'site'} data-testid="seo-tab-site" className={`wme-gs-tab${tab === 'site' ? ' is-on' : ''}`} onClick={() => setTab('site')}>Whole site</button>
      </div>
      {tab === 'page' ? <PageSearch env={env} postId={postId || page?.postId || 0} /> : <SiteSearchTab env={env} />}
    </PanelFrame>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function Counter({ n, goal }: { n: number; goal: number }) {
  return <p className="wme-gs-hint" style={{ marginTop: 4 }}>{n} characters. Around {goal} show in full.</p>;
}

interface PageValues {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: number | string | null;
  ogImageUrl: string;
  shown: boolean;
}

const EMPTY: PageValues = { title: '', description: '', ogTitle: '', ogDescription: '', ogImage: null, ogImageUrl: '', shown: true };

function PageSearch({ env, postId: id }: { env: EditorEnv; postId: number }) {
  const [loading, setLoading] = useState(!!id);
  const [initial, setInitial] = useState<PageValues>(EMPTY);
  const [v, setV] = useState<PageValues>(EMPTY);
  const [picking, setPicking] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The picture for sharing made here (2026-10-17): busy, the last one made (its id), what came from Suggest, and why one was not made.
  const [making, setMaking] = useState(false);
  const [suggestingPicture, setSuggestingPicture] = useState(false);
  const [made, setMade] = useState<number | null>(null);
  const [suggestedPicture, setSuggestedPicture] = useState(false);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const site = useSiteState();
  const canMakePicture = hasFeature(site, 'shareImage') && isAiEditingEnabled();
  const flow = useEditOperation();
  useAppliedFollows(flow, env);
  const s = flow.state;
  const busy = s.phase === 'publishing';
  const siteUrl = env.siteMap?.pages.find((p) => p.postId === id)?.url ?? '';

  useEffect(() => {
    let alive = true;
    if (!id) { setLoading(false); return () => { alive = false; }; }
    setLoading(true);
    getSEOData(id)
      .then((d: any) => {
        if (!alive) return;
        const read: PageValues = {
          title: d.meta_title || '', description: d.meta_description || '', ogTitle: d.og_title || '', ogDescription: d.og_description || '',
          ogImage: d.og_image ? d.og_image : null, ogImageUrl: d.og_image || '', shown: d.noindex !== true,
        };
        setInitial(read);
        setV(read);
      })
      .catch(() => { if (alive) setNote('The current search details could not be read. What you save here replaces them.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const seo: SeoFields = {
    ...(v.title.trim() !== initial.title.trim() ? { title: v.title.trim().slice(0, SEO_TITLE_MAX) } : {}),
    ...(v.description.trim() !== initial.description.trim() ? { description: v.description.trim().slice(0, SEO_DESCRIPTION_MAX) } : {}),
    ...(v.ogTitle.trim() !== initial.ogTitle.trim() ? { ogTitle: v.ogTitle.trim().slice(0, SEO_TITLE_MAX) } : {}),
    ...(v.ogDescription.trim() !== initial.ogDescription.trim() ? { ogDescription: v.ogDescription.trim().slice(0, SEO_DESCRIPTION_MAX) } : {}),
    ...(v.ogImage !== initial.ogImage ? { ogImage: v.ogImage } : {}),
    ...(v.shown !== initial.shown ? { noindex: !v.shown } : {}),
  };
  const changed = Object.keys(seo).length > 0;
  const set = (patch: Partial<PageValues>) => setV((cur) => ({ ...cur, ...patch }));

  const save = async () => {
    if (!id || !changed) return;
    const r = await flow.publishNow({ op: 'update_post', postId: id, fields: { seo } });
    if (r?.status === 'published') setInitial(v);
  };

  // Suggest also makes a picture for a page without one, when the account allows it.
  const suggestsPicture = canMakePicture && v.ogImage === null;

  const suggest = async () => {
    if (!id) return;
    const withPicture = suggestsPicture;
    setSuggesting(true);
    setSuggestingPicture(withPicture);
    setNote(null);
    if (withPicture) {
      setPictureError(null);
      setPicking(false);
    }
    try {
      const out = await fetchSeoSuggestion(id, { image: withPicture });
      set({ title: out.title || v.title, description: out.description || v.description });
      const picture = out.image;
      if (picture) {
        // Never over a picture the owner chose while Suggest was working.
        setV((cur) => (cur.ogImage === null ? { ...cur, ogImage: picture.id, ogImageUrl: picture.url } : cur));
        setMade(picture.id);
        setSuggestedPicture(true);
      }
      if (out.imageError) setPictureError(out.imageError);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'No suggestion right now. Try again in a moment.');
    } finally {
      setSuggesting(false);
      setSuggestingPicture(false);
    }
  };

  const makePicture = async () => {
    if (!id) return;
    setMaking(true);
    setPictureError(null);
    setPicking(false);
    try {
      const picture = await generateShareImage(id, { title: v.ogTitle.trim() || v.title, description: v.ogDescription.trim() || v.description });
      set({ ogImage: picture.id, ogImageUrl: picture.url });
      setMade(picture.id);
      setSuggestedPicture(false);
    } catch (err) {
      setPictureError(err instanceof Error ? err.message : 'No picture right now. Try again in a moment.');
    } finally {
      setMaking(false);
    }
  };

  const shareTitle = v.ogTitle.trim() || v.title.trim();
  const shareDescription = v.ogDescription.trim() || v.description.trim();
  const disabled = loading || busy || !id;
  const pictureBusy = making || suggestingPicture;
  const madeShown = made !== null && v.ogImage === made;
  // A picture made here and not saved yet: Save keeps it.
  const madeUnsaved = madeShown && v.ogImage !== initial.ogImage && !making;

  return (
    <>
      {!id && <p className="wme-gs-hint">Open a page of your site first: its search details are set here.</p>}
      {loading && <Working text="Reading the page's search details." />}
      {note && <p className="wme-gs-note is-warn" role="status">{note}</p>}
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-seo-title">Title</label>
        <input id="wme-gs-seo-title" data-testid="seo-title" className="wme-gs-input" value={v.title} onChange={(e) => set({ title: e.target.value })} maxLength={SEO_TITLE_MAX} disabled={disabled} />
        <Counter n={v.title.trim().length} goal={SEO_TITLE_GOAL} />
      </div>
      <div>
        <label className="wme-gs-label" htmlFor="wme-gs-seo-desc">Description</label>
        <textarea id="wme-gs-seo-desc" data-testid="seo-description" className="wme-gs-textarea" value={v.description} onChange={(e) => set({ description: e.target.value })} maxLength={SEO_DESCRIPTION_MAX} disabled={disabled} />
        <Counter n={v.description.trim().length} goal={SEO_DESCRIPTION_GOAL} />
      </div>
      <div className="wme-gs-preview-card" data-testid="seo-search-preview" aria-label="How it shows in search results">
        <p className="wme-gs-hint" style={{ margin: 0 }}>{siteUrl || 'your site'}</p>
        <p style={{ margin: '2px 0', color: 'var(--purple)', fontSize: 15 }}>{(v.title.trim() || 'Your page').slice(0, SEO_TITLE_GOAL)}{v.title.trim().length > SEO_TITLE_GOAL ? '...' : ''}</p>
        <p className="wme-gs-hint" style={{ margin: 0 }}>{(v.description.trim() || 'Search engines show a piece of the page here.').slice(0, SEO_DESCRIPTION_GOAL)}{v.description.trim().length > SEO_DESCRIPTION_GOAL ? '...' : ''}</p>
      </div>

      <fieldset className="wme-gs-group">
        <legend className="wme-gs-label">When someone shares this page</legend>
        <p className="wme-gs-hint">The picture and words a link shows on Facebook, WhatsApp, LinkedIn and in messages.</p>
        <div className="wme-gs-actions">
          {v.ogImageUrl && <img src={v.ogImageUrl} alt="" style={{ width: 64, height: 34, objectFit: 'cover', borderRadius: 4 }} />}
          <Button variant="outline" size="sm" data-testid="seo-share-pick" disabled={disabled || pictureBusy} onClick={() => setPicking((p) => !p)}>{picking ? 'Close' : 'Choose a picture'}</Button>
          {canMakePicture && (
            <Button variant="outline" size="sm" data-testid="seo-share-generate" disabled={disabled || pictureBusy} isLoading={making} onClick={() => { void makePicture(); }}>
              {madeShown ? 'Generate another' : 'Generate a picture'}
            </Button>
          )}
          {v.ogImage !== null && (
            <Button variant="ghost" size="sm" data-testid="seo-share-remove" disabled={disabled || pictureBusy} onClick={() => { set({ ogImage: null, ogImageUrl: '' }); setSuggestedPicture(false); }}>Remove</Button>
          )}
        </div>
        {picking && <MediaPicker selected={typeof v.ogImage === 'number' ? v.ogImage : null} onPick={(m) => { set({ ogImage: m.id, ogImageUrl: m.url }); setPicking(false); setSuggestedPicture(false); }} />}
        {making && <Working text="Making a picture for this page in your site's style. This can take up to a minute." />}
        {pictureError && <p className="wme-gs-note is-bad" role="alert" data-testid="seo-share-generate-error">{pictureError}</p>}
        {madeUnsaved && !suggestedPicture && (
          <p className="wme-gs-hint" data-testid="seo-share-made">Made for this page and added to your media library. Save to use it when the page is shared.</p>
        )}
        <p className="wme-gs-hint">Without one, the page's featured image or your site's sharing picture is used.</p>
        <label className="wme-gs-label" htmlFor="wme-gs-og-title">Title for sharing</label>
        <input id="wme-gs-og-title" data-testid="seo-og-title" className="wme-gs-input" placeholder={v.title} value={v.ogTitle} onChange={(e) => set({ ogTitle: e.target.value })} maxLength={SEO_TITLE_MAX} disabled={disabled} />
        <label className="wme-gs-label" htmlFor="wme-gs-og-desc">Description for sharing</label>
        <textarea id="wme-gs-og-desc" data-testid="seo-og-description" className="wme-gs-textarea" placeholder={v.description} value={v.ogDescription} onChange={(e) => set({ ogDescription: e.target.value })} maxLength={SEO_DESCRIPTION_MAX} disabled={disabled} />
        <div className="wme-gs-preview-card" data-testid="seo-share-preview" aria-label="How a shared link looks">
          {v.ogImageUrl && <img src={v.ogImageUrl} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 4 }} />}
          <p className="wme-gs-hint" style={{ margin: '4px 0 0' }}>{hostOf(siteUrl).toUpperCase()}</p>
          <p style={{ margin: '2px 0', fontWeight: 600 }}>{shareTitle || 'Your page'}</p>
          {shareDescription && <p className="wme-gs-hint" style={{ margin: 0 }}>{shareDescription.slice(0, 120)}</p>}
        </div>
        {madeUnsaved && suggestedPicture && (
          <p className="wme-gs-hint" data-testid="seo-share-suggested">Suggested with the words: a picture made for this page, added to your media library. Keep it, remove it or choose another. Save keeps it with the words.</p>
        )}
      </fieldset>

      <Checkbox checked={v.shown} disabled={disabled} onChange={(shown) => set({ shown })} label={<span data-testid="seo-page-shown">Show this page in search engines</span>} />
      {!v.shown && <p className="wme-gs-hint">Search engines stop listing this page. Visitors still reach it from your menu and links.</p>}

      {suggestingPicture && <Working text="Writing a title and a description, and making a picture for this page. This can take up to a minute." />}
      {busy && <Working text="Saving." />}
      {s.result && <EditResultLine result={s.result} failure={s.error} />}
      {s.error && s.error.stage === 'publish' && (
        <EditErrorBanner code={s.error.code} message={s.error.message} busy={busy} onRetry={() => { void save(); }} onDiscard={() => { flow.reset(); setV(initial); }} />
      )}
      <div className="wme-gs-actions">
        {isAiEditingEnabled() && (
          <Button variant="outline" size="sm" data-testid="seo-suggest" onClick={() => { void suggest(); }} isLoading={suggesting} disabled={suggesting || making || disabled}>Suggest</Button>
        )}
        {s.phase === 'published' && s.result?.undoable && (
          <Button data-testid="editor-undo" variant="ghost" size="sm" onClick={() => env.undo(s.result!)}>Undo</Button>
        )}
        <Button data-testid="seo-save" variant="primary" size="sm" className="wme-gs-push" disabled={!changed || disabled} isLoading={busy} onClick={() => { void save(); }}>
          Save
        </Button>
      </div>
    </>
  );
}

function SiteSearchTab({ env }: { env: EditorEnv }) {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<SiteSearch | null>(null);
  const [shown, setShown] = useState(true);
  const [tagline, setTagline] = useState('');
  const [image, setImage] = useState<{ id: number | string | null; url: string }>({ id: null, url: '' });
  const [picking, setPicking] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The whole site's picture made here (2026-10-19), under the page tab's gate: busy, the last one made, why one was not made.
  const site = useSiteState();
  const canMakePicture = hasFeature(site, 'shareImage') && isAiEditingEnabled();
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<number | null>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const flow = useEditOperation();
  useAppliedFollows(flow, env);
  const s = flow.state;
  const busy = s.phase === 'publishing';

  const load = () => {
    setLoading(true);
    fetchSiteSearch()
      .then((st) => {
        setState(st);
        setShown(!st.hidden);
        setTagline(st.tagline);
        setImage({ id: st.shareImage, url: st.shareImageUrl });
      })
      .catch((err) => setNote(err instanceof Error ? err.message : 'Your site\'s search settings could not be read.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const fields: Extract<EditOperation, { op: 'update_site_search' }>['fields'] = state ? {
    ...(shown === state.hidden ? { hidden: !shown } : {}),
    ...(tagline.trim() !== state.tagline ? { tagline: tagline.trim() } : {}),
    ...(state.canSetShareImage && image.id !== state.shareImage ? { shareImage: image.id } : {}),
  } : {};
  const changed = Object.keys(fields).length > 0;

  const save = async () => {
    if (!changed) return;
    const r = await flow.publishNow({ op: 'update_site_search', fields });
    if (r?.status === 'published') load();
  };

  /**
   * Its words are the site's name and tagline. A homepage that is a page
   * lends its design (the page route); one that lists the latest posts
   * has the site route, which reads the header and the homepage.
   */
  const makePicture = async () => {
    if (!state) return;
    setMaking(true);
    setPictureError(null);
    setPicking(false);
    try {
      const words = { title: siteName(), description: tagline.trim() };
      const picture = typeof state.frontPage === 'number' ? await generateShareImage(state.frontPage, words) : await generateSiteShareImage(words);
      setImage({ id: picture.id, url: picture.url });
      setMade(picture.id);
    } catch (err) {
      setPictureError(err instanceof Error ? err.message : 'No picture right now. Try again in a moment.');
    } finally {
      setMaking(false);
    }
  };
  const madeShown = made !== null && image.id === made;

  return (
    <>
      {loading && <Working text="Reading your site's search settings." />}
      {note && <p className="wme-gs-note is-warn" role="status">{note}</p>}
      {state?.hidden && <p className="wme-gs-note is-bad" role="alert" data-testid="seo-site-hidden">Your whole site is hidden from search engines.</p>}
      {state && (
        <>
          <Checkbox
            checked={shown}
            disabled={busy}
            onChange={(on) => { if (on) setShown(true); else setConfirmHide(true); }}
            label={<span data-testid="seo-site-shown">Show my site in search engines</span>}
          />
          {confirmHide && (
            <div className="wme-gs-note is-warn" role="alertdialog" aria-labelledby="wme-gs-hide-title" data-testid="seo-hide-confirm">
              <p id="wme-gs-hide-title" style={{ margin: 0, fontWeight: 600 }}>Hide your whole site from search engines?</p>
              <p style={{ margin: '4px 0' }}>Google and the others stop listing every page of your site, and people searching for your business will not find it. You can switch it back on at any time. Pages can take a few weeks to show again.</p>
              <div className="wme-gs-actions">
                <Button variant="outline" size="sm" data-testid="seo-hide-yes" onClick={() => { setShown(false); setConfirmHide(false); }}>Hide my site</Button>
                <Button variant="primary" size="sm" data-testid="seo-hide-no" onClick={() => setConfirmHide(false)}>Keep it visible</Button>
              </div>
            </div>
          )}

          <div>
            <p className="wme-gs-label">Sharing picture</p>
            {state.canSetShareImage ? (
              <>
                <p className="wme-gs-hint">Shown when someone shares a page that has no picture of its own.</p>
                <div className="wme-gs-actions">
                  {image.url && <img src={image.url} alt="" style={{ width: 64, height: 34, objectFit: 'cover', borderRadius: 4 }} />}
                  <Button variant="outline" size="sm" data-testid="seo-site-pick" disabled={busy || making} onClick={() => setPicking((p) => !p)}>{picking ? 'Close' : 'Choose a picture'}</Button>
                  {canMakePicture && (
                    <Button variant="outline" size="sm" data-testid="seo-site-generate" disabled={busy || making} isLoading={making} onClick={() => { void makePicture(); }}>
                      {madeShown ? 'Make another' : 'Make a picture'}
                    </Button>
                  )}
                  {image.id !== null && <Button variant="ghost" size="sm" disabled={busy || making} onClick={() => setImage({ id: null, url: '' })}>Remove</Button>}
                </div>
                {picking && <MediaPicker selected={typeof image.id === 'number' ? image.id : null} onPick={(m) => { setImage({ id: m.id, url: m.url }); setPicking(false); }} />}
                {making && <Working text="Making a picture for your site in its style. This can take up to a minute." />}
                {pictureError && <p className="wme-gs-note is-bad" role="alert" data-testid="seo-site-generate-error">{pictureError}</p>}
                {madeShown && image.id !== state.shareImage && !making && (
                  <p className="wme-gs-hint" data-testid="seo-site-made">Made for your site and added to your media library. Save to use it when a page without its own picture is shared.</p>
                )}
              </>
            ) : (
              <p className="wme-gs-hint">Your SEO plugin, {state.seoPlugin ?? 'your SEO plugin'}, sets the picture used when a page has none. Change it in its settings.</p>
            )}
          </div>

          <div>
            <label className="wme-gs-label" htmlFor="wme-gs-tagline">Tagline</label>
            <input id="wme-gs-tagline" data-testid="seo-tagline" className="wme-gs-input" value={tagline} maxLength={200} disabled={busy} onChange={(e) => setTagline(e.target.value)} />
            <p className="wme-gs-hint">A short line about your business. Search engines show it for your homepage when the homepage has no description of its own.</p>
          </div>

          {busy && <Working text="Saving." />}
          {s.result && <EditResultLine result={s.result} failure={s.error} />}
          {s.error && s.error.stage === 'publish' && (
            <EditErrorBanner code={s.error.code} message={s.error.message} busy={busy} onRetry={() => { void save(); }} onDiscard={() => { flow.reset(); load(); }} />
          )}
          <div className="wme-gs-actions">
            {s.phase === 'published' && s.result?.undoable && (
              <Button data-testid="editor-undo" variant="ghost" size="sm" onClick={() => env.undo(s.result!)}>Undo</Button>
            )}
            <Button data-testid="seo-site-save" variant="primary" size="sm" className="wme-gs-push" disabled={!changed || busy} isLoading={busy} onClick={() => { void save(); }}>Save</Button>
          </div>
        </>
      )}
      <SeoCheckList env={env} />
    </>
  );
}

const OPEN_PANELS: Record<string, string> = { social_links: 'social', site_search: 'seo', page_search: 'seo', menus: 'menus' };

/** The check of how search engines see the site: counts, findings and their fixes. */
export function SeoCheckList({ env }: { env: EditorEnv }) {
  const [check, setCheck] = useState<SeoCheck | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState<CheckFinding | null>(null);
  const flow = useEditOperation();
  useAppliedFollows(flow, env);

  useEffect(() => {
    fetchSeoCheck(false).then(setCheck).catch(() => undefined).finally(() => setLoading(false));
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setCheck(await fetchSeoCheck(true));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your site could not be checked just now.');
    } finally {
      setRunning(false);
    }
  };

  const fix = (f: CheckFinding) => {
    if (!f.fix) return;
    if (f.fix.kind === 'operation') {
      setFixing(f);
      void flow.preview(f.fix.operation);
    } else if (OPEN_PANELS[f.fix.target]) {
      env.openPanel?.({ kind: OPEN_PANELS[f.fix.target] } as never);
    }
  };

  const open = (check?.findings ?? []).filter((f) => f.level !== 'ok');
  const fine = (check?.findings ?? []).filter((f) => f.level === 'ok');

  return (
    <section className="wme-gs-group" data-testid="seo-check" aria-label="Search check">
      <p className="wme-gs-label">Search check</p>
      {loading ? <Working text="Reading your last check." /> : !check ? (
        <p className="wme-gs-hint">Check how search engines see your site. It reads your pages and takes about a minute.</p>
      ) : (
        <p className="wme-gs-hint" data-testid="seo-check-counts">{check.counts.fix} to fix, {check.counts.improve} to improve, {check.counts.ok} fine.</p>
      )}
      {running && <Working text="Checking your site. This takes about a minute." />}
      {error && <p className="wme-gs-note is-bad" role="alert">{error}</p>}
      {open.map((f) => (
        <div key={`${f.id}:${f.title}`} className={`wme-gs-finding is-${f.level}`} data-testid="seo-finding" data-level={f.level}>
          <p style={{ margin: 0 }}><strong>{f.level === 'fix' ? 'To fix' : 'To improve'}:</strong> {f.title}</p>
          {f.detail && <p className="wme-gs-hint" style={{ margin: 0 }}>{f.detail}</p>}
          {f.where.length > 0 && <p className="wme-gs-hint" style={{ margin: 0 }}>{f.where.slice(0, 5).map((w) => w.label).join(', ')}{f.where.length > 5 ? ` and ${f.where.length - 5} more` : ''}</p>}
          {f.fix && <Button variant="outline" size="sm" data-testid="seo-finding-fix" disabled={flow.state.phase === 'previewing' || flow.state.phase === 'publishing'} onClick={() => fix(f)}>{f.fix.label}</Button>}
        </div>
      ))}
      {fixing && (
        <PreviewFlow
          flow={flow}
          canPreview={false}
          onPreview={() => undefined}
          workingText="Preparing the fix. This can take up to a minute."
          onUndo={(r) => env.undo(r)}
          onDone={() => { setFixing(null); flow.reset(); void run(); }}
        />
      )}
      {fine.length > 0 && (
        <details>
          <summary className="wme-gs-hint">{fine.length} fine</summary>
          <ul className="wme-gs-hint" style={{ margin: '4px 0 0', paddingLeft: 16 }}>{fine.map((f) => <li key={f.id}>{f.title}</li>)}</ul>
        </details>
      )}
      <div className="wme-gs-actions">
        <Button variant={check ? 'ghost' : 'primary'} size="sm" data-testid="seo-check-run" disabled={running} isLoading={running} onClick={() => { void run(); }}>{check ? 'Check again' : 'Check my site'}</Button>
      </div>
    </section>
  );
}
