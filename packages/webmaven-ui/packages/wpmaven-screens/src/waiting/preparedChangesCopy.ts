/**
 * Changes your team prepared (PreparedChanges.tsx), a tab of Waiting for
 * you: product and blog post changes that a person on the owner's team (a
 * human team member, not the AI team) prepared, each waiting as a preview.
 * A card says what the change does, who sent it and when, with Publish,
 * Discard and a link to see it; after a press, one sentence says what
 * happened. In the page's language (French: src/i18n/fr.json, namespace
 * 'screensPreparedChanges').
 */
import { localized } from '@yotako/webmaven-ui';

export const PREPARED_CHANGES_COPY_EN = {
  /** A card's title when the change came without a summary (a change to a product of the owner's online shop). */
  aChange: 'A change to your store',
  /** Under a card's title: who on the team sent the change; {0} the person's name. */
  sentBy: (name: string) => `Sent by ${name}`,
  /** Who sent a change when the person's name is not known (then said as "Sent by A team member"). */
  aTeamMember: 'A team member',
  /** One changed field in a card's list; {0} the field ("Price"), {1} the value before, {2} the value after. */
  changed: (field: string, before: string, after: string) => `${field}: ${before} to ${after}`,
  /** A card's main button: puts the change live, exactly as previewed. */
  publish: 'Publish',
  /** A card's button: drops the change; nothing on the site changes. */
  discard: 'Discard',
  /** A card's link to where the change can be seen (the product, the blog). */
  seeIt: 'See it',
  /** Said where the card was, after Publish; {0} what the change did ("Kettle: price 18.00 to 14.00."). */
  published: (summary: string) => `Published: ${summary}`,
  /** Under a card when Publish failed. */
  publishFailed: 'This change was not published. Try again.',
  /** Said where the card was, after Discard; {0} what the change would have done, or "the change". */
  discarded: (summary: string) => `Discarded: ${summary}. Nothing on your site changed.`,
  /** Said in place of a change's summary when it has none ("Discarded: the change."). */
  theChange: 'the change',
  /** Under a card when Discard failed. */
  discardFailed: 'This change was not discarded. Try again.',
  /** Under a card when the site refused the change without saying why. */
  notThrough: 'This change did not go through. Nothing on your site changed.',
};

export const PREPARED_CHANGES_COPY = localized(PREPARED_CHANGES_COPY_EN, 'screensPreparedChanges');
