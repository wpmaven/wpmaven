/**
 * Changes your team prepared (moved from the dashboard's
 * StoreApprovalsSection, 2026-10-16): the product and post changes team
 * members prepared (each a preview that waits), for the owner and admins to
 * Publish or Discard. Publishing sends the same operation with its preview,
 * so what goes live is exactly what the member saw. In a site's scope only
 * that site's changes are read.
 *
 * The edit routes answer the EditResult itself (no { success, data }); a
 * failure that made no history row still answers one, with an error status,
 * and it is read, not thrown.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { errorMessage } from '@yotako/wpmaven-onboarding/shared';
import type { ScreensHost } from '../host/types';
import { HostLink } from '../host/HostLink';
import { readPrepared, type PreparedChange } from './reads';
import { TYPE, bareList, body, small } from '../approvals/styles';

/** Publishing waits for the site's answer and a snapshot: longer than an app's usual wait, below the API's own limit. */
export const EDIT_CALL_TIMEOUT_MS = 180_000;

const ROW_STYLE: React.CSSProperties = {
  padding: '12px 16px', borderRadius: 8, boxSizing: 'border-box',
  background: 'var(--bg-raised)', border: '1px solid var(--glass-border)',
};

/** What an edit answers (the API's EditResult, the parts read here). */
export interface PreparedEditResult {
  ok: boolean;
  operationId: string;
  status: string;
  summary: string;
  failures: Array<{ code: string; message: string }>;
}

/** The shape of an EditResult, from an answer of any status; null when it is not one. */
export function readEditResult(data: unknown): PreparedEditResult | null {
  const d = data as Partial<PreparedEditResult> | null;
  if (!d || typeof d !== 'object' || typeof d.ok !== 'boolean' || !Array.isArray(d.failures)) return null;
  return {
    ok: d.ok,
    operationId: typeof d.operationId === 'string' ? d.operationId : '',
    status: typeof d.status === 'string' ? d.status : (d.ok ? 'published' : 'failed'),
    summary: typeof d.summary === 'string' ? d.summary : '',
    failures: d.failures,
  };
}

/** The first failure of a result, in the API's words. */
export function editFailure(result: PreparedEditResult | null | undefined): { code: string; message: string } | null {
  if (!result || result.ok) return null;
  return result.failures[0] ?? { code: 'ENGINE', message: 'This change did not go through. Nothing on your site changed.' };
}

/**
 * The codes the store routes answer with a sentence written for the owner
 * (the dashboard's services/store): said as written, never as "our side had
 * a problem".
 */
const OWNER_CODES = new Set([
  'SITE_UNREACHABLE', 'PLUGIN_UPDATE_REQUIRED', 'NOT_FOUND', 'NO_STORE', 'VALIDATION', 'IN_USE',
  'STATUS_NOT_ALLOWED', 'REFUND_NOT_ALLOWED', 'REFUND_TOO_HIGH', 'RATE_LIMITED', 'MAIL_FAILED', 'WRITE_FAILED',
  'TEAM_ROLE', 'FEATURE_OFF', 'STORE_OFF',
]);

