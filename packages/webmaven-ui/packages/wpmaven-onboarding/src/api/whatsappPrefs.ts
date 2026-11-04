/**
 * The owner's WhatsApp offers switch: reminders about an offer before it
 * ends (the annual offer's last two days, and any offer after it), on
 * WhatsApp. On by default for existing customers under
 * the EU soft opt-in, with the way out shown wherever it is used: this switch
 * in Settings, the "Stop offers" button on the reminder itself, or a typed
 * STOP OFFERS. It covers offers only: build updates, business alerts and
 * approvals keep coming on WhatsApp whatever it says.
 *
 *   GET /users/me/whatsapp-prefs  ->  { success, data: { offers, offersOptedOutAt, offersOptedOutVia, linked } }
 *   PUT /users/me/whatsapp-prefs  { offers: boolean }  ->  the same answer
 *
 * The API stores the opt-out per user (the "Stop offers" reply writes the same
 * one), so the switch shows what a reply on the phone did too.
 */
import { localized } from '@yotako/webmaven-ui';
import type { WizardTransport } from '../host/types';
import { inPageLanguage } from './pageLanguage';

export const WHATSAPP_PREFS_PATH = '/users/me/whatsapp-prefs';

/**
 * Said wherever a WhatsApp number is given (onboarding's WhatsApp step, the
 * Welcome page's "Finish linking your WhatsApp", Settings, Channels): offer
 * reminders come too, and how to stop them. The EU soft opt-in rests on
 * telling people at the moment they give their number. Here, not in a page, so onboarding does not load Settings.
 */
export const WHATSAPP_OFFERS_AT_LINK =
  'We may also remind you before an offer ends. Turn that off any time in Settings, Notifications, or reply STOP OFFERS.';

/** The switch's words, word for word (WHATSAPP_OFFERS_AT_LINK stays the English one). */
export const WHATSAPP_PREFS_EN = {
  offersAtLink: WHATSAPP_OFFERS_AT_LINK,
} as const;

/** Those words in the page's language (namespace 'whatsappPrefs'). */
export const WHATSAPP_PREFS = localized(WHATSAPP_PREFS_EN, 'whatsappPrefs');

export interface WhatsAppPrefs {
  /** Offers and reminders on WhatsApp. On unless the owner turned them off. */
  offers: boolean;
  /** When they were turned off; null while on (or on an API that does not say). */
  optedOutAt: string | null;
  /** Where: 'whatsapp' (the "Stop offers" reply) or 'settings'; null while on or unknown. */
  optedOutVia: 'whatsapp' | 'settings' | null;
  /** A WhatsApp number is linked; null when the API does not say. */
  linked: boolean | null;
}

/**
 * The switch as the API answered it. Only an explicit false is "off": the
 * default is on (soft opt-in), and a missing or unreadable value is the
 * default, never a silent opt-out. Null for an answer that is not one.
 */
export function whatsappPrefsOf(raw: unknown): WhatsAppPrefs | null {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!body || body.success === false) return null;
  const data = body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : null;
  if (!data) return null;
  const offers = data.offers !== false;
  const via = data.offersOptedOutVia;
  return {
    offers,
    optedOutAt: !offers && typeof data.offersOptedOutAt === 'string' ? data.offersOptedOutAt : null,
    optedOutVia: !offers && (via === 'whatsapp' || via === 'settings') ? via : null,
    linked: typeof data.linked === 'boolean' ? data.linked : null,
  };
}

/** The switch's calls on a host's transport. */
export function createWhatsappPrefsApi(hostTransport: WizardTransport) {
  // The page's language on every call (734 A): the api answers the owner in it.
  const transport = inPageLanguage(hostTransport);
  return {
    get: async (): Promise<WhatsAppPrefs> => {
      const data = await transport.request({ method: 'GET', path: WHATSAPP_PREFS_PATH });
      const prefs = whatsappPrefsOf(data);
      if (!prefs) throw new Error('WhatsApp preferences unreadable');
      return prefs;
    },
    /** Saves the switch; resolves with what the API stored. */
    setOffers: async (offers: boolean): Promise<WhatsAppPrefs> => {
      const data = await transport.request({ method: 'PUT', path: WHATSAPP_PREFS_PATH, body: { offers } });
      const prefs = whatsappPrefsOf(data);
      if (!prefs) throw new Error('WhatsApp preferences not saved');
      return prefs;
    },
  };
}
