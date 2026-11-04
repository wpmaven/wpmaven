import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, SearchInput, Tabs } from '@yotako/webmaven-ui';
import { errorSentence, storeApi } from '../../../services/storeApi';
import type { Lead, LeadRow, LeadStatus, LeadsPage } from '../../../types/store';
import EmptyState from '../ui/EmptyState';
import Pagination from '../ui/Pagination';
import { storeAppData, useStoreContext } from '../store/shared/storeContext';
import { ErrorLine, Loading, StorePage, shortDate } from '../store/shared/ui';
import { useDebounced } from '../store/shared/useDebounced';
import { idFrom, useSubPath } from '../store/shared/useSubPath';
import MessageDetail from './MessageDetail';
import { ExportMessages, MessagesSettings } from './MessagesTools';

type View = 'all' | LeadStatus;

const PER_PAGE = 25;
const NO_COUNTS: Record<LeadStatus, number> = { new: 0, answered: 0, archived: 0, spam: 0 };

/** New messages first, then the newest. */
export function inboxOrder(rows: LeadRow[]): LeadRow[] {
  return [...rows].sort((a, b) => {
    if ((a.status === 'new') !== (b.status === 'new')) return a.status === 'new' ? -1 : 1;
    return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
  });
}

/** Where the list and the message sit side by side: wider than 900px (styles/store-content.css), so a computer. */
export const SIDE_BY_SIDE_QUERY = '(min-width: 901px)';

/** True while the window matches `query`; false where there is no window. */
function useMediaMatch(query: string): boolean {
  const [hit, setHit] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined;
    if (!mq) return undefined;
    const on = () => setHit(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);
  return hit;
}

/**
 * The message that opens by itself: on a computer, where the list and the
 * message sit side by side, the first of the list as shown (new first) when
 * none is open. Never on a phone, where the list comes first, and never over
 * a message the address or the owner chose.
 */
export function firstToOpen(rows: Array<Pick<LeadRow, 'id'>>, openId: number | null, sideBySide: boolean): number | null {
  if (!sideBySide || openId !== null || !rows.length) return null;
  return rows[0].id;
}

/** The rows the inbox shows for a filter, in their order: it leaves spam out, the Spam filter shows it. */
function shownRows(items: LeadRow[], view: View): LeadRow[] {
  return inboxOrder(items.filter((r) => view === 'spam' || view === r.status || (view === 'all' && r.status !== 'spam')));
}

function pageOf(p: Partial<LeadsPage> | null | undefined): LeadsPage {
  return {
    items: Array.isArray(p?.items) ? p!.items : [],
    total: typeof p?.total === 'number' ? p.total : 0,
    totalPages: typeof p?.totalPages === 'number' ? p.totalPages : 0,
    counts: { ...NO_COUNTS, ...(p?.counts ?? {}) },
    forms: Array.isArray(p?.forms) ? p!.forms : [],
  };
}

/**
 * Messages: what people sent through the site's forms, kept on the site.
 * New first with a dot until read, filters by status and form, search; a
 * message opens beside the list (#/messages/:id); Export and Settings.
 *
 * On a computer the first message of the list opens by itself when none is
 * open, and again after a filter or a search changed; it replaces the
 * address, so Back does not stop on the list first. On a phone the list
 * comes first and nothing opens by itself.
 */
