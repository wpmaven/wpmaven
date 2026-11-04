import React, { useEffect, useRef, useState } from 'react';
import { operatorTitle } from '../../../utils/team';
import { Button } from '@yotako/webmaven-ui';
import { useDashboard } from '../../../contexts/DashboardContext';
import { editFailure, errorSentence, storeApi } from '../../../services/storeApi';
import { WpRestError, wpRest } from '../../../services/wpRest';
import type { MediaUse, StoreCaps, StoreEditResult, StoreMediaRow } from '../../../types/store';
import { nameOr } from '../../../utils/brand';
import Confirm from '../store/shared/Confirm';
import EditOutcome from '../store/shared/EditOutcome';
import MediaPicker from '../store/shared/MediaPicker';
import { MEDIA_FIELDS, formatBytes, toMediaRow, type WpMedia } from '../store/shared/media';
import { useStoreContext } from '../store/shared/storeContext';
import { ConnectionNote, Drawer, ErrorLine, Field, Loading } from '../store/shared/ui';

export const ALT_HINT = 'Describe this image for people who cannot see it. Search engines read it too.';
/** The designed pages' note, in the site's brand (white label) or naming nobody. */
function designedNote(): string {
  const brand = nameOr('');
  return brand
    ? `Pages designed by ${brand} keep their own description of this image. Change it in the editor.`
    : 'Designed pages keep their own description of this image. Change it in the editor.';
}

function notDescribed(): string {
  const brand = nameOr('');
  return brand ? `${brand} could not describe this image. Try again.` : 'This image could not be described. Try again.';
}
/** How long the Undo of a text change stays. */
const UNDO_MS = 10_000;

const USE_KIND: Record<MediaUse['kind'], string> = {
  page: 'Page', post: 'Post', product: 'Product', variation: 'Product option', 'blog-cards': 'Blog cards',
  logo: 'Logo', icon: 'Site icon', placeholder: 'Product placeholder', fact: 'Business details',
};
const USE_HOW: Record<MediaUse['how'], string> = { content: 'in its content', featured: 'featured image', gallery: 'gallery', setting: 'setting' };

export function inUseSentence(n: number, kind: StoreMediaRow['kind']): string {
  return `This ${kind === 'image' ? 'image' : 'file'} is used in ${n} ${n === 1 ? 'place' : 'places'}. Replace it there first, or replace it everywhere at once.`;
}

interface TextForm {
  title: string;
  alt: string;
  caption: string;
}

const formOf = (m: StoreMediaRow): TextForm => ({ title: m.title, alt: m.alt, caption: m.caption });

