import React, { useState } from 'react';
import { Button, OperatorAvatar, OPERATOR_AVATAR_SIZES, type OperatorPresence } from '@yotako/webmaven-ui';
import { DECISION_OUTCOME_UNKNOWN, OperatorInline, noAnswer, toPlainLine } from '@yotako/wpmaven-onboarding/shared';
import { useOptionalScreensHost } from '../host/HostContext';
import { HostLink } from '../host/HostLink';
import type { ScreensHost } from '../host/types';
import type { DecideResult, OperatorApproval } from '../approvals/types';
import {
  CARD_ONLY_COPY, approvalGoesToTikTok, approvalGoesToYouTube, approvalNeedsCard, approvalPath, approvalSentence,
} from '../approvals/targets';
import { ApprovalPreview } from '../approvals/ApprovalPreview';
import { YOUTUBE_VISIBILITY_COPY, sendDecision } from '../approvals/youtubeVisibility';
import { canRequestChanges, readableText, siteChangeWords } from '../approvals/previewData';
import { drawableSitePreview } from '../approvals/sitePreview';
import { SiteChangeSummary } from '../approvals/SiteChangeSummary';
import { TeamNoteLine } from '../approvals/TeamNoteLine';
import { splitTeamNote } from '../approvals/teamNote';
import { TIKTOK_COPY } from '../approvals/tiktokPost';
import { NextStepButton, PageButton, ReceiptNote, openPage } from '../approvals/ReceiptNote';
import { decisionReceipt, type Receipt, type ReceiptTone } from '../approvals/receipts';
import { HELD_REASK_NOTE, heldReasonBadge, heldReasonLine, heldReasonStep, holdReasonOf } from '../approvals/heldReason';
import { packChoiceOfRow } from '../approvals/heldPack';
import { isVideoChoiceApproval } from '../approvals/videoLabel';
import { SectionHelpTip } from './HelpTip';
import type { HomePlan } from './reads';

/**
 * "Your team is on it": this week's expansion of the plan, on the
 * dashboard's Home and the plugin's Overview (shared 2026-10-16).
 * A recurring move is one cron row in the API, so the week view is derived
 * here: `m h * * dow` gives the weekday it fires; done-this-week comes from
 * lastRunAt. Gated tasks stay visible, job first, lock second.
 *
 * In a site's scope (the plugin) a row waiting for a yes shows what it is
 * and one button to Waiting for you, where a site decides by its own rules
 * (money only from the owner's account, TikTok and YouTube in the
 * dashboard). The account's scope decides here, as the dashboard always did.
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfWeekMs(now = new Date()): number {
  const d = new Date(now);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/** `m h * * dow` gives its weekday label; anything unparseable gives null. */
export function cronWeekday(cadence: string | null): string | null {
  if (!cadence) return null;
  const m = cadence.trim().split(/\s+/);
  if (m.length !== 5) return null;
  const dow = Number(m[4]);
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) return null;
  return DAY_NAMES[dow];
}

/** One row of the week, as Home draws it. */
export interface WeekRow {
  key: string;
  icon: string;
  title: string;
  operatorId: string;
  status: 'done' | 'running' | 'awaiting' | 'scheduled' | 'failed' | 'deferred' | 'paused';
  when: string | null;
  approval?: OperatorApproval;
  /** Other approvals of the same task also waiting (shown as a link to Waiting for you, never dropped). */
  moreWaiting?: number;
  /** A change to the site rather than something to publish: it is made, not published. */
  siteChange?: boolean;
  /**
   * The approved row a limit is holding (a deferred row): why it waits and
   * what unlocks it. Never `approval`, which draws Approve and Reject.
   */
  held?: OperatorApproval;
}
type Row = WeekRow;

export const WEEK_PLAN_COPY = {
  heading: 'Your team is on it',
  helpLabel: 'How does approving work?',
  /** In a site's scope, where Approve was: a site decides in Waiting for you. */
  openWaiting: 'Decide in Waiting for you',
  decideFailed: 'That did not save. Your team page has the full inbox.',
};

/** The title of a held row with no task: what waits, and for what. */
function heldTitle(a: OperatorApproval, site: boolean): string {
  const reason = holdReasonOf(a);
  if (reason === 'long_form_limit') return 'A page or article is waiting for room this month';
  if (reason === 'publishes_day_8') return 'A page or article publishes when your plan starts';
  return site ? 'A change to your site is waiting for actions' : 'A post is waiting for actions';
}

