import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, SearchInput } from '@yotako/webmaven-ui';
import { uploadMedia, wpRest } from '../../../../services/wpRest';
import { errorSentence } from '../../../../services/storeApi';
import type { StoreMediaRow } from '../../../../types/store';
import { MEDIA_FIELDS, toMediaRow, tooLargeSentence, type WpMedia } from './media';
import { storeAppData, useStoreContext } from './storeContext';
import { useDebounced } from './useDebounced';
import { ErrorLine, Loading } from './ui';

export interface UploadProgress {
  name: string;
  /** 0 to 1. */
  fraction: number;
}

/**
 * Uploads to the media library, one file after the other, with progress. A
 * file over the site's upload limit is refused before it is sent, with a
 * sentence naming the limit.
 */
export function useMediaUpload() {
  const { context } = useStoreContext();
  const maxBytes = context?.uploads?.maxBytes || storeAppData().uploads.maxBytes;
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const upload = useCallback(async (files: File[]): Promise<StoreMediaRow[]> => {
    const done: StoreMediaRow[] = [];
    const problems: string[] = [];
    for (const file of files) {
      const tooLarge = tooLargeSentence(file, maxBytes);
      if (tooLarge) {
        problems.push(tooLarge);
        continue;
      }
      setProgress({ name: file.name, fraction: 0 });
      try {
        const media = await uploadMedia<WpMedia>(file, { onProgress: (fraction) => setProgress({ name: file.name, fraction }) });
        done.push({ ...toMediaRow(media), uses: 0 });
      } catch (error) {
        problems.push(`${file.name}: ${errorSentence(error, 'The upload did not finish. Try again.')}`);
      }
    }
    setProgress(null);
    setErrors(problems);
    return done;
  }, [maxBytes]);

  return { upload, progress, errors, maxBytes, clearErrors: () => setErrors([]) };
}

/** The upload under way, and what could not go to the site. */
export function UploadNote({ progress, errors }: { progress: UploadProgress | null; errors: string[] }) {
  return (
    <>
      {progress && (
        <div className="wm-upload" role="status">
          <span className="wm-store-ellipsis">Uploading {progress.name}</span>
          <progress max={1} value={progress.fraction} aria-label={`Uploading ${progress.name}`} />
        </div>
      )}
      {errors.map((e) => <p key={e} className="wm-store-note wm-store-note--error" role="alert">{e}</p>)}
    </>
  );
}

/**
 * Choose an image from the media library, or upload a new one (picked at
 * once). Shown inside the panel that asked (a quick edit, a media detail,
 * a product's photos), never as a second panel over it.
 */
export default function MediaPicker({ onPick, onCancel, excludeId, title = 'Choose an image' }: {
  onPick: (media: StoreMediaRow) => void;
  onCancel: () => void;
  /** A file not to offer (the one being replaced). */
  excludeId?: number;
  title?: string;
}) {
  const [search, setSearch] = useState('');
  const query = useDebounced(search);
  const [items, setItems] = useState<StoreMediaRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { upload, progress, errors } = useMediaUpload();
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Only the latest read lands (a quick search answered out of order).
  const latest = useRef(0);
  const load = useCallback(async (nextPage: number, q: string) => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const answer = await wpRest.get<WpMedia[]>('wp/v2/media', {
        query: { media_type: 'image', per_page: 24, page: nextPage, search: q, context: 'edit', _fields: MEDIA_FIELDS },
      });
      if (mine !== latest.current) return;
      const rows = (Array.isArray(answer.data) ? answer.data : []).map(toMediaRow);
      setItems((before) => (nextPage === 1 ? rows : [...before, ...rows]));
      setPage(nextPage);
      setTotalPages(answer.totalPages);
    } catch (e) {
      if (mine === latest.current) setError(errorSentence(e, 'The media library could not be read. Try again.'));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1, query);
  }, [load, query]);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (fileInput.current) fileInput.current.value = '';
    if (!files.length) return;
    const [first] = await upload(files.slice(0, 1));
    if (first) onPick(first);
  };

  const shown = items.filter((m) => m.id !== excludeId);
  return (
    <section className="wm-picker" aria-label={title} data-testid="media-picker">
      <div className="wm-picker__head">
        <h3 className="wm-store-panel__title" tabIndex={-1} ref={heading}>{title}</h3>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
      <div className="wm-store-toolbar">
        <SearchInput aria-label="Search images" placeholder="Search images" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()} disabled={!!progress}>Upload an image</Button>
        <input ref={fileInput} type="file" accept="image/*" hidden aria-label="Upload an image" onChange={(e) => void onFiles(e.target.files)} />
      </div>
      <UploadNote progress={progress} errors={errors} />
      <ErrorLine message={error} onRetry={() => void load(1, query)} />
      {loading && !items.length ? <Loading label="Reading the media library" /> : !error && shown.length === 0 ? (
        <p className="wm-store-muted">{query ? 'No image matches this search.' : 'No images yet. Upload one.'}</p>
      ) : (
        <ul className="wm-picker__grid">
          {shown.map((m) => (
            <li key={m.id}>
              <button type="button" className="wm-picker__item" onClick={() => onPick(m)} title={m.title || m.filename}>
                {m.thumbUrl ? <img src={m.thumbUrl} alt="" loading="lazy" /> : <span>{m.filename}</span>}
                <span className="wm-content-sr">Choose {m.title || m.filename}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {page < totalPages && (
        <Button variant="ghost" size="sm" onClick={() => void load(page + 1, query)} isLoading={loading}>Show more</Button>
      )}
    </section>
  );
}