/** A wp-admin path of a use ("post.php?post=12&action=edit") as a link; anything else is no link. */
function adminHref(path: string | null, adminUrl: string): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  if (!/^[\w-]+\.php([?#]|$)/.test(path)) return null;
  return `${adminUrl.replace(/\/?$/, '/')}${path}`;
}

/**
 * One file of the library: its texts (title, the description for people
 * who cannot see it, caption) saved on the file with a short Undo, a
 * description written by AI, where it is used, Replace (everywhere at
 * once, an edit operation), Copy link, and Delete for a file nothing uses.
 */
export default function MediaDetail({ id, initial, fresh, caps, writesAvailable, onClose, onChanged, onDeleted }: {
  id: number;
  initial?: StoreMediaRow;
  /** Just uploaded: the panel asks for its description first. */
  fresh?: boolean;
  caps: StoreCaps;
  writesAvailable: boolean;
  onClose: () => void;
  /** The file changed (texts, uses): the grid shows it. */
  onChanged: (row: StoreMediaRow | null) => void;
  onDeleted: (id: number, name: string) => void;
}) {
  const { openEditor } = useDashboard();
  const { context } = useStoreContext();
  const adminUrl = context?.adminUrl || (window as any).WEBMAVEN_WP_DATA?.adminUrl || '/wp-admin/';
  const [row, setRow] = useState<StoreMediaRow | null>(initial ?? null);
  const [form, setForm] = useState<TextForm | null>(initial ? formOf(initial) : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** undefined while reading, null when the read failed. */
  const [uses, setUses] = useState<MediaUse[] | null | undefined>(undefined);
  const [partial, setPartial] = useState(false);
  const [busy, setBusy] = useState<'save' | 'undo' | 'suggest' | 'replace' | 'delete' | null>(null);
  const [undo, setUndo] = useState<Record<string, string> | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'menu' | 'pick' | 'ai'>('view');
  const [instruction, setInstruction] = useState('');
  const [outcome, setOutcome] = useState<StoreEditResult | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const [readKey, setReadKey] = useState(0);
  const altField = useRef<HTMLTextAreaElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  /** The owner typed since the file was read: a later read keeps what they typed. */
  const typed = useRef(false);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    wpRest.get<WpMedia>(`wp/v2/media/${id}`, { query: { context: 'edit', wpmaven_uses: 1, _fields: MEDIA_FIELDS } }).then(
      (answer) => {
        if (!live) return;
        const fresher = toMediaRow(answer.data);
        setRow(fresher);
        if (!typed.current) setForm(formOf(fresher));
      },
      (e) => live && setLoadError(errorSentence(e, 'This file could not be read. Try again.')),
    );
    storeApi.mediaUsage([id]).then(
      (answer) => {
        if (!live) return;
        setUses(answer?.uses?.[String(id)] ?? []);
        setPartial(answer?.partial === true);
      },
      () => live && setUses(null),
    );
    return () => {
      live = false;
    };
  }, [id, readKey]);

  // A file just uploaded: the cursor waits in its description.
  const asked = useRef(false);
  useEffect(() => {
    if (!fresh || asked.current || !altField.current) return;
    asked.current = true;
    altField.current.focus();
  });

  // The picker or the AI instruction closed: the keyboard goes back to Replace.
  const lastMode = useRef(mode);
  useEffect(() => {
    if ((lastMode.current === 'pick' || lastMode.current === 'ai') && mode === 'view') {
      actions.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    }
    lastMode.current = mode;
  }, [mode]);

  useEffect(() => {
    if (!undo) return undefined;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const write = async (body: Record<string, string>): Promise<StoreMediaRow> => {
    const answer = await wpRest.post<WpMedia>(`wp/v2/media/${id}`, body, { query: { context: 'edit', _fields: MEDIA_FIELDS } });
    const next = { ...toMediaRow(answer.data), uses: row?.uses ?? null };
    setRow(next);
    setForm(formOf(next));
    typed.current = false;
    onChanged(next);
    return next;
  };

  const save = async () => {
    if (!row || !form) return;
    const body: Record<string, string> = {};
    const before: Record<string, string> = {};
    if (form.title !== row.title) { body.title = form.title; before.title = row.title; }
    if (form.alt !== row.alt) { body.alt_text = form.alt; before.alt_text = row.alt; }
    if (form.caption !== row.caption) { body.caption = form.caption; before.caption = row.caption; }
    if (!Object.keys(body).length) {
      setProblem('Nothing changed yet.');
      return;
    }
    setBusy('save');
    setProblem(null);
    setNote(null);
    try {
      await write(body);
      setUndo(before);
      setNote('Saved.');
    } catch (e) {
      setProblem(errorSentence(e, 'The change did not save. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const putBack = async () => {
    if (!undo) return;
    setBusy('undo');
    try {
      await write(undo);
      setUndo(null);
      setNote('Put back as it was.');
    } catch (e) {
      setProblem(errorSentence(e, 'The undo did not go through. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const suggest = async () => {
    setBusy('suggest');
    setProblem(null);
    setNote(null);
    try {
      const suggestion = (await storeApi.suggestAltText([id])).find((s) => s.mediaId === id);
      if (suggestion?.alt) {
        typed.current = true;
        setForm((f) => (f ? { ...f, alt: suggestion.alt } : f));
        setNote('Read the description, change it if you like, then save it.');
      } else {
        setProblem(notDescribed());
      }
    } catch (e) {
      setProblem(errorSentence(e, notDescribed()));
    } finally {
      setBusy(null);
    }
  };

  const replace = async (how: { mediaId: number } | { instruction: string }) => {
    setBusy('replace');
    setProblem(null);
    setOutcome(null);
    try {
      const result = await storeApi.edit({ op: 'replace_image', target: { kind: 'media', mediaId: id }, ...how });
      setOutcome(result);
      if (!editFailure(result)) {
        setMode('view');
        setInstruction('');
        setRefusal(null);
        setReadKey((k) => k + 1);
        onChanged(null);
      }
    } catch (e) {
      setProblem(errorSentence(e, 'The image was not replaced. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const usedIn = uses ? uses.length : row?.uses ?? 0;

  const askToDelete = () => {
    setRefusal(null);
    setProblem(null);
    if (row && usedIn > 0) setRefusal(inUseSentence(usedIn, row.kind));
    else setAskDelete(true);
  };

  const remove = async () => {
    if (!row) return;
    setAskDelete(false);
    setBusy('delete');
    try {
      await storeApi.deleteMedia(id);
      onDeleted(id, row.filename || row.title);
    } catch (e) {
      if (e instanceof WpRestError && e.code === 'in_use') {
        const listed = Array.isArray(e.data?.uses) ? (e.data!.uses as MediaUse[]) : null;
        if (listed) setUses(listed);
        setRefusal(e.message || inUseSentence(listed?.length ?? usedIn, row.kind));
      } else {
        setProblem(errorSentence(e, 'The file was not deleted. Try again.'));
      }
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async () => {
    if (!row) return;
    try {
      await navigator.clipboard.writeText(row.url);
      setNote('Link copied.');
    } catch {
      setNote(`Copy this link: ${row.url}`);
    }
  };

  const image = row?.kind === 'image';
  const set = (patch: Partial<TextForm>) => {
    typed.current = true;
    setForm((f) => (f ? { ...f, ...patch } : f));
  };
  const footer = row && form && mode !== 'pick' ? (
    <>
      <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      <Button variant="primary" size="sm" onClick={save} isLoading={busy === 'save'} disabled={!!busy} data-testid="media-save">Save</Button>
    </>
  ) : undefined;

  return (
    <Drawer open title={row?.filename || row?.title || 'File'} onClose={onClose} footer={footer} testId="media-detail">
      <ErrorLine message={loadError} onRetry={() => setReadKey((k) => k + 1)} />
      {!row || !form ? (!loadError && <Loading label="Reading the file" />) : mode === 'pick' ? (
        <MediaPicker
          title="Choose the new image, or upload it"
          excludeId={id}
          onCancel={() => setMode('view')}
          onPick={(m) => {
            setMode('view');
            void replace({ mediaId: m.id });
          }}
        />
      ) : (
        <>
          <div className="wm-media-detail__preview">
            {row.thumbUrl ? <img src={row.thumbUrl} alt={row.alt} /> : <span className="wm-media-card__type">{row.mime || 'File'}</span>}
          </div>
          <p className="wm-store-muted">
            {[row.width && row.height ? `${row.width} × ${row.height}` : '', row.bytes ? formatBytes(row.bytes) : '', row.mime].filter(Boolean).join(' · ')}
          </p>
          {fresh && image && (
            <div className="wm-store-note" role="note">
              <strong>Describe this image</strong>
              <p className="wm-media-detail__ask">{ALT_HINT}</p>
            </div>
          )}
          <Field label="Title" htmlFor="media-title">
            <input id="media-title" className="wm-store-input" value={form.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          {image && (
            <Field label="Description for people who cannot see it" htmlFor="media-alt" hint={ALT_HINT}>
              <textarea id="media-alt" ref={altField} className="wm-store-textarea" value={form.alt} maxLength={1000} onChange={(e) => set({ alt: e.target.value })} />
            </Field>
          )}
          {image && caps.spend && (
            <div>
              <Button variant="secondary" size="sm" onClick={suggest} isLoading={busy === 'suggest'} disabled={!!busy}>Suggest a description</Button>
            </div>
          )}
          <Field label="Caption" htmlFor="media-caption" hint="Shown under the image where your pages show captions.">
            <textarea id="media-caption" className="wm-store-textarea wm-media-detail__caption" value={form.caption} onChange={(e) => set({ caption: e.target.value })} />
          </Field>
          {(note || undo) && (
            <div className="wm-store-outcome wm-store-outcome--ok" role="status" data-testid="media-saved">
              <span className="wm-store-outcome__text">{note}</span>
              {undo && (
                <Button variant="ghost" size="sm" onClick={putBack} isLoading={busy === 'undo'} data-testid="media-undo">Undo</Button>
              )}
            </div>
          )}
          <ErrorLine message={problem} />

          <section className="wm-media-uses" aria-label="Where it is used">
            <h3 className="wm-store-panel__title">Where it is used</h3>
            {uses === undefined ? <p className="wm-store-muted">Looking for the places that use it.</p> : uses === null ? (
              <p className="wm-store-muted">The places that use it could not be read.</p>
            ) : uses.length === 0 ? (
              <p className="wm-store-muted">Nothing on your site uses this file.</p>
            ) : (
              <ul className="wm-media-uses__list" data-testid="media-uses">
                {uses.map((u, i) => {
                  const href = adminHref(u.editPath, adminUrl);
                  return (
                    <li key={`${i}-${u.kind}-${u.id ?? ''}`}>
                      <span className="wm-store-grow">
                        {u.title || USE_KIND[u.kind]}
                        <span className="wm-store-muted"> {USE_KIND[u.kind]}{USE_HOW[u.how] ? `, ${USE_HOW[u.how]}` : ''}</span>
                      </span>
                      {u.designed && u.id ? (
                        <Button variant="ghost" size="sm" onClick={() => openEditor(u.id as number)}>Open in the editor</Button>
                      ) : href ? <a className="wm-store-link" href={href}>Open</a> : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {partial && <p className="wm-store-muted">Your site has many pages, so it may be used in more places.</p>}
            {uses?.some((u) => u.designed) && <p className="wm-store-note" role="note">{designedNote()}</p>}
          </section>

          <div className="wm-store-badges wm-media-detail__actions" ref={actions}>
            {image && (
              <Button variant="secondary" size="sm" onClick={() => setMode(mode === 'menu' ? 'view' : 'menu')} aria-expanded={mode === 'menu' || mode === 'ai'} disabled={!writesAvailable}>
                Replace
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={copyLink}>Copy link</Button>
            <Button variant="danger" size="sm" onClick={askToDelete} isLoading={busy === 'delete'} disabled={!!busy && busy !== 'delete'}>Delete</Button>
          </div>
          {image && !writesAvailable && <ConnectionNote available={false} />}
          {mode === 'menu' && (
            <div className="wm-media-detail__menu" role="group" aria-label="Replace this image">
              <p className="wm-store-muted">The new image takes its place everywhere it is used. This file stays in your library.</p>
              <Button variant="secondary" size="sm" onClick={() => setMode('pick')}>With another image</Button>
              {caps.spend && <Button variant="secondary" size="sm" onClick={() => setMode('ai')}>With an image made by AI</Button>}
            </div>
          )}
          {mode === 'ai' && (
            <div className="wm-media-detail__menu">
              <Field label="What should change?" htmlFor="media-ai" hint={`Your ${operatorTitle('web_designer')} makes a new image from this one and your instruction. It uses AI time.`}>
                <textarea id="media-ai" className="wm-store-textarea" value={instruction} maxLength={500} autoFocus onChange={(e) => setInstruction(e.target.value)} />
              </Field>
              <div className="wm-store-badges">
                <Button variant="primary" size="sm" onClick={() => void replace({ instruction: instruction.trim() })} isLoading={busy === 'replace'} disabled={!instruction.trim() || !!busy}>
                  Make the new image
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setMode('view')}>Cancel</Button>
              </div>
            </div>
          )}
          {busy === 'replace' && mode !== 'ai' && <Loading label="Replacing the image" />}
          <EditOutcome result={outcome} onUndone={() => { setReadKey((k) => k + 1); onChanged(null); }} />
          {refusal && (
            <div className="wm-store-note wm-store-note--error" role="alert" data-testid="media-refusal">
              {refusal}
              {image && writesAvailable && <button type="button" className="wm-store-link" onClick={() => setMode('pick')}>Replace it everywhere</button>}
            </div>
          )}
        </>
      )}
      <Confirm
        open={askDelete}
        title="Delete this file?"
        message={`${row?.filename || 'This file'} leaves your media library for good. Nothing on your site uses it.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setAskDelete(false)}
        onConfirm={() => void remove()}
      />
    </Drawer>
  );
}
