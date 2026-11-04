import React, { useEffect, useState } from 'react';
import { TeamFace } from '../../team/TeamFace';
import { operatorTitle } from '../../../utils/team';
import { Button } from '@yotako/webmaven-ui';
import { editFailure, errorSentence, storeApi } from '../../../services/storeApi';
import { wpRest } from '../../../services/wpRest';
import type { DesignedPicture } from '../../../types/store';
import { MEDIA_FIELDS, toMediaRow, type WpMedia } from '../store/shared/media';
import { Drawer, ErrorLine, Loading } from '../store/shared/ui';

/** The alt-text route takes at most this many pictures at once. */
const BATCH = 10;
/** One change describes at most this many pictures. */
const MAX_APPLY = 40;

/**
 * A picture to describe: a media library file (mediaId; when the site's
 * design shows it, its description reaches the design too), or a picture of
 * the site's design that is not a library file (file).
 */
interface Picture {
  key: string;
  mediaId: number | null;
  file: string | null;
  /** The file's name, or where the design shows the picture. */
  label: string;
  thumbUrl: string | null;
}

interface Draft {
  picture: Picture;
  alt: string;
}

const libraryPicture = (id: number, label: string, thumbUrl: string | null): Picture => ({ key: `m:${id}`, mediaId: id, file: null, label, thumbUrl });
const designPicture = (p: DesignedPicture): Picture => ({ key: `f:${p.file}`, mediaId: null, file: p.file, label: p.name, thumbUrl: p.url });

/** "12 images have no description." with the design's pictures after the library's. */
function missingLine(library: number, total: number, design: number): string {
  const parts: string[] = [];
  if (library) parts.push(total > library ? `${total} images have no description. These are the first ${library}.` : `${library} ${library === 1 ? 'image has' : 'images have'} no description.`);
  if (design) {
    parts.push(library
      ? `${design} more ${design === 1 ? 'picture' : 'pictures'} of your site's design ${design === 1 ? 'has' : 'have'} none.`
      : `${design} ${design === 1 ? 'picture' : 'pictures'} of your site's design ${design === 1 ? 'has' : 'have'} no description.`);
  }
  return parts.join(' ');
}

/**
 * Describe images without a description, at once: the media library's and
 * the pictures of the site's design. WPMaven writes a description of each
 * picture (batches of 10), the owner reads them, changes or drops any, then
 * applies the ones kept as one change with one undo.
 */