/** A pending approval that changes the site (API changesSite), rather than a post to publish. */
function isSiteChange(a: OperatorApproval): boolean {
  return a.changesSite === true;
}

/** Longest text a card shows before "more". */
const CARD_TEXT_MAX = 280;

/**
 * What Home draws for a waiting publish: the post exactly as it
 * goes out, through the same ApprovalPreview Waiting for you draws above its
 * Approve: the video in a player, the pictures, the caption, a shared video's
 * link post, the networks, the accounts it goes out as and what each network
 * will not carry. A change to the site keeps its own drawing (the page
 * itself, or the words it puts there); a video to choose keeps its own route.
 */
export function homeShowsPublishPreview(a: OperatorApproval): boolean {
  return !isSiteChange(a) && !isVideoChoiceApproval(a);
}

/**
 * The words the owner is saying yes to: a post's copy, or the text a change
 * to the site puts on it (a page, a post, a product, a translation). A site
 * change keeps its words in content or description, never in params.text.
 */
export function cardText(a: OperatorApproval): string | null {
  if (isSiteChange(a)) return siteChangeWords(a.toolName, a.params);
  // The post as it goes out, read the same way the inbox preview reads it.
  return typeof a.params?.text === 'string' ? readableText(a.params.text as string) : null;
}

/**
 * Which of a task's pending approvals the card offers first. A draft to
 * publish: the newest, since a newer draft supersedes an older one. Changes
 * to the site: the OLDEST, because they were parked in the order they depend
 * on each other (the page before the menu entry that links to it), and each
 * one is its own decision, so none is superseded. The rest stay one tap away.
 */
function firstToDecide(pending: OperatorApproval[]): OperatorApproval {
  const site = pending.filter(isSiteChange);
  if (site.length > 0 && isSiteChange(pending[0])) return site[site.length - 1];
  return pending[0];
}

/**
 * A run the month's action allowance stopped.
 *
 * The API marks these on the run payload, not with a status of their own: the
 * publishing tools answer `{ deferred: true, mode: 'deferred', reason }` and
 * the approval row keeps that answer in `result` (with the metering sentence
 * on `error` when the row itself was filed as failed). Read defensively
 * across all three shapes: an owner must never see "failed" for work that
 * was only postponed.
 */
export function isOutOfActionsRun(run: unknown, depth = 0): boolean {
  if (!run || typeof run !== 'object' || depth > 2) return false;
  const r = run as { outcome?: unknown; mode?: unknown; deferred?: unknown; reason?: unknown; error?: unknown; result?: unknown; outOfActions?: unknown };
  // The inbox's own flag on an older row filed FAILED when the allowance ran
  // out: its error is the owner's sentence now, which no longer carries the
  // metering wording read below.
  if (depth === 0 && r.outOfActions === true) return true;
  if (r.outcome === 'deferred' || r.mode === 'deferred' || r.deferred === true) return true;
  // The metering service's own wording. `reason` on the approval row itself is
  // the draft's "what will happen" blurb, which the operator wrote and could
  // say anything, so only the run's own fields are read at the top level.
  const sentences = (depth === 0 ? [r.error] : [r.reason, r.error])
    .filter((v): v is string => typeof v === 'string');
  if (sentences.some((s) => /allowance used up|out of actions|deliverable is deferred/i.test(s))) return true;
  return isOutOfActionsRun(r.result, depth + 1);
}

const CHANNEL_ICON: Record<string, string> = {
  x: '𝕏', twitter: '𝕏', email: '✉', blog: '✍', seo: '🔍', store: '🛒',
  social: '📣', video: '🎬', report: '📊',
};

function iconFor(task: { channel?: string | null }): string {
  const c = (task.channel ?? '').toLowerCase();
  for (const k of Object.keys(CHANNEL_ICON)) if (c.includes(k)) return CHANNEL_ICON[k];
  return '•';
}

/**
 * The order of the rows (2026-10-11): what waits for the owner's yes first,
 * then what is running, then what is coming up, then the rest (held for
 * actions, failed, paused, done). Home shows the first WEEK_PLAN_MAX of them;
 * the whole list is on Your team, one link away.
 */
export const WEEK_ROW_ORDER: Readonly<Record<Row['status'], number>> = {
  awaiting: 0, running: 1, scheduled: 2, deferred: 3, failed: 4, paused: 5, done: 6,
};

