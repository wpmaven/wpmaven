/**
 * Store currency: every sentence the dashboard says about the currency a
 * store sells in, word for word as the API's store currency rules have them,
 * built here and nowhere else so the screens and the tests read the same
 * words.
 *
 * A store sells in one currency: the one the owner saw at setup (the plan's
 * currency, from their country), changed only by the owner, on the setup
 * confirm step before the build or with Store currency on the business page
 * after it. Shoppers' prices never change without the owner choosing Keep
 * or Convert.
 *
 * Pure: lib/productName, and webmaven-ui's language helper (the page's
 * language: the namespaces 'storeCurrency' and 'storeCurrencySentences' of
 * the translations, the currencies named by their code there).
 */
import { formatDate, getLanguage, localized, localeTag } from '@yotako/webmaven-ui';
import { productName } from './productName';
import { formatTag } from './copyLanguage';

/** One offered currency, as GET /api/store-currencies serves it. */
export interface CurrencyNaming {
  /** ISO 4217 ("EUR"). */
  code: string;
  /** Plural lowercase English name used in sentences ("euros", "US dollars"). */
  name: string;
  /** The name with its first letter capitalized ("Euros", "US dollars"). */
  label: string;
  /** Decimal digits of a price: 0 for JPY, KRW and CLP, 2 for the rest. */
  digits: number;
}

/**
 * The offered currencies with their sentence names, the same 27 the API
 * serves (the UAE dirham and the Philippine peso since 2026-10-20, the
 * Israeli new shekel since 2026-10-21). The screens use
 * the API's list; this one only fills in until it arrives or when it cannot
 * be read, so a line never says "Prices in EUR (EUR)".
 */
export const STORE_CURRENCY_FALLBACK: readonly CurrencyNaming[] = [
  { code: 'USD', name: 'US dollars', label: 'US dollars', digits: 2 },
  { code: 'EUR', name: 'euros', label: 'Euros', digits: 2 },
  { code: 'GBP', name: 'British pounds', label: 'British pounds', digits: 2 },
  { code: 'CAD', name: 'Canadian dollars', label: 'Canadian dollars', digits: 2 },
  { code: 'AUD', name: 'Australian dollars', label: 'Australian dollars', digits: 2 },
  { code: 'NZD', name: 'New Zealand dollars', label: 'New Zealand dollars', digits: 2 },
  { code: 'JPY', name: 'Japanese yen', label: 'Japanese yen', digits: 0 },
  { code: 'CHF', name: 'Swiss francs', label: 'Swiss francs', digits: 2 },
  { code: 'SEK', name: 'Swedish kronor', label: 'Swedish kronor', digits: 2 },
  { code: 'NOK', name: 'Norwegian kroner', label: 'Norwegian kroner', digits: 2 },
  { code: 'DKK', name: 'Danish kroner', label: 'Danish kroner', digits: 2 },
  { code: 'PLN', name: 'Polish zlotys', label: 'Polish zlotys', digits: 2 },
  { code: 'CZK', name: 'Czech korunas', label: 'Czech korunas', digits: 2 },
  { code: 'HUF', name: 'Hungarian forints', label: 'Hungarian forints', digits: 2 },
  { code: 'RON', name: 'Romanian lei', label: 'Romanian lei', digits: 2 },
  { code: 'BRL', name: 'Brazilian reals', label: 'Brazilian reals', digits: 2 },
  { code: 'MXN', name: 'Mexican pesos', label: 'Mexican pesos', digits: 2 },
  { code: 'INR', name: 'Indian rupees', label: 'Indian rupees', digits: 2 },
  { code: 'ZAR', name: 'South African rand', label: 'South African rand', digits: 2 },
  { code: 'SGD', name: 'Singapore dollars', label: 'Singapore dollars', digits: 2 },
  { code: 'HKD', name: 'Hong Kong dollars', label: 'Hong Kong dollars', digits: 2 },
  { code: 'KRW', name: 'South Korean won', label: 'South Korean won', digits: 0 },
  { code: 'ARS', name: 'Argentine pesos', label: 'Argentine pesos', digits: 2 },
  { code: 'CLP', name: 'Chilean pesos', label: 'Chilean pesos', digits: 0 },
  { code: 'AED', name: 'UAE dirhams', label: 'UAE dirhams', digits: 2 },
  { code: 'PHP', name: 'Philippine pesos', label: 'Philippine pesos', digits: 2 },
  { code: 'ILS', name: 'Israeli new shekels', label: 'Israeli new shekels', digits: 2 },
];

