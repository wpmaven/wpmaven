/**
 * The WhatsApp linking card's words (WhatsAppLinkCard), word for word; the
 * card reads them in the page's language (namespace 'whatsappCard').
 */
import { localized } from '@yotako/webmaven-ui';

export const WHATSAPP_CARD_EN = {
  /** The fallback's button, and what it says under the code. */
  qrLabel: 'Scan a QR code instead',
  qrHelp: 'Scan it with WhatsApp on your phone to connect. It links for free.',
  qrFailed: 'We could not make a QR code just now. Try again, or link from Settings later.',
  declined: 'The confirmation was declined on that phone.',
  expired: 'The confirmation expired. Send a new one.',
  saveFailed: 'We could not save the number. Try again.',
  sendFailed: 'We could not send the confirmation. Check the number.',
  unreachable: 'We could not reach the server. Try again.',
  linked: 'WhatsApp linked. Your team can reach you there now.',
  checkPhone: 'Check your phone',
  /** "We sent you a WhatsApp message. Open it and tap <strong>Confirm</strong>. This screen updates by itself." */
  sentBefore: 'We sent you a WhatsApp message. Open it and tap ',
  confirmWord: 'Confirm',
  sentAfter: '. This screen updates by itself.',
  startOver: 'Wrong number? Start over',
  country: 'Country',
  countryCode: 'Country code',
  numberLabel: 'Your WhatsApp number',
  saveNumber: 'Save my number',
  sendConfirmation: 'Send confirmation',
  /** The opt-in names the sender the messages really come from (our WhatsApp number). */
  optIn: (sender: string) => `Send me ${sender} messages on WhatsApp (build updates, business alerts and chat).`,
  typeHint: 'Type it like you dial it (the leading 0 is fine). We send one message; you tap Confirm on your phone. No codes to type.',
} as const;

export const WHATSAPP_CARD = localized(WHATSAPP_CARD_EN, 'whatsappCard');
