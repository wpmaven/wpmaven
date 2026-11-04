/**
 * The website's visitors on Analytics, the pure part, as the dashboard has
 * it: the words, the API's four answers read strictly, the figures and their
 * change against the period before, the days of the chart, a page's short
 * path and a source's name. No React, so the tests read it directly.
 *
 * Visitors are counted with a salt that changes every day, so one person is
 * one visitor per day: a period's visitors are the days' visitors added up.
 * The figure says so in its label, and the API keeps no visitors count for
 * the period before, so that figure has no change line.
 */

export type TrafficPeriod = '7d' | '30d' | '90d';

/** AI assistants reading the site (ChatGPT, Claude, Perplexity...), counted by the plugin. */
export interface AiReads {
  total: number;
  previousTotal: number | null;
  byAgent: Array<{ label: string; count: number }>;
}

export interface TrafficSummary {
  pageviews: number | null;
  /** Visitors counted once a day each (a daily salt), added up over the period. */
  uniqueVisitors: number | null;
  sessions: number | null;
  /** 0..1, or null with no sessions. */
  bounceRate: number | null;
  /** Seconds. */
  avgDuration: number | null;
  conversions: number | null;
  /** The period before, of the same length (the API keeps no visitors count for it). */
  previous: { pageviews: number | null; sessions: number | null; bounceRate: number | null; avgDuration: number | null };
  /** null when the plugin counted no AI reads. */
  aiVisits: AiReads | null;
}

/** One day of the daily chart: "2026-10-03" and its count. */
export interface DayCount {
  date: string;
  value: number;
}

export interface TopPage {
  url: string;
  views: number;
  /** Seconds, or null when not measured. */
  avgTimeOnPage: number | null;
}

/** Visits by kind of source (search, social...) and by the site they came from. */
export interface TrafficSources {
  bySources: Array<{ source: string; count: number }>;
  byDomain: Array<{ domain: string; count: number }>;
}

export const TRAFFIC_PERIODS: ReadonlyArray<{ key: TrafficPeriod; label: string; days: number }> = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
];

export function periodDays(period: TrafficPeriod): number {
  return TRAFFIC_PERIODS.find((p) => p.key === period)?.days ?? 7;
}

/**
 * What a visitors count means, wherever one shows for a period: the daily
 * salt counts each person once a day, so a week's visitors are the days'
 * visitors added up. The dashboard's words, exactly.
 */
export const VISITORS_ONCE_A_DAY = 'each person counted once a day';

/** The same words as a quiet line of their own, under a short "Visitors" label. */
export const VISITORS_NOTE = `${VISITORS_ONCE_A_DAY.charAt(0).toUpperCase()}${VISITORS_ONCE_A_DAY.slice(1)}`;