/** The most rows Home shows. */
export const WEEK_PLAN_MAX = 5;

/** Where the whole plan is: Your team's Plan, on this business. */
export function weekPlanHref(instanceId: string | null | undefined): string {
  return instanceId ? `/team?tab=plan&business=${encodeURIComponent(instanceId)}` : '/team?tab=plan';
}

/** The link beside the heading: how many there are when some are left out. */
export function weekPlanSeeAllLabel(total: number, shown: number): string {
  return total > shown ? `See all ${total} in Your team` : 'See everything in Your team';
}

/**
 * Where the receipt of a decision shows among the rows on screen: in its row
 * ('row') while that row is shown, otherwise at the place it was pressed in
 * (before the row now at that index, or after the last one). A decided row
 * often moves down the order, past the rows Home shows, and its receipt must
 * not go with it.
 */
export function receiptSpot(
  receipt: { rowKey: string; index: number } | null,
  shown: ReadonlyArray<{ key: string }>,
): 'row' | number | null {
  if (!receipt) return null;
  if (shown.some((r) => r.key === receipt.rowKey)) return 'row';
  return Math.max(0, Math.min(receipt.index, shown.length));
}

export function deriveRows(plan: Pick<HomePlan, 'tasks'> | null, approvals: OperatorApproval[]): Row[] {
  const weekStart = startOfWeekMs();
  const rows: Row[] = [];
  // Approvals arrive newest-first. Every pending one of a task is kept: the
  // card offers one (firstToDecide) and counts the rest.
  const pendingByTask = new Map<string, OperatorApproval[]>();
  for (const a of approvals) {
    if (a.status === 'PENDING' && a.operatorTaskId) {
      const list = pendingByTask.get(a.operatorTaskId) ?? [];
      list.push(a);
      pendingByTask.set(a.operatorTaskId, list);
    }
  }

  for (const t of plan?.tasks ?? []) {
    if (t.status === 'CANCELLED') continue;
    const lastRun = t.lastRunAt ? new Date(t.lastRunAt).getTime() : null;
    const ranThisWeek = lastRun != null && lastRun >= weekStart;
    const pendingList = pendingByTask.get(t.id) ?? [];
    const pending = pendingList.length ? firstToDecide(pendingList) : undefined;
    const day = cronWeekday(t.cadence);
    const next = t.scheduledTask?.nextRunAt ? new Date(t.scheduledTask.nextRunAt) : null;

    /*
     * Everything that was not running and not done used to fall through to
     * "scheduled", so work the platform had paused, cancelled or failed still
     * read as "scheduled . Tue", week after week, and never arrived.
     *
     * PAUSED is not an OperatorTask status: pausing after repeated failures
     * is written on the SCHEDULED TASK. There is no 'stopped': a CANCELLED
     * task is skipped above. FAILED has to be checked BEFORE the done
     * branch: a failed run still stamps lastRunAt.
     */
    const pausedBySchedule = t.scheduledTask?.status === 'PAUSED';
    let status: Row['status'];
    if (pending) status = 'awaiting';
    else if (t.status === 'RUNNING') status = 'running';
    else if (t.status === 'FAILED') status = 'failed';
    else if (pausedBySchedule) status = 'paused';
    else if (ranThisWeek || (t.cadence == null && t.status === 'COMPLETED')) status = 'done';
    else status = 'scheduled';

    // A finished one-shot older than this week is history, not this week's plan.
    if (t.cadence == null && t.status === 'COMPLETED' && !ranThisWeek) continue;

    rows.push({
      key: t.id,
      icon: iconFor(t),
      title: t.title,
      operatorId: t.operatorId,
      status,
      when: status === 'done'
        ? (lastRun ? DAY_NAMES[new Date(lastRun).getDay()] : null)
        : day ?? (next ? DAY_NAMES[next.getDay()] : null),
      approval: pending,
      moreWaiting: Math.max(0, pendingList.length - 1),
    });
  }

  // Pending approvals whose task is not in the plan (chat-parked publishes).
  for (const a of approvals) {
    if (a.status !== 'PENDING') continue;
    if (a.operatorTaskId && rows.some((r) => r.key === a.operatorTaskId)) continue;
    rows.push({
      key: `approval-${a.id}`,
      icon: isSiteChange(a) ? '🛠' : '📣',
      title: a.task?.title ?? (isSiteChange(a) ? 'A change to your site' : 'A post is ready for your approval'),
      operatorId: a.operatorId,
      status: 'awaiting',
      when: null,
      approval: a,
    });
  }

  // A publish that FAILED this week is news the owner must see, not a row
  // to silently drop. A run the action meter stopped is news too, and a
  // different kind: it is waiting, not broken, and it reads as "Paused, out
  // of actions" next to the banner that says how to fix it.
  for (const a of approvals) {
    // Only rows that were decided can have an outcome. NEEDS_ACTIONS is the
    // API's own status for an approved post the meter stopped.
    if (a.status !== 'FAILED' && a.status !== 'EXECUTED' && a.status !== 'NEEDS_ACTIONS') continue;
    const deferred = a.status === 'NEEDS_ACTIONS' || isOutOfActionsRun(a);
    if (a.status !== 'FAILED' && !deferred) continue;
    const t = a.decidedAt ?? a.createdAt;
    if (!t || new Date(t).getTime() < weekStart) continue;
    // The plan's own row for this task is already on screen, and lastRunAt
    // makes a deferred run look "done". Relabel that row rather than adding a
    // second line that contradicts the first. A row still awaiting a decision
    // is about a DIFFERENT, newer draft, so it keeps its buttons.
    const existing = deferred && a.operatorTaskId
      ? rows.find((r) => r.key === a.operatorTaskId && r.status !== 'awaiting')
      : undefined;
    if (existing) {
      existing.status = 'deferred';
      existing.when = null;
      existing.siteChange = isSiteChange(a);
      existing.held = a;
      continue;
    }
    // A page, product, form or translation costs an action too, so a held row
    // can be a change to the site that is not a post.
    const site = isSiteChange(a);
    rows.push({
      key: `${deferred ? 'deferred' : 'failed'}-${a.id}`,
      icon: site ? '🛠' : '📣',
      title: a.task?.title ?? (deferred
        ? heldTitle(a, site)
        : (site ? 'A change to your site failed' : 'A publish failed')),
      operatorId: a.operatorId,
      status: deferred ? 'deferred' : 'failed',
      when: null,
      siteChange: site,
      ...(deferred ? { held: a } : {}),
    });
  }

  return rows.sort((x, y) => WEEK_ROW_ORDER[x.status] - WEEK_ROW_ORDER[y.status]);
}

