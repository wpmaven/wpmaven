/**
 * Feature my business on the product's own channels, a box under Share your
 * site on Home (FeatureOnWpmaven.tsx): the owner chooses whether the product
 * announces their new business on its own public social accounts (only the
 * business's name and link), and the line under the box says what happened.
 * The owner's own launch post on their X account always waits for their
 * approval. {places} carry the product's name ("WPMaven"), kept as written.
 *
 * English is the source; the French is written by hand (src/i18n/fr.json,
 * namespace screensFeatureOnWpmaven), the other languages by the dashboard's
 * translation script.
 */
import { localized } from '@yotako/webmaven-ui';
import { productName } from '@yotako/wpmaven-onboarding/shared';

export const FEATURE_COPY_EN = {
  /** The box's label; {0} the product's name. */
  labelFor: (product: string) => `Feature my business on ${product}’s channels`,
  /** labelFor with the product's name (not a text of its own). */
  get label(): string {
    return this.labelFor(productName());
  },
  /** Under the box: what is posted, and that nothing leaves the owner's own accounts without their approval; {0} the product's name. */
  explainerFor: (product: string) => `We post your business name and its link on ${product}’s own accounts, only while this box is ticked. Nothing goes out from your own accounts without your approval.`,
  /** explainerFor with the product's name (not a text of its own). */
  get explainer(): string {
    return this.explainerFor(productName());
  },
  /** After the explainer. */
  turnOff: 'Turn it off here anytime.',
  /** Under the box once ticked: posted on the product's X account; {0} the product's name. */
  postedFor: (product: string) => `Posted on ${product}’s X account.`,
  /** Under the box once ticked (more may follow). */
  saved: 'Saved.',
  /** Under the box once ticked, before the product's channel is live; {0} the product's name. */
  savedLaterFor: (product: string) => `Saved. It will be posted when ${product}’s channel goes live.`,
  /** The owner's own launch post on X waits for their approval (a link to it follows). */
  ownWaiting: 'Your own X launch post is waiting for your approval.',
  /** The same inside WordPress, naming where to approve it; {0} the product's name. */
  ownWaitingPluginFor: (product: string) => `Your own X launch post is waiting for your approval in your ${product} dashboard, under Your team, then Approvals.`,
  /** The owner's own launch post went out. */
  ownPosted: 'Your launch post is on your own X account.',
  /** After unticking the box; {0} the product's name. */
  turnedOffFor: (product: string) => `Turned off. ${product}’s accounts will not post anything new about your business.`,
  /** The choice could not be saved. */
  saveFailed: 'Could not save your choice. Try again.',
  /** The link to the waiting launch post. */
  reviewNow: 'Review it now',
};

export const FEATURE_COPY = localized(FEATURE_COPY_EN, 'screensFeatureOnWpmaven');
