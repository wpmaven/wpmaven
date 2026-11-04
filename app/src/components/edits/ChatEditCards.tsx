import React, { useEffect, useState } from 'react';
import { Button, GlassCard } from '@yotako/webmaven-ui';
import { TeamFace } from '../team/TeamFace';
import { operatorRefOf, TEAM_COPY } from '../../utils/team';
import type { EditCheck, EditChange, EditPreviewCard, EditResult, EditResultCard, EditStatus } from '../../types/edits';
import { editsApi, EditsRequestError, isWorking, normalizeChecks, orderChecks, settleEdit, STATUS_WORDS } from '../../services/edits';
import { REVIEW_COPY, REVIEW_KINDS, ReviewChanges } from './ReviewChanges';
import { useUndoEdit } from '../../hooks/useUndoEdit';
import { UndoBox } from './UndoBox';
import { cleanId, RECEIPT_TEXT, useReceiptStanding } from './chatReceipt';
import { proxy } from '../../services/proxyClient';
import { dashboardLink, useSiteState } from '../../utils/siteState';
import { dashboardPhrase, siteBrand } from '../../utils/brand';
import { errorSentence } from '../../utils/apiWords';

/**
 * What the chat shows of an edit operation: the result of a change (its
 * summary, what changed, Undo) and the preview an approval asks about (its
 * summary, checks, pictures, Open preview, Approve or Decline). Never the
 * tool's name, never its parameters as code.
 */

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const STATUSES: ReadonlySet<string> = new Set(['queued', 'previewing', 'previewed', 'publishing', 'published', 'failed', 'undone', 'discarded', 'expired']);
const plain = (v: unknown, max = 300): string => (typeof v === 'string' ? v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const web = (v: unknown): string | undefined => (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v) ? v : undefined);

function changesOf(raw: unknown): EditChange[] {
  if (!Array.isArray(raw)) return [];
  // Every line a bulk change lists (the card shows five and counts the rest; Review all reads them all).
  return raw.filter(isObj).slice(0, 100).map((c) => ({
    kind: (typeof c.kind === 'string' ? c.kind : 'page') as EditChange['kind'],
    ref: plain(c.ref, 120),
    label: plain(c.label, 120),
    ...(typeof c.before === 'string' ? { before: plain(c.before, 120) } : {}),
    ...(typeof c.after === 'string' ? { after: plain(c.after, 120) } : {}),
  }));
}

/** An edit's result card from a tool event, or null when it is not one. */
export function parseEditCard(raw: unknown): EditResultCard | null {
  if (!isObj(raw) || typeof raw.operationId !== 'string' || !raw.operationId || !STATUSES.has(raw.status)) return null;
  return {
    operationId: raw.operationId,
    status: raw.status as EditStatus,
    summary: plain(raw.summary),
    changed: changesOf(raw.changed),
    checks: normalizeChecks(raw.checks),
    undoable: raw.undoable === true,
    ...(web(raw.previewUrl) ? { previewUrl: raw.previewUrl } : {}),
    ...(web(raw.liveUrl) ? { liveUrl: raw.liveUrl } : {}),
    ...(operatorRefOf(raw.operator) ? { operator: operatorRefOf(raw.operator) } : {}),
  };
}

/** The preview an approval card shows, or null. */
export function parsePreviewCard(raw: unknown): EditPreviewCard | null {
  const card = parseEditCard(raw);
  if (!card || !isObj(raw)) return null;
  const thumbs = Array.isArray(raw.thumbnails)
    ? raw.thumbnails.filter((t: any) => isObj(t) && /^https:\/\//.test(String(t.after))).slice(0, 4).map((t: any) => ({
      ref: plain(t.ref, 120), width: t.width === 390 ? 390 as const : 1440 as const, after: t.after, ...(typeof t.before === 'string' && /^https:\/\//.test(t.before) ? { before: t.before } : {}),
    }))
    : [];
  return {
    ...card,
    previewId: typeof raw.previewId === 'string' ? raw.previewId : '',
    ...(web(raw.shareUrl) ? { shareUrl: raw.shareUrl } : {}),
    ...(thumbs.length ? { thumbnails: thumbs } : {}),
    ...(typeof raw.kind === 'string' ? { kind: raw.kind } : {}),
    ...(raw.anotherVersion === true ? { anotherVersion: true } : {}),
  };
}

