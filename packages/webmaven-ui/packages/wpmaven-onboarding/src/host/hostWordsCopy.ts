/**
 * Words the dashboard draws inside /create that are not the wizard's, kept
 * here so they live in the wizard's catalogs and read the visitor's language
 * (real-build check of 2026-11-03: a Spanish build read "Save your business
 * while it builds", "Use my email instead"):
 *
 *   saveCard  the host's sign-in slot (slots.SaveBusiness): the dashboard's
 *             "Save your business" card on a computer and its bottom sheet
 *             on a phone, with its sign-in (Continue with Google, or a code
 *             sent by email, then the authenticator's code where the account
 *             turned two-step sign-in on);
 *   helpChat  the help button beside the wizard (it opens the chat with the
 *             team).
 *
 * English is the source (the dashboard's own words, unchanged); the
 * dashboard reads SAVE_CARD_COPY and HELP_CHAT_COPY at render, from
 * @yotako/wpmaven-onboarding/shared. Its other pages are English, and so are
 * these words there.
 *
 * The sign-up's consent line ("I accept the terms and conditions", the EU
 * start-right-away consent, in its second version) is here too, so a save
 * card in another language reads it in that language, not in English. Its
 * words are versioned consent: the API records the version with the
 * sign-up, so each language has its own version (startNowConsentVersion): '2026-10-11.v2' for the English words,
 * '2026-10-11.v2.<language>' for a language's, and startNowConsentLine
 * says which language the words on the screen are in (English wherever a
 * catalog has no whole line). The API must know a language's version before
 * a dashboard that sends it is live: an API without it records nothing.
 */
import { getLanguage, localized } from '@yotako/webmaven-ui';

export const SAVE_CARD_COPY_EN = {
  /** The card's title, while the business builds and once it is finished. */
  title: {
    building: 'Save your business while it builds',
    ready: 'Save your business',
  },
  /** Under the title. */
  line: {
    building: "Free account, no card. We email you the link when it's ready, so you can close this page.",
    ready: 'No card needed. Your business, products, and plan are saved to your account.',
  },
  /** The email way, beside Continue with Google. */
  useMyEmail: 'Use my email instead',
  /** The email way's button, and while the code is asked for. */
  emailMeACode: 'Email me a code',
  sendingCode: 'Sending code...',
  /** The sheet's way out, and once saved (also the saved card's X, for a screen reader). */
  notNow: 'Not now',
  close: 'Close',
  /** The email field's name for a screen reader (the field shows only its example). */
  emailLabel: 'Email',
  /** The email field's example address. */
  emailPlaceholder: 'you@example.com',
  /** An address that is not one. */
  emailInvalid: 'Email is invalid',
  /** Saved: the title, and under it while it builds (`email` is the account's address). */
  savedTitle: 'Saved to your account',
  savedLineTo: (email: string) => `We'll email ${email} when your business is ready. You can close this message.`,
  savedLine: "We'll email you when your business is ready. You can close this message.",
  /** Signed in, and the business not saved to the account yet. */
  notSaved: 'You are signed in, but your business is not saved to your account yet. Try again.',
  tryAgain: 'Try again',
  /** Back to the first step of the sign-in. */
  startAgain: 'Start again',
  /** After Continue with Google, when the terms box was not ticked yet. */
  googleConsentIntro: 'You are continuing with Google. Tick the box below to create your account.',
  googleConsentSubmit: 'Create my account',
  /** Why the button is off: the terms box. */
  tickToContinue: 'Tick the box above to continue.',
  /** Said when the email is sent without the terms box ticked. */
  tickRequired: 'Tick the box to accept the terms and conditions, then continue.',
  /**
   * The sign-up's consent line beside its box (the start-right-away consent,
   * version 2): `link` is the part of `text`, word for word, that opens the
   * terms in a new tab.
   */
  consent: {
    text: 'I accept the terms and conditions',
    link: 'terms and conditions',
  },
  /** Between Continue with Google and the email way. */
  or: 'or',
  /** While Google's answer is checked. */
  signingIn: 'Signing you in...',
  /** The code sent by email. */
  code: {
    /** `email` is the address the code went to (drawn in bold). */
    sentTo: (email: string) => `We emailed a 6-digit code to ${email}. Enter it below; it expires in 10 minutes.`,
    spamHint: 'Not in your inbox? Check your Spam folder. The code often lands there.',
    label: 'Sign-in code',
    checking: 'Checking...',
    signIn: 'Sign in',
    /** Why Sign in is off. */
    enterCode: 'Enter the 6-digit code from the email to sign in.',
    differentEmail: 'Use a different email',
    /** `seconds` until a new code can be sent. */
    resendIn: (seconds: number) => `Resend in ${seconds}s`,
    sending: 'Sending...',
    resend: 'Resend code',
  },
  /** Two-step sign-in: the code from the authenticator app, or a recovery code. */
  secondStep: {
    appIntro: 'Enter the 6-digit code from your authenticator app.',
    recoveryIntro: 'Enter one of the recovery codes you saved when you turned on two-step sign-in. Each code works once.',
    appLabel: 'Authenticator code',
    recoveryLabel: 'Recovery code',
    useRecoveryCode: 'Use a recovery code',
    useAppCode: 'Use the code from your app',
    whyApp: 'Enter the 6-digit code from your authenticator app to sign in.',
    whyRecovery: 'Enter a recovery code to sign in.',
  },
};

/** SAVE_CARD_COPY_EN in the page's language. */
export const SAVE_CARD_COPY = localized(SAVE_CARD_COPY_EN, 'saveCard');

/** The version of the English consent words, recorded with the sign-up (the API's START_NOW_CONSENT_VERSION_V2). */
export const START_NOW_CONSENT_VERSION_V2 = '2026-10-11.v2';

/** The consent line as a screen shows it: its words, the part that opens the terms, and the language the words are in. */
export interface StartNowConsentLine {
  text: string;
  link: string;
  /** 'en', or the page's language when its catalog gives the whole line. */
  language: string;
}

/**
 * The consent line in the page's language: the catalog's words when they are
 * whole (both texts translated, the link's words inside the line's), else the
 * English line, so the words shown and the version recorded always agree.
 */
export function startNowConsentLine(): StartNowConsentLine {
  const en = SAVE_CARD_COPY_EN.consent;
  const language = getLanguage();
  if (language === 'en') return { ...en, language: 'en' };
  const { text, link } = SAVE_CARD_COPY.consent;
  const whole = typeof text === 'string' && typeof link === 'string' && text !== en.text && link !== en.link
    && link.trim().length > 0 && text.includes(link);
  return whole ? { text, link, language } : { ...en, language: 'en' };
}

/** The version the API records for a line in this language: the English words' version, or '<that>.<language>'. */
export function startNowConsentVersion(language: string): string {
  return !language || language === 'en' ? START_NOW_CONSENT_VERSION_V2 : `${START_NOW_CONSENT_VERSION_V2}.${language}`;
}

export const HELP_CHAT_COPY_EN = {
  /** The help button's name for a screen reader; `team` is the product's name (productName()). */
  label: (team: string) => `Chat with the ${team} team`,
  /** The same, when the team has replied. */
  labelReply: (team: string) => `Chat with the ${team} team: you have a reply`,
  /** Its tooltip. */
  title: (team: string) => `Questions? Chat with the ${team} team`,
};

/** HELP_CHAT_COPY_EN in the page's language. */
export const HELP_CHAT_COPY = localized(HELP_CHAT_COPY_EN, 'helpChat');
