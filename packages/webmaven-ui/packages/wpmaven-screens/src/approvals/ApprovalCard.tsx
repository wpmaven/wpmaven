/**
 * One approval, the same card in both apps and on both of the dashboard's
 * surfaces (2026-10-16): Waiting for you, the plugin's Waiting for you, and
 * the dashboard's Your team > Approvals, which drew a second card of its own.
 *
 * Who on the team asks (and, in the dashboard's account view, for which
 * business), the title, the real content (ApprovalPreview), what it does,
 * the team's note, then the decision. What only one surface adds comes in
 * through slots: Your team's status and time, its receipt on the card, its
 * Post to TikTok screen, its history lines.
 *
 * In a site's view (the plugin) the API says what the site may do with each
 * row, and the card follows it: a post to TikTok or an upload to YouTube is
 * declined or sent back from here but approved in the dashboard
 * (approveInDashboardText, the one link to the dashboard left; an upload to
 * YouTube is approved there even when a row does not say so); money the
 * person may not decide shows the API's sentence (ownerOnlyText) instead of
 * the decision; a held change says the site's held sentence, with Open
 * billing and Cancel this change.
 */
import React, { useState } from 'react';
import {
  Badge, Button, Card, Modal, OperatorAvatar, OPERATOR_AVATAR_SIZES, operatorTitle, type BadgeColor,
} from '@yotako/webmaven-ui';
import { OperatorInline, WhyDisabled, toPlainLine } from '@yotako/wpmaven-onboarding/shared';
import type { OperatorApproval } from './types';
import { ApprovalPreview } from './ApprovalPreview';
import { ActionDetails } from './ActionDetails';
import { TeamNoteLine } from './TeamNoteLine';
import { YouTubeUploadSection } from './YouTubeUploadSection';
import { ModalScrollBody } from './ModalScrollBody';
import { approvalGoesToTikTok, approvalGoesToYouTube, approvalPath } from './targets';
import { platformMeta } from './previewData';
import { TIKTOK_COPY } from './tiktokPost';
import { canCancelHeld, heldCancelWords, heldLine, staleHoldLine } from './heldItems';
import {
  asksYouTubeVisibility, initialYouTubeForm, youtubeApproveBlock, youtubeChoiceId, type YouTubeUploadForm,
} from './youtubeVisibility';
import { isVideoChoiceApproval, rejectLabelFor } from './videoLabel';
import { approvalByTitle, approvalTitle, canRevise, factsOf, sentenceOf, sentenceUnderTitle, underTitleStyle } from './words';
import { HostLink } from '../host/HostLink';
import { useOptionalScreensHost } from '../host/HostContext';
import { PageButton } from './ReceiptNote';
import { TYPE, small } from './styles';

/** A card's status, in words and in one of the badge colours (Your team's history). */
export interface ApprovalCardStatus {
  color: BadgeColor;
  label: string;
}

export interface ApprovalCardProps {
  approval: OperatorApproval;
  /**
   * The business the approval belongs to, named on the card: the dashboard's
   * account view of every business. Never given in a site's view.
   */
  businessName?: string | null;
  /** The first card carries the guided tour's anchor on its decision row. */
  tourAnchor?: boolean;
  /** This card's decision is being sent. */
  deciding: boolean;
  /** Staff viewing as the owner (the API refuses their decision on a TikTok row). */
  locked?: boolean;
  /**
   * The "Post to YouTube" section as the owner filled it in on this card:
   * the title and the description as edited, who can see it, made for kids
   * (nothing chosen until they choose; what the API sent is only a hint).
   * Absent: what the section opens on. Only read on a row that uploads to
   * YouTube.
   */
  youtubeForm?: YouTubeUploadForm | null;
  /** The API refused an approve without the YouTube values: ask for them here. */
  youtubeAsked?: boolean;
  onYouTubeChange?: (patch: Partial<YouTubeUploadForm>) => void;
  /** Which page shows the "Post to YouTube" section ('waiting', 'team'): the section's id. */
  surface?: string;
  noteOpen: boolean;
  note: string;
  sendingNote: boolean;
  /** Said under the note box when the request for changes was refused. */
  noteError?: string | null;
  onApprove: () => void;
  /** A post to TikTok: open the Post to TikTok screen (the dashboard's Your team). */
  onOpenTikTok?: () => void;
  onReject: () => void;
  onToggleNote: () => void;
  onNoteChange: (value: string) => void;
  onSendNote: () => void;
  onCancelNote: () => void;
  /** "Open in full" was pressed (the card opens it itself). */
  onOpenFull?: () => void;
  /**
   * Cancel a held item before it goes out. Throws the API's refusal, which
   * the confirmation says. Absent: no Cancel on a held card.
   */
  onCancelHeld?: () => Promise<void>;
  /**
   * The way out of a held card the app draws (the dashboard's pack choice or
   * next step); null for none (it is on the receipt already). Absent: Open
   * billing, to the row's own dashboard page.
   */
  heldWayOut?: React.ReactNode;
  /**
   * Draw it as held whatever its status: an older row filed FAILED when the
   * action allowance ran out (Your team reads it, outOfActions).
   */
  treatAsHeld?: boolean;
  /** Leave out the held sentence (Your team: the receipt where the owner acted says it). */
  hideHeldLine?: boolean;