/**
 * What Refine types into the Co-CEO box: the task's title as plain words.
 * The title is model text, and the box is a plain input, so "**Launch**
 * caption &amp; tags" was prefilled with its markers and its entity.
 */
export function refinePrefill(taskTitle: unknown): string {
  return `About "${toPlainLine(taskTitle)}": `;
}

/** The link to the rest of a task's approvals: "1 more is waiting for your yes". */
export function moreWaitingLabel(n: number): string {
  return n === 1 ? '1 more is waiting for your yes' : `${n} more are waiting for your yes`;
}

/** A press on a held row's way out ended (bought and sent, the secure payment page, refused). */
export type HeldSettled = { text: string; tone: ReceiptTone };

/** What the app draws after a receipt (the dashboard's pack choice or its next step), or undefined for the shared button. */
function receiptNextOf(host: ScreensHost | null, receipt: Receipt, onSettled: (settled: HeldSettled) => void): React.ReactNode | undefined {
  const draw = host?.renderers?.receiptNext;
  return draw ? draw({ receipt, approval: null, onSettled }) : undefined;
}

/**
 * What a row says about the owner's decision, once: the
 * receipt when they just decided in this row, and a held row's line ("You
 * approved this. It is not lost ..."). A held receipt already says the work
 * is waiting, with the day and the way to more actions, so the line is left
 * out while it shows, and comes back after a reload, when no receipt is.
 */
