/**
 * The weekly check-ins of Your team > Progress (GET /operators/progress):
 * every Monday the Data Analyst measures the week against the plan's
 * forecast, and the Co-CEO writes what it means. One copy for both apps
 * (2026-10-16).
 */
import type { BadgeColor } from '@yotako/webmaven-ui';

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

export const PROGRESS_COPY = {
  noneTitle: 'No weekly check-ins yet',
  none: 'Every Monday your Data Analyst measures the week against your forecast, and the Co-CEO adjusts the plan. The first check-in appears after your first full week live.',
  ofTarget: "of this week's forecast target",
  revenue: 'Revenue',
  orders: 'Orders',
  visitors: 'Visitors',
  pageviews: 'Pageviews',
  /** Under Visitors: how the site counts them (the dashboard's VISITORS_NOTE). */
  visitorsNote: 'Each person counted once a day',
  reflection: "Co-CEO's reflection",
  earlier: 'Earlier weeks',
  reflectionToggle: 'Reflection',
  weekEnding: (day: string) => `Week ending ${day}`,
  target: (money: string) => `target ${money}`,
};

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
