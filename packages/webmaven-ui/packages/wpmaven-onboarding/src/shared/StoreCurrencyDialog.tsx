import React, { useCallback, useEffect, useId, useState } from 'react';
import { Button, Modal, Skeleton } from '@yotako/webmaven-ui';
import { WhyDisabled } from './WhyDisabled';
import {
  storeCurrencyRefusalOf,
  type StoreCurrencyApi,
  type StoreCurrencyChangeResult,
  type StoreCurrencyMode,
  type StoreCurrencyQuote,
} from '../api/storeCurrency';
import {
  STORE_CURRENCY_COPY,
  convertLabel,
  convertText,
  convertUnavailableText,
  dialogTitle,
  hasPricesLine,
  keepEitherWayLine,
  keepText,
  rateUnavailableLine,
  unsupportedKindsLine,
  type CurrencyNaming,
} from './storeCurrencyCopy';
import { useOptionalHost } from '../host/HostContext';
import { wizardApisFor } from '../wizard/wizardApis';

/**
 * "Change your store currency to British pounds (GBP)?" (store currency
 * contract 7.4, 7.5 and 10.3). Nothing changes until the owner confirms:
 * a store with prices must first choose what happens to them, Keep the same
 * numbers or Convert at today's rate, each shown with a price from their own
 * store. Convert says why when it cannot be chosen (no fresh rate, too many
 * prices, product kinds it cannot convert); Keep always works. The confirm
 * button says why it is off until a choice is made. A plugin with a currency
 * of its own (a booking calendar) is said too: what happens to it, and its
 * prices when the change relabels them (Keep keeps their numbers; Convert
 * leaves the plugin in its own currency), before anything changes.
 *
 * A two-choice dialog on the ui Modal: ConfirmDialog has no radios.
 */

const body: React.CSSProperties = { margin: 0, fontSize: 'var(--text-body, 14px)', lineHeight: 1.5, color: 'var(--text)' };
const dim: React.CSSProperties = { margin: 0, fontSize: 'var(--text-data, 13px)', lineHeight: 1.5, color: 'var(--text-dim)' };

type To = Pick<CurrencyNaming, 'code' | 'name'> & { digits?: number };

export interface StoreCurrencyDialogViewProps {
  /** The currency the owner picked. */
  to: To;
  /** The quote (examples, the rate, what Convert can do); null while it loads or when it failed. */
  quote: StoreCurrencyQuote | null;
  /** Why the quote did not load, with Try again. */
  loadError: string | null;
  choice: StoreCurrencyMode | null;
  busy: boolean;
  /** A refusal of the last confirm, in the owner's words. */
  error: string | null;
  /** The live currency changed elsewhere: nothing to confirm, only Close. */
  blocked: boolean;
  onChoose: (mode: StoreCurrencyMode) => void;
  onConfirm: () => void;
  onClose: () => void;
  onRetry: () => void;
}

/** What the confirm button and Convert say about themselves, from the quote and the choice. */
export function dialogButtons(p: { quote: StoreCurrencyQuote | null; choice: StoreCurrencyMode | null; busy: boolean; blocked: boolean; to: To }): {
  confirmDisabled: boolean;
  confirmWhy: string | null;
  convertDisabled: boolean;
  convertWhy: string | null;
} {
  const q = p.quote;
  const convertDisabled = !q || !q.convertAvailable;
  // Convert off always says why: the API's reason, else what the quote shows.
  // A missing rate names the currency whose rate is missing (the store's own
  // when it sells in Argentine or Chilean pesos, not the pick).
  const rateName = q?.rateUnavailableFor?.name ?? q?.to.name ?? p.to.name;
  const convertWhy = q && q.hasPrices && !q.convertAvailable
    ? convertUnavailableText(q.convertUnavailableReason, { toName: q.to.name, kinds: q.otherProductTypes, rateFresh: !!q.rate?.fresh, rateName })
      ?? (q.otherProductTypes.length ? unsupportedKindsLine(q.otherProductTypes) : rateUnavailableLine(rateName))
    : null;
  const needsChoice = !!q && q.hasPrices && !p.choice;
  return {
    confirmDisabled: !q || p.busy || p.blocked || needsChoice || (p.choice === 'convert' && convertDisabled),
    // Busy says itself (the button reads "Changing..."); blocked has its sentence above.
    confirmWhy: needsChoice && !p.busy && !p.blocked ? STORE_CURRENCY_COPY.chooseFirst : null,
    convertDisabled,
    convertWhy,
  };
}