/** The sentence for a failed publish or discard: the API's own for a store code, else the host's rule. */
export function preparedErrorText(e: unknown, fallback: string, errorText: (e: unknown, fallback: string) => string = errorMessage): string {
  const res = (e as { response?: { status?: number; data?: { error?: unknown; code?: unknown } } })?.response;
  const said = typeof res?.data?.error === 'string' ? res.data.error.trim() : '';
  const code = typeof res?.data?.code === 'string' ? res.data.code : '';
  const readable = said.length > 0 && said.length <= 300 && /\s/.test(said) && !/^\s*HTTP\s*\d{3}/i.test(said) && !/[{[<]/.test(said);
  if (readable && OWNER_CODES.has(code)) return said;
  return errorText(e, fallback);
}

/** An edit call: its answer, or the EditResult a refusal carries. */
async function editCall(host: ScreensHost, path: string, payload: Record<string, unknown>): Promise<PreparedEditResult> {
  try {
    const result = readEditResult(await host.transport.post(path, payload, { timeoutMs: EDIT_CALL_TIMEOUT_MS }));
    if (!result) throw new Error('No change in the answer');
    return result;
  } catch (e) {
    const refused = readEditResult((e as { response?: { data?: unknown } })?.response?.data ?? (e as { data?: unknown })?.data);
    if (refused) return refused;
    throw e;
  }
}

/** Where the change can be seen: its product in the Store, or its business page's Blog (the dashboard's pages). */
export function preparedLink(item: Pick<PreparedChange, 'instanceId' | 'operation'>): string | null {
  const op = item.operation as { op?: string; productId?: unknown };
  const q = new URLSearchParams({ business: item.instanceId });
  if (op.op === 'update_product' && typeof op.productId === 'number') return `/store/products/${op.productId}?${q}`;
  if (op.op && /_product$/.test(op.op)) return `/store?${q}`;
  if (op.op && /_post$/.test(op.op)) return `/instances/${encodeURIComponent(item.instanceId)}?tab=blog`;
  return null;
}

/** "Oct 11, 08:00 AM", as the Store says a date. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** One change a team member sent: what it does, who sent it, and Publish or Discard. */
export const PreparedChangeCard: React.FC<{
  item: PreparedChange;
  /** Name the business (the account's view). */
  showBusiness: boolean;
  busy: 'publish' | 'discard' | null;
  error: string | null;
  onPublish: () => void;
  onDiscard: () => void;
}> = ({ item, showBusiness, busy, error, onPublish, onDiscard }) => {
  const link = preparedLink(item);
  return (
    <div style={ROW_STYLE} data-testid={`store-approval-${item.operationId}`}>
      <p style={{ ...body, fontWeight: 550, color: 'var(--text)', overflowWrap: 'anywhere' }}>{item.summary || 'A change to your store'}</p>
      <p style={{ ...small, color: 'var(--text-dim)' }}>
        {[showBusiness ? item.businessName : '', item.requestedBy?.name ? `Sent by ${item.requestedBy.name}` : '', shortDate(item.createdAt)].filter(Boolean).join(' · ')}
      </p>
      {item.changed.length > 0 && (
        <ul style={{ ...bareList, ...small, marginTop: 4, color: 'var(--text)' }}>
          {item.changed.slice(0, 6).map((c, i) => (
            <li key={`${c.ref}-${i}`} style={{ overflowWrap: 'anywhere', marginTop: i === 0 ? 0 : 2 }}>
              {c.label}{c.before !== undefined || c.after !== undefined ? `: ${c.before ?? ''} to ${c.after ?? ''}` : ''}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" style={{ ...small, marginTop: 4, color: 'var(--danger)' }}>{error}</p>}
      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Button type="button" size="sm" variant="primary" isLoading={busy === 'publish'} disabled={!!busy} onClick={onPublish}>Publish</Button>
        <Button type="button" size="sm" variant="ghost" isLoading={busy === 'discard'} disabled={!!busy} onClick={onDiscard}>Discard</Button>
        {link && <HostLink to={link} style={{ ...small, textDecoration: 'underline', color: 'var(--purple)' }}>See it</HostLink>}
      </div>
    </div>
  );
};

/** The changes team members prepared, as Waiting for you reads and decides them. */
export interface PreparedChangesState {
  /** The owner and admins decide them; nothing is asked for anyone else. */
  canPublish: boolean;
  items: PreparedChange[];
  /** The list was read (at once for a seat that cannot publish: nothing to read). */
  loaded: boolean;
  busy: { id: string; what: 'publish' | 'discard' } | null;
  errors: Record<string, string>;
  /** What the last Publish or Discard did, said where the card was. */
  receipt: string | null;
  publish: (item: PreparedChange) => Promise<void>;
  discard: (item: PreparedChange) => Promise<void>;
}

/** Read by the screen, which needs the count before it draws its tabs. */
export function usePreparedChanges(host: ScreensHost): PreparedChangesState {
  const canPublish = host.viewer?.publishesPrepared !== false;
  const [items, setItems] = useState<PreparedChange[]>([]);
  const [loaded, setLoaded] = useState(!canPublish);
  const [busy, setBusy] = useState<{ id: string; what: 'publish' | 'discard' } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<string | null>(null);
  const scopeKey = host.scope.kind === 'site' ? host.scope.instanceId : '';
  const errorText = host.errorText ?? errorMessage;

  const load = useCallback(async () => {
    try {
      setItems(await readPrepared(host.transport, host.scope));
    } catch {
      // Not there (an older API, teams off): nothing waits here.
      setItems([]);
    }
    setLoaded(true);
    // The host object may be new on each render: read again only for another scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  useEffect(() => { if (canPublish) void load(); }, [canPublish, load]);

  const settle = (item: PreparedChange, text: string) => {
    setItems((list) => list.filter((i) => i.operationId !== item.operationId));
    setReceipt(text);
  };

  const publish = async (item: PreparedChange) => {
    setBusy({ id: item.operationId, what: 'publish' });
    setErrors((e) => ({ ...e, [item.operationId]: '' }));
    try {
      const result = await editCall(host, `/instances/${encodeURIComponent(item.instanceId)}/edits`, {
        operation: item.operation,
        mode: 'publish',
        ...(item.previewId ? { previewId: item.previewId } : {}),
        // The dashboard says where it came from; a site's is the API's own (the editor).
        ...(host.scope.kind === 'account' ? { source: 'dashboard' } : {}),
        wait: true,
      });
      const failure = editFailure(result);
      if (failure) setErrors((e) => ({ ...e, [item.operationId]: failure.message }));
      else settle(item, `Published: ${result.summary || item.summary}`);
    } catch (e) {
      setErrors((x) => ({ ...x, [item.operationId]: preparedErrorText(e, 'This change was not published. Try again.', errorText) }));
    } finally {
      setBusy(null);
    }
  };

  const discard = async (item: PreparedChange) => {
    setBusy({ id: item.operationId, what: 'discard' });
    try {
      const result = await editCall(host, `/instances/${encodeURIComponent(item.instanceId)}/edits/${encodeURIComponent(item.operationId)}/discard`, {});
      const failure = editFailure(result);
      if (failure && result.status !== 'discarded') setErrors((e) => ({ ...e, [item.operationId]: failure.message }));
      else settle(item, `Discarded: ${item.summary || 'the change'}. Nothing on your site changed.`);
    } catch (e) {
      setErrors((x) => ({ ...x, [item.operationId]: preparedErrorText(e, 'This change was not discarded. Try again.', errorText) }));
    } finally {
      setBusy(null);
    }
  };

  return { canPublish, items, loaded, busy, errors, receipt, publish, discard };
}

/** The prepared changes, under their tab on Waiting for you (the tab names them). */
export const PreparedChanges: React.FC<{ state: PreparedChangesState; showBusiness: boolean }> = ({ state, showBusiness }) => {
  const { items, busy, errors, receipt } = state;
  const said = receipt
    ? <p role="status" style={{ ...body, color: 'var(--text)' }} data-testid="store-approval-receipt">{receipt}</p>
    : null;
  if (!state.canPublish || items.length === 0) return said;

  return (
    <section data-testid="store-approvals">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: TYPE.body }}>
        {said}
        {items.map((item) => (
          <PreparedChangeCard
            key={item.operationId}
            item={item}
            showBusiness={showBusiness}
            busy={busy?.id === item.operationId ? busy.what : null}
            error={errors[item.operationId] || null}
            onPublish={() => void state.publish(item)}
            onDiscard={() => void state.discard(item)}
          />
        ))}
      </div>
    </section>
  );
};

export default PreparedChanges;
