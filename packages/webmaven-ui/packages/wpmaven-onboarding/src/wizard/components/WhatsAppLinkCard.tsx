/**
 * Number-first WhatsApp linking card: the shared surface used by
 * the onboarding's hidden WhatsApp step AND the Welcome page. The user
 * types their number and ticks consent; WE send a pre-approved template to
 * their phone; they just tap Confirm there. No codes anywhere.
 *
 * Talks to the API through the transport it is handed (the Welcome page's
 * signed-in client); the onboarding only captures the number (captureMode).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Loader, QRCode } from '@yotako/webmaven-ui';
import { useOptionalHost } from '../../host/HostContext';
import { WhyDisabled } from '../../shared/WhyDisabled';
import { whatsappSendBlocker } from '../../shared/guidance';
import { WHATSAPP_PREFS } from '../../api/whatsappPrefs';
import { OUR_NAME } from '../../shared/productName';
import { whatsappCountries, whatsappCountry } from '../../shared/whatsappCountries';
import { WHATSAPP_CARD, WHATSAPP_CARD_EN } from './whatsappCardCopy';

type Phase = 'idle' | 'sending' | 'waiting' | 'linked' | 'failed';

const POLL_MS = 2500;

/** The picker's countries: every country (shared/whatsappCountries), named
 *  and sorted in the page's language, with a national-format example used as
 *  the input placeholder; the flag is derived from the ISO code, and the API
 *  does the real parsing with this as the default country, so a national
 *  number with its leading 0 just works. */
const countries = whatsappCountries;

/** 🇫🇷 from "FR" — regional-indicator code points, no asset needed. */
function flagOf(iso: string): string {
  return iso.replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

/** A country of the picker, from an ISO code or a locale's region ("fr_FR", "fr-FR"), or null. */
function pickerCountry(code: string | null | undefined): string | null {
  return whatsappCountry(code);
}

function regionOf(locale: string | null | undefined): string | null {
  return pickerCountry(String(locale || '').replace(/-/g, '_').split('_')[1] || '');
}

/**
 * The country the picker starts on, before anyone picks one by hand: the
 * business's own country (where it is, from the onboarding), else the
 * WordPress locale's region ("fr_FR" → FR), else the browser language's
 * region ("fr-FR" → FR), and only then US. The account's GeoIP answer
 * comes later and replaces a guess, never the business's country.
 */
export function startingCountry(opts: {
  business?: string | null;
  wpLocale?: string | null;
  browserLanguage?: string | null;
}): string {
  return pickerCountry(opts.business) ?? regionOf(opts.wpLocale) ?? regionOf(opts.browserLanguage) ?? 'US';
}

/** The picker's start on this page (the site's WordPress locale, when the host builds onto a site, and the browser it runs in). */
function fallbackCountry(business: string | null | undefined, wpLocale: string | null | undefined): string {
  const browserLanguage = typeof navigator !== 'undefined' && typeof navigator.language === 'string' ? navigator.language : '';
  return startingCountry({ business, wpLocale: wpLocale || '', browserLanguage });
}

/** Pluggable backend: the dashboard passes a direct-API transport
 *  post-signup, and a capture-only stub in the wizard (no account to link
 *  yet - strategy doc 22). */
export interface WhatsAppTransport {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: (path: string) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  post: (path: string, body?: any) => Promise<any>;
}

/** No backend: every call answers nothing (a card given no transport links nothing). */
const defaultTransport: WhatsAppTransport = { get: async () => ({}), post: async () => ({}) };

/** The fallback's button, and what it says under the code (English; the card reads WHATSAPP_CARD). */
export const QR_FALLBACK_LABEL = WHATSAPP_CARD_EN.qrLabel;
export const QR_FALLBACK_HELP = WHATSAPP_CARD_EN.qrHelp;
export const QR_FALLBACK_FAILED = WHATSAPP_CARD_EN.qrFailed;

/**
 * Mint a linking QR code (POST whatsapp/link, the same code the Settings
 * page's fallback shows): its URL, or null when none came back.
 */
export async function mintLinkQr(transport: WhatsAppTransport): Promise<string | null> {
  try {
    const json = await transport.post('whatsapp/link');
    const url = json?.success ? json?.data?.qrUrl : null;
    return typeof url === 'string' && url ? url : null;
  } catch {
    return null;
  }
}

/**
 * When the confirmation message cannot be sent (a number WhatsApp refuses, a
 * send that failed), the owner can still link, for free, by scanning a code:
 * the card offers it right there instead of pointing to another page.
 */
export function QrFallback({ transport }: { transport: WhatsAppTransport }) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  if (qrUrl) {
    return (
      <div data-testid="whatsapp-qr-fallback" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
        <QRCode value={qrUrl} size={180} />
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-dim)' }}>{WHATSAPP_CARD.qrHelp}</p>
      </div>
    );
  }
  return (
    <div data-testid="whatsapp-qr-fallback" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Button
        variant="secondary"
        style={{ alignSelf: 'flex-start' }}
        isLoading={state === 'loading'}
        disabled={state === 'loading'}
        onClick={async () => {
          setState('loading');
          const url = await mintLinkQr(transport);
          if (url) setQrUrl(url);
          setState(url ? 'idle' : 'failed');
        }}
      >
        {WHATSAPP_CARD.qrLabel}
      </Button>
      {state === 'failed' && (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--rose, #e8919f)' }}>{WHATSAPP_CARD.qrFailed}</p>
      )}
    </div>
  );
}

