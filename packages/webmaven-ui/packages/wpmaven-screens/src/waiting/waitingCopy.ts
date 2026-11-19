/**
 * Waiting for you (WaitingForYou.tsx): the page where the owner decides
 * what their AI team wants to do (publish a post, change the website, spend
 * money), answers customers and sees alerts, the same screen in the
 * dashboard and in the WordPress plugin. Its title and the line under it,
 * the tab bar's name, the link to the next tab, the customers' card, the
 * alerts' labels, the empty page and what the page says when a call fails.
 * In the page's language (French: src/i18n/fr.json, namespace 'screensWaiting').
 */
import { localized } from '@yotako/webmaven-ui';

export const WAITING_COPY_EN = {
  /** The page's title (the menu entry has the same name). */
  title: 'Waiting for you',
  /** Under the title when nothing waits for the owner. */
  subtitleNothing: 'Nothing needs you right now. Your team keeps working, and anything they want to publish waits here for your yes.',
  /** Under the title when something waits for the owner's decision. */
  subtitleWaiting: 'Your team keeps working while these wait. Nothing is published until you say so.',
  /** The tab bar's name, read by screen readers. */
  tabsLabel: 'What waits for you',
  /**
   * Under a tab whose last item was just dealt with: the link to the next
   * tab that has something; {0} that tab's label with its count ("Worth fixing (3)").
   */
  next: (tab: string) => `Next: ${tab}`,
  /** The button beside a failure message; it loads the page again. */
  tryAgain: 'Try again',
  /** When nothing on the page could be loaded. */
  loadFailed: 'We could not load what is waiting for you.',
  /** When Approve or Decline did not go through. */
  decisionFailed: 'That decision did not go through. Try again.',
  /** When the owner's request for changes did not go through. */
  notThrough: 'That did not go through. Try again.',
  /** When canceling an approved item that was waiting did not go through. */
  notThroughReload: 'That did not go through. Reload and try again.',
  /**
   * The customers' tab: how many customer conversations can still be
   * answered, and why it is urgent (Meta, which runs Facebook and Instagram,
   * closes a conversation 24 hours after the customer's last message); {0}
   * the count, {1} the Facebook or Instagram account's name.
   */
  customersOpen: (count: number, account: string) => `${count} ${count === 1 ? 'conversation is' : 'conversations are'} still open on ${account}. Meta closes each one 24 hours after the customer's last message.`,
  /** The customers' card's button: opens the conversations, where the owner replies. */
  readAndReply: 'Read and reply',
  /** The page when nothing at all waits. */
  nothingWaiting: 'Nothing is waiting. This is what a good week looks like.',
  /** The empty page's button: opens Home, where the team's week shows. */
  seeTeam: 'See what your team is doing',
  /** An alert's label (a small pill), for a critical alert. */
  urgent: 'Urgent',
  /** An alert's label (a small pill), for a warning. */
  needsAttention: 'Needs attention',
  /** An alert's label (a small pill), for an alert that only informs. */
  information: 'Information',
};

export const WAITING_COPY = localized(WAITING_COPY_EN, 'screensWaiting');