/** A preview the card made itself (another version, the reviewed values), as the card shows it. */
export function previewCardOf(r: EditResult, operator: EditPreviewCard['operator']): EditPreviewCard | null {
  const card = parsePreviewCard({
    ...r,
    previewUrl: r.preview?.url,
    shareUrl: r.preview?.shareUrl,
    thumbnails: r.preview?.thumbnails,
    operator: operator ?? null,
  });
  return card && card.previewId ? { ...card, operator } : null;
}

/** The most versions of one change a card keeps to compare. */
const MAX_VERSIONS = 3;

export const VERSION_COPY = {
  another: 'Try another version',
  making: 'Making another version. This can take up to a minute.',
  chip: (n: number) => `Version ${n}`,
  failed: 'Another version could not be made right now. The versions here are unchanged.',
} as const;

/** What a search field change is called on a card ("search description of Home"). */
const SEARCH_WORDS: Record<string, string> = {
  title: 'search title', description: 'search description', ogTitle: 'sharing title',
  ogDescription: 'sharing description', ogImage: 'sharing picture', noindex: 'visibility in search engines',
};

function lineLabel(c: EditChange): string {
  const seo = /#seo\.(\w+)$/.exec(c.ref);
  if (seo && SEARCH_WORDS[seo[1]]) return `${SEARCH_WORDS[seo[1]].charAt(0).toUpperCase()}${SEARCH_WORDS[seo[1]].slice(1)} of ${c.label}`;
  return c.label;
}

function ChangeLines({ changes }: { changes: EditChange[] }) {
  const all = changes.filter((c) => c.label);
  const shown = all.slice(0, 5);
  if (!shown.length) return null;
  return (
    <ul data-testid="edit-change-lines" style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
      {shown.map((c, i) => (
        <li key={`${c.ref}-${i}`}>
          {lineLabel(c)}
          {c.before !== undefined && c.after !== undefined && c.before !== c.after ? `: ${c.before} → ${c.after}` : ''}
        </li>
      ))}
      {all.length > shown.length && <li data-testid="edit-change-more">and {all.length - shown.length} more</li>}
    </ul>
  );
}

function CheckLines({ checks }: { checks: EditCheck[] }) {
  if (!checks.length) return null;
  return (
    <ul data-testid="approval-checks" style={{ listStyle: 'none', margin: '0 0 8px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {orderChecks(checks).slice(0, 5).map((c, i) => (
        <li key={i} data-severity={c.severity} style={{ fontSize: 12, lineHeight: 1.45, color: c.severity === 'broken' ? 'var(--rose)' : c.severity === 'warn' ? 'var(--peach)' : 'var(--text-dim)' }}>
          {c.width === 390 ? 'On phones: ' : c.width === 1440 ? 'On wide screens: ' : ''}{c.message}
        </li>
      ))}
    </ul>
  );
}

const CARD: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text)' };
const LINK: React.CSSProperties = { color: 'var(--purple)', fontSize: 12, fontWeight: 500, textDecoration: 'none' };

/** A change the chat made (or prepared): its summary, what changed, View and Undo. */
export function EditResultCardView({ card }: { card: EditResultCard }) {
  const undo = useUndoEdit();
  const live = card.status === 'published';
  const view = live ? card.liveUrl : card.previewUrl;
  return (
    <div style={CARD} data-testid="chat-edit-card" data-status={card.status} data-operation-id={card.operationId}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        {card.operator && (
          <TeamFace
            id={card.operator.id}
            title={card.operator.title}
            presence={live ? 'done' : card.status === 'failed' ? 'failed' : card.status === 'previewed' ? 'waiting' : 'working'}
            size="card"
          />
        )}
        <span style={{ flex: 1, fontWeight: 500 }}>{card.summary || 'A change to your site'}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: live ? 'var(--cyan)' : card.status === 'failed' ? 'var(--rose)' : 'var(--text-dim)', flexShrink: 0 }}>{STATUS_WORDS[card.status]}</span>
      </div>
      {card.operator && (live || card.status === 'failed') && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }} data-testid="chat-edit-by">
          {live ? TEAM_COPY.doneBy(card.operator.title) : TEAM_COPY.stoppedBy(card.operator.title)}
        </p>
      )}
      <ChangeLines changes={card.changed} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {view && <a href={view} target="_blank" rel="noopener noreferrer" style={LINK}>{live ? 'View on your site' : 'Open preview'}</a>}
        {live && card.undoable && undo.state.phase === 'idle' && (
          <Button variant="ghost" size="sm" onClick={() => { void undo.start({ operationId: card.operationId, summary: card.summary || 'This change' }); }} data-testid="chat-edit-undo">Undo</Button>
        )}
      </div>
      <UndoBox state={undo.state} onConfirm={(o) => { void undo.confirm(o); }} onCancel={() => { void undo.cancel(); }} />
    </div>
  );
}