export const TRAFFIC_COPY = {
  title: 'Your website\'s visitors',
  period: 'Period',
  visitors: `Visitors (${VISITORS_ONCE_A_DAY})`,
  pageviews: 'Page views',
  visits: 'Visits',
  timeOnSite: 'Time on site',
  bounce: 'Left after one page',
  aiReads: 'AI reads',
  perDay: 'Visitors per day',
  perDayNote: 'A day is counted once it ends, so today shows here tomorrow.',
  showTable: 'Show as table',
  showChart: 'Show as chart',
  day: 'Day',
  topPages: 'Top pages',
  page: 'Page',
  views: 'Views',
  timeOnPage: 'Time on page',
  noPages: 'No page views in these days.',
  sources: 'Where they come from',
  bySource: 'Visits by source',
  bySite: 'Visits by site',
  noSources: 'No visits in these days.',
  noSites: 'No visit came from a link on another site in these days.',
  empty: 'No visits measured yet. They show up here from your site\'s first visitor.',
  loadError: 'We could not load your site\'s visitors. Try again in a moment.',
  loading: 'Loading your website\'s visitors',
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** The proxy hands over the API's data; an answer still wrapped in { data } is read the same. */
const unwrap = (body: unknown): unknown => (isObj(body) && 'data' in body ? body.data : body);

/** The summary (GET analytics/:id/summary), or null when the answer is not one. */
export function readTraffic(body: unknown): TrafficSummary | null {
  const s = unwrap(body);
  if (!isObj(s)) return null;
  const prev = isObj(s.previous) ? s.previous : {};
  const ai = isObj(s.aiVisits) ? s.aiVisits : null;
  const aiTotal = ai ? num(ai.total) : null;
  return {
    pageviews: num(s.pageviews),
    uniqueVisitors: num(s.uniqueVisitors),
    sessions: num(s.sessions),
    bounceRate: num(s.bounceRate),
    avgDuration: num(s.avgDuration),
    conversions: num(s.conversions),
    previous: {
      pageviews: num(prev.pageviews),
      sessions: num(prev.sessions),
      bounceRate: num(prev.bounceRate),
      avgDuration: num(prev.avgDuration),
    },
    aiVisits: ai && aiTotal !== null
      ? {
        total: aiTotal,
        previousTotal: num(ai.previousTotal),
        byAgent: (Array.isArray(ai.byAgent) ? ai.byAgent : [])
          .filter(isObj)
          .filter((a) => num(a.count) !== null)
          .map((a) => ({ label: String(a.label ?? ''), count: a.count as number })),
      }
      : null,
  };
}

/** The daily series (GET analytics/:id/timeseries): days with a date and a count, in the API's order; null when the answer is not a list. */
export function readDays(body: unknown): DayCount[] | null {
  const list = unwrap(body);
  if (!Array.isArray(list)) return null;
  return list
    .filter(isObj)
    .filter((d) => typeof d.date === 'string' && num(d.value) !== null)
    .map((d) => ({ date: d.date as string, value: d.value as number }));
}

/** The most viewed pages (GET analytics/:id/pages); null when the answer is not a list. */
export function readTopPages(body: unknown): TopPage[] | null {
  const list = unwrap(body);
  if (!Array.isArray(list)) return null;
  return list
    .filter(isObj)
    .filter((p) => typeof p.url === 'string' && num(p.views) !== null)
    .map((p) => ({ url: p.url as string, views: p.views as number, avgTimeOnPage: num(p.avgTimeOnPage) }));
}

/** Where the visits came from (GET analytics/:id/referrers); null when the answer is not one. */
export function readSources(body: unknown): TrafficSources | null {
  const r = unwrap(body);
  if (!isObj(r)) return null;
  const rows = (v: unknown, key: 'source' | 'domain') => (Array.isArray(v) ? v : [])
    .filter(isObj)
    .filter((x) => typeof x[key] === 'string' && (x[key] as string) !== '' && num(x.count) !== null)
    .map((x) => ({ name: x[key] as string, count: x.count as number }));
  return {
    bySources: rows(r.bySources, 'source').map((x) => ({ source: x.name, count: x.count })),
    byDomain: rows(r.byDomain, 'domain').map((x) => ({ domain: x.name, count: x.count })),
  };
}

/** "1,204", or "Not measured yet". */
export function countText(n: number | null): string {
  return n === null ? 'Not measured yet' : n.toLocaleString('en-US');
}

/** "+12% on the 7 days before", "-5% on ...", or null with nothing to compare. */
export function trendText(now: number | null, before: number | null, days: number): string | null {
  if (now === null || before === null || before === 0) return null;
  const change = Math.round(((now - before) / before) * 100);
  return `${change > 0 ? '+' : ''}${change}% on the ${days} days before`;
}

/** "2 min 05 s", "45 s", or "Not measured yet". */
export function durationText(seconds: number | null): string {
  if (seconds === null) return 'Not measured yet';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/** "Oct 3" for "2026-10-03", read as a calendar day (never shifted by the time zone). */
export function shortDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export interface TrafficFigure {
  key: 'visitors' | 'pageviews' | 'visits' | 'timeOnSite' | 'bounce' | 'aiReads';
  label: string;
  value: string;
  /** The change against the period before, when both are known. */
  change: string | null;
  /** A line under the figure (the AI assistants that read the site). */
  detail?: string | null;
}

const percent = (rate: number | null) => (rate === null ? 'Not measured yet' : `${Math.round(rate * 100)}%`);

/** "Was 38% the 7 days before": a rate is compared as itself, never as a percent of a percent. */
export function rateBefore(before: number | null, days: number): string | null {
  return before === null ? null : `Was ${percent(before)} the ${days} days before`;
}

/** The figures, in reading order. AI reads only when the plugin counted some, now or before. */
export function trafficFigures(t: TrafficSummary, period: TrafficPeriod): TrafficFigure[] {
  const days = periodDays(period);
  const out: TrafficFigure[] = [
    { key: 'visitors', label: TRAFFIC_COPY.visitors, value: countText(t.uniqueVisitors), change: null },
    { key: 'pageviews', label: TRAFFIC_COPY.pageviews, value: countText(t.pageviews), change: trendText(t.pageviews, t.previous.pageviews, days) },
    { key: 'visits', label: TRAFFIC_COPY.visits, value: countText(t.sessions), change: trendText(t.sessions, t.previous.sessions, days) },
    { key: 'timeOnSite', label: TRAFFIC_COPY.timeOnSite, value: durationText(t.avgDuration), change: trendText(t.avgDuration, t.previous.avgDuration, days) },
    { key: 'bounce', label: TRAFFIC_COPY.bounce, value: percent(t.bounceRate), change: t.bounceRate === null ? null : rateBefore(t.previous.bounceRate, days) },
  ];
  const ai = t.aiVisits;
  if (ai && (ai.total > 0 || (ai.previousTotal ?? 0) > 0)) {
    out.push({
      key: 'aiReads',
      label: TRAFFIC_COPY.aiReads,
      value: countText(ai.total),
      change: trendText(ai.total, ai.previousTotal, days),
      detail: ai.byAgent.slice(0, 3).map((a) => a.label).filter(Boolean).join(', ') || null,
    });
  }
  return out;
}

/** No visit in this period nor the one before: the section says when they will show. */
export function noVisitsYet(t: TrafficSummary): boolean {
  return !t.pageviews && !t.sessions && !t.previous.pageviews && !t.previous.sessions;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Every day of the period up to yesterday (UTC), each with its count. The API
 * keeps a row only for a day with visits, and counts a day once it ends, so a
 * day without a row is a day without visits, drawn at 0 rather than skipped.
 */
export function chartDays(days: DayCount[], period: TrafficPeriod, now: number = Date.now()): DayCount[] {
  const byDate = new Map(days.map((d) => [d.date.slice(0, 10), d.value]));
  const n = periodDays(period);
  const today = Date.parse(`${isoDay(now)}T00:00:00.000Z`);
  const out: DayCount[] = [];
  for (let k = n; k >= 1; k -= 1) {
    const date = isoDay(today - k * DAY_MS);
    out.push({ date, value: byDate.get(date) ?? 0 });
  }
  return out;
}

/** What the chart says to a screen reader: the days it covers and the busiest one. */
export function chartSummaryText(days: DayCount[]): string {
  if (days.length === 0) return TRAFFIC_COPY.perDay;
  const top = days.reduce((a, b) => (b.value > a.value ? b : a), days[0]);
  const range = `${TRAFFIC_COPY.perDay}, ${shortDay(days[0].date)} to ${shortDay(days[days.length - 1].date)}.`;
  return top.value > 0 ? `${range} The busiest day was ${shortDay(top.date)}, with ${countText(top.value)}.` : `${range} None yet.`;
}

/**
 * A page's address, short: its path without the site, the query or the
 * anchor, "Home page" for the root, and a long one cut in the middle so its
 * end (the page's own name) stays readable.
 */
export function shortPath(url: string, max = 40): string {
  let path = url;
  try {
    path = new URL(url, 'https://site.invalid').pathname;
  } catch {
    path = url.split(/[?#]/)[0];
  }
  try {
    path = decodeURI(path);
  } catch {
    // An address with a broken escape stays as it came.
  }
  if (path === '' || path === '/') return 'Home page';
  if (path.length <= max) return path;
  const head = Math.ceil((max - 1) / 3);
  return `${path.slice(0, head)}…${path.slice(path.length - (max - 1 - head))}`;
}

const SOURCE_NAMES: Readonly<Record<string, string>> = {
  direct: 'Came directly (typed or bookmarked)',
  search: 'Search engines',
  social: 'Social networks',
  email: 'Emails',
  paid: 'Ads',
  campaign: 'Campaign links',
  referral: 'Links on other sites',
};

/** A kind of source in words; an unknown one as the API names it, capitalised. */
export function sourceName(source: string): string {
  return SOURCE_NAMES[source] ?? (source ? source.charAt(0).toUpperCase() + source.slice(1) : '');
}

/** "example.com" for "www.example.com". */
export function siteName(domain: string): string {
  return domain.replace(/^www\./i, '');
}