  // ── What only Your team adds ─────────────────────────────────────────

  /** On the right of the first line: the row's status (Your team's history). */
  status?: ApprovalCardStatus | null;
  /** After the status: when it was asked. */
  when?: React.ReactNode;
  /** What the owner just did to this card, said on it (a ReceiptNote). */
  confirmation?: React.ReactNode;
  /** After the content: Your team's history lines (links, TikTok's status, sharing). */
  extra?: React.ReactNode;
  /**
   * The Post to TikTok screen, drawn on the card above the decision: its own
   * button approves (Your team), and a video that also goes to YouTube shows
   * its "Post to YouTube" section on the card too. Without it, a TikTok
   * row's button opens that screen (onOpenTikTok).
   */
  tiktokScreen?: React.ReactNode;
  /**
   * Leave the video out of the preview: the Post to TikTok screen plays the
   * exact file TikTok would get in its own player.
   */
  hideVideo?: boolean;
  /** The buttons' words where a surface keeps its own ("Approve and run", "Reject"). */
  labels?: { approve?: string; reject?: string };
  /** Why Approve cannot be pressed besides YouTube (a team member's role), said beside it. */
  approveBlock?: string | null;
  /** Why no decision can be made here at all (a team member's role): Decline and Request changes are off too. */
  decideBlock?: string | null;
  /** The decision did not go through: the reason, under the buttons. */
  decideError?: string | null;
  /**
   * 'none': the card draws no frame, no first line and no title; the page
   * draws them around it (Your team: its own frame and header, like its plan
   * and progress cards, 2026-10-11).
   */
  frame?: 'card' | 'none';
  /**
   * The title the page drew (Your team heads a card by its kind, "A video for
   * TikTok"): what the change does is then said right under it, before the
   * content, whole.
   */
  heading?: string | null;
  /** "Part of: <the task>" under a heading that names the kind, not the task (Your team). */
  partOf?: boolean;
  /** Draws the decision's buttons inside the page's own row (Your team's). */
  decisionRow?: (buttons: React.ReactNode) => React.ReactNode;
  /** Offer "Open in full" (default). Your team shows everything on the card. */
  openFull?: boolean;
  /** Action details on the card, closed, whenever there are any (Your team); else only on a change approved on its card. */
  inlineActionDetails?: boolean;
}

/** The decision for a site's row: approve here, approve in the dashboard, or none (money it may not decide). */
export type SiteDecision = 'here' | 'dashboard' | 'owner-only';

/** What a row lets this person do, from the API's site view (absent fields: approve here). */
export function siteDecisionOf(a: Partial<Pick<OperatorApproval, 'approveInDashboard' | 'ownerOnly' | 'decidable'>>, decidesMoney = true): SiteDecision {
  if (a.ownerOnly && (a.decidable === false || (a.decidable === undefined && !decidesMoney))) return 'owner-only';
  if (a.approveInDashboard) return 'dashboard';
  return 'here';
}

/** A row approved and waiting for the plan's actions, in either view. */
export function isHeldRow(a: Pick<OperatorApproval, 'status'> & Partial<Pick<OperatorApproval, 'held'>>): boolean {
  return a.status === 'NEEDS_ACTIONS' || a.held === true;
}