/**
 * The preview an approval asks about. Approve publishes the preview on the
 * card: the one the run made, or a version asked here ("Try another
 * version", up to three to compare), or the values kept in "Review all".
 * onApprove gets that preview's id when it is not the first one. Decline
 * drops them all. While the answer is on its way (`answering`), neither
 * button answers again.
 *
 * Without onApprove and onDecline it is the preview alone, inside a card
 * that decides it (Waiting for you, the shared approval card): what it
 * changes, its checks, its picture, Open preview and Share preview, with no
 * header, versions, review or buttons of its own.
 */
export function EditPreviewCardView({ card, onApprove, onDecline, answering = false }: {
  card: EditPreviewCard;
  onApprove?: (pickedPreviewId?: string) => void;
  onDecline?: () => void;
  answering?: boolean;
}) {
  const decides = !!onApprove && !!onDecline;
  const [versions, setVersions] = useState<EditPreviewCard[]>([card]);
  const [shown, setShown] = useState(0);
  const [making, setMaking] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const current = versions[shown] ?? card;
  const [shareUrls, setShareUrls] = useState<Record<string, string>>(card.shareUrl ? { [card.previewId]: card.shareUrl } : {});
  const shareUrl = shareUrls[current.previewId] ?? current.shareUrl;
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const broken = current.checks.some((c) => c.severity === 'broken');
  const thumb = current.thumbnails?.find((t) => t.width === 1440) ?? current.thumbnails?.[0];
  const open = current.previewUrl || shareUrl;
  const canAskAnother = decides && card.anotherVersion === true && versions.length < MAX_VERSIONS;
  const reviewable = decides && !!card.kind && REVIEW_KINDS.has(card.kind);

  const anotherVersion = async () => {
    setMaking(true);
    setVersionError(null);
    try {
      const first = await editsApi.anotherVersion(current.previewId);
      const r = first.operationId && isWorking(first.status) ? await settleEdit(first) : first;
      const next = r.ok && r.status === 'previewed' ? previewCardOf(r, card.operator) : null;
      if (next) {
        setVersions((cur) => [...cur, next]);
        setShown(versions.length);
      } else {
        setVersionError(r.failures[0]?.message || VERSION_COPY.failed);
      }
    } catch (e) {
      setVersionError(e instanceof EditsRequestError && e.message ? e.message : VERSION_COPY.failed);
    } finally {
      setMaking(false);
    }
  };

  const reviewed = (r: EditResult) => {
    const next = previewCardOf(r, card.operator);
    if (next) setVersions((cur) => cur.map((v, i) => (i === shown ? { ...next, kind: v.kind } : v)));
    setReviewing(false);
  };
  return (
    <div style={CARD} data-testid="approval-edit-preview">
      {decides && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {card.operator && (
            <TeamFace id={card.operator.id} title={card.operator.title} presence="waiting" size="card" decorative />
          )}
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <strong style={{ fontSize: 14 }}>Ready for your approval</strong>
            {card.operator && <span style={{ fontSize: 12, color: 'var(--text-dim)' }} data-testid="approval-by">{TEAM_COPY.preparedBy(card.operator.title)}</span>}
          </span>
        </div>
      )}
      {versions.length > 1 && (
        <div role="group" aria-label="Versions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {versions.map((v, i) => (
            <button
              key={v.previewId}
              type="button"
              data-testid="approval-version-chip"
              aria-pressed={i === shown}
              onClick={() => setShown(i)}
              style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: '1px solid var(--glass-border)', background: i === shown ? 'var(--purple)' : 'transparent', color: i === shown ? 'var(--bg)' : 'var(--text)' }}
            >
              {VERSION_COPY.chip(i + 1)}
            </button>
          ))}
        </div>
      )}
      <p style={{ margin: 0, lineHeight: 1.5 }}>{current.summary || 'A change to your site'}</p>
      <ChangeLines changes={current.changed} />
      {reviewable && (
        <button type="button" data-testid="approval-review-all" onClick={() => setReviewing(true)} style={{ ...LINK, alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, cursor: 'pointer' }}>
          {REVIEW_COPY.open}
        </button>
      )}
      <CheckLines checks={current.checks} />
      {broken && <p style={{ margin: 0, fontSize: 12, color: 'var(--rose)' }}>The preview found a problem. Approving publishes it anyway.</p>}
      {thumb && (
        <div style={{ display: 'grid', gridTemplateColumns: thumb.before ? '1fr 1fr' : '1fr', gap: 6 }}>
          {thumb.before && <img src={thumb.before} alt="Before the change" loading="lazy" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--glass-border)' }} />}
          <img src={thumb.after} alt="After the change" loading="lazy" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--glass-border)' }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {open && <a href={open} target="_blank" rel="noopener noreferrer" style={LINK} data-testid="approval-open-preview">Open preview</a>}
        {!shareUrl && current.operationId && (
          <button
            type="button"
            disabled={sharing}
            onClick={async () => {
              setSharing(true);
              setShareError(null);
              try {
                const r = await editsApi.share(current.operationId);
                const url = r.preview?.shareUrl;
                if (url) setShareUrls((cur) => ({ ...cur, [current.previewId]: url }));
              } catch {
                setShareError('The link could not be made right now.');
              } finally {
                setSharing(false);
              }
            }}
            style={{ ...LINK, border: 0, background: 'none', padding: 0, cursor: 'pointer' }}
          >
            {sharing ? 'Making a link...' : 'Share preview'}
          </button>
        )}
        {shareUrl && <input readOnly value={shareUrl} aria-label="Preview link, open for 72 hours" onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--glass-border)', background: 'var(--bg)', color: 'var(--text)' }} />}
      </div>
      {shareError && <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--rose)' }}>{shareError}</p>}
      {making && <p role="status" data-testid="approval-version-working" style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>{VERSION_COPY.making}</p>}
      {versionError && <p role="alert" data-testid="approval-version-error" style={{ margin: 0, fontSize: 12, color: 'var(--rose)' }}>{versionError}</p>}
      {onApprove && onDecline && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          <Button variant="ghost" onClick={onDecline} disabled={making || answering} style={{ fontSize: 12, padding: '6px 14px' }} data-testid="approval-decline">Decline</Button>
          {canAskAnother && (
            <Button variant="ghost" onClick={() => { void anotherVersion(); }} disabled={making} style={{ fontSize: 12, padding: '6px 14px' }} data-testid="approval-another-version">
              {VERSION_COPY.another}
            </Button>
          )}
          <Button
            data-testid="approval-approve"
            variant="primary"
            disabled={making || answering}
            onClick={() => onApprove(current.previewId !== card.previewId ? current.previewId : undefined)}
            style={{ fontSize: 12, padding: '6px 14px' }}
          >
            {broken ? 'Publish anyway' : 'Approve'}
          </Button>
        </div>
      )}
      {reviewing && <ReviewChanges card={current} onClose={() => setReviewing(false)} onReviewed={reviewed} />}
    </div>
  );
}

