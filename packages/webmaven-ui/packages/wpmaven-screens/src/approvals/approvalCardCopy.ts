/**
 * One approval card (ApprovalCard.tsx), on Waiting for you and on Your
 * team, in the dashboard and in the WordPress plugin: who on the AI team
 * asks, the work itself (a post, a video, a change to the website), and the
 * owner's decision: Approve, Request changes (a note box for what should be
 * different), Decline, the full view. In the plugin some cards are decided
 * in the dashboard or by the account's owner only, and an approved card can
 * wait for the plan's monthly actions (the plan's allowance of work). In the
 * page's language (French: src/i18n/fr.json, namespace 'screensApprovalCard').
 */
import { localized } from '@yotako/webmaven-ui';

export const APPROVAL_CARD_COPY_EN = {
  /** Above the card: who on the AI team asks; {0} the role's title ("Social Media Manager", "Web Designer"). */
  yourMember: (title: string) => `Your ${title}`,
  /** The card's main button: says yes to the work, which then goes ahead. */
  approve: 'Approve',
  /** The main button's words while the decision is being sent. */
  working: 'Working…',
  /** The card's button that opens a note box to ask the team for a new version. */
  requestChanges: 'Request changes',
  /** The card's button that turns the work down (the owner declines their own team's work). */
  decline: 'Decline',
  /** The card's button that opens the whole work in a dialog. */
  openFull: 'Open in full',
  /** Before the task the work belongs to ("Part of: Weekly blog post"). */
  partOf: 'Part of:',
  /** Under the work when the team rewrote it after the owner's notes; {0} the version's number (2, 3...). */
  version: (n: number) => `Version ${n}, rewritten after your notes.`,
  /** The owner's last note, quoted; {0} the note as they wrote it. */
  youAskedFor: (note: string) => `You asked for: “${note}”`,
  /** The note box's label, under the buttons. */
  noteLabel: 'What should be different? Write it the way you would say it.',
  /** The note box's example, shown while it is empty. */
  notePlaceholder: 'Shorter, and mention that we open on Saturdays.',
  /** The send button's words while the note is being sent. */
  sending: 'Sending…',
  /** The button that sends the note to the AI team, which makes a new version. */
  sendToTeam: 'Send to your team',
  /** Closes the note box without sending. */
  cancel: 'Cancel',
  /** Beside the send button while the note box is empty: why it cannot be pressed. */
  noteWhy: 'Write what should be different, then send it.',
  /** In the WordPress plugin: the link to this card in the dashboard. */
  openInDashboard: 'Open in your dashboard',
  /** In the WordPress plugin, in place of Approve on a post to TikTok or an upload to YouTube. */
  approveInDashboard: 'Posts to TikTok and uploads to YouTube are approved in your dashboard, where their settings are chosen.',
  /** In the WordPress plugin, in place of the buttons on a card about money, for a person who is not the account's owner. */
  ownerOnly: "Only the account's owner decides payments.",
  /** In the WordPress plugin, on an approved card that waits for the plan's monthly actions. */
  siteHeld: "This waits for your plan's actions. See your dashboard.",
  /** On an approved card that waits: the button to the plan's billing page. */
  openBilling: 'Open billing',
  /** When canceling an approved card that waits did not go through. */
  cancelFailed: 'That did not go through. Reload and try again.',
  /** The full view's scrolling area, read by screen readers. */
  fullLabel: 'The approval in full',
  /** The full view's button that closes it. */
  close: 'Close',
};

export const APPROVAL_CARD_COPY = localized(APPROVAL_CARD_COPY_EN, 'screensApprovalCard');
