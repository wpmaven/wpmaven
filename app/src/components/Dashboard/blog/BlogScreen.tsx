import React, { useCallback, useEffect, useState } from 'react';
import { Button, SearchInput } from '@yotako/webmaven-ui';
import { useDashboard } from '../../../contexts/DashboardContext';
import { editFailure, errorSentence, storeApi } from '../../../services/storeApi';
import { wpRest } from '../../../services/wpRest';
import type { StoreEditResult } from '../../../types/store';
import Pagination from '../ui/Pagination';
import StatusBadge from '../ui/StatusBadge';
import EditOutcome from '../store/shared/EditOutcome';
import { useStoreContext } from '../store/shared/storeContext';
import { ConnectionNote, Chips, Drawer, ErrorLine, Field, Loading, StorePage, shortDate } from '../store/shared/ui';
import { useDebounced } from '../store/shared/useDebounced';
import { idFrom, useSubPath } from '../store/shared/useSubPath';
import PostQuickEdit from './PostQuickEdit';
import { ALL_STATUSES, POST_QUERY, createdPostId, toPost, type BlogPost, type WpPost } from './posts';

type Filter = 'all' | 'publish' | 'draft' | 'future';

const FILTERS: Array<{ value: Filter; label: string; statuses: string }> = [
  { value: 'all', label: 'All', statuses: ALL_STATUSES },
  { value: 'publish', label: 'Published', statuses: 'publish' },
  { value: 'draft', label: 'Drafts', statuses: 'draft,pending' },
  { value: 'future', label: 'Scheduled', statuses: 'future' },
];

const STATUS_LABELS: Record<string, string> = { future: 'Scheduled', pending: 'Waiting for review' };

function dateLine(p: BlogPost): string {
  const when = p.dateGmt || p.date;
  if (p.status === 'future') return `Goes live ${shortDate(when)}`;
  if (p.status === 'draft' || p.status === 'pending') return p.modifiedGmt ? `Last changed ${shortDate(p.modifiedGmt, false)}` : '';
  return shortDate(when, false);
}