/** The few parameter names an approval may show, in the owner's words (anything else is left out). */
const PARAM_WORDS: Record<string, string> = {
  title: 'Title', name: 'Name', label: 'Name', price: 'Price', regular_price: 'Price', regularPrice: 'Price',
  sale_price: 'Sale price', salePrice: 'Sale price', status: 'Status', url: 'Link', link: 'Link', email: 'Email',
  phone: 'Phone', subject: 'Subject', to: 'To', recipient: 'To', date: 'Date', time: 'Time', amount: 'Amount',
  quantity: 'Quantity', sku: 'SKU', category: 'Category', categories: 'Categories', tags: 'Tags', plugin_slug: 'Plugin',
  instruction: 'What changes', excerpt: 'Summary', caption: 'Caption', alt: 'Alt text', schedule: 'When', network: 'Where',
};

/** An approval's parameters as at most six plain lines (known names, plain values). */
export function paramLines(params: unknown): Array<{ label: string; value: string }> {
  if (!isObj(params)) return [];
  const out: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(params)) {
    const label = PARAM_WORDS[key];
    if (!label || out.some((o) => o.label === label)) continue;
    let text = '';
    if (typeof value === 'string') text = plain(decodeEntities(value), 140);
    else if (typeof value === 'number' && Number.isFinite(value)) text = String(value);
    else if (typeof value === 'boolean') text = value ? 'Yes' : 'No';
    else if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) text = value.slice(0, 5).map((v) => plain(decodeEntities(String(v)), 40)).join(', ');
    if (text) out.push({ label, value: text });
    if (out.length >= 6) break;
  }
  return out;
}

