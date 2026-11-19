/**
 * What an approval would publish, drawn where the owner decides
 * (ApprovalPreview.tsx, on every approval card and on Home): the video in a
 * player, the pictures, the post's whole text, a shared video's second post,
 * the networks it goes to, and an email campaign the team asks to send.
 *
 * English is the source; the French is written by hand (src/i18n/fr.json,
 * namespace screensApprovalPreview), the other languages by the dashboard's
 * translation script.
 */
import { localized } from '@yotako/webmaven-ui';

export const APPROVAL_PREVIEW_COPY_EN = {
  /** Under an email campaign's subject: the owner already got a test copy. */
  campaignTestCopy: 'A test copy is in your inbox. It goes to everyone who agreed to get your emails.',
  /** The link to the email's own page, where it can be read in full and changed. */
  openEmail: 'Open the email',
  /** An approval with nothing to show. */
  nothingToPreview: 'Nothing to preview.',
  /** Above a shared video's second post, which goes out on other networks with a link to the video; {0} those networks ("Facebook and LinkedIn"). */
  thenOn: (networks: string) => `Then on ${networks}:`,
  /** In that second post, where the link to the video will be (in square brackets, as the post shows it). */
  videoLink: '[link to the video]',
  /** The video could not be played in the card. */
  videoFailed: 'This video could not be played here.',
  /** The link to the video file. */
  openVideo: 'Open the video',
  /** The small link under the player. */
  openVideoNewTab: 'Open video in a new tab',
  /** A picture that could not be loaded: its link. */
  imageFailed: 'Image could not be loaded. Open it',
  /** Under a long post cut to three lines: shows the rest. */
  showMore: 'Show more',
  /** The same once open: cuts it short again. */
  showLess: 'Show less',
  /** Before the networks a post goes to (their logos follow). */
  goesTo: 'Goes to',
  /** A network chip whose network is not known. */
  unknownNetwork: 'Unknown',
};

export const APPROVAL_PREVIEW_COPY = localized(APPROVAL_PREVIEW_COPY_EN, 'screensApprovalPreview');
