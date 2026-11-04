import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TeamFace } from '../../components/team/TeamFace';
import { operatorRefOf } from '../../utils/team';
import { Button } from '@yotako/webmaven-ui';
import type { EditResult } from '../../types/edits';
import { editsApi, EditsRequestError, isWorking, sourceWords, STATUS_WORDS } from '../../services/edits';
import { siteBrand, type SiteBrand } from '../../utils/brand';
import { useUndoEdit } from '../../hooks/useUndoEdit';
import { UndoBox } from '../../components/edits/UndoBox';
import type { EditorEnv } from './env';
import { PanelFrame, Working } from './ui';

/** "3 minutes ago", "yesterday", or the date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'Just now';
  if (s < 3600) { const m = Math.round(s / 60); return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`; }
  if (s < 86400) { const h = Math.round(s / 3600); return `${h} ${h === 1 ? 'hour' : 'hours'} ago`; }
  if (s < 172800) return 'Yesterday';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** A history row's line: the baseline reads as the site going live, with the site's brand (utils/brand.ts) or naming nobody. */
export function rowSummary(r: EditResult, b: SiteBrand = siteBrand()): string {
  if (r.kind === 'baseline') return b.mode === 'neutral' ? 'Your site went live' : `Your site went live with ${b.name}`;
  return r.summary || 'A change to your site';
}

function statusClass(r: EditResult): string {
  if (r.status === 'published') return 'is-live';
  if (r.status === 'previewed' || isWorking(r.status)) return 'is-preview';
  if (r.status === 'failed') return 'is-bad';
  return '';
}

/**
 * Every change to the site from every surface (the editor, the chats, the
 * Store, the dashboard), newest first, with its preview while it is one and
 * its undo once it is live. Undo says what else it takes back and asks.
 */
export function EditHistoryPanel({
  env, undoTarget, onOpenPreview,
}: {
  env: EditorEnv;
  /** Start on this change's undo (a panel's Undo button). */
  undoTarget?: { operationId: string; summary: string } | null;
  onOpenPreview: (r: EditResult) => void;
}) {
  const [items, setItems] = useState<EditResult[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string; canForce?: boolean } | null>(null);
  const undo = useUndoEdit();
  const started = useRef<string | null>(null);

  const load = useCallback(async (more = false) => {
    setLoading(true);
    try {
      const page = await editsApi.history({ limit: 30, ...(more && cursor ? { cursor } : {}) });
      setItems((cur) => (more ? [...cur, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err instanceof EditsRequestError ? err.message : 'History could not be read right now.');
    } finally {
      setLoading(false);
    }
  }, [cursor]);

  useEffect(() => { void load(false); /* first page */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (undoTarget && started.current !== undoTarget.operationId) {
      started.current = undoTarget.operationId;
      void undo.start(undoTarget);
    }
  }, [undoTarget, undo]);

  // An undo that went through: the frame shows the site as it is now.
  useEffect(() => {
    if (undo.state.phase === 'done') {
      env.showLive();
      env.refreshSiteMap();
      void load(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo.state.phase]);

  // Any preview publishes by its id: one made here, in a chat, on the dashboard or in an earlier session.
  const publishRow = async (r: EditResult, force = false) => {
    setBusyRow(r.operationId);
    setRowError(null);
    try {
      const out = await editsApi.publish(r.operationId, { wait: true, ...(force ? { force: true } : {}) });
      if (out.status !== 'published') setRowError({ id: r.operationId, message: out.failures[0]?.message ?? 'This change did not go through.', canForce: out.status === 'previewed' && ['DRIFT', 'CHECK_BROKEN', 'CHANGED_ELSEWHERE'].includes(out.failures[0]?.code ?? '') });
      else { env.showLive(); env.refreshSiteMap(); }
      await load(false);
    } catch (err) {
      setRowError({ id: r.operationId, message: err instanceof EditsRequestError ? err.message : 'This change did not go through.' });
    } finally {
      setBusyRow(null);
    }
  };

  const discardRow = async (r: EditResult) => {
    setBusyRow(r.operationId);
    try { await editsApi.discard(r.operationId); } catch { /* it expires by itself */ }
    setBusyRow(null);
    void load(false);
  };

  return (
    <PanelFrame chip="History" color="var(--purple)" title="Changes to your site" sub="From the editor, your chats, the Store and your dashboard" onClose={env.closePanel}>
      <UndoBox state={undo.state} onConfirm={(o) => { void undo.confirm(o); }} onCancel={() => { void undo.cancel(); }} onShowPreview={() => { if (undo.state.preview) onOpenPreview(undo.state.preview); }} />
      {error && <p className="wme-gs-note is-warn" role="alert">{error}</p>}
      {loading && items.length === 0 && <Working text="Reading your history." />}
      {!loading && !error && items.length === 0 && <p className="wme-gs-hint">No changes yet. What you publish shows here, with an undo.</p>}
      <ul className="wme-gs-list" data-testid="edit-history">
        {items.map((r) => (
          <li key={r.operationId} className="wme-gs-row" style={{ alignItems: 'flex-start', flexDirection: 'column' }} data-testid="edit-history-item" data-status={r.status} data-operation-id={r.operationId}>
            <div style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'flex-start' }}>
              {/* An AI change shows who on the team made it; a person's change, no face. */}
              {operatorRefOf(r.operator) && <TeamFace id={operatorRefOf(r.operator)!.id} title={operatorRefOf(r.operator)!.title} size="row" />}
              <div className="wme-gs-row-main">
                <p>{rowSummary(r)}</p>
                {operatorRefOf(r.operator) && <small data-testid="edit-history-by">{`Your ${operatorRefOf(r.operator)!.title} · `}</small>}
                <small>{sourceWords(r.source)}{(r.publishedAt || r.createdAt) ? ` · ${timeAgo(r.publishedAt || r.createdAt)}` : ''}</small>
              </div>
              <span className={`wme-gs-status ${statusClass(r)}`}>{r.kind === 'baseline' ? 'Live' : STATUS_WORDS[r.status]}</span>
            </div>
            <div className="wme-gs-actions" style={{ width: '100%' }}>
              {r.status === 'published' && r.undoable && r.kind !== 'baseline' && (
                <Button data-testid="edit-history-undo" variant="outline" size="sm" disabled={undo.state.phase !== 'idle' && undo.state.phase !== 'done' && undo.state.phase !== 'failed'} onClick={() => { void undo.start({ operationId: r.operationId, summary: rowSummary(r) }); }}>
                  Undo
                </Button>
              )}
              {r.status === 'previewed' && r.preview && (
                <button type="button" className="wme-gs-link" onClick={() => onOpenPreview(r)}>Show the preview</button>
              )}
              {r.status === 'previewed' && (
                <Button data-testid="edit-history-publish" variant="primary" size="sm" isLoading={busyRow === r.operationId} disabled={!!busyRow} onClick={() => { void publishRow(r, rowError?.id === r.operationId && !!rowError.canForce); }}>
                  {rowError?.id === r.operationId && rowError.canForce ? 'Publish anyway' : 'Publish'}
                </Button>
              )}
              {r.status === 'previewed' && (
                <Button variant="ghost" size="sm" disabled={!!busyRow} onClick={() => { void discardRow(r); }}>Discard</Button>
              )}
            </div>
            {rowError?.id === r.operationId && <p className="wme-gs-hint" style={{ color: 'var(--rose)' }} role="alert">{rowError.message}</p>}
          </li>
        ))}
      </ul>
      {cursor && <Button variant="ghost" size="sm" onClick={() => { void load(true); }} isLoading={loading}>Show older changes</Button>}
    </PanelFrame>
  );
}