/** A code as the screens compare a CHOICE (the plan's currency, a pick):
 *  trimmed, upper case, and Bulgaria's old lev read as the euro it became on
 *  January 1, 2026. */
export function normalizeCurrencyCode(code: unknown): string {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
  return c === 'BGN' ? 'EUR' : c;
}

/**
 * A code as a LIVE STORE holds it (the business page's setting, the quote,
 * a change's result): trimmed and upper case only. A store still selling in
 * lev sells in lev, and the change is sent from the currency it really
 * holds; reading it as euros refused every change (CURRENCY_CHANGED).
 */
export function liveCurrencyCode(code: unknown): string {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

/**
 * Price decimals of a currency: for an offered code (the lev reads as the
 * euro), the list's, which are the API's stored ones (0 for JPY, KRW and CLP,
 * 2 for the rest). Never the browser's currency data for these: it moves
 * between releases (CLDR 48 gives the Hungarian forint 0 where the API, the
 * plugin and the store use 2). Another code: from Intl, 2 when Intl does not
 * know it.
 */
export function currencyDigits(code: unknown): number {
  const offered = STORE_CURRENCY_FALLBACK.find((o) => o.code === normalizeCurrencyCode(code));
  if (offered) return offered.digits;
  try {
    const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency: normalizeCurrencyCode(code) })
      .resolvedOptions().maximumFractionDigits;
    return typeof digits === 'number' ? digits : 2;
  } catch {
    return 2;
  }
}

/** The naming of a code: from the given list first, the built-in one second. */
export function currencyNaming(code: unknown, list?: readonly CurrencyNaming[] | null): CurrencyNaming | null {
  const c = normalizeCurrencyCode(code);
  if (!c) return null;
  return (list ?? []).find((o) => o.code === c) ?? STORE_CURRENCY_FALLBACK.find((o) => o.code === c) ?? null;
}

/**
 * A currency's name in the page's language: on an English page the name it
 * came with (the API's "euros", "US dollars"); on another page the name of
 * its code in that language (French plurals for the offered codes, else the
 * browser's name for the code), found by the code, or by the English name
 * when only the name came ("US dollars" reads "dollars américains").
 */
export function sayCurrencyName(n: { code?: unknown; name: string }): string {
  if (getLanguage() === 'en') return n.name;
  const byName = STORE_CURRENCY_FALLBACK.find((o) => o.name.toLowerCase() === n.name.trim().toLowerCase())?.code;
  // As the store holds it (a store in lev is named in lev), never read as a choice.
  const code = liveCurrencyCode(n.code) || byName || liveCurrencyCode(n.name);
  const names = STORE_CURRENCY_SENTENCES.names;
  const said = names[code] ?? (byName ? names[byName] : undefined);
  if (said) return said;
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      const shown = new Intl.DisplayNames(localeTag(), { type: 'currency' }).of(code);
      if (shown && shown !== code) return shown;
    } catch {
      /* the runtime does not name it */
    }
  }
  return n.name;
}

