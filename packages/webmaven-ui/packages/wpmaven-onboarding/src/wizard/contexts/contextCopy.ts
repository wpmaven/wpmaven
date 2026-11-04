/**
 * The sentences the wizard's state holds when the api sent none of its own:
 * the errors and notices the provider sets (OnboardingContext), and the build
 * theater's own lines. The api's sentences are shown as they come; these are
 * only ours. Read when the sentence is made, so it is in the page's language
 * at that moment.
 */
import { localized } from '@yotako/webmaven-ui';

export const CONTEXT_COPY_EN = {
  /** The theater's line when an update of the API stopped the build and it started again (BUILD_RESTARTED_LINE). */
  buildRestarted: 'We restarted your build. It takes a few minutes.',
  /** A press that never reached the API (PUBLISH_NOT_STARTED). */
  publishNotStarted: 'The publish did not start. Try again in a minute.',
  /** A check that could not start (SITE_CHECK_FAILED). */
  siteCheckFailed: 'We could not check your site just now. Try again in a minute.',
  readIdeaFailed: 'Something went wrong reading your idea. Try again.',
  forecastFailed: 'Could not load the forecast. Try again.',
  rerollsLimited: 'Rerolls are limited for this session. Pick one of the current directions.',
  directionsFailed: 'Could not make the design directions. Try again.',
  preparingPreview: 'Preparing your preview inside WordPress',
  buildFailedEvent: 'The build failed.',
  buildFailed: 'Something went wrong while your team was building the site. Your answers and your design choice are saved, so you can try again.',
  buildProblem: 'The build hit a problem. Please try again.',
  siteReady: 'Your site is ready!',
  wpStopped: 'WordPress stopped while it was starting in your browser',
  wpSilent: 'WordPress stopped responding for 150 seconds while it was starting in your browser',
  /** `reason` without its closing period. */
  wpPreviewFailed: (reason: string) => `Your site is built and saved, but its WordPress preview could not start: ${reason}.`,
  readSiteFailed: 'We could not read your site just now. Try again in a minute.',
  saveChoiceFailed: 'We could not save your choice just now. Try again in a minute.',
  saveBusinessFailed: 'We could not save your business just now. Try again in a minute.',
  saveListFailed: 'We could not save your list just now. Try again in a minute.',
  restoreFailed: 'We could not put your old design back just now. Try again in a minute.',
} as const;

/** The same, in the page's language (French in src/i18n, namespace 'context'). */
export const CONTEXT_COPY = localized(CONTEXT_COPY_EN, 'context');
