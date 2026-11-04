import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import type { EditChange, EditOperation, EditPreviewCard, EditResult } from '../../types/edits';
import { editsApi, EditsRequestError } from '../../services/edits';
import { Drawer } from '../Dashboard/store/shared/ui';
import '../../styles/store.css';

/**
 * Every line of a bulk change an approval asks about (pictures' descriptions,
 * pages' search details), read in full, each one changed or dropped before
 * the yes. "Preview these" makes a new preview of the values kept, in place
 * of the one on the card; the card's approval then publishes the new one.
 */

/** The bulk changes whose lines the owner can review on the card. */
export const REVIEW_KINDS: ReadonlySet<string> = new Set(['update_search_details', 'describe_images']);

export const REVIEW_COPY = {
  open: 'Review all',
  title: 'Review every change',
  loading: 'Reading every change.',
  before: 'Now',
  remove: 'Remove',
  removed: 'Removed: this one stays as it is.',
  undoRemove: 'Keep it',
  readOnly: 'Some of these changes can only be approved or declined as they are.',
  save: 'Preview these',
  saving: 'Preparing the new preview.',
  close: 'Close',
  failed: 'The new preview could not be made right now. The change on the card is unchanged.',
  keepOne: 'Keep at least one change, or decline it on the card.',
} as const;

const ALT = /^media:(\d+)#alt$/;
const SEARCH = /^post:(\d+)#seo\.(title|description|ogTitle|ogDescription)$/;
const SEARCH_WORDS: Record<string, string> = { title: 'Search title', description: 'Search description', ogTitle: 'Sharing title', ogDescription: 'Sharing description' };

interface Line {
  ref: string;
  label: string;
  before: string;
  value: string;
  original: string;
  editable: boolean;
  removed: boolean;
}

const asValue = (words: string | undefined): string => (!words || words === 'empty' ? '' : words);

function linesOf(changes: EditChange[]): Line[] {
  return changes.map((c) => {
    const search = SEARCH.exec(c.ref);
    const label = search ? `${SEARCH_WORDS[search[2]]} of ${c.label}` : c.label;
    const value = asValue(c.after);
    return { ref: c.ref, label, before: c.before ?? '', value, original: value, editable: ALT.test(c.ref) || !!search, removed: false };
  });
}

/** The operation the kept lines make, or null when a line cannot be written back. */
export function reviewedOperation(kind: string, lines: Array<Pick<Line, 'ref' | 'value' | 'removed'>>): EditOperation | null {
  const kept = lines.filter((l) => !l.removed);
  if (!kept.length) return null;
  if (kind === 'describe_images') {
    const items = kept.map((l) => ({ mediaId: Number(ALT.exec(l.ref)?.[1]), alt: l.value.trim() }));
    return items.every((i) => i.mediaId > 0) ? ({ op: 'describe_images', items } as unknown as EditOperation) : null;
  }
  if (kind === 'update_search_details') {
    const byPost = new Map<number, Record<string, string>>();
    for (const l of kept) {
      const m = SEARCH.exec(l.ref);
      if (!m) return null;
      const seo = byPost.get(Number(m[1])) ?? {};
      seo[m[2]] = l.value.trim();
      byPost.set(Number(m[1]), seo);
    }
    return { op: 'update_search_details', items: [...byPost].map(([postId, seo]) => ({ postId, seo })) } as unknown as EditOperation;
  }
  return null;
}

export function ReviewChanges({ card, onClose, onReviewed }: {
  card: EditPreviewCard;
  onClose: () => void;
  /** The new preview of the values kept, in place of the card's. */
  onReviewed: (result: EditResult) => void;
}) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // The card holds a few lines; the change itself holds every one.
    editsApi.get(card.operationId)
      .then((r) => { if (live) setLines(linesOf(r.changed.length ? r.changed : card.changed)); })
      .catch(() => { if (live) setLines(linesOf(card.changed)); });
    return () => { live = false; };
  }, [card.operationId, card.changed]);

  const editable = !!lines && lines.every((l) => l.editable);
  const changed = !!lines && lines.some((l) => l.removed || l.value.trim() !== l.original.trim());
  const operation = useMemo(() => (lines && editable && card.kind ? reviewedOperation(card.kind, lines) : null), [lines, editable, card.kind]);
  const set = (i: number, patch: Partial<Line>) => setLines((cur) => (cur ? cur.map((l, n) => (n === i ? { ...l, ...patch } : l)) : cur));

  const save = async () => {
    if (!operation) {
      setError(REVIEW_COPY.keepOne);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await editsApi.request({ operation, mode: 'preview', revisionOf: card.previewId, wait: true, source: 'chat' });
      if (r.ok && r.status === 'previewed' && r.previewId) {
        onReviewed(r);
        return;
      }
      setError(r.failures[0]?.message || REVIEW_COPY.failed);
    } catch (e) {
      setError(e instanceof EditsRequestError && e.message ? e.message : REVIEW_COPY.failed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      title={REVIEW_COPY.title}
      onClose={onClose}
      testId="approval-review-drawer"
      footer={(
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>{REVIEW_COPY.close}</Button>
          {editable && (
            <Button variant="primary" onClick={() => { void save(); }} disabled={saving || !changed} data-testid="approval-review-save">
              {saving ? REVIEW_COPY.saving : REVIEW_COPY.save}
            </Button>
          )}
        </div>
      )}
    >
      {!lines && <p role="status">{REVIEW_COPY.loading}</p>}
      {lines && !editable && <p data-testid="approval-review-readonly" style={{ marginTop: 0 }}>{REVIEW_COPY.readOnly}</p>}
      {lines && (
        <ol data-testid="approval-review-lines" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {lines.map((l, i) => (
            <li key={`${l.ref}-${i}`} data-ref={l.ref} data-removed={l.removed ? 'true' : 'false'} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong style={{ fontSize: 13 }}>{l.label}</strong>
              {l.before && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{REVIEW_COPY.before}: {l.before}</span>}
              {l.removed ? (
                <span style={{ fontSize: 12 }}>
                  {REVIEW_COPY.removed}{' '}
                  <button type="button" onClick={() => set(i, { removed: false })} style={{ border: 0, background: 'none', padding: 0, color: 'var(--purple)', cursor: 'pointer' }}>{REVIEW_COPY.undoRemove}</button>
                </span>
              ) : (
                <>
                  <textarea
                    aria-label={l.label}
                    value={l.value}
                    readOnly={!editable}
                    rows={2}
                    onChange={(e) => set(i, { value: e.target.value })}
                    style={{ width: '100%', fontSize: 13, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--glass-border)', background: 'var(--bg)', color: 'var(--text)' }}
                  />
                  {editable && (
                    <button type="button" data-testid="approval-review-remove" onClick={() => set(i, { removed: true })} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, fontSize: 12, color: 'var(--text-dim)', cursor: 'pointer' }}>
                      {REVIEW_COPY.remove}
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {error && <p role="alert" style={{ color: 'var(--rose)', fontSize: 12 }}>{error}</p>}
    </Drawer>
  );
}
