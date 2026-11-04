/**
 * What the api calls say when the api sent no sentence of its own: the build
 * limit's card text and fix, and the fallbacks of a refusal. The api's own
 * sentences are shown as they come; these are only ours.
 */
import { localized } from '@yotako/webmaven-ui';

export const API_COPY_EN = {
  /** The API's own BUILD_LIMIT_TEXT and its fix. */
  buildLimitText: 'You built 3 previews. Start your plan to build another.',
  buildLimitFix: 'See plans',
  /** The API's own PAYMENT_FAILED text and its fix. */
  paymentFailedText: 'Your last payment did not go through, so chat and your team are paused. Update your card to restart them.',
  paymentFailedFix: 'Update your card',
  somethingWrong: 'Something went wrong. Try again.',
  confirmAnalysisFailed: 'Could not confirm the analysis',
  saveStyleFailed: 'Could not save the style',
  saveNumberFailed: 'Could not save the number',
  checkSiteFirst: 'Check your site first, then save your business.',
  saveBusinessFailed: 'We could not save your business just now. Try again in a minute.',
  readSiteFailed: 'We could not read your site just now. Try again in a minute.',
  noEarlierDesign: 'There is no earlier design to go back to.',
  restoreFailed: 'We could not put your old design back just now. Try again in a minute.',
  setupReadFailed: 'The setup could not be read just now. Try again in a minute.',
} as const;

/** The same, in the page's language (French in src/i18n, namespace 'api'). */
export const API_COPY = localized(API_COPY_EN, 'api');
