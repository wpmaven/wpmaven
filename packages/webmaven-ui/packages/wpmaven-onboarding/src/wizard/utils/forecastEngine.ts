/**
 * Deterministic 24-month unit-economics forecast, shaped for the businesses
 * WPMaven actually builds: instead of MRR/churn/ARPU it projects
 * units-per-month (orders, bookings, projects, tickets, donations) ramping
 * up from nearly zero, times an average unit value, minus variable and
 * fixed costs.
 *
 * The LLM proposes the ASSUMPTIONS (validated and clamped server-side);
 * this module does ALL the arithmetic, client-side, on every edit — the
 * projection is never stored, so an edited input can never leave stale
 * outputs anywhere.
 *
 * All money stays in minor units (cents) until formatting.
 */

import { getLanguage, localeTag } from '@yotako/webmaven-ui';
import { BusinessPlanAssumptions } from '../types/businessPlan';
import { FORECAST_ENGINE_COPY } from './forecastEngineCopy';

export const FORECAST_MONTHS = 24;

export type ForecastScenario = 'cautious' | 'expected' | 'ambitious';

/** Scenario multipliers apply to UNITS only (how many people buy), never to
 *  prices or costs — "how well does the selling go", not "what do you charge". */
export const SCENARIO_UNIT_MULT: Record<ForecastScenario, number> = {
  cautious: 0.6,
  expected: 1,
  ambitious: 1.5,
};

/** The scenario names in English (the screens read FORECAST_ENGINE_COPY.scenario, in the page's language). */
export const SCENARIO_LABEL: Record<ForecastScenario, string> = {
  cautious: 'Cautious',
  expected: 'Expected',
  ambitious: 'Ambitious',
};

export interface ForecastMonth {
  monthIndex: number;
  units: number;
  revenueCents: number;
  /** revenue × (1 − variableCost) − fixed. What stays with the owner. */
  profitCents: number;
  /** Running total of profit since month 1. */
  cumulativeCents: number;
}

export interface ForecastResult {
  months: ForecastMonth[];
  /** Monthly sales (revenue) at month 12. */
  monthlyRevenueAtYearCents: number;
  /** Monthly profit at month 12. */
  monthlyProfitAtYearCents: number;
  /** First month (1-based) whose profit is positive, or null if never. */
  paysForItselfMonth: number | null;
  totalRevenue2yCents: number;
  totalProfit2yCents: number;
}

/**
 * Geometric ramp: unitsMonth1 → unitsMonth12 over the first year, then the
 * business matures and monthly growth halves for year two. unitsMonth1 = 0 is
 * honest for a brand-new shop; the ramp then starts from 1 in month two.
 */
export function computeForecast(
  a: BusinessPlanAssumptions,
  scenario: ForecastScenario = 'expected',
): ForecastResult {
  const mult = SCENARIO_UNIT_MULT[scenario] ?? 1;
  const u1 = Math.max(0, a.unitsMonth1 || 0);
  const u12 = Math.max(u1, a.unitsMonth12 || 0);
  const unitValue = Math.max(0, a.avgUnitValueCents || 0);
  const varPct = Math.min(0.9, Math.max(0, a.variableCostPct || 0));
  const fixed = Math.max(0, a.fixedMonthlyCents || 0);

  const base = Math.max(u1, 1);
  const growth = u12 > 0 ? Math.pow(u12 / base, 1 / 11) : 1;
  const lateGrowth = 1 + (growth - 1) / 2;
  const yearEndUnits = base * Math.pow(growth, 11);

  const months: ForecastMonth[] = [];
  let cumulative = 0;
  let paysForItself: number | null = null;
  let totalRevenue = 0;
  let totalProfit = 0;

  for (let i = 0; i < FORECAST_MONTHS; i++) {
    const rampUnits =
      i === 0 ? u1 : i <= 11 ? base * Math.pow(growth, i) : yearEndUnits * Math.pow(lateGrowth, i - 11);
    const units = Math.round(rampUnits * mult);
    const revenue = Math.round(units * unitValue);
    const profit = Math.round(revenue * (1 - varPct)) - fixed;
    cumulative += profit;
    if (paysForItself === null && profit > 0) paysForItself = i + 1;
    totalRevenue += revenue;
    totalProfit += profit;
    months.push({ monthIndex: i, units, revenueCents: revenue, profitCents: profit, cumulativeCents: cumulative });
  }

  return {
    months,
    monthlyRevenueAtYearCents: months[11].revenueCents,
    monthlyProfitAtYearCents: months[11].profitCents,
    paysForItselfMonth: paysForItself,
    totalRevenue2yCents: totalRevenue,
    totalProfit2yCents: totalProfit,
  };
}