export const StoreCurrencyDialogView: React.FC<StoreCurrencyDialogViewProps> = ({
  to, quote, loadError, choice, busy, error, blocked, onChoose, onConfirm, onClose, onRetry,
}) => {
  const confirmWhyId = useId();
  const convertWhyId = useId();
  const b = dialogButtons({ quote, choice, busy, blocked, to });
  const example = quote?.examples[0] ?? null;
  const toDigits = quote?.to.digits ?? to.digits ?? 2;
  const radio = (mode: StoreCurrencyMode, label: string, text: string, disabled: boolean, why: string | null) => (
    <div
      key={mode}
      data-testid={`store-currency-${mode}`}
      data-selected={choice === mode ? 'true' : undefined}
      style={{
        padding: '10px 12px', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 4,
        border: `1px solid ${choice === mode ? 'var(--text)' : 'var(--glass-border)'}`,
        background: 'var(--bg-raised)',
      }}
    >
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: disabled || busy ? 'not-allowed' : 'pointer' }}>
        <input
          type="radio"
          name="store-currency-mode"
          value={mode}
          checked={choice === mode}
          disabled={disabled || busy || blocked}
          aria-describedby={why ? convertWhyId : undefined}
          onChange={() => onChoose(mode)}
          data-testid={`store-currency-radio-${mode}`}
          style={{ marginTop: 4 }}
        />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, opacity: disabled ? 0.7 : 1 }}>
          <strong style={{ ...body, fontWeight: 600 }}>{label}</strong>
          <span style={dim}>{text}</span>
        </span>
      </label>
      {why && (
        <div style={{ paddingLeft: 26 }}>
          <WhyDisabled id={convertWhyId} reason={why} />
        </div>
      )}
    </div>
  );
  return (
    <Modal isOpen onClose={busy ? () => undefined : onClose} title={dialogTitle(to)} size="md">
      <div data-testid="store-currency-dialog" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!quote && !loadError && (
          <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton height={20} /><Skeleton height={64} /><Skeleton height={64} />
          </div>
        )}
        {!quote && loadError && (
          <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <span style={body}>{loadError}</span>
            <Button size="sm" variant="outline" onClick={onRetry}>{STORE_CURRENCY_COPY.tryAgain}</Button>
          </div>
        )}
        {quote && !quote.hasPrices && <p style={body}>{STORE_CURRENCY_COPY.noPrices}</p>}
        {quote && !quote.hasPrices && quote.pluginNotes.map((note) => (
          <p key={note} style={body} data-testid="store-currency-plugin-note">{note}</p>
        ))}
        {quote && quote.hasPrices && (
          <>
            <p style={body}>{hasPricesLine(quote.from)}</p>
            <div role="radiogroup" aria-label={dialogTitle(to)} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {radio('keep', STORE_CURRENCY_COPY.keepLabel, keepText(quote.to.name, example), false, null)}
              {radio(
                'convert',
                // The rate shows only when it is today's: never beside "not available".
                convertLabel(quote.rate?.text, !!quote.rate?.fresh),
                convertText(toDigits, b.convertDisabled ? null : example),
                b.convertDisabled,
                b.convertWhy,
              )}
            </div>
            {(quote.follows.coupons || quote.follows.shippingCosts) && <p style={dim}>{STORE_CURRENCY_COPY.follows}</p>}
            {quote.notConvertible.length > 0 && <p style={dim}>{keepEitherWayLine(quote.notConvertible)}</p>}
            {quote.pluginNotes.map((note) => (
              <p key={note} style={dim} data-testid="store-currency-plugin-note">{note}</p>
            ))}
          </>
        )}
        {error && (
          <p role="alert" data-testid="store-currency-error" style={{ ...body, color: 'var(--danger)' }}>{error}</p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <Button
            variant="primary"
            size="sm"
            isLoading={busy}
            disabled={b.confirmDisabled}
            aria-describedby={b.confirmWhy ? confirmWhyId : undefined}
            onClick={onConfirm}
            data-testid="store-currency-confirm"
          >
            {busy ? STORE_CURRENCY_COPY.changing : STORE_CURRENCY_COPY.confirmButton}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose} data-testid="store-currency-cancel">
            {blocked ? STORE_CURRENCY_COPY.close : STORE_CURRENCY_COPY.cancel}
          </Button>
          <WhyDisabled id={confirmWhyId} reason={b.confirmWhy} />
        </div>
      </div>
    </Modal>
  );
};

export interface StoreCurrencyDialogProps {
  instanceId: string;
  /** The currency the store sells in now, as the card read it. */
  from: string;
  to: To;
  /** Closed: with the change's result when it went through; `reload` asks the card to read the setting again. */
  onClose: (result: StoreCurrencyChangeResult | null, reload: boolean) => void;
  /** The calls: the app's (the dashboard's business page), else the wizard host's when the dialog is drawn inside it. */
  api?: Pick<StoreCurrencyApi, 'quote' | 'change'> | null;
  /** Where the change is reported: the app's tracker, else the wizard host's analytics. */
  track?: ((category: string, action: string, name?: string, value?: number) => void) | null;
}

