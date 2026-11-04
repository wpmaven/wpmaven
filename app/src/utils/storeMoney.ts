/**
 * Money as WooCommerce shows it (wc_price): the store's currency symbol and
 * its position, its number of decimals and its separators, a minus sign
 * before everything. An order shows in its own currency with the store's
 * rules. Inputs take the store's decimal separator and give back a
 * WooCommerce decimal string ("18.50", "1500"): never a float.
 */

import type { Decimal, StoreMoneyFormat } from '../types/store';

const NBSP = ' ';

/** What a store without a known format uses (WooCommerce's defaults). */
export const DEFAULT_MONEY_FORMAT: StoreMoneyFormat = {
  code: 'USD', symbol: '$', position: 'left', decimals: 2, thousandSep: ',', decimalSep: '.',
};

/** "&euro;" and "&#36;" as the characters they are. */
export function decodeSymbol(symbol: string): string {
  if (!symbol || !symbol.includes('&')) return symbol;
  const named: Record<string, string> = {
    euro: '€', pound: '£', yen: '¥', cent: '¢', dollar: '$', amp: '&', nbsp: NBSP, curren: '¤', inr: '₹',
  };
  return symbol
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

/**
 * An amount ("18", "18.5", 18.5) as an exact count of minor units with
 * `decimals` digits, rounded half away from zero like PHP's number_format.
 * null for anything that is not a number.
 */
export function toMinorUnits(amount: Decimal | number | null | undefined, decimals: number): number | null {
  if (amount === null || amount === undefined || amount === '') return null;
  let text = typeof amount === 'number' ? (Number.isFinite(amount) ? amount.toFixed(Math.min(20, decimals + 6)) : '') : String(amount).trim();
  if (!/^-?\d*(\.\d*)?$/.test(text) || !/\d/.test(text)) return null;
  const negative = text.startsWith('-');
  if (negative) text = text.slice(1);
  const [whole = '0', frac = ''] = text.split('.');
  const kept = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const digits = ((whole || '0') + kept).replace(/^0+(?=\d)/, '');
  // Exact integers only (amounts far beyond any price are refused).
  if (digits.length > 15) return null;
  let minor = Number(digits);
  const next = frac.charAt(decimals);
  if (next && Number(next) >= 5) minor += 1;
  return negative ? -minor : minor;
}

/** Minor units as a WooCommerce decimal string with `decimals` digits (1850 -> "18.50"). */
export function fromMinorUnits(minor: number, decimals: number): Decimal {
  const negative = minor < 0;
  const digits = String(Math.abs(Math.round(minor))).padStart(decimals + 1, '0');
  const whole = decimals > 0 ? digits.slice(0, -decimals) : digits;
  const frac = decimals > 0 ? `.${digits.slice(-decimals)}` : '';
  return `${negative ? '-' : ''}${whole}${frac}`;
}

/** A price in WooCommerce's stored form normalized to the store's decimals ("18" -> "18.00"); '' and null stay null. */
export function toDecimal(amount: Decimal | number | null | undefined, decimals: number): Decimal | null {
  const minor = toMinorUnits(amount, decimals);
  return minor === null ? null : fromMinorUnits(minor, decimals);
}

function groupThousands(whole: string, sep: string): string {
  if (!sep) return whole;
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

function place(symbol: string, number: string, position: StoreMoneyFormat['position']): string {
  switch (position) {
    case 'right': return `${number}${symbol}`;
    case 'left_space': return `${symbol}${NBSP}${number}`;
    case 'right_space': return `${number}${NBSP}${symbol}`;
    default: return `${symbol}${number}`;
  }
}

/** An amount as the store prints it: "$18.00", "18,00 €" (a no-break space), "¥1,500". '' for no amount. */
export function formatStoreMoney(amount: Decimal | number | null | undefined, fmt: StoreMoneyFormat | null | undefined): string {
  const f = fmt ?? DEFAULT_MONEY_FORMAT;
  const decimals = Math.max(0, Math.min(8, Math.floor(f.decimals)));
  const minor = toMinorUnits(amount, decimals);
  if (minor === null) return '';
  const negative = minor < 0;
  const plain = fromMinorUnits(Math.abs(minor), decimals);
  const [whole, frac] = plain.split('.');
  const number = `${groupThousands(whole, f.thousandSep)}${frac !== undefined ? `${f.decimalSep}${frac}` : ''}`;
  return `${negative ? '-' : ''}${place(decodeSymbol(f.symbol), number, f.position)}`;
}

/** An order's amount, in the order's currency (its symbol) with the store's rules. */
export function formatOrderMoney(amount: Decimal | number | null | undefined, currencySymbol: string, fmt: StoreMoneyFormat | null | undefined): string {
  const f = fmt ?? DEFAULT_MONEY_FORMAT;
  return formatStoreMoney(amount, { ...f, symbol: currencySymbol || f.symbol });
}

/**
 * What the owner typed, as a WooCommerce decimal string with the store's
 * decimals, or null when it is not an amount (or has more decimals than the
 * store uses). The store's decimal separator is the decimal point; its
 * thousands separator is accepted between groups of three digits ("1.500,25"
 * in a comma store); "18.5" in a comma store still reads as 18.50.
 */
export function parseStoreMoney(input: string, fmt: StoreMoneyFormat | null | undefined): Decimal | null {
  const f = fmt ?? DEFAULT_MONEY_FORMAT;
  const decimals = Math.max(0, Math.min(8, Math.floor(f.decimals)));
  let s = String(input ?? '').replace(/[\s  ]/g, '');
  const symbol = decodeSymbol(f.symbol);
  if (symbol) s = s.split(symbol).join('');
  // The code is matched as text in any letter case, whatever characters a custom currency's code holds ("R$", "C++").
  if (f.code) s = s.replace(new RegExp(String(f.code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ''); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp (the code is escaped right here)
  if (!s) return null;
  const dec = f.decimalSep || '.';
  const thou = f.thousandSep && f.thousandSep !== dec ? f.thousandSep : '';
  if (thou) {
    if (s.includes(dec)) {
      s = s.split(thou).join('');
    } else if (s.includes(thou)) {
      // Only groups of three after it: a thousands separator ("1.500"); else the owner's decimal point ("18.5").
      const groups = s.split(thou);
      const thousands = groups.length > 1 && groups.slice(1).every((g) => /^\d{3}$/.test(g)) && /^\d{1,3}$/.test(groups[0]);
      s = thousands ? groups.join('') : groups.join(dec);
    }
  }
  if (dec !== '.') s = s.split(dec).join('.');
  if (!/^\d+(\.\d*)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  const [, frac = ''] = s.split('.');
  if (frac.length > decimals) return null;
  return toDecimal(s.startsWith('.') ? `0${s}` : s, decimals);
}

/** The input's text for an amount (the store's decimal separator, no symbol, no grouping): "18,50". */
export function moneyInputText(amount: Decimal | null | undefined, fmt: StoreMoneyFormat | null | undefined): string {
  const f = fmt ?? DEFAULT_MONEY_FORMAT;
  const d = toDecimal(amount ?? null, Math.max(0, Math.floor(f.decimals)));
  if (d === null) return '';
  return f.decimalSep && f.decimalSep !== '.' ? d.replace('.', f.decimalSep) : d;
}

/** Compares two decimal strings: negative, 0 or positive. null sorts first. */
export function compareDecimal(a: Decimal | null | undefined, b: Decimal | null | undefined): number {
  const x = toMinorUnits(a ?? null, 4);
  const y = toMinorUnits(b ?? null, 4);
  if (x === null || y === null) return x === y ? 0 : x === null ? -1 : 1;
  return x === y ? 0 : x < y ? -1 : 1;
}
