import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, SearchInput } from '@yotako/webmaven-ui';
import { errorSentence } from '../../../services/storeApi';
import { wpRest, type QueryValue } from '../../../services/wpRest';
import type { StoreMediaRow } from '../../../types/store';
import Pagination from '../ui/Pagination';
import { UploadNote, useMediaUpload } from '../store/shared/MediaPicker';
import { MEDIA_FIELDS, formatBytes, toMediaRow, type WpMedia } from '../store/shared/media';
import { useStoreContext } from '../store/shared/storeContext';
import { Chips, ErrorLine, Loading, StorePage } from '../store/shared/ui';
import { useDebounced } from '../store/shared/useDebounced';
import { idFrom, useSubPath } from '../store/shared/useSubPath';
import DescribeImages from './DescribeImages';
import MediaDetail from './MediaDetail';

type Filter = 'all' | 'image' | 'document' | 'video' | 'no_alt' | 'unused';

const FILTER_QUERY: Record<Filter, Record<string, QueryValue>> = {
  all: {},
  image: { media_type: 'image' },
  document: { media_type: 'application' },
  video: { media_type: 'video' },
  no_alt: { media_type: 'image', wpmaven_no_alt: 1 },
  unused: { wpmaven_unused: 1 },
};

/** Addresses that open the screen on a filter (#/media/without-description, from the Overview tile). */
const FILTER_WORDS: Record<string, Filter> = {
  'without-description': 'no_alt', 'not-used': 'unused', images: 'image', documents: 'document', videos: 'video',
};

const PER_PAGE = 40;

function fileType(row: StoreMediaRow): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(row.filename)?.[1];
  return ext ? ext.toUpperCase() : row.kind === 'video' ? 'Video' : 'File';
}

/**
 * Media: the site's media library as a grid with filters, upload by drag
 * and drop or a button (the site's size limit checked first), a detail per
 * file (#/media/:id) and descriptions written by AI for every image that
 * has none.
 */
