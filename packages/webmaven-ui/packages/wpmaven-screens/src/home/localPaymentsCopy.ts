/**
 * The words of the local payment services in Turn on a way to get paid
 * (2026-11-16), in one module: English is the source. The translation
 * branch reads this object through its catalogs (namespace
 * screensLocalPayments), with the French written by hand.
 *
 * Plain words, one step per line: where to create the account, where to
 * copy the keys, where to paste them, and what happens next.
 */
import { localized } from '@yotako/webmaven-ui';

export const LOCAL_PAYMENTS_COPY_EN = {
  /** Under a service's name: what buyers pay with; the list is the service's own methods, joined in the page's language. */
  buyersPayWith: (methods: string) => `Your buyers pay with ${methods}.`,
  /** Under a service's name: the money is the owner's, paid into their account with that service. */
  ownAccount: (name: string) => `The money goes to your own ${name} account.`,
  /** Under a service's name, for one that also takes repeat payments for subscriptions. */
  renewsSubscriptions: 'It also renews subscriptions.',
  /** A service's button, before anything is set up. */
  connect: 'Connect',
  /** A service's button while it is half set up (installed, keys or its own page still to finish). */
  finishSetup: 'Finish setup',
  /** A small label beside a service connected with test keys, which take no real money. */
  testKeysOn: 'Connected with test keys',
  /** Step 1 of the form: the owner's account with the service. */
  stepAccount: (name: string) => `Create your ${name} account, or sign in to the one you have.`,
  /** The link after step 1, to the service's sign-up page. */
  openSignup: (name: string) => `Open ${name}`,
  /** Step 2 of the form: where the keys are, in the service's own dashboard. */
  stepKeys: (name: string) => `Copy your keys from your ${name} dashboard.`,
  /** The link after step 2, to the page of the service's dashboard that shows the keys. */
  openKeys: (name: string) => `Open your ${name} keys`,
  /** Step 3 of the form, above the boxes. */
  stepPaste: 'Paste each key in its box below.',
  /** Under the boxes: where the keys go; the argument is the product's name. */
  keysStayYours: (product: string) => `Your keys go straight to your own site. ${product} does not keep them.`,
  /** A link that switches the form to the service's test keys. */
  useTestKeys: 'Try it with test keys first',
  /** A link that switches the form back to the live keys. */
  useLiveKeys: 'Use my live keys instead',
  /** Shown while the form asks for test keys. */
  testKeysNote: (name: string) => `With test keys, ${name} takes no real money. Connect it again with your live keys when you are ready to sell.`,
  /** The form's button that sends the keys. */
  submit: (name: string) => `Connect ${name}`,
  /** The form's button that closes it without sending anything. */
  cancel: 'Cancel',
  /** Inside a secret key's box: shows what was pasted. */
  show: 'Show',
  /** Inside a secret key's box: hides what was pasted again. */
  hide: 'Hide',
  /** Under a box left empty when the form is sent. */
  pasteMissing: 'Paste this key here.',
  /** After the keys were sent: the service takes real payments now. */
  connectedLive: (name: string) => `${name} is connected. Your buyers can pay with it now.`,
  /** After test keys were sent. */
  connectedTest: (name: string) => `${name} is connected with test keys. It takes no real money until you connect it with your live keys.`,
  /** After the keys were sent, when the service still does not take payments. */
  savedNotTaking: (name: string) => `Your keys are saved on your site, but ${name} is not taking payments yet. Check that the keys are right and that a payment method is on in your ${name} account, then connect again.`,
  /** Under a service whose own plugin connects the account on its page in WordPress. */
  ownPage: (name: string) => `${name} connects your account on its own page in WordPress. We add it to your site, then open WordPress for you.`,
};

/** The words in the page's language (namespace screensLocalPayments; English when a catalog lacks a text). */
export const LOCAL_PAYMENTS_COPY = localized(LOCAL_PAYMENTS_COPY_EN, 'screensLocalPayments');