// ── Vocabulary ──────────────────────────────────────────────────────────────

/** Every label and sentence speaks the business's own unit word — a bakery
 *  sells orders, a photographer wins projects, a charity collects donations.
 *  In the page's language (forecastEngineCopy); French counts 0 and 1 as one. */
type UnitWords = { singular: string; plural: string; typical: string };

function unitWords(earningModel: string): UnitWords {
  const units = FORECAST_ENGINE_COPY.units as Record<string, UnitWords | undefined>;
  return units[earningModel] || units.products!;
}

export function unitWord(earningModel: string, count = 2): string {
  const words = unitWords(earningModel);
  const lang = getLanguage();
  const one = lang === 'en' ? count === 1 : new Intl.PluralRules(localeTag(lang)).select(count) === 'one';
  return one ? words.singular : words.plural;
}

/** "A typical order", in the page's language. */
export function typicalUnit(earningModel: string): string {
  return unitWords(earningModel).typical;
}

/**
 * The locale the forecast formats with: the browser's own on an English page
 * (as it always did), the page language's otherwise ("fr-FR").
 */
export function forecastLocale(): string | undefined {
  const lang = getLanguage();
  return lang === 'en' ? undefined : localeTag(lang);
}

/**
 * The currency's symbol comes after the amount in the page's language
 * ("24 €" in French). Never on an English page, which always wrote it first.
 */
export function currencySymbolAfter(currency: string): boolean {
  const locale = forecastLocale();
  if (!locale) return false;
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(1);
    const symbolAt = parts.findIndex((p) => p.type === 'currency');
    const numberAt = parts.findIndex((p) => p.type === 'integer');
    return symbolAt > numberAt;
  } catch {
    return false;
  }
}

/** A compact amount in the page's language ("38,2 k€", "1,2 M€"); for pages in another language than English. */
export function formatMoneyCompact(cents: number, currency: string, fractionDigits = 1): string {
  try {
    return new Intl.NumberFormat(forecastLocale(), {
      style: 'currency',
      currency,
      notation: 'compact',
      minimumFractionDigits: 0,
      maximumFractionDigits: fractionDigits,
    }).format(cents / 100);
  } catch {
    return formatMoney(cents, currency);
  }
}

// ── Money formatting ────────────────────────────────────────────────────────

/** Format cents in the plan's currency via Intl ("€24", "$1,250.50"). Whole
 *  amounts drop the decimals — forecast numbers should read like speech. */
export function formatMoney(cents: number, currency: string): string {
  const value = cents / 100;
  const wholeAmount = Math.abs(value % 1) < 0.005;
  try {
    return new Intl.NumberFormat(forecastLocale(), {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: wholeAmount ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(wholeAmount ? 0 : 2)}`;
  }
}

/** Compact tile form: "€38.2k", "$1.2M". Negative values keep their sign. */
export function formatMoneyShort(cents: number, currency: string): string {
  const value = cents / 100;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return formatCompact(value / 1_000_000, 'M', currency);
  if (abs >= 10_000) return formatCompact(value / 1_000, 'k', currency);
  return formatMoney(Math.round(value) * 100, currency);
}

function formatCompact(scaled: number, suffix: string, currency: string): string {
  const digits = Math.abs(scaled) >= 100 ? 0 : 1;
  // Another language than English writes it its own way ("38,2 k€").
  if (forecastLocale()) return formatMoneyCompact(scaled * (suffix === 'M' ? 1_000_000 : 1_000) * 100, currency, digits);
  const symbol = currencySymbol(currency);
  return `${scaled < 0 ? '-' : ''}${symbol}${Math.abs(scaled).toFixed(digits)}${suffix}`;
}

/** The bare currency symbol ("€"), for compact strings and input prefixes. */
export function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat(forecastLocale(), { style: 'currency', currency }).formatToParts(1);
    return parts.find((p) => p.type === 'currency')?.value || currency;
  } catch {
    return currency;
  }
}