function decodeEntities(text: string): string {
  if (typeof document === 'undefined') return text;
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
}

const RECEIPT_LINK_BUTTON: React.CSSProperties = { ...LINK, border: 0, background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' };

/** The site's own address, for the View of a change made after the yes. */
function siteHome(siteUrl: string | undefined): string | undefined {
  if (siteUrl && /^https?:\/\/\S+$/i.test(siteUrl)) return siteUrl;
  return typeof window !== 'undefined' && window.location?.origin ? `${window.location.origin}/` : undefined;
}

/**
 * A change the chat left waiting, where its approval stands now: waiting
 * for the yes, approved and being made, the change as it went live (View
 * and Undo), declined, not done and why, held for the plan's actions (Open
 * billing, Cancel this change, never a pack or a price), or waiting in the
 * dashboard for a row this site may not see. Without its approval found, it
 * says what the run said.
 */
function ParkedReceipt({ held, approvalId, previewId, operationId }: {
  held: boolean;
  approvalId?: string;
  previewId?: string;
  operationId?: string;
}) {
  const site = useSiteState();
  const { standing } = useReceiptStanding({ approvalId, previewId });
  const [made, setMade] = useState<EditResultCard | null>(null);
  const [cancel, setCancel] = useState<{ busy: boolean; said: string | null; error: string | null }>({ busy: false, said: null, error: null });
  const row = standing.kind === 'row' ? standing.row : null;
  const status = row?.status ?? null;
  const siteUrl = site.instance?.siteUrl;

  // Made: the change as it went live, when the chat knows its operation.
  useEffect(() => {
    if (status !== 'EXECUTED' || !operationId) return undefined;
    let on = true;
    editsApi.get(operationId).then((r) => {
      if (!on || r.status !== 'published') return;
      const liveUrl = siteHome(siteUrl);
      setMade({
        operationId: r.operationId || operationId,
        status: 'published',
        summary: r.summary,
        changed: r.changed,
        checks: [],
        undoable: r.undoable,
        ...(liveUrl ? { liveUrl } : {}),
        operator: r.operator ?? null,
      });
    }).catch(() => undefined);
    return () => { on = false; };
  }, [status, operationId, siteUrl]);

  const line = (kind: string, words: string, color: string) => (
    <p data-testid="chat-step-waiting" data-standing={kind} style={{ margin: '6px 0 0', fontSize: 12, color }}>{words}</p>
  );

  const cancelHeld = async (id: string) => {
    setCancel({ busy: true, said: null, error: null });
    try {
      const answer = await proxy.post<{ message?: string }>(`operators/approvals/${encodeURIComponent(id)}/cancel-held`);
      const said = typeof answer?.message === 'string' ? answer.message.trim() : '';
      setCancel({ busy: false, said: said || RECEIPT_TEXT.canceled, error: null });
    } catch (err) {
      setCancel({ busy: false, said: null, error: errorSentence(err, 'That did not go through. Try again in a minute.') });
    }
  };

  if (cancel.said) return line('canceled', cancel.said, 'var(--text-dim)');
  if (standing.kind === 'dashboard') {
    const where = dashboardPhrase(siteBrand());
    return (
      <p data-testid="chat-step-waiting" data-standing="dashboard" style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--peach)' }}>
        {RECEIPT_TEXT.inDashboard(where)}{' '}
        <a href={dashboardLink(site, '/waiting')} target="_blank" rel="noopener noreferrer" style={LINK}>{`Open ${where}`}</a>
      </p>
    );
  }
  switch (status) {
    case 'APPROVED':
      return line('approved', RECEIPT_TEXT.approved, 'var(--text-dim)');
    case 'EXECUTED':
      return made
        ? <div data-testid="chat-step-waiting" data-standing="done" style={{ marginTop: 6 }}><GlassCard padding="12px"><EditResultCardView card={made} /></GlassCard></div>
        : line('done', RECEIPT_TEXT.done, 'var(--cyan)');
    case 'REJECTED':
      return line('declined', RECEIPT_TEXT.declined, 'var(--text-dim)');
    case 'FAILED':
      return line('failed', RECEIPT_TEXT.failed(typeof row?.error === 'string' && row.error.trim() ? row.error.trim() : null), 'var(--rose)');
    case 'EXPIRED':
      return line('expired', RECEIPT_TEXT.expired, 'var(--text-dim)');
    case 'NEEDS_ACTIONS':
      return (
        <div data-testid="chat-step-waiting" data-standing="held" style={{ marginTop: 6 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--peach)' }}>{RECEIPT_TEXT.held}</p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <a href={dashboardLink(site, row?.dashboardPath || '/billing')} target="_blank" rel="noopener noreferrer" style={LINK}>{RECEIPT_TEXT.openBilling}</a>
            <button type="button" data-testid="chat-receipt-cancel" disabled={cancel.busy} onClick={() => { if (row) void cancelHeld(row.id); }} style={RECEIPT_LINK_BUTTON}>
              {cancel.busy ? 'Canceling' : RECEIPT_TEXT.cancel}
            </button>
          </div>
          {cancel.error && <p role="alert" style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--rose)' }}>{cancel.error}</p>}
        </div>
      );
    default:
      // Still waiting for the yes, or not found: as the run said. A yes kept
      // for the plan's actions says so even before its approval is read.
      return held && !row ? line('held', RECEIPT_TEXT.held, 'var(--peach)') : line('waiting', RECEIPT_TEXT.waiting, 'var(--peach)');
  }
}

/** The most a said line shows (the API sends at most 600 characters). */
const SAID_MAX = 2000;

/**
 * What the API lets an owner see of a step's result (its owner-safe
 * projection): pictures, one item with its link, a few short lines, what
 * another member answered the chat's lead, or that it waits for the owner.
 * Anything else shows nothing. A step that waits follows its approval
 * (ParkedReceipt); `approvalEdit` is the preview the chat's approval card
 * showed for it, when the owner answered one.
 */
export function OwnerDisplayView({ result, approvalEdit }: { result: unknown; approvalEdit?: unknown }) {
  if (!isObj(result)) return null;
  if (Array.isArray(result.images)) {
    const images = result.images.filter((i: any) => isObj(i) && /^https:\/\//.test(String(i.url))).slice(0, 6);
    if (!images.length) return null;
    return (
      <div data-testid="chat-step-images" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {images.map((i: any, n: number) => (
          <img key={n} src={i.url} alt={plain(i.alt, 120)} loading="lazy" style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--glass-border)' }} />
        ))}
      </div>
    );
  }
  if (isObj(result.item)) {
    const title = plain(result.item.title, 120);
    if (!title) return null;
    const url = web(result.item.url);
    return (
      <p data-testid="chat-step-item" style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-dim)' }}>
        {url ? <a href={url} target="_blank" rel="noopener noreferrer" style={LINK}>{title}</a> : <span style={{ color: 'var(--text)' }}>{title}</span>}
      </p>
    );
  }
  if (Array.isArray(result.list)) {
    const lines = result.list.filter((l: unknown) => typeof l === 'string').slice(0, 5).map((l: string) => plain(l, 160)).filter(Boolean);
    if (!lines.length) return null;
    return (
      <ul data-testid="chat-step-list" style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {lines.map((l: string, n: number) => <li key={n}>{l}</li>)}
      </ul>
    );
  }
  // What another member answered the chat's lead inside the turn (the
  // Co-CEO answering the Web Designer in the editor, 1.8.0): their face,
  // "Your Co-CEO", then the words as written, never read as Markdown.
  if (isObj(result.said)) {
    const who = operatorRefOf(result.said.operator);
    const text = typeof result.said.text === 'string' ? result.said.text.trim().slice(0, SAID_MAX) : '';
    if (!who || !text) return null;
    return (
      <div data-testid="chat-step-said" style={{ margin: '6px 0', padding: '8px 10px', borderRadius: 8, background: 'var(--glass-hover)' }}>
        <p style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 4px', fontSize: 12, fontWeight: 600, lineHeight: 1.4, color: 'var(--text)' }}>
          <TeamFace id={who.id} title={who.title} size="row" decorative />
          {`Your ${who.title}`}
        </p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</p>
      </div>
    );
  }
  if (result.parked === true || result.held === true) {
    const asked = isObj(approvalEdit) ? approvalEdit : {};
    return (
      <ParkedReceipt
        held={result.held === true}
        approvalId={cleanId(result.approvalId)}
        previewId={cleanId(asked.previewId)}
        operationId={cleanId(asked.operationId)}
      />
    );
  }
  return null;
}