export default function WhatsAppLinkCard({
  onLinked,
  transport = defaultTransport,
  captureMode = false,
  onCapture,
  initialPhone,
  successText,
  initialError,
  defaultCountry,
}: {
  onLinked?: () => void;
  transport?: WhatsAppTransport;
  /** Pre-signup: validate + hand the number (and the picker's country) to onCapture instead of sending. */
  captureMode?: boolean;
  onCapture?: (fullNumber: string, country: string) => void | Promise<void>;
  initialPhone?: string;
  successText?: string;
  /** Open on a failed send with this sentence (and the QR fallback). */
  initialError?: string;
  /** The business's own country (ISO alpha-2): the picker starts on it, over the locale, the
   *  browser and the account's GeoIP guess, but never over a country picked by hand. */
  defaultCountry?: string | null;
}) {
  const wpLocale = useOptionalHost()?.site?.locale ?? null;
  const [phase, setPhase] = useState<Phase>(initialError ? 'failed' : 'idle');
  const [phone, setPhone] = useState(initialPhone || '');
  const [country, setCountry] = useState<string>(() => fallbackCountry(defaultCountry, wpLocale));
  const businessCountry = pickerCountry(defaultCountry);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const requestIdRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  // GeoIP-detected country (persisted on the account) beats the WP-locale
  // guess, but never the business's own country, and never a country the
  // user already picked by hand.
  const countryTouchedRef = useRef(false);
  const businessCountryRef = useRef(businessCountry);
  businessCountryRef.current = businessCountry;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await transport.get('users/me/geo');
        const detected = String(json?.data?.country || '').toUpperCase();
        if (!cancelled && !countryTouchedRef.current && !businessCountryRef.current && countries().some((c) => c.iso === detected)) {
          setCountry(detected);
        }
      } catch {
        /* keep the locale fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // The business's country arriving after the card opened (the page read it
  // a moment later) still sets the picker, unless it was picked by hand.
  useEffect(() => {
    if (businessCountry && !countryTouchedRef.current) setCountry(businessCountry);
  }, [businessCountry]);

  const startPolling = useCallback((requestId: string) => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const json = await transport.get(`whatsapp/link/request/${requestId}`);
        if (!json?.success) return;
        const status = json.data?.status as string;
        if (status === 'CONFIRMED') {
          stopPolling();
          setPhase('linked');
          onLinked?.();
        } else if (status === 'DECLINED' || status === 'EXPIRED' || status === 'FAILED') {
          stopPolling();
          setError(
            json.data?.error ||
              (status === 'DECLINED'
                ? WHATSAPP_CARD.declined
                : WHATSAPP_CARD.expired),
          );
          setPhase('failed');
        }
      } catch {
        /* transient — next tick retries */
      }
    }, POLL_MS);
  }, [onLinked, stopPolling]);

  const send = useCallback(async () => {
    if (!phone.trim() || !consent) return;
    setPhase('sending');
    setError(null);
    if (captureMode) {
      try {
        await onCapture?.(phone.trim(), country);
        setPhase('linked');
        onLinked?.();
      } catch {
        setError(WHATSAPP_CARD.saveFailed);
        setPhase('failed');
      }
      return;
    }
    try {
      const json = await transport.post('whatsapp/link/request', { phoneNumber: phone.trim(), country, consent: true });
      if (json?.success && json.data?.status === 'SENT') {
        requestIdRef.current = json.data.requestId;
        setPhase('waiting');
        startPolling(json.data.requestId);
      } else {
        setError(json?.data?.error || json?.error || WHATSAPP_CARD.sendFailed);
        setPhase('failed');
      }
    } catch {
      setError(WHATSAPP_CARD.unreachable);
      setPhase('failed');
    }
  }, [phone, country, consent, startPolling, captureMode, onCapture, onLinked, transport]);

  if (phase === 'linked') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: '50%',
            background: 'color-mix(in srgb, var(--cyan) 20%, transparent)',
            border: '1px solid color-mix(in srgb, var(--cyan) 40%, transparent)',
            color: 'var(--cyan)', fontSize: 14,
          }}
          aria-hidden
        >
          ✓
        </span>
        <span style={{ fontSize: 14, color: 'var(--text)' }}>
          {successText || WHATSAPP_CARD.linked}
        </span>
      </div>
    );
  }

  if (phase === 'waiting') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Loader size={20} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {WHATSAPP_CARD.checkPhone}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--text-dim)' }}>
          {WHATSAPP_CARD.sentBefore}<strong>{WHATSAPP_CARD.confirmWord}</strong>{WHATSAPP_CARD.sentAfter}
        </p>
        <Button
          variant="ghost"
          style={{ alignSelf: 'flex-start', fontSize: 12 }}
          onClick={() => {
            stopPolling();
            setPhase('idle');
          }}
        >
          {WHATSAPP_CARD.startOver}
        </Button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{WHATSAPP_CARD.country}</span>
          <select
            value={country}
            aria-label={WHATSAPP_CARD.countryCode}
            onChange={(e) => {
              countryTouchedRef.current = true;
              setCountry(e.target.value);
            }}
            style={{
              height: 41,
              padding: '0 8px',
              fontSize: 14,
              fontFamily: 'inherit',
              color: 'var(--text)',
              background: 'var(--glass)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--r-md, 8px)',
              outline: 'none',
            }}
          >
            {countries().map((c) => (
              <option key={c.iso} value={c.iso}>
                {flagOf(c.iso)} {c.name} {c.dial}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 170 }}>
          <Input
            label={WHATSAPP_CARD.numberLabel}
            value={phone}
            placeholder={countries().find((c) => c.iso === country)?.example || '06 12 34 56 78'}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter') void send();
            }}
          />
        </div>
        <Button
          variant="primary"
          onClick={() => void send()}
          disabled={phase === 'sending' || !phone.trim() || !consent}
          isLoading={phase === 'sending'}
        >
          {captureMode ? WHATSAPP_CARD.saveNumber : WHATSAPP_CARD.sendConfirmation}
        </Button>
      </div>
      <WhyDisabled reason={phase === 'sending' ? null : whatsappSendBlocker(phone, consent)} />
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--text-dim)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        {/* The opt-in names the sender the messages really come from (our WhatsApp number), on every host. */}
        <span>{WHATSAPP_CARD.optIn(OUR_NAME)}</span>
      </label>
      {/* EU soft opt-in: offer reminders are on by default, so the way out
          is said where the number is given, in onboarding and on Welcome as
          in Settings. */}
      <p data-testid="whatsapp-offers-notice" style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>
        {WHATSAPP_PREFS.offersAtLink}
      </p>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>
        {WHATSAPP_CARD.typeHint}
      </p>
      {phase === 'failed' && error && (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--rose, #e8919f)' }}>
          {error}
        </p>
      )}
      {phase === 'failed' && !captureMode && <QrFallback transport={transport} />}
    </div>
  );
}