export default function DescribeImages({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const [images, setImages] = useState<Picture[] | null>(null);
  const [counts, setCounts] = useState({ library: 0, total: 0, design: 0 });
  const [designNotYet, setDesignNotYet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [writing, setWriting] = useState<{ done: number; total: number } | null>(null);
  const [written, setWritten] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      wpRest.get<WpMedia[]>('wp/v2/media', {
        query: { media_type: 'image', wpmaven_no_alt: 1, per_page: 100, context: 'edit', _fields: MEDIA_FIELDS },
      }),
      storeApi.designedPictures(),
    ]).then(
      ([answer, designed]) => {
        if (!live) return;
        const rows = (Array.isArray(answer.data) ? answer.data : []).map(toMediaRow).filter((m) => !m.alt.trim());
        // A library file the design shows: one picture, named by where it is.
        const shownBy = new Map(designed.pictures.filter((p) => p.mediaId).map((p) => [p.mediaId as number, p]));
        const library = rows.map((m) => libraryPicture(m.id, (designed.canDescribe && shownBy.get(m.id)?.name) || m.filename || m.title, m.thumbUrl));
        const listed = new Set(rows.map((m) => m.id));
        const design = designed.canDescribe ? designed.pictures.filter((p) => !p.mediaId || !listed.has(p.mediaId)).map(designPicture) : [];
        setImages([...library, ...design]);
        setCounts({ library: library.length, total: answer.total, design: design.length });
        setDesignNotYet(!designed.canDescribe && designed.pictures.length > 0);
      },
      (e) => live && setError(errorSentence(e, 'Your images could not be read. Try again.')),
    );
    return () => {
      live = false;
    };
  }, []);

  const write = async () => {
    if (!images?.length) return;
    setError(null);
    setDrafts([]);
    setWriting({ done: 0, total: images.length });
    for (let i = 0; i < images.length; i += BATCH) {
      const batch = images.slice(i, i + BATCH);
      try {
        const ids = batch.filter((p) => p.mediaId).map((p) => p.mediaId as number);
        const files = batch.filter((p) => p.file).map((p) => p.file as string);
        const suggestions = await storeApi.suggestAltText(ids, files);
        const byKey = new Map(suggestions.map((s) => [s.file ? `f:${s.file}` : `m:${s.mediaId}`, s.alt]));
        setDrafts((before) => [...before, ...batch.filter((p) => byKey.get(p.key)).map((p) => ({ picture: p, alt: String(byKey.get(p.key)) }))]);
      } catch (e) {
        setError(errorSentence(e, `Your ${operatorTitle('seo_specialist')} stopped writing descriptions. Try again.`));
        break;
      }
      setWriting({ done: Math.min(i + BATCH, images.length), total: images.length });
    }
    setWriting(null);
    setWritten(true);
  };

  const [undoId, setUndoId] = useState<string | null>(null);

  // One change for every description kept: one row in the history, one undo (at most 40 at a time).
  const apply = async () => {
    const kept = drafts.filter((d) => d.alt.trim()).slice(0, MAX_APPLY);
    if (!kept.length) return;
    setApplying(true);
    setError(null);
    try {
      const items = kept.map((d) => (d.picture.mediaId ? { mediaId: d.picture.mediaId, alt: d.alt.trim() } : { file: d.picture.file as string, alt: d.alt.trim() }));
      const r = await storeApi.edit({ op: 'describe_images', items });
      const failure = editFailure(r);
      if (failure) {
        setError(failure.message);
      } else {
        const saved = kept.length;
        setDrafts((before) => before.filter((d) => !kept.includes(d)));
        setResult(`${saved} ${saved === 1 ? 'description' : 'descriptions'} saved.`);
        setUndoId(r?.undoable && r.operationId ? r.operationId : null);
        onApplied();
      }
    } catch (e) {
      setError(errorSentence(e, 'The descriptions did not save. Try again.'));
    } finally {
      setApplying(false);
    }
  };

  const undo = async () => {
    if (!undoId) return;
    setApplying(true);
    try {
      const r = await storeApi.undo(undoId);
      const failure = editFailure(r);
      if (failure) setError(failure.message);
      else {
        setResult('The descriptions were taken back.');
        setUndoId(null);
        onApplied();
      }
    } catch (e) {
      setError(errorSentence(e, 'The descriptions could not be taken back. Try again.'));
    } finally {
      setApplying(false);
    }
  };

  const kept = Math.min(drafts.filter((d) => d.alt.trim()).length, MAX_APPLY);
  const footer = (
    <>
      <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      {written && (
        <Button variant="primary" size="sm" onClick={apply} isLoading={applying} disabled={!kept || applying} data-testid="describe-apply">
          {`Apply ${kept} ${kept === 1 ? 'description' : 'descriptions'}`}
        </Button>
      )}
    </>
  );

  return (
    <Drawer open title="Describe images" onClose={onClose} footer={footer} testId="describe-images">
      {!images && !error && <Loading label="Looking for images without a description" />}
      {images && images.length === 0 && !result && <p className="wm-store-muted">Every image has a description.</p>}
      {designNotYet && <p className="wm-store-muted" data-testid="describe-design-later">Descriptions for the pictures of your site&apos;s design are not available yet.</p>}
      {images && images.length > 0 && !written && !writing && (
        <>
          <p>
            {missingLine(counts.library, counts.total, counts.design)}
            {` Your ${operatorTitle('seo_specialist')} looks at each picture and writes one. You read them before anything is saved. This uses AI time.`}
          </p>
          <div>
            <Button variant="primary" size="sm" onClick={write} data-testid="describe-write">Write the descriptions</Button>
          </div>
        </>
      )}
      {writing && (
        <p className="wm-store-muted" role="status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TeamFace id="seo_specialist" title={operatorTitle('seo_specialist')} presence="working" size="card" decorative />
          {`Your ${operatorTitle('seo_specialist')} is writing descriptions: ${writing.done} of ${writing.total}`}
        </p>
      )}
      {result && (
        <p className="wm-store-outcome wm-store-outcome--ok" role="status">
          {result}
          {undoId && <> <Button variant="ghost" size="sm" onClick={undo} disabled={applying} data-testid="describe-undo">Undo</Button></>}
        </p>
      )}
      <ErrorLine message={error} />
      {written && drafts.length > MAX_APPLY && (
        <p className="wm-store-muted">{`One change saves at most ${MAX_APPLY} descriptions: the first ${MAX_APPLY} now, then apply again for the others.`}</p>
      )}
      {drafts.length > 0 && (
        <ul className="wm-describe" data-testid="describe-review">
          {drafts.map((d) => (
            <li key={d.picture.key} className="wm-describe__item" data-design={d.picture.file ? 'true' : undefined}>
              <div className="wm-store-thumb">{d.picture.thumbUrl ? <img src={d.picture.thumbUrl} alt="" /> : null}</div>
              <div className="wm-store-grow">
                <label className="wm-store-field__label" htmlFor={`describe-${d.picture.key}`}>Description of {d.picture.label}</label>
                <textarea
                  id={`describe-${d.picture.key}`}
                  className="wm-store-textarea wm-describe__text"
                  value={d.alt}
                  maxLength={1000}
                  onChange={(e) => setDrafts((before) => before.map((x) => (x.picture.key === d.picture.key ? { ...x, alt: e.target.value } : x)))}
                />
              </div>
              <Button variant="ghost" size="sm" onClick={() => setDrafts((before) => before.filter((x) => x.picture.key !== d.picture.key))} aria-label={`Drop the description of ${d.picture.label}`}>
                Drop
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