export default function MediaScreen() {
  const { caps, writesAvailable, context } = useStoreContext();
  const { parts, go } = useSubPath('media');
  const openId = idFrom(parts[0]);
  const [filter, setFilter] = useState<Filter>(() => FILTER_WORDS[parts[0] ?? ''] ?? 'all');
  const [search, setSearch] = useState('');
  const query = useDebounced(search);
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{ items: StoreMediaRow[]; total: number; totalPages: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [freshId, setFreshId] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { upload, progress, errors, maxBytes } = useMediaUpload();
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const close = useCallback(() => go([]), [go]);
  const closeDescribe = useCallback(() => setDescribing(false), []);

  // An address naming a filter sets it (the tile's link, a pasted address).
  const word = FILTER_WORDS[parts[0] ?? ''];
  useEffect(() => {
    if (word) setFilter(word);
  }, [word]);

  useEffect(() => {
    setPage(1);
  }, [filter, query]);

  useEffect(() => {
    if (!caps.media) return undefined;
    let live = true;
    setError(null);
    wpRest.get<WpMedia[]>('wp/v2/media', {
      query: { ...FILTER_QUERY[filter], per_page: PER_PAGE, page, search: query, context: 'edit', wpmaven_uses: 1, _fields: MEDIA_FIELDS },
    }).then(
      (answer) => live && setList({ items: (Array.isArray(answer.data) ? answer.data : []).map(toMediaRow), total: answer.total, totalPages: answer.totalPages }),
      (e) => live && setError(errorSentence(e, 'Your media library could not be read. Try again.')),
    );
    return () => {
      live = false;
    };
  }, [caps.media, filter, query, page, reloadKey]);

  const changed = useCallback((row: StoreMediaRow | null) => {
    if (!row) {
      setReloadKey((k) => k + 1);
      return;
    }
    setList((l) => (l ? { ...l, items: l.items.map((m) => (m.id === row.id ? { ...row, uses: row.uses ?? m.uses } : m)) } : l));
  }, []);

  const deleted = useCallback((id: number, name: string) => {
    setList((l) => (l ? { ...l, items: l.items.filter((m) => m.id !== id), total: Math.max(0, l.total - 1) } : l));
    setNote(`${name} was deleted.`);
    go([]);
  }, [go]);

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    setNote(null);
    const rows = await upload(files);
    if (!rows.length) return;
    reload();
    const last = rows[rows.length - 1];
    setFreshId(last.id);
    go([last.id]);
  };

  if (!caps.media) {
    return (
      <StorePage title="Media" testId="media-root">
        <p className="wm-store-note" role="note">Your WordPress account cannot upload files on this site. Ask an administrator of the site if you need to.</p>
      </StorePage>
    );
  }

  const items = list?.items ?? [];
  const withoutAlt = context?.counts?.imagesWithoutAlt;
  const filters: Array<{ value: Filter; label: string; count?: number | null }> = [
    { value: 'all', label: 'All' },
    { value: 'image', label: 'Images' },
    { value: 'document', label: 'Documents' },
    { value: 'video', label: 'Videos' },
    { value: 'no_alt', label: 'Without description', count: typeof withoutAlt === 'number' && withoutAlt > 0 ? withoutAlt : null },
    { value: 'unused', label: 'Not used' },
  ];

  return (
    <StorePage
      title="Media"
      testId="media-root"
      actions={(
        <>
          {caps.spend && (
            <Button variant="secondary" size="sm" onClick={() => setDescribing(true)}>Describe images without a description</Button>
          )}
          <Button variant="primary" size="sm" onClick={() => fileInput.current?.click()} disabled={!!progress}>Upload</Button>
        </>
      )}
    >
      <div
        className={`wm-media ${dragging ? 'wm-media--drop' : ''}`}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void onFiles(Array.from(e.dataTransfer?.files ?? []));
        }}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          aria-label="Upload files"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void onFiles(files);
          }}
        />
        <button type="button" className="wm-media-drop" onClick={() => fileInput.current?.click()} disabled={!!progress}>
          <span className="wm-store-strong">Drop files here to upload them, or choose files</span>
          <span className="wm-store-muted">Up to {formatBytes(maxBytes)} each.</span>
        </button>
        <UploadNote progress={progress} errors={errors} />
        {note && <p className="wm-store-outcome wm-store-outcome--ok" role="status">{note}</p>}
        <div className="wm-store-toolbar">
          <SearchInput aria-label="Search the media library" placeholder="Search files" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Chips label="Show" value={filter} options={filters} onChange={setFilter} />
        <ErrorLine message={error} onRetry={reload} />
        {!list && !error && <Loading label="Reading your media library" />}
        {list && !items.length && (
          <p className="wm-store-muted" data-testid="media-empty">
            {filter === 'no_alt' && !query ? 'Every image has a description.' : query || filter !== 'all' ? 'No file matches.' : 'Your media library is empty. Upload a file to start.'}
          </p>
        )}
        {!!items.length && (
          <ul className="wm-media-grid" data-testid="media-grid">
            {items.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`wm-media-card ${openId === m.id ? 'wm-media-card--on' : ''}`}
                  onClick={() => go([m.id])}
                  data-testid={`media-card-${m.id}`}
                >
                  <span className="wm-media-card__thumb">
                    {m.thumbUrl ? <img src={m.thumbUrl} alt="" loading="lazy" /> : <span className="wm-media-card__type">{fileType(m)}</span>}
                  </span>
                  <span className="wm-media-card__name">{m.title || m.filename}</span>
                  <span className="wm-media-card__marks">
                    {m.kind === 'image' && !m.alt.trim() && <span className="wm-mark wm-mark--warn">No description</span>}
                    {m.uses !== null && <span className="wm-mark">{m.uses > 0 ? `Used ${m.uses}` : 'Not used'}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {list && <Pagination currentPage={page} totalPages={list.totalPages} total={list.total} onPageChange={setPage} />}
      </div>
      {openId && (
        <MediaDetail
          key={openId}
          id={openId}
          initial={items.find((m) => m.id === openId)}
          fresh={freshId === openId}
          caps={caps}
          writesAvailable={writesAvailable}
          onClose={close}
          onChanged={changed}
          onDeleted={deleted}
        />
      )}
      {describing && <DescribeImages onClose={closeDescribe} onApplied={reload} />}
    </StorePage>
  );
}