export const RowAnswer: React.FC<{
  row: Pick<Row, 'status' | 'siteChange' | 'held'>;
  /** The receipt of a decision made in this row, or null. */
  receipt: Receipt | null;
  /** A press on the held choice ended (bought and sent, the secure payment page, refused): said in this row. */
  onHeldPack?: (approvalId: string, settled: HeldSettled) => void;
}> = ({ row, receipt, onHeldPack }) => {
  const host = useOptionalScreensHost();
  const held = row.status === 'deferred' ? row.held : undefined;
  // Held because this month's actions are used up: buy the pack and it goes
  // out now, or wait, the same two choices as its card (the app draws them).
  const packChoice = held ? packChoiceOfRow(held) : null;
  const wayOut = host?.renderers?.heldWayOut;
  return (
    <>
      {receipt && (
        <div style={{ marginTop: 8 }}>
          <ReceiptNote
            message={receipt.message}
            tone={receipt.tone}
            nextStep={receipt.nextStep}
            next={receiptNextOf(host, receipt, (settled) => onHeldPack?.(receipt.id, settled))}
            testId="week-receipt"
            links={receipt.links}
          />
        </div>
      )}
      {row.status === 'deferred' && receipt?.tone !== 'waiting' && (
        <p data-testid="week-held-line" style={{ margin: '6px 0 0', fontSize: 'var(--text-data)', color: 'var(--text-dim)', lineHeight: 'var(--leading-body)' }}>
          {(held && (packChoice?.text ?? heldReasonLine(held))) ?? `${row.siteChange
            ? 'You approved this. It is not lost: your team makes this change by itself as soon as actions come back.'
            : 'You approved this. It is not lost: it publishes by itself as soon as actions come back.'}${held?.goesToTikTok ? '' : ` ${HELD_REASK_NOTE}`}`}
        </p>
      )}
      {/* What unlocks it, straight to it: the pack, Start my month now, or
          Billing (the same button as on Your team). The receipt carries it
          while it shows. A site is never offered a pack: the button opens
          the dashboard's page. */}
      {held && (held.status === 'NEEDS_ACTIONS' || held.status === 'FAILED') && receipt?.tone !== 'waiting' && (
        <div style={{ marginTop: 8 }}>
          {wayOut && host?.scope.kind !== 'site'
            ? wayOut(held, { onSettled: (settled) => onHeldPack?.(held.id, settled), source: 'home_week' })
            : <NextStepButton step={heldReasonStep(held)} source="home_week" />}
        </div>
      )}
    </>
  );
};

/** The state each row wears on its operator's face. */
const ROW_PRESENCE: Record<Row['status'], OperatorPresence> = {
  done: 'done', running: 'working', awaiting: 'waiting', scheduled: 'queued', failed: 'failed', deferred: 'still', paused: 'still',
};

const STATUS_LABEL: Record<Row['status'], string> = {
  done: '✓ done', running: 'running', awaiting: 'awaiting your approval', scheduled: 'scheduled',
  failed: 'failed · details in Your team',
  deferred: 'Paused, out of actions',
  paused: 'paused, not scheduled',
};

/** The decision call: the host's own (the dashboard's service), else the API's decide on the transport. */
function decideCall(host: ScreensHost | null, id: string, approved: boolean): Promise<DecideResult> {
  if (host?.decide) return host.decide(id, approved, {});
  if (!host) return Promise.reject(new Error('No host to decide with.'));
  return host.transport.post<DecideResult>(`/operators/approvals/${encodeURIComponent(id)}/decide`, { approved });
}

export interface WeekPlanProps {
  /** The business the plan is for: the link to the whole of it opens on it. */
  instanceId: string | null;
  plan: Pick<HomePlan, 'tasks'> | null;
  approvals: OperatorApproval[];
  /** The team's titles by member id; a row names its member only when it has a title. */
  catalog: ReadonlyMap<string, { title?: string | null }> | null;
  /**
   * The app's own row after the week's (the dashboard's video upsell and its
   * dialog). It counts as something to show: the card is drawn for it alone.
   */
  upsell?: React.ReactNode;
  /**
   * Refine: the task's title as the model wrote it (refinePrefill makes it
   * the Co-CEO's words). The Refine button is left out without it.
   */
  onRefine?: (taskTitle: string) => void;
  /**
   * A yes or a no is on its way (`approved`), or did not go through (null):
   * the dashboard's Co-CEO receipt of that change says it at once.
   */
  onDeciding?: (approvalId: string, approved: boolean | null) => void;
  /** A decision went through (or may have): read the plan and the approvals again. */
  onDecided: () => void;
  /** A receipt shows or goes (the section keeps its card while one shows). */
  onReceiptShown?: (shown: boolean) => void;
}

/** Whether the week has anything to draw: a row, or the app's own row. */
export function weekPlanShows(plan: Pick<HomePlan, 'tasks'> | null, approvals: OperatorApproval[], upsell?: React.ReactNode): boolean {
  return deriveRows(plan, approvals).length > 0 || (upsell !== null && upsell !== undefined && upsell !== false);
}