/** The dialog wired to the API: the quote on open, the change on confirm, every refusal said in it. */
export const StoreCurrencyDialog: React.FC<StoreCurrencyDialogProps> = ({ instanceId, from, to, onClose, api: givenApi, track: givenTrack }) => {
  const host = useOptionalHost();
  const storeCurrencyApi = givenApi ?? (host ? wizardApisFor(host).storeCurrency : null);
  const trackEvent = givenTrack ?? ((category: string, action: string, name?: string, value?: number) => host?.analytics.track(category, action, name, value));
  const [quote, setQuote] = useState<StoreCurrencyQuote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<StoreCurrencyMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  /** Ask for the quote; `keepError` leaves the last refusal on screen (its sentence says what changed). */
  const loadQuote = useCallback(async (keepError = false) => {
    setLoadError(null);
    if (!keepError) setError(null);
    try {
      if (!storeCurrencyApi) throw new Error('the store currency dialog has no api');
      const q = await storeCurrencyApi.quote(instanceId, to.code);
      if (!q) {
        setQuote(null);
        setLoadError(STORE_CURRENCY_COPY.loadFailed);
        return;
      }
      setQuote(q);
      // A choice the new quote cannot honor is taken back.
      setChoice((c) => (c === 'convert' && !q.convertAvailable) || !q.hasPrices ? null : c);
    } catch (e) {
      setQuote(null);
      setLoadError(storeCurrencyRefusalOf(e, STORE_CURRENCY_COPY.loadFailed).text);
    }
  }, [instanceId, to.code]);

  useEffect(() => { void loadQuote(); }, [loadQuote]);

  const submitChange = async () => {
    if (!quote || busy || blocked) return;
    const mode = quote.hasPrices ? choice : null;
    if (quote.hasPrices && !mode) return;
    setBusy(true);
    setError(null);
    try {
      if (!storeCurrencyApi) throw new Error('the store currency dialog has no api');
      const result = await storeCurrencyApi.change(instanceId, {
        currency: to.code,
        ...(mode ? { mode } : {}),
        expectedFrom: quote.from.code || from,
        ...(mode === 'convert' && quote.rate?.date ? { rateDate: quote.rate.date } : {}),
        // The notes listed the prices a booking calendar (or another plugin
        // with its own currency) holds: with Keep they keep their numbers too.
        ...(quote.pluginPricesListed ? { pluginPricesShown: true } : {}),
      });
      trackEvent('store_currency', 'changed', `${quote.from.code}>${to.code}:${result?.mode ?? mode ?? 'none'}`);
      onClose(result, true);
    } catch (e) {
      const refusal = storeCurrencyRefusalOf(e, STORE_CURRENCY_COPY.notSaved);
      setError(refusal.text);
      switch (refusal.code) {
        case 'RATE_CHANGED':
          // The answer carries the new quote: the owner sees the new rate and confirms again.
          if (refusal.quote) {
            const q = refusal.quote;
            setQuote(q);
            setChoice((c) => (c === 'convert' && !q.convertAvailable) || !q.hasPrices ? null : c);
          } else {
            void loadQuote(true);
          }
          break;
        case 'STORE_CHANGED':
        case 'MODE_REQUIRED':
        case 'RATE_UNAVAILABLE':
        case 'TOO_MANY_PRICES':
        case 'UNSUPPORTED_PRODUCTS':
          void loadQuote(true);
          break;
        // Nothing more to confirm here: the store is not as the dialog read
        // it (changed elsewhere, still changing, or left partway with prices
        // that could not be put back). Another click would send the values
        // it holds now as "before" and convert them again; only Close, and
        // the card reads the store again.
        case 'CURRENCY_CHANGED':
        case 'NOT_RESTORED':
        case 'CHANGE_RUNNING':
        case 'CHANGE_UNCONFIRMED':
        case 'CLIENT_TIMEOUT':
        case 'CHANGE_IN_PROGRESS':
        case 'CURRENCY_UNREADABLE':
        case 'NO_STORE':
          setBlocked(true);
          break;
        default:
          break;
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <StoreCurrencyDialogView
      to={to}
      quote={quote}
      loadError={loadError}
      choice={choice}
      busy={busy}
      error={error}
      blocked={blocked}
      onChoose={(m) => { setChoice(m); setError(null); }}
      onConfirm={() => void submitChange()}
      onClose={() => onClose(null, blocked || !!error)}
      onRetry={() => void loadQuote()}
    />
  );
};

export default StoreCurrencyDialog;