/** The sentence a site's money card says when this person may not decide it (the API's own, else this). */
export const OWNER_ONLY_TEXT = "Only the account's owner decides payments.";

/** The sentence a site's TikTok or YouTube card says (the API's own, else this). */
export const APPROVE_IN_DASHBOARD_TEXT = 'Posts to TikTok and uploads to YouTube are approved in your dashboard, where their settings are chosen.';

/** The sentence a site's held card says (the API's own, else this). */
export const SITE_HELD_TEXT = "This waits for your plan's actions. See your dashboard.";

export const ApprovalCard: React.FC<ApprovalCardProps> = ({
  approval: a, businessName = null, tourAnchor = false, deciding, locked = false,
  youtubeForm, youtubeAsked = false, onYouTubeChange, surface = 'waiting',
  noteOpen, note, sendingNote, noteError = null,
  onApprove, onOpenTikTok, onReject, onToggleNote, onNoteChange, onSendNote, onCancelNote, onOpenFull,
  onCancelHeld, heldWayOut, treatAsHeld = false, hideHeldLine = false,
  status = null, when, confirmation, extra, tiktokScreen, hideVideo = false, labels, approveBlock: extraBlock = null, decideBlock = null,
  decideError = null, frame = 'card', heading = null, partOf = false, decisionRow, openFull = true, inlineActionDetails = false,
}) => {
  const host = useOptionalScreensHost();
  const siteView = host?.scope.kind === 'site';
  const [full, setFull] = useState(false);
  const pending = a.status === 'PENDING' && !a.held;
  const held = treatAsHeld || isHeldRow(a);
  /*
   * A site never approves an upload to YouTube: the API answers
   * APPROVAL_IN_DASHBOARD to it, and to any `youtube` a site sends. The row
   * says so (approveInDashboard); one that goes to YouTube without saying so
   * is approved in the dashboard all the same, so a site's card never draws
   * the "Post to YouTube" section.
   */
  const toYouTube = approvalGoesToYouTube(a);
  const decision: SiteDecision = siteView
    ? siteDecisionOf(toYouTube ? { ...a, approveInDashboard: true } : a, host?.viewer?.decidesMoney !== false)
    : 'here';
  /*
   * An upload to YouTube shows exactly what YouTube will get (YouTube API
   * Services Developer Policies III.C.3 and III.E): its title and description
   * to check and edit, who can see it, made for kids. Approve waits until it
   * is complete, saying so beside it. A TikTok row shows it only beside the
   * Post to TikTok screen (Your team); elsewhere its button opens that
   * screen, whose card asks. A site approves neither (approveInDashboard).
   */
  const tiktok = approvalGoesToTikTok(a);
  /*
   * A video to choose: its card (ApprovalPreview) carries "Choose your
   * video", which opens the choice screen where the owner approves the exact
   * dollars. It is never approved blind from this list; "Not now" skips it.
   */
  const videoChoice = isVideoChoiceApproval(a);
  const asksYouTube = pending && decision === 'here' && (!tiktok || !!tiktokScreen) && !videoChoice && asksYouTubeVisibility(a, youtubeAsked);
  const ytForm = youtubeForm ?? initialYouTubeForm(a);
  const approveBlock = decideBlock ?? extraBlock ?? youtubeApproveBlock({ asks: asksYouTube, form: ytForm, locked });
  const ytId = youtubeChoiceId(a.id, surface);
  const whyId = `wapprove-why-${a.id}`;
  const by = approvalByTitle(a, operatorTitle);
  const facts = factsOf(a);
  // Under the page's own heading the change is said whole; under the card's
  // own title, only when the title does not already say it.
  const under = heading ? (facts && toPlainLine(facts) && toPlainLine(facts) !== heading ? facts : null) : sentenceUnderTitle(a);
  const stale = staleHoldLine(a);
  const showDecision = pending && decision !== 'owner-only';
  const openTheFull = () => { onOpenFull?.(); setFull(true); };
  const sentence = under ? <OperatorInline text={under} style={underTitleStyle(a)} /> : null;
  const teamNote = <TeamNoteLine sentence={sentenceOf(a)} />;

  const buttons = (
    <>
      {videoChoice || tiktokScreen || decision === 'dashboard' ? null : tiktok ? (
        <Button
          size="sm"
          variant="primary"
          disabled={deciding}
          onClick={onOpenTikTok}
        >
          {TIKTOK_COPY.routeButton}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="primary"
          data-testid="waiting-approve"
          disabled={deciding || !!approveBlock}
          aria-disabled={deciding || !!approveBlock}
          aria-describedby={approveBlock ? whyId : undefined}
          onClick={onApprove}
        >
          {deciding ? 'Working…' : (labels?.approve ?? 'Approve')}
        </Button>
      )}
      {!videoChoice && canRevise(a) && (
        <Button
          size="sm"
          variant="outline"
          data-testid="waiting-request-changes"
          disabled={deciding || !!decideBlock}
          onClick={onToggleNote}
        >
          Request changes
        </Button>
      )}
      {/* The API refuses a staff decision on a TikTok row either way. */}
      <Button
        size="sm"
        variant="outline"
        data-testid="waiting-decline"
        disabled={deciding || (locked && tiktok) || !!decideBlock}
        aria-disabled={deciding || (locked && tiktok) || !!decideBlock}
        aria-describedby={decideBlock ? whyId : undefined}
        title={locked && tiktok ? TIKTOK_COPY.staffRefusal : undefined}
        onClick={onReject}
      >
        {/* Decline, as the plugin says it: the owner turns down their own team's work. */}
        {labels?.reject ?? rejectLabelFor(a, 'Decline')}
      </Button>
      {openFull && (
        <Button
          size="sm"
          variant="ghost"
          data-testid="waiting-open-full"
          onClick={openTheFull}
        >
          <span style={{ whiteSpace: 'nowrap' }}>Open in full</span>
        </Button>
      )}
      {/* What unlocks Approve, beside it: the YouTube section above, or the role. */}
      <WhyDisabled id={whyId} reason={deciding ? null : approveBlock} />
    </>
  );

  const body = (
    <div data-testid="waiting-item" data-approval-id={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {frame === 'card' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {/* Who on the team asks, waiting for the owner's yes; and in the
              account's view, for which business. */}
          <span data-testid="waiting-by" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-dim)', minWidth: 0 }}>
            <OperatorAvatar id={a.operatorId} title={by} presence={pending ? 'waiting' : 'still'} size={OPERATOR_AVATAR_SIZES.card} decorative />
            <span>Your {by}</span>
            {businessName && (
              <span data-testid="waiting-business" style={{ overflowWrap: 'anywhere' }}>
                <span aria-hidden="true">{'· '}</span>{businessName}
              </span>
            )}
          </span>
          {(status || when) && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {status && <Badge color={status.color}>{status.label}</Badge>}
              {when && <span style={{ ...small, opacity: 0.6 }}>{when}</span>}
            </span>
          )}
        </div>
      )}
      {confirmation}
      {frame === 'card' && (
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {heading || approvalTitle(a)}
        </span>
      )}
      {partOf && a.task?.title && (
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Part of: <OperatorInline text={a.task.title} /></span>
      )}
      {/* Under a heading that names the kind, what the change does comes first. */}
      {heading && sentence}
      {heading && teamNote}
      {/* The real content, not a summary of it: the video plays here,
          the picture shows with its caption, the copy is whole. */}
      <ApprovalPreview approval={a} hideVideo={hideVideo} />
      {pending && tiktok && decision === 'here' && !tiktokScreen && (
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{TIKTOK_COPY.routeFirst}</span>
      )}
      {!heading && sentence}
      {!heading && teamNote}
      {/* A change whose words cannot say all it does is approved on what it
          is: the statement, open, above Approve. Your team shows
          the call, closed, on every card that has one. */}
      {(a.approveOnCard || inlineActionDetails) && <ActionDetails approval={a} />}
      {/* Held past 72 hours, so asked again instead of posted. */}
      {stale && (
        <span data-testid="stale-hold-line" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{stale}</span>
      )}
      {a.revisionRound > 0 && (
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Version {a.revisionRound + 1}, rewritten after your notes.
        </span>
      )}
      {a.revisionNote && (
        <span style={{ fontSize: 13, color: 'var(--text)', opacity: 0.8 }}>You asked for: “{a.revisionNote}”</span>
      )}
      {a.error && (
        <OperatorInline text={a.error} style={{ fontSize: 13, color: 'var(--danger)' }} />
      )}
      {held && (
        <HeldBlock
          approval={a}
          siteView={siteView}
          hideLine={hideHeldLine}
          wayOut={heldWayOut}
          locked={locked}
          onCancel={onCancelHeld}
        />
      )}
      {extra}
      {pending && decision === 'dashboard' && (
        <InDashboard
          text={a.approveInDashboardText || APPROVE_IN_DASHBOARD_TEXT}
          to={a.dashboardPath || (toYouTube ? approvalPath(a.id) : null)}
        />
      )}
      {pending && decision === 'owner-only' && (
        <p data-testid="waiting-owner-only" role="note" style={{ margin: 0, fontSize: 13, color: 'var(--text)' }}>
          {a.ownerOnlyText || OWNER_ONLY_TEXT}
        </p>
      )}
      {asksYouTube && (
        <YouTubeUploadSection
          id={ytId}
          approval={a}
          form={ytForm}
          disabled={locked}
          highlight={youtubeAsked}
          onChange={(patch) => onYouTubeChange?.(patch)}
        />
      )}
      {pending && tiktokScreen}
      {showDecision && (decisionRow ? decisionRow(buttons) : (
        <div
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
          data-tour={tourAnchor ? 'waiting-decide' : undefined}
        >
          {buttons}
        </div>
      ))}
      {pending && openFull && !showDecision && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button size="sm" variant="ghost" data-testid="waiting-open-full" onClick={openTheFull}>
            <span style={{ whiteSpace: 'nowrap' }}>Open in full</span>
          </Button>
        </div>
      )}
      {showDecision && locked && tiktok && (
        <span role="note" style={{ fontSize: 12, color: 'var(--text-dim)' }}>{TIKTOK_COPY.staffRefusal}</span>
      )}
      {decideError && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger)', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>{decideError}</p>
      )}
      {showDecision && noteOpen && (
        <NoteBox
          id={a.id}
          note={note}
          sending={sendingNote}
          error={noteError}
          onChange={onNoteChange}
          onSend={onSendNote}
          onCancel={onCancelNote}
        />
      )}
      {full && <ApprovalDetail approval={a} onClose={() => setFull(false)} />}
    </div>
  );

  return frame === 'card' ? <Card padding="md">{body}</Card> : body;
};