export const WeekPlan: React.FC<WeekPlanProps> = ({
  instanceId, plan, approvals, catalog, upsell, onRefine, onDeciding, onDecided, onReceiptShown,
}) => {
  const host = useOptionalScreensHost();
  const site = host?.scope.kind === 'site';
  const [deciding, setDeciding] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  /*
   * What the owner just decided, said in the row they pressed it in: the
   * row's buttons go away once the plan reloads, and
   * nothing used to say what had happened. `index` places it when the row
   * itself is gone.
   */
  const [receipt, setReceiptState] = useState<{ rowKey: string; index: number; receipt: Receipt } | null>(null);
  const setReceipt = (next: { rowKey: string; index: number; receipt: Receipt } | null) => {
    setReceiptState(next);
    onReceiptShown?.(next !== null);
  };

  const hasUpsell = upsell !== null && upsell !== undefined && upsell !== false;
  const all = deriveRows(plan, approvals);
  if (!all.length && !hasUpsell && !receipt) return null;
  // The essentials (2026-10-11): the first rows, in WEEK_ROW_ORDER; the rest
  // are on Your team. A receipt follows the rows that are shown: in its row
  // while that row is here, at its place otherwise.
  const rows = all.slice(0, WEEK_PLAN_MAX);
  const spot = receiptSpot(receipt, rows);
  // A press on a held row's choice ended: said in that row, and the plan reloads.
  const onHeldPack = (rowKey: string, index: number) => (approvalId: string, settled: HeldSettled) => {
    setReceipt({ rowKey, index, receipt: { id: approvalId, message: settled.text, tone: settled.tone } });
    onDecided();
  };
  const receiptNote = receipt ? (
    <ReceiptNote
      message={receipt.receipt.message}
      tone={receipt.receipt.tone}
      nextStep={receipt.receipt.nextStep}
      next={receiptNextOf(host, receipt.receipt, (settled) => onHeldPack(receipt.rowKey, receipt.index)(receipt.receipt.id, settled))}
      testId="week-receipt"
      links={receipt.receipt.links}
    />
  ) : null;

  // Every positive action is the primary: no ring CTA here.

  /**
   * A TikTok post is approved on the Post to TikTok screen and nowhere else.
   * The API's goesToTikTok covers every way a row reaches TikTok.
   */
  const needsTikTokConsent = (a: OperatorApproval) => approvalGoesToTikTok(a);
  /**
   * So is an upload to YouTube never approved blind from here: its card shows
   * the title and the description YouTube will get and asks who can see it
   * and whether it is made for kids first, as YouTube's API Services
   * Developer Policies (III.C.3, III.E) want, and the API refuses an approve
   * without them.
   */
  const needsYouTubeChoice = (a: OperatorApproval) => approvalGoesToYouTube(a);
  /** Nor a database write WPMaven cannot put fully into words: it is approved on its card. */
  const needsCard = (a: OperatorApproval) => approvalNeedsCard(a);

  const decide = async (a: OperatorApproval, approved: boolean, rowKey = a.id, index = -1) => {
    if (approved && (needsTikTokConsent(a) || needsYouTubeChoice(a) || needsCard(a))) {
      openPage(host, approvalPath(a.id));
      return;
    }
    setDeciding(a.id);
    setDecideError(null);
    setReceipt(null);
    onDeciding?.(a.id, approved);
    const out = await sendDecision({
      approved,
      asks: false,
      form: null,
      send: () => decideCall(host, a.id, approved),
    });
    setDeciding(null);
    // Not decided here after all (or not known): the list read next says where it stands.
    if (out.kind !== 'sent') onDeciding?.(a.id, null);
    // The API says it goes to YouTube after all: its card shows what YouTube gets.
    if (out.kind === 'ask') {
      openPage(host, approvalPath(a.id));
      return;
    }
    if (out.kind === 'failed') {
      if (noAnswer(out.error)) {
        // It may have gone through: say so and read the list again instead
        // of calling it a failure.
        setDecideError(DECISION_OUTCOME_UNKNOWN);
        onDecided();
        return;
      }
      setDecideError(WEEK_PLAN_COPY.decideFailed);
      return;
    }
    const res = out.result;
    setReceipt({ rowKey, index, receipt: decisionReceipt(a.id, approved, res) });
    onDecided();
  };

  const opTitle = (id: string) => catalog?.get(id)?.title ?? null;
  const routeTo = (a: OperatorApproval) => () => openPage(host, approvalPath(a.id));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 'var(--text-label)', fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8 }}>
          {WEEK_PLAN_COPY.heading}
          <SectionHelpTip
            id="approvals"
            topic="approvals"
            label={WEEK_PLAN_COPY.helpLabel}
          >
            Nothing is published and nothing on your site changes until you
            approve it. Reject it and your team does something else. To
            change the words of a post, refine it and say what to change. For a
            change to your site, reject it and tell your Co-CEO what you want instead.
          </SectionHelpTip>
        </div>
        {/* Always beside the heading, and it says how many there are when
            some are left out. */}
        <HostLink
          to={weekPlanHref(instanceId)}
          testId="week-see-all"
          style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 2px', fontSize: 'var(--text-data)', color: 'var(--text-dim)', textDecoration: 'underline', minHeight: 32, whiteSpace: 'nowrap' }}
        >
          {weekPlanSeeAllLabel(all.length, rows.length)}
        </HostLink>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r, i) => (
          <React.Fragment key={r.key}>
          {spot === i && receiptNote}
          <div style={{ borderRadius: 10, border: '1px solid var(--glass-border)', background: 'var(--glass)', padding: '10px 12px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span aria-hidden style={{ width: 20, textAlign: 'center' }}>{r.icon}</span>
              <span style={{ fontSize: 'var(--text-body)', color: 'var(--text)', fontWeight: 600, flex: 1, minWidth: 160 }}><OperatorInline text={r.title} /></span>
              {opTitle(r.operatorId) && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-meta)', color: 'var(--text-dim)' }}>
                  <OperatorAvatar id={r.operatorId} title={opTitle(r.operatorId) ?? undefined} presence={ROW_PRESENCE[r.status] ?? 'still'} size={OPERATOR_AVATAR_SIZES.row} decorative />
                  {opTitle(r.operatorId)}
                </span>
              )}
              <span style={{
                fontSize: 'var(--text-meta)', fontWeight: 600,
                color: r.status === 'awaiting' || r.status === 'deferred' ? 'var(--warning)' : 'var(--text-dim)',
              }}>
                {r.status === 'deferred' && r.held ? heldReasonBadge(r.held) : STATUS_LABEL[r.status]}{r.when && r.status !== 'awaiting' ? ` · ${r.when}` : ''}
              </span>
            </div>

            <RowAnswer row={r} receipt={receipt && receipt.rowKey === r.key ? receipt.receipt : null} onHeldPack={onHeldPack(r.key, i)} />

            {r.approval && (
              <div style={{ marginTop: 8 }}>
                {/* What saying yes does, in the owner's words (the API's
                    sentence): for a change to the site this is the only
                    description there is, since it has no post text. The
                    operator's own note on it sits under it, smaller. */}
                {approvalSentence(r.approval) && (
                  <p style={{ margin: '0 0 8px', fontSize: 'var(--text-body)', lineHeight: 'var(--leading-body)', color: 'var(--text)' }}>
                    <OperatorInline text={splitTeamNote(approvalSentence(r.approval)).facts} />
                  </p>
                )}
                <TeamNoteLine sentence={approvalSentence(r.approval)} as="p" style={{ margin: '-4px 0 8px' }} />
                {/* The words the owner is being asked to approve (a post's
                    copy, or the text a page or product puts on the site):
                    full body size at full contrast, not dimmed fine print. */}
                {(() => {
                  // A post, page or product: its picture, title and first
                  // words, and the button to its card, where it is drawn as
                  // the site will show it (2026-09-24).
                  const preview = drawableSitePreview(r.approval);
                  if (preview) {
                    return <SiteChangeSummary site={preview} onOpen={routeTo(r.approval)} />;
                  }
                  // A post: what goes out, as it goes out.
                  if (homeShowsPublishPreview(r.approval)) {
                    return (
                      <div data-testid="week-publish-preview" style={{ margin: '0 0 10px' }}>
                        <ApprovalPreview approval={r.approval} />
                      </div>
                    );
                  }
                  const text = cardText(r.approval);
                  if (!text) return null;
                  return (
                    <blockquote style={{
                      margin: '0 0 10px', padding: '10px 12px', borderLeft: '3px solid var(--glass-border)',
                      fontSize: 'var(--text-body)', lineHeight: 'var(--leading-body)',
                      color: 'var(--text)', whiteSpace: 'pre-wrap',
                    }}>
                      {expanded === r.key || text.length <= CARD_TEXT_MAX
                        ? text
                        : `${text.slice(0, CARD_TEXT_MAX)}…`}
                      {text.length > CARD_TEXT_MAX && (
                        <button
                          onClick={() => setExpanded(expanded === r.key ? null : r.key)}
                          style={{ background: 'none', border: 'none', padding: '4px 6px', cursor: 'pointer', fontSize: 'var(--text-data)', color: 'var(--text-mid)', minHeight: 30 }}
                        >
                          {expanded === r.key ? 'less' : 'more'}
                        </button>
                      )}
                    </blockquote>
                  );
                })()}
                {site ? (
                  // A site decides in Waiting for you, by its own rules.
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-testid="week-site-route">
                    <PageButton to="/waiting" source="home_week">{WEEK_PLAN_COPY.openWaiting}</PageButton>
                  </div>
                ) : needsTikTokConsent(r.approval) ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Button size="sm" variant="primary" onClick={routeTo(r.approval)}>
                      {TIKTOK_COPY.routeButton}
                    </Button>
                    <span style={{ fontSize: 'var(--text-data)', color: 'var(--text-dim)' }}>
                      {TIKTOK_COPY.routeFirst}
                    </span>
                  </div>
                ) : isVideoChoiceApproval(r.approval) ? (
                  host?.renderers?.videoChoiceRoute
                    ? <>{host.renderers.videoChoiceRoute(r.approval)}</>
                    : (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-testid="video-choice-route">
                        <PageButton to={approvalPath(r.approval.id)} source="home_week">Choose your video</PageButton>
                      </div>
                    )
                ) : needsYouTubeChoice(r.approval) ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-testid="week-youtube-route">
                    <Button size="sm" variant="primary" onClick={routeTo(r.approval)}>
                      {YOUTUBE_VISIBILITY_COPY.routeButton}
                    </Button>
                    <span style={{ fontSize: 'var(--text-data)', color: 'var(--text-dim)' }}>
                      {YOUTUBE_VISIBILITY_COPY.routeFirst}
                    </span>
                  </div>
                ) : needsCard(r.approval) ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-testid="week-card-route">
                    <Button size="sm" variant="primary" onClick={routeTo(r.approval)}>
                      {CARD_ONLY_COPY.routeButton}
                    </Button>
                    <Button size="sm" variant="outline" disabled={deciding != null}
                      onClick={() => decide(r.approval!, false, r.key, i)}>
                      Reject
                    </Button>
                    <span style={{ fontSize: 'var(--text-data)', color: 'var(--text-dim)' }}>
                      {CARD_ONLY_COPY.routeFirst}
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button
                      size="sm"
                      variant="primary"
                      isLoading={deciding === r.approval.id}
                      disabled={deciding != null}
                      onClick={() => decide(r.approval!, true, r.key, i)}
                    >
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={deciding != null}
                      onClick={() => decide(r.approval!, false, r.key, i)}>
                      Reject
                    </Button>
                    {/* Refine asks for different words, so it is offered where
                        Team and Waiting for you offer Request changes. A change
                        to the site has none to rewrite: reject it and tell the
                        Co-CEO instead. */}
                    {canRequestChanges(r.approval) && onRefine && (
                      <Button size="sm" variant="outline" disabled={deciding != null}
                        onClick={() => onRefine(r.title)}>
                        Refine
                      </Button>
                    )}
                  </div>
                )}
                {decideError && r.approval && deciding == null && (
                  <p style={{ margin: '6px 0 0', fontSize: 'var(--text-data)', color: 'var(--rose, #d06a77)' }}>{decideError}</p>
                )}
                {(r.moreWaiting ?? 0) > 0 && (
                  <button
                    onClick={() => openPage(host, '/waiting')}
                    style={{ background: 'none', border: 'none', padding: '6px 0 0', cursor: 'pointer', fontSize: 'var(--text-data)', color: 'var(--text)', textDecoration: 'underline', minHeight: 32 }}
                  >
                    {moreWaitingLabel(r.moreWaiting ?? 0)}
                  </button>
                )}
              </div>
            )}
          </div>
          </React.Fragment>
        ))}
        {spot === rows.length && receiptNote}

        {hasUpsell && upsell}
      </div>
    </div>
  );
};

export default WeekPlan;
