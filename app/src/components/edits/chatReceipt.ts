/**
 * A change the chat left waiting for the owner's yes, where its approval
 * stands now. The step's result is what the run saw when it parked the
 * change ("Waiting for your approval.") and is never rewritten: after the
 * owner approved it and the site changed, the chat kept saying it waited.
 *
 * The receipt finds its approval by the id the parked step carries, read
 * alone (GET operators/approvals?id=, the list's shape); else by the preview
 * the chat's approval card showed for it: the one the approval publishes
 * (params.previewId), the ones it had before the team prepared it again
 * (params.earlierPreviewIds), or result.earlierPreviewId on an older row.
 * While the team makes the change it asks again, three minutes at most; a
 * change still waiting reads again when the page is looked at again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getInstanceId, proxy } from '../../services/proxyClient';
import { CANCELLED_TEXT, DECIDE_TEXT } from '../Dashboard/pages/parity/approvalWords';

/** One approval as the site's list sends it, the fields the receipt reads. */
export interface ReceiptRow {
  id: string;
  status: string;
  params?: unknown;
  /** Why it did not go through, in the API's owner words (FAILED). */
  error?: string | null;
  /** Approved and waiting for the plan's actions (the site's view). */
  held?: boolean;
  dashboardPath?: string;
  result?: unknown;
}

/** What the receipt knows of its approval. */
export type Standing =
  /** Not asked, not found, or not read: the receipt says what the run said. */
  | { kind: 'unknown' }
  /** A row this site may not see (public work, money): it waits in the dashboard. */
  | { kind: 'dashboard' }
  | { kind: 'row'; row: ReceiptRow };

/** How the receipt finds its approval. */
export interface ReceiptRef {
  approvalId?: string;
  previewId?: string;
}

export const RECEIPT_TEXT = {
  waiting: 'Waiting for your approval.',
  approved: 'Approved. Your team is on it.',
  declined: 'Okay, I did not do that.',
  failed: (reason: string | null) => (reason ? `Approved, but it did not go through. ${reason}` : DECIDE_TEXT.FAILED),
  held: DECIDE_TEXT.NEEDS_ACTIONS,
  expired: 'That approval expired before you answered, so nothing changed. Ask again if you still want it.',
  done: DECIDE_TEXT.EXECUTED,
  canceled: CANCELLED_TEXT,
  inDashboard: (where: string) => `It waits for your yes in ${where}.`,
  openBilling: 'Open billing',
  cancel: 'Cancel this change',
} as const;

/** How often, and for how long, an approved change is asked about while the team makes it. */
export const WATCH_EVERY_MS = 3_000;
export const WATCH_FOR_MS = 180_000;

/** Statuses after which nothing moves any more: the receipt stops asking. */
const SETTLED: ReadonlySet<string> = new Set(['EXECUTED', 'REJECTED', 'FAILED', 'EXPIRED']);

/** The most earlier previews read from one row (the API keeps at most 20). */
const MAX_EARLIER_PREVIEWS = 20;

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const ID = /^[A-Za-z0-9_-]{1,100}$/;

/** An id the receipt may put in a request, else undefined. */
export function cleanId(v: unknown): string | undefined {
  return typeof v === 'string' && ID.test(v) ? v : undefined;
}

/** Every preview a change to the site was shown as, the one it publishes first. */
export function previewIdsOf(row: ReceiptRow): string[] {
  const params = isObj(row.params) ? row.params : {};
  const listed = Array.isArray(params.earlierPreviewIds) ? params.earlierPreviewIds.slice(-MAX_EARLIER_PREVIEWS) : [];
  const older = isObj(row.result) && row.result.preparedAgain === true ? [row.result.earlierPreviewId] : [];
  const ids = [params.previewId, ...listed, ...older].map(cleanId).filter((id): id is string => !!id);
  return [...new Set(ids)];
}

/** The approval that publishes this preview, or was prepared again from it; the newest when several. */
export function rowForPreview(rows: readonly ReceiptRow[], previewId: string): ReceiptRow | null {
  return rows.find((row) => previewIdsOf(row).includes(previewId)) ?? null;
}

function rowsOf(answer: unknown): ReceiptRow[] {
  const items = isObj(answer) && Array.isArray(answer.items) ? answer.items : [];
  return items.filter((r: unknown): r is ReceiptRow => isObj(r) && typeof r.id === 'string' && typeof r.status === 'string');
}

/** Where the approval stands now. Throws when the read did not go through. */
export async function readStanding(ref: ReceiptRef): Promise<Standing> {
  const instanceId = getInstanceId();
  const approvalId = cleanId(ref.approvalId);
  if (approvalId) {
    const rows = rowsOf(await proxy.get('operators/approvals', { ...(instanceId ? { instanceId } : {}), id: approvalId, limit: 1 }));
    const row = rows.find((r) => r.id === approvalId);
    // Read by its id and not sent: a row a site never sees.
    return row ? { kind: 'row', row } : { kind: 'dashboard' };
  }
  const previewId = cleanId(ref.previewId);
  if (previewId) {
    const rows = rowsOf(await proxy.get('operators/approvals', { ...(instanceId ? { instanceId } : {}), limit: 50 }));
    const row = rowForPreview(rows, previewId);
    return row ? { kind: 'row', row } : { kind: 'unknown' };
  }
  return { kind: 'unknown' };
}

/** Whether nothing will move any more: the receipt stops asking. */
export function isSettled(standing: Standing): boolean {
  if (standing.kind === 'dashboard') return true;
  return standing.kind === 'row' && SETTLED.has(standing.row.status);
}

/**
 * The receipt's approval as it stands, read once, again every few seconds
 * while the team makes the change (three minutes at most), and again when
 * the page is looked at while it still waits.
 */
export function useReceiptStanding(ref: ReceiptRef): { standing: Standing; setStanding: (s: Standing) => void } {
  const approvalId = cleanId(ref.approvalId);
  const previewId = approvalId ? undefined : cleanId(ref.previewId);
  const askable = !!(approvalId || previewId);
  const [standing, setStanding] = useState<Standing>({ kind: 'unknown' });
  // One more on every read that came back, answered or not: the next ask follows it.
  const [reads, setReads] = useState(0);
  const standingRef = useRef(standing);
  standingRef.current = standing;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const read = useCallback(async () => {
    try {
      const next = await readStanding({ approvalId, previewId });
      if (!alive.current) return;
      // A row found once is not forgotten when a later list no longer holds it.
      if (!(next.kind === 'unknown' && standingRef.current.kind === 'row')) setStanding(next);
    } catch {
      // Not read this time: the receipt keeps what it knew.
    }
    if (alive.current) setReads((n) => n + 1);
  }, [approvalId, previewId]);

  useEffect(() => {
    if (askable) void read();
  }, [askable, read]);

  // While the team makes the change: asked again until it ends, three minutes at most.
  const watchStart = useRef<number | null>(null);
  const status = standing.kind === 'row' ? standing.row.status : null;
  useEffect(() => {
    if (status !== 'APPROVED') {
      watchStart.current = null;
      return undefined;
    }
    if (watchStart.current === null) watchStart.current = Date.now();
    if (Date.now() - watchStart.current >= WATCH_FOR_MS) return undefined;
    const timer = setTimeout(() => { void read(); }, WATCH_EVERY_MS);
    return () => clearTimeout(timer);
  }, [status, reads, read]);

  // Still waiting: read again when the page is looked at again.
  useEffect(() => {
    if (!askable) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'hidden' && !isSettled(standingRef.current)) void read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [askable, read]);

  return { standing, setStanding };
}
