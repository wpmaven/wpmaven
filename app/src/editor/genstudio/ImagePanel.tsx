import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import type { EditOperation, EditView, ImageTarget } from '../../types/edits';
import { KIND_COLORS } from './bindings';
import { useFrameFollows, type EditorEnv } from './env';
import { listMedia, uploadMedia, type MediaItem } from './siteData';
import { BrowserTabMock } from './IdentityPanel';
import { PanelFrame, PreviewFlow } from './ui';
import { useEditOperation } from './useEditOperation';

/** The media library: newest first, a search, an upload. */
export function MediaPicker({ selected, onPick }: { selected: number | null; onPick: (m: MediaItem) => void }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      listMedia(search.trim())
        .then((list) => { if (alive) { setItems(list); setError(null); } })
        .catch(() => { if (alive) setError('Your media library could not be read right now.'); })
        .finally(() => { if (alive) setLoading(false); });
    }, search ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [search]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) {
      setError('Choose a PNG, JPG, WebP or GIF image.');
      return;
    }
    setUploading(true);
    try {
      const m = await uploadMedia(file);
      setItems((cur) => [m, ...cur]);
      onPick(m);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The upload did not work. Try another file.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="wme-gs-actions">
        <input className="wme-gs-input" style={{ flex: 1, minWidth: 0 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your images" aria-label="Search your images" />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} isLoading={uploading} disabled={uploading}>Upload</Button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {error && <p className="wme-gs-note is-warn" role="alert">{error}</p>}
      {loading ? <p className="wme-gs-hint">Reading your images.</p> : items.length === 0 ? (
        <p className="wme-gs-hint">{search ? 'No image matches.' : 'Your media library has no images yet. Upload one.'}</p>
      ) : (
        <div className="wme-gs-media" data-testid="media-picker">
          {items.map((m) => (
            <button key={m.id} type="button" aria-pressed={selected === m.id} onClick={() => onPick(m)} title={m.title || m.alt || 'Image'}>
              <img src={m.thumb} alt={m.alt || m.title || ''} loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The words of the panel for each kind of image. */
export function imageWords(target: ImageTarget | null): { chip: string; title: string; placeholder: string; working: string; lead?: string } {
  if (target?.kind === 'site' && target.slot === 'icon') {
    return {
      chip: 'Site icon',
      title: 'Your site icon',
      placeholder: 'For example: a coffee bean in your accent color, simple and bold',
      working: 'Making the new icon. This can take up to a minute.',
      lead: 'The small picture next to your site\'s name in browser tabs, bookmarks and phone home screens. A square image works best, at least 512 pixels wide.',
    };
  }
  if (target?.kind === 'site') {
    return { chip: 'Logo', title: 'Your logo', placeholder: 'For example: the name in a rounded serif, with a small coffee bean', working: 'Making the new logo. This can take up to a minute.' };
  }
  if (target?.kind === 'chrome') {
    return { chip: 'Image', title: `Image in the ${target.region}`, placeholder: 'For example: a barista pouring latte art, warm morning light', working: 'Making the new image. This can take up to a minute.' };
  }
  return { chip: 'Image', title: 'Image', placeholder: 'For example: a barista pouring latte art, warm morning light', working: 'Making the new image. This can take up to a minute.' };
}

/** The words of the "Change this image" tab. */
export const CHANGE_WORDS = {
  tab: 'Change this image',
  label: 'What should change?',
  placeholder: 'For example: make the background white',
  hint: 'Starts from this image and changes only what you ask.',
  working: 'Changing the image. This can take up to a minute.',
  noPicture: 'This image cannot be shown here. Make a new one or choose one from your library.',
} as const;

export type ImageTab = 'change' | 'new' | 'library';

/** The images a picture can be changed from: those of the pages, the header and the footer. */
export const canChangePicture = (target: ImageTarget | null): boolean => target?.kind === 'section' || target?.kind === 'chrome';

/** The tab a panel opens on: the change of the picture when there is one to start from, else a new image. */
export function defaultImageTab(target: ImageTarget | null, src: string): ImageTab {
  return canChangePicture(target) && /^https?:\/\//.test(src) ? 'change' : 'new';
}

/**
 * What a preview of the panel sends: a change of the picture, a new image
 * from words (with the view they are read with), a library file, or the
 * description alone. null when nothing is asked yet.
 */
export function imageOperation(input: {
  target: ImageTarget;
  tab: ImageTab;
  instruction: string;
  picked: MediaItem | null;
  alt: string | null;
  view?: EditView;
}): EditOperation | null {
  const { target, tab, picked } = input;
  const instruction = input.instruction.trim();
  const altPatch = input.alt !== null ? { alt: input.alt } : {};
  if ((tab === 'change' || tab === 'new') && instruction.length >= 3) {
    return { op: 'replace_image', target, instruction, ...(canChangePicture(target) ? { mode: tab } : {}), ...altPatch, ...(input.view ? { view: input.view } : {}) };
  }
  if (tab === 'library' && picked) return { op: 'replace_image', target, mediaId: picked.id, ...altPatch };
  if (input.alt !== null && canChangePicture(target)) return { op: 'replace_image', target, alt: input.alt };
  return null;
}

/**
 * An image of a section, of the header or footer, the logo or the site icon.
 * A section, header or footer image can be changed as it is ("make the
 * background white", the default when the panel shows its picture), made new
 * from a description, or taken from the media library; its alt text can
 * change with it or alone. A new icon shows in a browser tab mock: no page
 * shows it, so the frame stays on the live site.
 */
export function ImagePanel({ env, target, src, alt, label }: { env: EditorEnv; target: ImageTarget | null; src: string; alt: string; label: string; region?: 'header' | 'footer' }) {
  const [tab, setTab] = useState<ImageTab>(() => defaultImageTab(target, src));
  const [instruction, setInstruction] = useState('');
  const [picked, setPicked] = useState<MediaItem | null>(null);
  const [altText, setAltText] = useState(alt);
  const flow = useEditOperation();
  const isIcon = target?.kind === 'site' && target.slot === 'icon';
  useFrameFollows(flow, env, target && target.kind === 'section' ? target.page : undefined, { preview: !isIcon });
  const busy = flow.state.phase === 'previewing' || flow.state.phase === 'publishing';
  const words = imageWords(target);
  const newIcon = isIcon ? flow.state.preview?.preview?.images?.find((i) => i.ref === 'image:icon')?.url : undefined;
  const hasPicture = /^https?:\/\//.test(src);
  const changeable = canChangePicture(target);

  if (!target) {
    return (
      <PanelFrame chip="Image" color={KIND_COLORS.image} title={label || 'Image'} onClose={env.closePanel}>
        <p className="wme-gs-note">This image is not part of a section, the header or the footer, so it cannot be changed here.</p>
      </PanelFrame>
    );
  }

  const altChanged = !isIcon && altText.trim() !== alt.trim();
  const operation = imageOperation({ target, tab, instruction, picked, alt: altChanged ? altText.trim().slice(0, 250) : null, view: env.view });
  const altOnly = !!operation && operation.op === 'replace_image' && !operation.instruction && !operation.mediaId;
  const canPreview = !!operation && !(tab === 'change' && !hasPicture && !altOnly);
  const workingText = altOnly ? 'Saving the description.' : tab === 'change' ? CHANGE_WORDS.working : tab === 'new' ? words.working : 'Placing your image.';

  return (
    <PanelFrame
      chip={words.chip}
      color={KIND_COLORS.image}
      title={label || words.title}
      onClose={env.closePanel}
      footer={(
        <PreviewFlow
          flow={flow}
          canPreview={canPreview}
          previewLabel={altOnly ? 'Save the description' : 'Preview'}
          onPreview={(refine) => {
            if (!operation) return;
            void flow.preview(operation, { refine: refine && !altOnly && (tab === 'change' || tab === 'new') });
          }}
          workingText={workingText}
          phoneFirst={env.viewport === 'mobile'}
          onUndo={env.undo}
          onDone={env.closePanel}
        />
      )}
    >
      {words.lead && <p className="wme-gs-hint" data-testid="image-lead">{words.lead}</p>}
      {hasPicture && (
        <img src={src} alt={alt || 'The current image'} style={{ width: '100%', maxHeight: isIcon ? 96 : 180, objectFit: 'contain', borderRadius: 10, border: '1px solid var(--glass-border)', background: 'var(--bg)' }} />
      )}
      {isIcon && !src && <p className="wme-gs-hint">Your site has no icon yet, so browsers show a blank page symbol.</p>}
      {newIcon && <BrowserTabMock iconUrl={newIcon} />}
      <div className="wme-gs-tabs" role="tablist" aria-label="Where the new image comes from">
        {changeable && (
          <button type="button" role="tab" data-testid="image-tab-change" aria-selected={tab === 'change'} onClick={() => setTab('change')} disabled={busy}>{CHANGE_WORDS.tab}</button>
        )}
        <button type="button" role="tab" data-testid="image-tab-new" aria-selected={tab === 'new'} onClick={() => setTab('new')} disabled={busy}>{changeable ? 'Make a new one' : 'Make one with AI'}</button>
        <button type="button" role="tab" data-testid="image-tab-library" aria-selected={tab === 'library'} onClick={() => setTab('library')} disabled={busy}>From your library</button>
      </div>
      {tab === 'change' && (
        hasPicture ? (
          <div>
            <label className="wme-gs-label" htmlFor="wme-gs-image-change">{CHANGE_WORDS.label}</label>
            <textarea id="wme-gs-image-change" data-testid="editor-instruction" className="wme-gs-textarea" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={CHANGE_WORDS.placeholder} disabled={busy} maxLength={1000} />
            <p className="wme-gs-hint">{CHANGE_WORDS.hint}</p>
          </div>
        ) : (
          <p className="wme-gs-note" data-testid="image-no-picture">{CHANGE_WORDS.noPicture}</p>
        )
      )}
      {tab === 'new' && (
        <div>
          <label className="wme-gs-label" htmlFor="wme-gs-image-ai">{changeable ? 'Describe the new image' : 'Describe the image'}</label>
          <textarea id="wme-gs-image-ai" data-testid="editor-instruction" className="wme-gs-textarea" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={words.placeholder} disabled={busy} maxLength={1000} />
        </div>
      )}
      {tab === 'library' && (
        <MediaPicker selected={picked?.id ?? null} onPick={(m) => { setPicked(m); if (!altText.trim() && m.alt) setAltText(m.alt); }} />
      )}
      {!isIcon && (
        <div>
          <label className="wme-gs-label" htmlFor="wme-gs-image-alt">Alt text</label>
          <input id="wme-gs-image-alt" data-testid="image-alt" className="wme-gs-input" value={altText} onChange={(e) => setAltText(e.target.value)} placeholder="What the image shows, for people who cannot see it" disabled={busy} maxLength={250} />
        </div>
      )}
    </PanelFrame>
  );
}