export default function MessagesScreen() {
  const { caps, context } = useStoreContext();
  const mail = context?.mail ?? storeAppData().mail;
  const { parts, go } = useSubPath('messages');
  const openId = idFrom(parts[0]);
  const [view, setView] = useState<View>('all');
  const [form, setForm] = useState('');
  const [search, setSearch] = useState('');
  const query = useDebounced(search);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LeadsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tool, setTool] = useState<'export' | 'settings' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const sideBySide = useMediaMatch(SIDE_BY_SIDE_QUERY);
  // The list on screen is the one for these filters, not the one before a change.
  const listKey = `${view}|${form}|${query}|${page}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  // A filter or the search changed: the first message of the new list opens (on a computer).
  const filters = `${view}|${form}|${query}`;
  const lastFilters = useRef(filters);
  const reopen = useRef(false);
  // The message that opened by itself: it leaves the focus where it is.
  const autoOpened = useRef<number | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const back = useCallback(() => go([]), [go]);
  const closeTool = useCallback(() => setTool(null), []);

  useEffect(() => {
    setPage(1);
    if (lastFilters.current !== filters) reopen.current = true;
    lastFilters.current = filters;
  }, [filters]);

  useEffect(() => {
    if (!caps.messages) return undefined;
    let live = true;
    const key = `${view}|${form}|${query}|${page}`;
    setError(null);
    storeApi.leads({ status: view === 'all' ? '' : view, form, search: query, page, per_page: PER_PAGE }).then(
      (p) => {
        if (!live) return;
        setData(pageOf(p));
        setLoadedKey(key);
      },
      (e) => live && setError(errorSentence(e, 'Your messages could not be read. Try again.')),
    );
    return () => {
      live = false;
    };
  }, [caps.messages, view, form, query, page, reloadKey]);

  const shown = useRef<LeadsPage | null>(null);
  shown.current = data;
  /** A message read or changed in the detail: its row follows (a status change moves the counts: read again). */
  const changed = useCallback((lead: Lead) => {
    const row = shown.current?.items.find((r) => r.id === lead.id);
    if (row?.status !== lead.status) {
      setReloadKey((k) => k + 1);
      return;
    }
    setData((d) => (d ? { ...d, items: d.items.map((r) => (r.id === lead.id ? { ...r, seen: true } : r)) } : d));
  }, []);

  // On a computer, the first message opens when none is open, and after a filter
  // or the search changed, in the address like a click but replacing it.
  useEffect(() => {
    if (!caps.messages || !data || loadedKey !== listKey) return;
    const first = firstToOpen(shownRows(data.items, view), reopen.current ? null : openId, sideBySide);
    reopen.current = false;
    if (first === null || first === openId) return;
    autoOpened.current = first;
    go([first], { replace: true });
  }, [caps.messages, data, loadedKey, listKey, view, openId, sideBySide, go]);

  const deleted = useCallback((id: number) => {
    setData((d) => (d ? { ...d, items: d.items.filter((r) => r.id !== id) } : d));
    setNote('The message was deleted.');
    go([]);
    setReloadKey((k) => k + 1);
  }, [go]);

  if (!caps.messages) {
    return (
      <StorePage title="Messages" testId="messages-root">
        <p className="wm-store-note" role="note">Your WordPress account cannot read this site's messages. Ask an administrator of the site if you need to.</p>
      </StorePage>
    );
  }

  const counts = data?.counts ?? NO_COUNTS;
  const rows = shownRows(data?.items ?? [], view);
  const nothingAtAll = !!data && view === 'all' && Object.values(counts).every((n) => !n) && !data.items.length && !query && !form;
  const views: Array<{ value: View; label: string; count?: number | null }> = [
    { value: 'all', label: 'All' },
    { value: 'new', label: 'New', count: counts.new || null },
    { value: 'answered', label: 'Answered' },
    { value: 'archived', label: 'Archived' },
    { value: 'spam', label: 'Spam' },
  ];

  return (
    <StorePage
      title="Messages"
      testId="messages-root"
      actions={(
        <>
          <Button variant="secondary" size="sm" onClick={() => setTool('export')}>Export</Button>
          {caps.messagesSettings && <Button variant="ghost" size="sm" onClick={() => setTool('settings')}>Settings</Button>}
        </>
      )}
    >
      {nothingAtAll ? (
        <EmptyState title="No messages yet." description="When someone fills in a form on your site, it shows up here." />
      ) : (
        <>
          <div className="wm-store-toolbar">
            <SearchInput aria-label="Search messages" placeholder="Search messages" value={search} onChange={(e) => setSearch(e.target.value)} />
            {(data?.forms.length ?? 0) > 1 && (
              <>
                <label className="wm-store-muted" htmlFor="messages-form">Form</label>
                <select id="messages-form" className="wm-select" value={form} onChange={(e) => setForm(e.target.value)}>
                  <option value="">All forms</option>
                  {data!.forms.map((f) => (
                    <option key={`${f.source}:${f.formId}`} value={`${f.source}:${f.formId}`}>{f.title || 'Untitled form'}</option>
                  ))}
                </select>
              </>
            )}
          </div>
          {/* A block around the bar: on a phone it scrolls sideways inside the page's width. */}
          <div data-testid="messages-views" style={{ maxWidth: '100%', overflowX: 'auto', marginBottom: 12 }}>
            <Tabs
              items={views.map((v) => ({ key: v.value, label: v.count ? `${v.label} (${v.count})` : v.label }))}
              activeKey={view}
              onChange={(key) => setView(key as View)}
            />
          </div>
          {note && <p className="wm-store-outcome wm-store-outcome--ok" role="status">{note}</p>}
          <ErrorLine message={error} onRetry={reload} />
          <div className={`wm-msg ${openId ? 'wm-msg--open' : ''}`}>
            <div className="wm-msg__list">
              {!data && !error && <Loading label="Reading your messages" />}
              {data && !rows.length && <p className="wm-store-muted wm-msg__none">{query || form ? 'No message matches.' : 'No messages here.'}</p>}
              {rows.length > 0 && (
                <ul className="wm-store-list" data-testid="messages-list">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className={`wm-msg__row ${openId === r.id ? 'wm-msg__row--on' : ''}`}
                        aria-current={openId === r.id ? 'true' : undefined}
                        onClick={() => go([r.id])}
                        data-testid={`message-row-${r.id}`}
                      >
                        <span className={`wm-msg__dot ${r.seen ? '' : 'wm-msg__dot--on'}`} data-testid={r.seen ? undefined : 'unread-dot'}>
                          {!r.seen && <span className="wm-content-sr">Unread</span>}
                        </span>
                        <span className="wm-msg__who">{r.name || r.email || 'Someone'}</span>
                        <span className="wm-msg__when">{shortDate(r.createdAt)}</span>
                        <span className="wm-msg__form">{r.formTitle}</span>
                        <span className="wm-msg__line">{r.firstLine}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {data && <Pagination currentPage={page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />}
            </div>
            <div className="wm-msg__detail">
              {openId ? (
                <MessageDetail key={openId} id={openId} mail={mail} focusOnOpen={openId !== autoOpened.current} onBack={back} onChanged={changed} onDeleted={deleted} />
              ) : (
                <p className="wm-store-muted wm-msg__pick">Choose a message to read it.</p>
              )}
            </div>
          </div>
        </>
      )}
      {tool === 'export' && <ExportMessages onClose={closeTool} />}
      {tool === 'settings' && <MessagesSettings onClose={closeTool} />}
    </StorePage>
  );
}