/** "What should be different?" under the buttons, until it is sent or put away. */
function NoteBox({ id, note, sending, error, onChange, onSend, onCancel }: {
  id: string;
  note: string;
  sending: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const empty = !note.trim();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label htmlFor={`wnote-${id}`} style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        What should be different? Write it the way you would say it.
      </label>
      <textarea
        id={`wnote-${id}`}
        rows={3}
        autoFocus
        value={note}
        maxLength={2000}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Shorter, and mention that we open on Saturdays."
        style={{
          boxSizing: 'border-box', width: '100%', padding: 10, borderRadius: 8, margin: 0,
          border: '1px solid var(--glass-border)', background: 'var(--bg-raised)',
          color: 'var(--text)', fontSize: TYPE.data, fontFamily: 'inherit',
        }}
      />
      {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          size="sm"
          variant="primary"
          disabled={sending || empty}
          aria-describedby={!sending && empty ? `wnote-why-${id}` : undefined}
          onClick={onSend}
        >
          {sending ? 'Sending…' : 'Send to your team'}
        </Button>
        <Button size="sm" variant="ghost" disabled={sending} onClick={onCancel}>
          Cancel
        </Button>
        <WhyDisabled id={`wnote-why-${id}`} reason={!sending && empty ? 'Write what should be different, then send it.' : null} />
      </div>
    </div>
  );
}

/**
 * A row whose settings are chosen in the dashboard (a post to TikTok, an
 * upload to YouTube), in a site's view: the API's sentence and the way to
 * its card there, in Approve's place. The only link to the dashboard the
 * page keeps.
 */
function InDashboard({ text, to }: { text: string; to: string | null }) {
  return (
    <div data-testid="waiting-approve-in-dashboard" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 13, color: 'var(--text)', flex: '1 1 260px' }}>{text}</span>
      {to && (
        <HostLink to={to} style={{ fontSize: 13, fontWeight: 600, color: 'var(--purple)', textDecoration: 'underline' }} testId="waiting-open-dashboard">
          Open in your dashboard
        </HostLink>
      )}
    </div>
  );
}

