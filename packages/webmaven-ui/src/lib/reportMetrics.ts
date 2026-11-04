/**
 * A report's metrics in the owner's words. A section's metrics arrive as the
 * API's own keys: the weekly progress to goal computes revenueCents,
 * weeklyTargetCents, units, progressPct and forecastMonth, and the full
 * report's writer copies keys from the site's figures (pageviews, visitors,
 * bounceRate, revenue, avgOrderValue, newSubscribers...). Drawn as they came,
 * a revenue read "Revenue cents 54.0k".
 *
 * Each key becomes a label in sentence case, with no unit word and no
 * underscore, and its value is drawn in the unit the key carries: money in
 * the report's currency when it is known (cents divided by 100), a percent,
 * a duration. A key we have never seen is split into words the same way.
 * Pure: the same key, value and currency always read the same.
 */

export interface ReportMetricWords {
  label: string;
  value: string;
}

/** How a value is drawn. */
type Unit = 'count' | 'money' | 'cents' | 'percent' | 'share' | 'seconds' | 'hours';

/**
 * The keys the API sends, by their words joined in lower case
 * ("revenueCents" and "revenue_cents" are both "revenuecents").
 */
const KNOWN: Record<string, { label: string; unit?: Unit }> = {
  // The weekly progress to goal.
  revenuecents: { label: 'Revenue', unit: 'cents' },
  weeklytargetcents: { label: 'Weekly revenue target', unit: 'cents' },
  weeklytargetunits: { label: 'Weekly sales target' },
  units: { label: 'Sales' },
  unitsthisweek: { label: 'Sales' },
  progresspct: { label: 'Progress to goal', unit: 'percent' },
  forecastmonth: { label: 'Month of the plan' },
  // The store.
  revenue: { label: 'Revenue', unit: 'money' },
  totalrevenue: { label: 'Revenue', unit: 'money' },
  orders: { label: 'Orders' },
  ordercount: { label: 'Orders' },
  totalorders: { label: 'Orders' },
  avgordervalue: { label: 'Average order', unit: 'money' },
  averageordervalue: { label: 'Average order', unit: 'money' },
  conversionrate: { label: 'Conversion rate', unit: 'share' },
  // Traffic. Visitors are counted once a day, so never "unique".
  pageviews: { label: 'Pageviews' },
  totalpageviews: { label: 'Pageviews' },
  visitors: { label: 'Visitors' },
  uniquevisitors: { label: 'Visitors' },
  totalvisitors: { label: 'Visitors' },
  sessions: { label: 'Visits' },
  bouncerate: { label: 'Bounce rate', unit: 'share' },
  avgduration: { label: 'Average visit', unit: 'seconds' },
  avgsessionduration: { label: 'Average visit', unit: 'seconds' },
  totalsites: { label: 'Sites' },
  // Forms and bookings.
  conversations: { label: 'Conversations' },
  answered: { label: 'Answered' },
  shareanswered: { label: 'Answered', unit: 'share' },
  medianhourstoanswer: { label: 'Time to answer', unit: 'hours' },
  newsubscribers: { label: 'New subscribers' },
  submissions: { label: 'Form messages' },
  formsubmissions: { label: 'Form messages' },
  bookings: { label: 'Bookings' },
  // Content and health.
  poststotal: { label: 'Posts' },
  pagestotal: { label: 'Pages' },
  commentstotal: { label: 'Comments' },
  pendingcomments: { label: 'Comments to review' },
  activealerts: { label: 'Open alerts' },
  resolvedthisperiod: { label: 'Fixed this period' },
  // AI assistants reading the site.
  aivisits: { label: 'AI reads' },
  previoustotal: { label: 'Previous period' },
};

/** A key's last word that only says its unit: dropped from the label. */
const UNIT_WORDS: Record<string, Unit> = {
  cents: 'cents',
  pct: 'percent',
  percent: 'percent',
  percentage: 'percent',
  seconds: 'seconds',
  secs: 'seconds',
  hours: 'hours',
};

const SHORT_WORDS: Record<string, string> = { avg: 'average', num: 'number', qty: 'quantity' };
const ACRONYMS = new Set(['ai', 'seo', 'url', 'cta', 'lcp', 'cls', 'inp', 'id']);

