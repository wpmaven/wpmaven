/**
 * "Check what your site says about you", a card in Home's side column
 * (BusinessDetailsPrompt.tsx, the dashboard's Home and the WordPress
 * plugin's Overview) until the owner has saved the business's contact
 * details once: the details the site shows to reach the business. The
 * dashboard reads these words too.
 *
 * English is the source; the French is written by hand (src/i18n/fr.json,
 * namespace screensBusinessDetails), the other languages by the dashboard's
 * translation script.
 */
import { localized } from '@yotako/webmaven-ui';

export const BUSINESS_DETAILS_PROMPT_COPY_EN = {
  /** The card's title. */
  title: 'Check what your site says about you',
  /** The card's line. */
  body: 'Your name, phone, email, address, and opening hours: your site uses them wherever it shows how to reach you. Check them once, so customers reach the right place.',
  /** The card's button: opens the business details to check them. */
  button: 'Check my details',
} as const;

export const BUSINESS_DETAILS_PROMPT_COPY = localized(BUSINESS_DETAILS_PROMPT_COPY_EN, 'screensBusinessDetails');