/** "New post": its title, then a draft opens in the editor. */
function NewPost({ onClose, writesAvailable }: { onClose: () => void; writesAvailable: boolean }) {
  const { openEditor } = useDashboard();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [failed, setFailed] = useState<StoreEditResult | null>(null);

  const create = async () => {
    const clean = title.trim();
    if (!clean) {
      setProblem('Give the post a title.');
      return;
    }
    setBusy(true);
    setProblem(null);
    setFailed(null);
    try {
      const result = await storeApi.edit({ op: 'add_post', fields: { title: clean, status: 'draft' } });
      const id = createdPostId(result.changed);
      if (editFailure(result) || !id) {
        setFailed(result);
        return;
      }
      openEditor(id);
    } catch (e) {
      setProblem(errorSentence(e, 'The post could not be created. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      title="New post"
      onClose={onClose}
      testId="new-post"
      footer={(
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={create} isLoading={busy} disabled={!writesAvailable}>Create and write it</Button>
        </>
      )}
    >
      <ConnectionNote available={writesAvailable} />
      <Field label="Title" htmlFor="new-post-title" hint="The post starts as a draft and opens in the editor.">
        <input
          id="new-post-title"
          className="wm-store-input"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
        />
      </Field>
      <EditOutcome result={failed} />
      <ErrorLine message={problem} />
    </Drawer>
  );
}

/**
 * Blog: the site's posts (any status) with their image, excerpt, status,
 * date and categories; a quick edit per post (#/blog/:id); New post; Edit
 * content opens the editor. Changes are edit operations (history, undo).
 */
export default function BlogScreen() {
  const { caps, writesAvailable } = useStoreContext();
  const { openEditor } = useDashboard();
  const { parts, go } = useSubPath('blog');
  const openId = idFrom(parts[0]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const query = useDebounced(search);
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{ items: BlogPost[]; total: number; totalPages: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [outcome, setOutcome] = useState<StoreEditResult | null>(null);
  const [creating, setCreating] = useState(false);

  // Stable, so an open drawer keeps its focus when the list reloads.
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const close = useCallback(() => go([]), [go]);
  const closeNew = useCallback(() => setCreating(false), []);
  const done = useCallback((result: StoreEditResult) => {
    setOutcome(result);
    go([]);
    setReloadKey((k) => k + 1);
  }, [go]);

  useEffect(() => {
    setPage(1);
  }, [filter, query]);

  useEffect(() => {
    if (!caps.posts) return undefined;
    let live = true;
    setError(null);
    const statuses = FILTERS.find((f) => f.value === filter)?.statuses ?? ALL_STATUSES;
    wpRest.get<WpPost[]>('wp/v2/posts', {
      query: { ...POST_QUERY, status: statuses, per_page: 20, page, search: query, orderby: 'date', order: 'desc' },
    }).then(
      (answer) => live && setList({ items: (Array.isArray(answer.data) ? answer.data : []).map(toPost), total: answer.total, totalPages: answer.totalPages }),
      (e) => live && setError(errorSentence(e, 'Your posts could not be read. Try again.')),
    );
    return () => {
      live = false;
    };
  }, [caps.posts, filter, query, page, reloadKey]);

  if (!caps.posts) {
    return (
      <StorePage title="Blog" testId="blog-root">
        <p className="wm-store-note" role="note">Your WordPress account cannot edit posts on this site. Ask an administrator of the site if you need to.</p>
      </StorePage>
    );
  }

  const items = list?.items ?? [];

  return (
    <StorePage
      title="Blog"
      testId="blog-root"
      actions={<Button variant="primary" size="sm" onClick={() => setCreating(true)} disabled={!writesAvailable}>New post</Button>}
    >
      <ConnectionNote available={writesAvailable} />
      <div className="wm-store-toolbar">
        <SearchInput aria-label="Search posts" placeholder="Search posts" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Chips label="Show" value={filter} options={FILTERS} onChange={setFilter} />
      {outcome && (
        <EditOutcome
          key={outcome.operationId}
          result={outcome}
          onUndone={() => reload()}
        />
      )}
      <ErrorLine message={error} onRetry={reload} />
      {!list && !error && <Loading label="Reading your posts" />}
      {list && !items.length && (
        <p className="wm-store-muted" data-testid="blog-empty">
          {query || filter !== 'all' ? 'No post matches.' : 'No posts yet. Write your first one with New post.'}
        </p>
      )}
      {!!items.length && (
        <ul className="wm-store-list wm-blog-list" data-testid="blog-list">
          {items.map((p) => (
            <li key={p.id} className="wm-store-row wm-blog-row" data-testid={`blog-post-${p.id}`}>
              <div className="wm-store-thumb wm-blog-row__thumb">
                {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : 'No image'}
              </div>
              <div className="wm-store-grow">
                <div className="wm-blog-row__top">
                  <button type="button" className="wm-blog-row__title" onClick={() => go([p.id])}>{p.title || '(No title)'}</button>
                  <StatusBadge status={p.status} label={STATUS_LABELS[p.status]} />
                </div>
                {p.summary && <p className="wm-blog-row__excerpt">{p.summary}</p>}
                <p className="wm-store-muted">
                  {dateLine(p)}
                  {p.categories.length > 0 && <span>{dateLine(p) ? ' · ' : ''}{p.categories.map((c) => c.name).join(', ')}</span>}
                </p>
              </div>
              <div className="wm-blog-row__actions">
                <Button variant="secondary" size="sm" onClick={() => go([p.id])}>Quick edit</Button>
                <Button variant="ghost" size="sm" onClick={() => openEditor(p.id)}>Edit content</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {list && <Pagination currentPage={page} totalPages={list.totalPages} total={list.total} onPageChange={setPage} />}
      {openId && (
        <PostQuickEdit
          key={openId}
          id={openId}
          initial={items.find((p) => p.id === openId)}
          writesAvailable={writesAvailable}
          onClose={close}
          onChanged={reload}
          onDone={done}
        />
      )}
      {creating && <NewPost onClose={closeNew} writesAvailable={writesAvailable} />}
    </StorePage>
  );
}