/** "revenueCents", "revenue_cents", "AOVValue" -> ["revenue", "cents"], ["aov", "value"]. */
function words(key: string): string[] {
  return key
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[^A-Za-z\d]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean);
}

function sentence(list: string[]): string {
  const text = list.map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : SHORT_WORDS[w] ?? w)).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The label and the unit of a key. */
function describe(key: string): { label: string; unit: Unit } {
  const list = words(key);
  const known = KNOWN[list.join('')];
  if (known) return { label: known.label, unit: known.unit ?? 'count' };
  let unit: Unit = 'count';
  const last = list[list.length - 1];
  if (list.length > 1 && last && UNIT_WORDS[last]) {
    unit = UNIT_WORDS[last];
    list.pop();
  } else if (last === 'rate') {
    unit = 'share';
  } else if (list.includes('revenue')) {
    unit = 'money';
  }
  return { label: list.length > 0 ? sentence(list) : String(key), unit };
}

const ISO_CURRENCY = /^[A-Z]{3}$/;

/** A three-letter currency code, upper case, or null. */
export function currencyCode(value: unknown): string | null {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return ISO_CURRENCY.test(code) ? code : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function plain(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}

/** Whole amounts without cents ("€540"), the others with two digits ("€540.50"). */
function money(amount: number, currency: string | null): string {
  const digits = Number.isInteger(Math.round(amount * 100) / 100) ? 0 : 2;
  const options: Intl.NumberFormatOptions = { minimumFractionDigits: digits, maximumFractionDigits: digits };
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', { ...options, style: 'currency', currency }).format(amount);
    } catch {
      // A code Intl does not know: the amount, then the code.
      return `${new Intl.NumberFormat('en-US', options).format(amount)} ${currency}`;
    }
  }
  return new Intl.NumberFormat('en-US', options).format(amount);
}

function duration(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return s > 0 ? `${m} min ${s} s` : `${m} min`;
}

function hours(n: number): string {
  if (n < 1) return `${Math.max(1, Math.round(n * 60))} min`;
  const h = round1(n);
  return `${plain(h)} ${h === 1 ? 'hour' : 'hours'}`;
}

function drawNumber(n: number, unit: Unit, currency: string | null): string {
  switch (unit) {
    case 'cents': return money(n / 100, currency);
    case 'money': return money(n, currency);
    case 'percent': return `${plain(round1(n))}%`;
    // A share comes as 0.42 or as 42: either way it reads 42%.
    case 'share': return `${plain(round1(Math.abs(n) <= 1 ? n * 100 : n))}%`;
    case 'seconds': return duration(n);
    case 'hours': return hours(n);
    default: return plain(n);
  }
}

/**
 * One metric in words: { label: "Revenue", value: "€540" } for
 * ("revenueCents", 54000, "EUR"). `currency` is the report's, when known;
 * without it money is drawn as an amount alone.
 */
export function reportMetricWords(key: string, value: unknown, currency?: string | null): ReportMetricWords {
  const { label, unit } = describe(key);
  const code = currencyCode(currency);
  let text: string;
  if (value === null || value === undefined) text = '-';
  else if (typeof value === 'number') text = Number.isFinite(value) ? drawNumber(value, unit, code) : '-';
  else if (typeof value === 'boolean') text = value ? 'Yes' : 'No';
  else if (typeof value === 'string') {
    const trimmed = value.trim();
    text = /^-?\d+(\.\d+)?$/.test(trimmed) ? drawNumber(Number(trimmed), unit, code) : trimmed || '-';
  } else text = '-';
  return { label, value: text };
}

/**
 * The report's currency, from where the API keeps it: the report itself, or
 * the figures it was written from (the store's revenue for a full report,
 * the plan's target for the weekly progress to goal). Null when none says.
 */
export function reportCurrency(report: { currency?: unknown; content?: unknown; data?: unknown }): string | null {
  const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' ? (v as Record<string, any>) : {});
  const data = obj(report.data);
  const candidates = [
    report.currency,
    obj(report.content).currency,
    data.currency,
    obj(data.target).currency,
    obj(obj(obj(data.business).woocommerce).revenue).currency,
  ];
  for (const c of candidates) {
    const code = currencyCode(c);
    if (code) return code;
  }
  return null;
}