/** The name as an option label ("Euros", "Dollars américains"): English keeps the label it came with. */
export function sayCurrencyLabel(n: { code?: unknown; name: string; label: string }): string {
  if (getLanguage() === 'en') return n.label;
  const name = sayCurrencyName(n);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** The currency's name for a sentence; the bare code when it is not offered. */
export function currencyName(code: unknown, list?: readonly CurrencyNaming[] | null): string {
  const naming = currencyNaming(code, list);
  return naming ? sayCurrencyName(naming) : normalizeCurrencyCode(code);
}

/** "A", "A and B", "A, B and C". */
export function listText(items: readonly string[]): string {
  const xs = items.map((s) => s.trim()).filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? '';
  return STORE_CURRENCY_SENTENCES.and(xs.slice(0, -1).join(', '), xs[xs.length - 1]);
}

/** Fixed sentences, and the words of every sentence built below. */
export const STORE_CURRENCY_COPY_EN = {
  // 10.1 The setup confirm step.
  change: 'Change',
  selectLabel: 'Store currency',
  confirmHelp: "Your store sells in this currency. Changing it converts the prices below at today's rate, and you can still edit any price.",
  confirmSaving: 'Converting your prices...',
  confirmFailed: 'The currency did not change. Please try again.',
  unsupported: 'That currency is not available for stores yet.',
  // 10.2 The business page card.
  cardTitle: 'Store currency',
  cardLead: 'The currency your store sells in. Product prices, the cart and checkout all use it.',
  pickerLabel: 'New currency',
  continue: 'Continue',
  cancel: 'Cancel',
  pickFirst: 'Pick the currency your store should sell in.',
  loadFailed: 'The store currency did not load.',
  tryAgain: 'Try again',
  whyNotImpersonation: 'Only the owner can change the store currency. From a view-as session this setting can only be read.',
  whyNotMember: 'Only the account owner or an admin can change the store currency.',
  whyNotUnreachable: 'We could not reach your site just now, so its currency cannot be changed. Try again in a minute.',
  get whyNotPluginTooOld(): string {
    return STORE_CURRENCY_SENTENCES.whyNotPluginTooOldFor(productName());
  },
  // 10.3 The dialog.
  noPrices: 'Your store has no prices yet, so only the currency changes.',
  keepLabel: 'Keep the same numbers',
  convertLabelBare: "Convert at today's rate",
  // Coupons: a fixed amount, and the minimum and maximum spend of any coupon (a 15% stays 15%).
  follows: 'Coupons and shipping costs follow the same choice, converted without rounding.',
  tooManyPrices: 'Your store has more than 2,000 prices, too many to convert here. Keep the same numbers, or change them in WooCommerce.',
  confirmButton: 'Change currency',
  chooseFirst: 'Choose Keep the same numbers or Convert first.',
  changing: 'Changing...',
  // 10.4 Refusals of the change, by the API's code.
  currencyChanged: "Your store's currency was changed somewhere else while you were deciding. Nothing was changed. Close this and check the current currency.",
  storeChanged: "Your store's prices changed while you were deciding. Nothing was changed. Try again to see the new prices.",
  rateChanged: "Today's rate was just updated. Nothing was changed. Check the new rate and confirm again.",
  rateUnavailable: "Today's rate is not available right now. Nothing was changed. Try again later, or keep the same numbers.",
  get pluginTooOld(): string {
    return STORE_CURRENCY_SENTENCES.pluginTooOldFor(productName());
  },
  siteUnreachable: 'We could not reach your site. Nothing was changed. Try again in a minute.',
  notSaved: 'Your site did not save the change, so nothing was changed. Try again, or contact us if it keeps happening.',
  changeInProgress: 'A currency change for this store is already running. Wait a moment and check again.',
  modeRequired: "Choose Keep the same numbers or Convert at today's rate.",
  // The change answered late or not at all: never "nothing was changed" unless the site says so.
  changeRunning: 'Your store is still changing its currency. This can take a few minutes on a large store. Check this card again in a few minutes.',
  changeUnconfirmed: 'Your site did not answer in time, so we cannot tell yet whether the currency changed. Check this card again in a minute before you try again.',
  stillWorking: 'This is taking longer than usual, and your store may still be changing its currency. Close this and check the card again in a minute before you try again.',
  currencyUnreadable: 'We could not read the currency your store sells in now, so it cannot be changed here. Set it in WooCommerce first (WooCommerce, then Settings).',
  close: 'Close',
} as const;

/** The fixed sentences in the page's language (namespace 'storeCurrency'). */
export const STORE_CURRENCY_COPY = localized(STORE_CURRENCY_COPY_EN, 'storeCurrency');

/** The words of the sentences built below (names, codes and examples filled in), word for word. */
export const STORE_CURRENCY_SENTENCES_EN = {
  /** "A, B and C": the list's head and its last item. */
  and: (head: string, last: string) => `${head} and ${last}`,
  /** The offered currencies by code, as a sentence names them (the API's English names). */
  names: Object.fromEntries(STORE_CURRENCY_FALLBACK.map((c) => [c.code, c.name])) as Record<string, string>,
  whyNotPluginTooOldFor: (name: string) => `Changing the currency needs the next ${name} plugin update on this site. The plugin updates itself automatically; try again after it has.`,
  pluginTooOldFor: (name: string) => `Nothing was changed: changing the currency needs the next ${name} plugin update on this site. The plugin updates itself automatically; try again after it has.`,
  pricesIn: (name: string, code: string) => `Prices in ${name} (${code})`,
  optionLabel: (label: string, code: string) => `${label} (${code})`,
  todaysRate: "today's rate",
  rateOf: (date: string) => `the rate of ${date}`,
  pricesConverted: (fromName: string, at: string, rateText: string) => `Prices converted from ${fromName} at ${at} (${rateText}). You can still edit any price.`,
  buildStarted: (name: string, code: string) => `Your site is already being built in ${name} (${code}). Once it is live, you can change the currency on your business page, under Store currency.`,
  existingStoreLead: (name: string, code: string) => `Your store already sells in ${name} (${code}) and has prices.`,
  keepStoreLabel: (name: string, code: string) => `Keep ${name} (${code})`,
  keepStoreText: (name: string) => `Your new products are priced in ${name} too. Nothing changes on your site.`,
  storeKeeps: (name: string, code: string) => `Your store already sells in ${name} (${code}), so it stays in ${name}. Your new products will be converted into ${name} when your site is built.`,
  moveStoreLabel: (name: string, code: string) => `Move your store to ${name} (${code})`,
  moveStoreText: "You choose what happens to the prices it already has first: keep the same numbers, or convert them at today's rate.",
  sellsIn: (name: string, code: string) => `Your store sells in ${name} (${code}).`,
  changedOutside: (name: string, code: string, product: string) => `Your store's currency was changed in WordPress to ${name} (${code}). ${product} uses it now too.`,
  dialogTitle: (name: string, code: string) => `Change your store currency to ${name} (${code})?`,
  hasPrices: (name: string, code: string) => `Your store has prices in ${name} (${code}). Choose what happens to them before anything changes.`,
  keepBase: (toName: string) => `Every price keeps its number and is now in ${toName}.`,
  forExample: (base: string, label: string, from: string, to: string) => `${base} For example, ${label} goes from ${from} to ${to}.`,
  roundedWhole: 'a whole price',
  roundedNinetyNine: 'a price ending in .99',
  convertBase: (rounded: string) => `Every price is converted and rounded to ${rounded}.`,
  forExampleExact: (base: string, label: string, from: string, to: string) => `${base} For example, ${label} goes from ${from} to ${to}, converted without rounding.`,
  forExampleRate: (base: string, label: string, from: string, to: string, exact: string) => `${base} For example, ${label} goes from ${from} to ${to} (${exact} at today's rate).`,
  keepEitherWay: (list: string) => `These keep their numbers either way: ${list}.`,
  rateUnavailableFor: (name: string) => `Today's rate for ${name} is not available right now. Try again later, or keep the same numbers.`,
  rateNotOffered: (name: string) => `Converting to or from ${name} is not available here. Keep the same numbers, or change the prices in WooCommerce.`,
  unsupportedKinds: (list: string) => `Some of your products are of a kind whose prices cannot be converted here (${list}). Keep the same numbers, or change those prices in WooCommerce.`,
  unsupportedKindsBare: 'Some of your products are of a kind whose prices cannot be converted here. Keep the same numbers, or change those prices in WooCommerce.',
  sameCurrency: (name: string, code: string) => `Your store already sells in ${name} (${code}).`,
  notRestored: (list: string) => `Your site stopped partway, and some prices could not be put back: ${list}. Please check them in WooCommerce. Our team has been told and will look at it too.`,
  changedFallback: (name: string, code: string) => `Your store now sells in ${name} (${code}).`,
} as const;

/** The built sentences in the page's language (namespace 'storeCurrencySentences'). */
export const STORE_CURRENCY_SENTENCES = localized(STORE_CURRENCY_SENTENCES_EN, 'storeCurrencySentences');

// ── 10.1 The setup confirm step ─────────────────────────────────────────────

/** "Prices in euros (EUR)". */
export function pricesInLine(n: Pick<CurrencyNaming, 'code' | 'name'>): string {
  return STORE_CURRENCY_SENTENCES.pricesIn(sayCurrencyName(n), n.code);
}

/** An option of either picker: "Euros (EUR)", "US dollars (USD)". */
export function currencyOptionLabel(n: Pick<CurrencyNaming, 'code' | 'label'> & { name?: string }): string {
  return STORE_CURRENCY_SENTENCES.optionLabel(getLanguage() === 'en' ? n.label : sayCurrencyLabel({ code: n.code, name: n.name ?? n.label, label: n.label }), n.code);
}

/**
 * After a change on the confirm step. A rate that is not today's (a saved
 * one while the rate source is down, or the table the Argentine and Chilean
 * pesos always use) says its day instead of "today's rate".
 */
export function pricesConvertedLine(fromName: string, rateText: string, when?: { fresh?: boolean | null; dateText?: string | null; date?: string | null } | null): string {
  const dated = when && when.fresh === false && typeof when.dateText === 'string' && when.dateText.trim();
  const at = dated ? STORE_CURRENCY_SENTENCES.rateOf(rateDay(when!.date, when!.dateText!.trim())) : STORE_CURRENCY_SENTENCES.todaysRate;
  return STORE_CURRENCY_SENTENCES.pricesConverted(sayCurrencyName({ name: fromName }), at, rateText);
}

/** The day of a rate: the API's words on an English page ("September 29, 2026"), its date in the page's language otherwise. */
function rateDay(date: string | null | undefined, dateText: string): string {
  if (getLanguage() === 'en' || typeof date !== 'string' || !date.trim()) return dateText;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) ? `${date.trim()}T12:00:00Z` : date);
  return Number.isNaN(d.getTime()) ? dateText : formatDate(d, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The confirm step once the site build started (and the API's 409 BUILD_STARTED). */
export function buildStartedLine(n: Pick<CurrencyNaming, 'code' | 'name'>): string {
  return STORE_CURRENCY_SENTENCES.buildStarted(sayCurrencyName(n), n.code);
}

// ── The setup confirm step on a WordPress site whose store already sells ────
// The store holds prices in another currency than the plan picked: keeping
// the store's currency is the default (the new products are priced in it,
// nothing changes on the site), and moving the store goes through the
// dialog (Keep the same numbers or Convert at today's rate).

/** "Your store already sells in euros (EUR) and has prices." */
export function existingStoreLead(store: Pick<CurrencyNaming, 'code' | 'name'>): string {
  return STORE_CURRENCY_SENTENCES.existingStoreLead(sayCurrencyName(store), store.code);
}

/** The default choice: "Keep euros (EUR)". */
export function keepStoreLabel(store: Pick<CurrencyNaming, 'code' | 'name'>): string {
  return STORE_CURRENCY_SENTENCES.keepStoreLabel(sayCurrencyName(store), store.code);
}

/** What keeping does. */
export function keepStoreText(store: Pick<CurrencyNaming, 'code' | 'name'>): string {
  return STORE_CURRENCY_SENTENCES.keepStoreText(sayCurrencyName(store));
}

/**
 * A store that keeps a currency the plan cannot move into here (one that is
 * not offered, such as the Bulgarian lev): the build converts the new
 * products into it.
 */
export function storeKeepsLine(store: Pick<CurrencyNaming, 'code' | 'name'>): string {
  return STORE_CURRENCY_SENTENCES.storeKeeps(sayCurrencyName(store), store.code);
}

/** The other choice: "Move your store to US dollars (USD)". */
export function moveStoreLabel(to: Pick<CurrencyNaming, 'code' | 'name'>): string {
  return STORE_CURRENCY_SENTENCES.moveStoreLabel(sayCurrencyName(to), to.code);
}

/** What moving asks first (English; the screens read STORE_CURRENCY_SENTENCES.moveStoreText). */
export const MOVE_STORE_TEXT = STORE_CURRENCY_SENTENCES_EN.moveStoreText;

// ── 10.2 The business page card ─────────────────────────────────────────────

/** "Your store sells in euros (EUR)." */
export function sellsInLine(n: Pick<CurrencyNaming, 'code' | 'name'>): string {
  return STORE_CURRENCY_SENTENCES.sellsIn(sayCurrencyName(n), n.code);
}

/** Someone changed woocommerce_currency in WordPress; WPMaven follows it. */
export function changedOutsideLine(n: Pick<CurrencyNaming, 'code' | 'name'>): string {
  return STORE_CURRENCY_SENTENCES.changedOutside(sayCurrencyName(n), n.code, productName());
}

/** The sentence for each code, read in the page's language when it is asked for. */
const WHY_NOT_BY_CODE: Record<string, keyof typeof STORE_CURRENCY_COPY_EN> = {
  change_running: 'changeInProgress',
  currency_unreadable: 'currencyUnreadable',
  impersonation: 'whyNotImpersonation',
  view_as: 'whyNotImpersonation',
  member: 'whyNotMember',
  role: 'whyNotMember',
  team_role: 'whyNotMember',
  unreachable: 'whyNotUnreachable',
  site_unreachable: 'whyNotUnreachable',
  plugin_too_old: 'whyNotPluginTooOld',
  older_plugin: 'whyNotPluginTooOld',
};

/**
 * Why the card's Change is off, from the API's whyNot: its sentence as it
 * came, or the sentence for a code. Null when there is nothing to say.
 */
export function whyNotText(whyNot: unknown): string | null {
  if (typeof whyNot !== 'string' || !whyNot.trim()) return null;
  const v = whyNot.trim();
  const key = WHY_NOT_BY_CODE[v.toLowerCase()];
  if (key) return STORE_CURRENCY_COPY[key] as string;
  return /\s/.test(v) ? v : null;
}

// ── 10.3 The dialog ─────────────────────────────────────────────────────────

/** One price of the owner's own store, as the quote formats it. */
export interface CurrencyExample {
  /**
   * A product's regular price (rounded when converted), or a coupon or a
   * shipping cost (converted exactly). Missing in an older answer: a price.
   */
  kind?: 'price' | 'coupon' | 'shipping';
  /** "Signature Tee", "the coupon SPRING10", 'the shipping cost "Standard"'. */
  label: string;
  /** Today, in the current currency ("€29.00"). */
  from: string;
  /** With Keep ("£29.00"). */
  keep: string;
  /** With Convert, rounded ("£24.99"); null when Convert is unavailable. */
  convert: string | null;
  /** The exact conversion ("£24.86"); null when Convert is unavailable. */
  exact: string | null;
}

/** "Change your store currency to British pounds (GBP)?" */
export function dialogTitle(to: Pick<CurrencyNaming, 'code' | 'name'>): string {
  return STORE_CURRENCY_SENTENCES.dialogTitle(sayCurrencyName(to), to.code);
}

/** The dialog's lead when the store holds money values. */
export function hasPricesLine(from: Pick<CurrencyNaming, 'code' | 'name'>): string {
  return STORE_CURRENCY_SENTENCES.hasPrices(sayCurrencyName(from), from.code);
}

/** What Keep does, with an example from the owner's own store when there is one. */
export function keepText(toName: string, example?: CurrencyExample | null): string {
  const base = STORE_CURRENCY_SENTENCES.keepBase(sayCurrencyName({ name: toName }));
  return example ? STORE_CURRENCY_SENTENCES.forExample(base, example.label, example.from, example.keep) : base;
}

/**
 * "Convert at today's rate (1 EUR = 0.8572 GBP)"; bare when the rate is not
 * known or is not today's (a label that shows a rate right above "today's
 * rate is not available" contradicts itself).
 */
export function convertLabel(rateText: string | null | undefined, fresh = true): string {
  const r = typeof rateText === 'string' ? rateText.trim() : '';
  return r && fresh ? `${STORE_CURRENCY_COPY.convertLabelBare} (${r})` : STORE_CURRENCY_COPY.convertLabelBare;
}

/**
 * What Convert does: .99 endings, or whole prices for a currency without
 * decimals. The example is a product's price when the store has one; a
 * coupon or a shipping cost converts exactly, and says so.
 */
export function convertText(toDigits: number, example?: CurrencyExample | null): string {
  const rounded = toDigits === 0 ? STORE_CURRENCY_SENTENCES.roundedWhole : STORE_CURRENCY_SENTENCES.roundedNinetyNine;
  const base = STORE_CURRENCY_SENTENCES.convertBase(rounded);
  if (!example || !example.convert) return base;
  if (example.kind === 'coupon' || example.kind === 'shipping') {
    return STORE_CURRENCY_SENTENCES.forExampleExact(base, example.label, example.from, example.convert);
  }
  return example.exact
    ? STORE_CURRENCY_SENTENCES.forExampleRate(base, example.label, example.from, example.convert, example.exact)
    : base;
}

/** Formula shipping costs and the like: they keep their numbers whatever is chosen. */
export function keepEitherWayLine(items: readonly { label: string; value?: string | null }[]): string {
  const list = listText(items.map((i) => (i.value && i.value.trim() ? `${i.label} (${i.value.trim()})` : i.label)));
  return STORE_CURRENCY_SENTENCES.keepEitherWay(list);
}

/** Convert is off: today's rate is missing for now (it names the currency whose rate is missing). */
export function rateUnavailableLine(name: string): string {
  return STORE_CURRENCY_SENTENCES.rateUnavailableFor(sayCurrencyName({ name }));
}

/** Convert is off for good: a currency with no daily rate here (the Argentine and Chilean pesos). */
export function rateNotOfferedLine(name: string): string {
  return STORE_CURRENCY_SENTENCES.rateNotOffered(sayCurrencyName({ name }));
}

/** Convert is off: product kinds whose prices this cannot convert. */
export function unsupportedKindsLine(kinds: readonly string[]): string {
  return STORE_CURRENCY_SENTENCES.unsupportedKinds(listText(kinds));
}

/**
 * Why Convert is off, from the quote's convertUnavailableReason: its
 * sentence as it came, or the sentence for a code. Null when Convert is on.
 */
export function convertUnavailableText(
  reason: unknown,
  ctx: { toName: string; kinds?: readonly string[] | null; rateFresh?: boolean; rateName?: string | null },
): string | null {
  const rateName = ctx.rateName && ctx.rateName.trim() ? ctx.rateName.trim() : ctx.toName;
  if (typeof reason === 'string' && reason.trim()) {
    const v = reason.trim();
    switch (v.toLowerCase()) {
      case 'rate_not_offered':
        return rateNotOfferedLine(rateName);
      case 'rate_unavailable':
      case 'rate_stale':
      case 'stale_rate':
      case 'rate':
        return rateUnavailableLine(rateName);
      case 'too_many_prices':
      case 'too_many':
        return STORE_CURRENCY_COPY.tooManyPrices;
      case 'unsupported_products':
      case 'other_product_types':
        return ctx.kinds && ctx.kinds.length
          ? unsupportedKindsLine(ctx.kinds)
          : STORE_CURRENCY_SENTENCES.unsupportedKindsBare;
      default:
        if (/\s/.test(v)) return v;
    }
  }
  return ctx.rateFresh === false ? rateUnavailableLine(rateName) : null;
}

// ── 10.4 The result, and the refusals ───────────────────────────────────────

/** "Your store already sells in euros (EUR)." (SAME_CURRENCY) */
export function sameCurrencyLine(n: Pick<CurrencyNaming, 'code' | 'name'>): string {
  return STORE_CURRENCY_SENTENCES.sameCurrency(sayCurrencyName(n), n.code);
}

/** NOT_RESTORED: the plugin stopped partway and could not put these prices back. */
export function notRestoredLine(list: string): string {
  return STORE_CURRENCY_SENTENCES.notRestored(list);
}

/** The result the API words; when it sent none, what is always true after a change. */
export function changedFallbackLine(to: Pick<CurrencyNaming, 'code' | 'name'>): string {
  return STORE_CURRENCY_SENTENCES.changedFallback(sayCurrencyName(to), to.code);
}

/**
 * The sentence for a refusal code the API sends on the store currency
 * routes, used when its body carries no sentence of its own. Null for a code
 * this screen does not know.
 */
export function refusalText(code: string | null | undefined, ctx: { to?: Pick<CurrencyNaming, 'code' | 'name'> | null } = {}): string | null {
  switch (code) {
    case 'CURRENCY_CHANGED': return STORE_CURRENCY_COPY.currencyChanged;
    case 'STORE_CHANGED': return STORE_CURRENCY_COPY.storeChanged;
    case 'RATE_CHANGED': return STORE_CURRENCY_COPY.rateChanged;
    case 'RATE_UNAVAILABLE': return STORE_CURRENCY_COPY.rateUnavailable;
    case 'PLUGIN_TOO_OLD': return STORE_CURRENCY_COPY.pluginTooOld;
    case 'SITE_UNREACHABLE': return STORE_CURRENCY_COPY.siteUnreachable;
    case 'NOT_SAVED': return STORE_CURRENCY_COPY.notSaved;
    case 'CHANGE_IN_PROGRESS': return STORE_CURRENCY_COPY.changeInProgress;
    case 'CHANGE_RUNNING': return STORE_CURRENCY_COPY.changeRunning;
    case 'CHANGE_UNCONFIRMED': return STORE_CURRENCY_COPY.changeUnconfirmed;
    case 'CLIENT_TIMEOUT': return STORE_CURRENCY_COPY.stillWorking;
    case 'CURRENCY_UNREADABLE': return STORE_CURRENCY_COPY.currencyUnreadable;
    case 'MODE_REQUIRED': return STORE_CURRENCY_COPY.modeRequired;
    case 'UNSUPPORTED_CURRENCY': return STORE_CURRENCY_COPY.unsupported;
    case 'SAME_CURRENCY': return ctx.to ? sameCurrencyLine(ctx.to) : null;
    case 'TOO_MANY_PRICES': return STORE_CURRENCY_COPY.tooManyPrices;
    default: return null;
  }
}

// ── The confirm step's lineup ───────────────────────────────────────────────

/**
 * A price as the lineup shows it, grouped the en-US way on an English page:
 * "29", "24.99", "10,625.99", "44,900" (French: "24,99", "10 625,99"; the
 * lineup's reader takes both back). A whole amount shows no decimals (as
 * before); a currency without decimals never shows any.
 */
export function formatPlanPrice(cents: number, digits: number): string {
  const v = (Number.isFinite(cents) ? cents : 0) / 100;
  const whole = digits === 0 || Number.isInteger(v);
  return new Intl.NumberFormat(formatTag('en-US'), {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
    useGrouping: true,
  }).format(digits === 0 ? Math.round(v) : v);
}