/**
 * A held card: what it waits for and what lets it go. In a site's view the
 * API's own sentence (never a pack or a price) and Open billing; in the
 * account's, the held line and the app's way out (the pack, or the button
 * for why it waits). Cancel, with its confirmation, in both.
 */
function HeldBlock({ approval: a, siteView, hideLine, wayOut, locked, onCancel }: {
  approval: OperatorApproval;
  siteView: boolean;
  hideLine: boolean;
  wayOut?: React.ReactNode;
  locked: boolean;
  onCancel?: () => Promise<void>;
}) {
  const tiktok = approvalGoesToTikTok(a);
  const words = heldCancelWords(
    tiktok,
    (a.targets ?? []).filter((p) => p !== 'tiktok').map((p) => platformMeta(p).label),
    a.changesSite === true,
  );
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const line = siteView ? (a.heldText || SITE_HELD_TEXT) : heldLine(a, tiktok);
  const cancellable = !!onCancel && (canCancelHeld(a) || a.held === true);
  const staffBlocked = locked && tiktok;
  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await onCancel?.();
      setAsking(false);
    } catch (e) {
      setFailure(e instanceof Error && e.message ? e.message : 'That did not go through. Reload and try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {!hideLine && (
        <p data-testid="held-line" style={{ margin: 0, fontSize: 13, color: 'var(--text)' }}>{line}</p>
      )}
      {(wayOut !== null || cancellable) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {wayOut !== undefined ? wayOut : (
            <PageButton to={a.dashboardPath || '/billing'} source="held" testId="held-open-billing">Open billing</PageButton>
          )}
          {cancellable && (
            <Button
              size="sm"
              variant="danger"
              disabled={staffBlocked || busy}
              aria-disabled={staffBlocked || busy}
              title={staffBlocked ? words.staffRefusal : undefined}
              onClick={() => { setFailure(null); setAsking(true); }}
              data-testid={words.testId}
            >
              {words.button}
            </Button>
          )}
          {cancellable && staffBlocked && (
            <span role="note" style={{ ...small, opacity: 0.6 }}>{words.staffRefusal}</span>
          )}
        </div>
      )}
      {asking && (
        <Modal isOpen onClose={busy ? () => undefined : () => setAsking(false)} title={words.title} size="sm">
          <p style={{ margin: 0, fontSize: TYPE.data, color: 'var(--text-dim)', lineHeight: 1.5 }}>{words.detail}</p>
          {failure && (
            <p role="alert" style={{ margin: '12px 0 0', fontSize: TYPE.data, color: 'var(--rose, #d06a77)', lineHeight: 1.5 }}>{failure}</p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            <Button variant="dangerSolid" size="sm" isLoading={busy} disabled={busy} onClick={() => void confirm()}>
              {words.confirm}
            </Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => setAsking(false)}>
              {words.keep}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export interface ApprovalDetailProps {
  approval: OperatorApproval;
  onClose: () => void;
}

/**
 * The "Open in full" view of one approval. Its title and the sentence under
 * it follow the card's rule (approvalTitle, sentenceUnderTitle): a row that
 * goes to TikTok names its networks, whatever reason it was stored with. A
 * long post scrolls inside the screen; the title, the X and Close stay on it
 * (ModalScrollBody). The raw call (a database statement, a REST call, a
 * setting) is under Action details here, closed, and never in the sentence
 * (2026-09-29), and never with an id or a key in it (2026-10-16).
 */
export const ApprovalDetail: React.FC<ApprovalDetailProps> = ({ approval: a, onClose }) => {
  const under = sentenceUnderTitle(a);
  return (
    <Modal isOpen onClose={onClose} title={approvalTitle(a)} size="lg">
      <ModalScrollBody
        label="The approval in full"
        footer={<Button size="sm" variant="outline" onClick={onClose}>Close</Button>}
      >
        {under && (
          <OperatorInline text={under} style={underTitleStyle(a)} />
        )}
        <TeamNoteLine sentence={sentenceOf(a)} as="div" />
        <ApprovalPreview approval={a} expanded />
        <ActionDetails approval={a} />
      </ModalScrollBody>
    </Modal>
  );
};

export default ApprovalCard;
