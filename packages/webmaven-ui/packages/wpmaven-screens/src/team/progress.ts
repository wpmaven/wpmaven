/**
 * The weekly check-ins of Your team > Progress (GET /operators/progress):
 * every Monday the Data Analyst measures the week against the plan's
 * forecast, and the Co-CEO writes what it means. One copy for both apps
 * (2026-10-16).
 */
import { localized, type BadgeColor } from '@yotako/webmaven-ui';

export interface ProgressSnapshot {
  id: string;
  periodStart: string;
  periodEnd: string;
  actuals: {
    revenueCents: number;
    orders: number;
    formSubmissions: number;
    bookings: number;
    pageviews: number;
    visitors: number;
  };
  target: {
    monthIndex?: number;
    expectedUnitsWeek?: number;
    expectedRevenueCentsWeek?: number;
    currency?: string;
  } | null;
  progressPct: number | null;
  notes: string | null;
  createdAt: string;
}

/** The weekly check-in is the Data Analyst's (its empty state says so). */
export const CHECK_IN_BY = 'data_analyst';

/**
 * The Progress tab of Your team: the weekly check-ins, where the Data
 * Analyst (an AI team member) measures the week against the forecast and
 * the Co-CEO reflects on it. In the page's language (namespace
 * screensProgress; French in src/i18n/fr.json).
 */
export const PROGRESS_COPY_EN = {
  /** The empty state's title. */
  noneTitle: 'No weekly check-ins yet',
  /** The empty state's line. */
  none: 'Every Monday your Data Analyst measures the week against your forecast, and the Co-CEO adjusts the plan. The first check-in appears after your first full week live.',
  /** After a percentage ("82% of this week's forecast target"). */
  ofTarget: "of this week's forecast target",
  /** A figure's label. */
  revenue: 'Revenue',
  /** A figure's label. */
  orders: 'Orders',
  /** A figure's label: people who visited the site. */
  visitors: 'Visitors',
  /** A figure's label: pages viewed. */
  pageviews: 'Pageviews',
  /** Under Visitors: how the site counts them (the dashboard's VISITORS_NOTE). */
  visitorsNote: 'Each person counted once a day',
  /** The Co-CEO's comment on the week: its heading. */
  reflection: "Co-CEO's reflection",
  /** The older check-ins: their heading. */
  earlier: 'Earlier weeks',
  /** The button that shows or hides the comment. */
  reflectionToggle: 'Reflection',
  /** A check-in's heading; {0} is the week's last day. */
  weekEnding: (day: string) => `Week ending ${day}`,
  /** After a figure: its target; {0} is an amount ("$1,200"). */
  target: (money: string) => `target ${money}`,
};

export const PROGRESS_COPY = localized(PROGRESS_COPY_EN, 'screensProgress');

/** A week's share of its forecast target, as a status badge: cyan once met (as shown, rounded), blue on the way. */
export function weekBadge(pct: number | null): { color: BadgeColor; label: string } | null {
  if (pct === null) return null;
  const shown = Math.round(pct);
  return { color: shown >= 100 ? 'cyan' : 'blue', label: `${shown}%` };
}

export function fmtMoney(cents: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** "Oct 11"; empty for a date that is not one (never a dash). */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The check-ins out of the answer, newest first as the API sends them; a row that is not one is dropped. */
export function readProgress(body: unknown): ProgressSnapshot[] {
  const rows = Array.isArray(body) ? body : [];
  return rows.filter((s): s is ProgressSnapshot => !!s && typeof s === 'object'
    && typeof (s as ProgressSnapshot).id === 'string'
    && !!(s as ProgressSnapshot).actuals && typeof (s as ProgressSnapshot).actuals === 'object');
}
