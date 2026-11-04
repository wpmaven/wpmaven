/**
 * What the Home sections read, for one business, on the app's transport
 * (2026-10-16). The dashboard's Home and the plugin's Overview draw the same
 * sections from the same reads; every read names the business (the
 * account's screen the one the app chose, a site's screen its own instance).
 *
 *   plan        GET  /operators/plan?instanceId=
 *   approvals   GET  /operators/approvals?instanceId=&limit=50
 *   channels    GET  /operators/connect?instanceId=
 *   progress    GET  /operators/progress?instanceId=&limit=26
 *   money       GET  /instances/:id/finance/summary?period=week|year
 *   visitors    GET  /analytics/:id/summary?period=7d
 *   this week   GET  /operators/plans/:planId/milestones
 *   health      GET  /instances/:id/health, POST /instances/:id/health/check
 *   activity    GET  /instances/:id/activity?limit=5
 *   report      GET  /reports/:id?limit=1
 *   up next     GET  /scheduled-tasks/upcoming?instanceId=&limit=5
 *   goals       GET  /analytics/:id/goals, POST /analytics/:id/goals
 *   built       GET  /operators/stored-value?instanceId=
 *
 * Every number shown is one the API sent: a read that failed answers null
 * and its block simply does not draw. Nothing here estimates or projects.
 */
import { errorMessage } from '@yotako/wpmaven-onboarding/shared';
import type { BusinessPlanAssumptions } from '@yotako/wpmaven-onboarding/shared';
import type { ScreensTransport } from '../host/types';
import type { OperatorApproval } from '../approvals/types';
import { readPlan, type TeamPlan, type TaskOperator } from '../team/tasks';

const enc = encodeURIComponent;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const date = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

/** The API's status when it answered, else 0. */
function statusOf(e: unknown): number {
  const s = (e as { response?: { status?: unknown }; status?: unknown } | null)?.response?.status
    ?? (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : 0;
}

// ── The plan ─────────────────────────────────────────────────────────────

/**
 * One week of the team's work, as GET /operators/plan sends it, the plan's
 * own weeks from activation, every week present, zeros included:
 *   publishedByWeek  what went out, through the current week, in
 *                    deliverables (a post counts once per network);
 *   plannedByWeek    the runs of the plan's tasks it has the team do, weeks
 *                    1 to 104 (the forecast's two years);
 *   ranByWeek        the runs of the plan's tasks that completed, through the
 *                    current week, in the same unit as plannedByWeek.
 */
export interface WeekCount {
  /** The week's first instant: activatedAt + 7 days x (week - 1). */
  weekStart: string;
  count: number;
}

/**
 * OperatorPlan.forecast as the API freezes it at activation. `scenario` is
 * the toggle the owner accepted on the forecast step: the plan curve and
 * the weekly targets are computed from THAT line, so the graph reads it from
 * here rather than default to the middle one.
 */
export type FrozenForecast = {
  assumptions?: BusinessPlanAssumptions;
  currency?: string;
  scenario?: string;
} | null;

/** The business's active plan, with what Home draws besides the tasks: the forecast and the work by week. */
export interface HomePlan extends TeamPlan {
  forecast?: unknown;
  publishedByWeek?: WeekCount[] | null;
  plannedByWeek?: WeekCount[] | null;
  ranByWeek?: WeekCount[] | null;
}

export async function readHomePlan(transport: ScreensTransport, instanceId: string): Promise<HomePlan | null> {
  return readPlan(await transport.get<unknown>('/operators/plan', { instanceId })) as HomePlan | null;
}

/** The approvals of the business, newest first, every status (the milestones and the week's rows read them). */
export async function readHomeApprovals(transport: ScreensTransport, instanceId: string, limit = 50): Promise<OperatorApproval[]> {
  const data = await transport.get<{ items?: unknown } | null>('/operators/approvals', { instanceId, limit });
  return Array.isArray(data?.items) ? (data!.items as OperatorApproval[]).filter((a) => isObj(a) && typeof a.id === 'string') : [];
}

// ── Money and visitors ───────────────────────────────────────────────────

export interface HomeFinance {
  netRevenue: number | null;
  currency: string | null;
  orderCount: number | null;
  avgOrderValue: number | null;
  /**
   * The store's own currency, only when the API read a store (hasStore).
   * `currency` falls back to USD when it could not, so it cannot tell a
   * dollar store from an unread one; the fees line needs to. Absent on an
   * older payload.
   */
  storeCurrency?: string | null;
  /**
   * The figures are the API's development sample (DEV_SAMPLE_DATA on a
   * development server, never in production): Home marks the cards they
   * feed "Sample figures (development)". Absent on real figures.
   */
  sample?: true;
}

/** An ISO 4217 code the summary gives for a store it read, upper-cased; else null. */
export function storeCurrencyOf(summary: { hasStore?: unknown; currency?: unknown } | null | undefined): string | null {
  if (!summary || summary.hasStore !== true || typeof summary.currency !== 'string') return null;
  const code = summary.currency.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/** The finance summary's money, as Home reads it; null without a revenue statement. */
export function parseHomeFinance(body: unknown): HomeFinance | null {
  const s = isObj(body) && body.data != null ? body.data : body;
  if (!isObj(s)) return null;
  const rs = s.revenueStatement;
  if (!isObj(rs)) return null;
  return {
    netRevenue: typeof rs.netRevenue === 'number' ? rs.netRevenue : null,
    currency: typeof s.currency === 'string' ? s.currency : null,
    orderCount: typeof rs.orderCount === 'number' ? rs.orderCount : null,
    avgOrderValue: typeof rs.avgOrderValue === 'number' ? rs.avgOrderValue : null,
    storeCurrency: storeCurrencyOf(s as { hasStore?: unknown; currency?: unknown }),
    ...(s.sample === true ? { sample: true as const } : {}),
  };
}

/**
 * Money from the finance summary. 'week' feeds What changed; the milestones
 * ask for 'year' so lifetime progress never resets on Monday. The API makes
 * a live round trip to the store for it: a slow site answers late, and a
 * failure answers null.
 */
export async function readHomeFinance(
  transport: ScreensTransport,
  instanceId: string,
  period: 'week' | 'month' | 'year' = 'week',
): Promise<HomeFinance | null> {
  try {
    return parseHomeFinance(await transport.get<unknown>(`/instances/${enc(instanceId)}/finance/summary`, { period }));
  } catch {
    return null;
  }
}

export interface HomeTraffic {
  pageviews: number | null;
  uniqueVisitors: number | null;
  sessions: number | null;
  conversions: number | null;
  /** AI assistant fetches (ChatGPT, Claude, Perplexity...) in the period; null when the site did not answer. */
  aiVisits: { total: number; previousTotal: number | null; byAgent: Array<{ label: string; count: number }> } | null;
}

/** The analytics summary as Home reads it; null for anything else. */
export function parseHomeTraffic(body: unknown): HomeTraffic | null {
  const s = isObj(body) && body.data != null ? body.data : body;
  if (!isObj(s)) return null;
  const ai = isObj(s.aiVisits) && typeof s.aiVisits.total === 'number'
    ? {
      total: s.aiVisits.total,
      previousTotal: num(s.aiVisits.previousTotal),
      byAgent: Array.isArray(s.aiVisits.byAgent)
        ? (s.aiVisits.byAgent as Array<{ label?: unknown; count?: unknown }>)
          .filter((a) => isObj(a) && typeof a.count === 'number')
          .map((a) => ({ label: String(a.label ?? ''), count: a.count as number }))
        : [],
    }
    : null;
  return {
    pageviews: num(s.pageviews),
    uniqueVisitors: num(s.uniqueVisitors),
    sessions: num(s.sessions),
    conversions: num(s.conversions),
    aiVisits: ai,
  };
}

/** The last 7 days' visitors, from the native analytics; null when it did not answer. */
export async function readHomeTraffic(transport: ScreensTransport, instanceId: string): Promise<HomeTraffic | null> {
  try {
    return parseHomeTraffic(await transport.get<unknown>(`/analytics/${enc(instanceId)}/summary`, { period: '7d' }));
  } catch {
    return null;
  }
}

/**
 * What changed's two reads, side by side (the plugin puts the same numbers
 * into its own figures card with its site's counts): this week's money and
 * the last 7 days' visitors. Each is null when its read did not answer.
 */
export async function readWhatChanged(
  transport: ScreensTransport,
  instanceId: string,
): Promise<{ finance: HomeFinance | null; traffic: HomeTraffic | null }> {
  const [finance, traffic] = await Promise.all([readHomeFinance(transport, instanceId, 'week'), readHomeTraffic(transport, instanceId)]);
  return { finance, traffic };
}

// ── This week's milestone ────────────────────────────────────────────────

export type MilestoneWeekStatus = 'ahead' | 'on' | 'behind' | 'upcoming' | 'current';
export type MilestoneTaskStatus = 'done' | 'active' | 'planned' | 'paused';

export interface MilestoneTask {
  id: string;
  title: string;
  /** Catalog operator id that owns the work. */
  operator: string;
  status: MilestoneTaskStatus;
  /** Measured contribution, when the analytics can attribute it. */
  contribution: { visitors: number; purchases: number } | null;
}

export interface MilestoneWeek {
  index: number;
  start: string;
  end: string;
  goal: { revenueCents: number; orders: number; visitors: number };
  /** null while the week has not been measured yet. */
  actual: { revenueCents: number; orders: number; visitors: number; converted: number } | null;
  status: MilestoneWeekStatus;
  tasks: MilestoneTask[];
}

export interface PlanMilestones {
  currency: string;
  /** The forecast scenario the goals were computed from. */
  scenario?: string;
  weeks: MilestoneWeek[];
}

/**
 * The weekly milestones of an activated plan: one money goal, what really
 * arrived against it, and the work the team did to move it, all computed by
 * the API against the forecast the owner accepted. Null when the route is
 * not deployed (404) or the answer has no weeks; other failures throw.
 */
export async function readPlanMilestones(transport: ScreensTransport, planId: string): Promise<PlanMilestones | null> {
  try {
    const payload = await transport.get<PlanMilestones | null>(`/operators/plans/${enc(planId)}/milestones`);
    if (!payload || !Array.isArray(payload.weeks)) return null;
    return payload;
  } catch (err) {
    if (statusOf(err) === 404) return null;
    throw err;
  }
}

/** The week the owner is living in: the API's own 'current', else the week whose range contains today, else nothing. */
export function currentWeek(weeks: MilestoneWeek[], now = Date.now()): MilestoneWeek | null {
  const flagged = weeks.find((w) => w.status === 'current');
  if (flagged) return flagged;
  return (
    weeks.find((w) => {
      const start = new Date(w.start).getTime();
      const end = new Date(w.end).getTime();
      return Number.isFinite(start) && Number.isFinite(end) && now >= start && now < end;
    }) ?? null
  );
}

// ── Site health ──────────────────────────────────────────────────────────

export type SiteHealthStateName = 'up' | 'down' | 'checking' | 'not_checked';

export interface SiteHealthIssueRow {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  /** What to do, in the alert's own words. */
  text: string;
  since: string;
}

/** A site's health as GET /instances/:id/health answers it (the API's HealthView). */
export interface SiteHealthView {
  state: SiteHealthStateName;
  since: string | null;
  monitoredSince: string | null;
  lastCheckAt: string | null;
  responseMs: { last: number | null; median7d: number | null };
  uptime: { days7: number | null; days30: number | null };
  outages: Array<{ startedAt: string; endedAt: string | null; minutes: number; cause: string | null; restarted: boolean }>;
  issues: SiteHealthIssueRow[];
  versions: { wordpress: string | null; php: string | null; plugin: string | null; checkedAt: string | null };
  certificate: { expiresAt: string | null; checkedAt: string | null; renewsAutomatically: boolean };
  /** Null for a site WPMaven does not back up. */
  backups: { lastOkAt: string | null; lastFailedAt: string | null } | null;
  hosted: boolean;
}

const HEALTH_STATES: readonly SiteHealthStateName[] = ['up', 'down', 'checking', 'not_checked'];
const SEVERITIES = ['info', 'warning', 'critical'] as const;

/** The health as the API answered it (wrapped or bare), strictly; null for anything else. */
export function parseSiteHealth(body: unknown): SiteHealthView | null {
  const b = isObj(body) && isObj(body.data) ? body.data : body;
  if (!isObj(b) || !HEALTH_STATES.includes(b.state as SiteHealthStateName)) return null;
  const response = isObj(b.responseMs) ? b.responseMs : {};
  const uptime = isObj(b.uptime) ? b.uptime : {};
  const versions = isObj(b.versions) ? b.versions : {};
  const cert = isObj(b.certificate) ? b.certificate : {};
  const backups = isObj(b.backups) ? b.backups : null;
  const pct = (v: unknown) => { const n = num(v); return n !== null && n >= 0 && n <= 100 ? n : null; };
  return {
    state: b.state as SiteHealthStateName,
    since: date(b.since),
    monitoredSince: date(b.monitoredSince),
    lastCheckAt: date(b.lastCheckAt),
    responseMs: { last: num(response.last), median7d: num(response.median7d) },
    uptime: { days7: pct(uptime.days7), days30: pct(uptime.days30) },
    outages: (Array.isArray(b.outages) ? b.outages : [])
      .filter((o): o is Record<string, unknown> => isObj(o) && !!date(o.startedAt))
      .map((o) => ({
        startedAt: o.startedAt as string,
        endedAt: date(o.endedAt),
        minutes: Math.max(0, Math.round(num(o.minutes) ?? 0)),
        cause: str(o.cause),
        restarted: o.restarted === true,
      })),
    issues: (Array.isArray(b.issues) ? b.issues : [])
      .filter((i): i is Record<string, unknown> => isObj(i) && !!str(i.title))
      .map((i) => ({
        type: str(i.type) ?? 'other',
        severity: (SEVERITIES as readonly string[]).includes(i.severity as string) ? i.severity as SiteHealthIssueRow['severity'] : 'info',
        title: str(i.title)!,
        text: str(i.text) ?? '',
        since: date(i.since) ?? '',
      })),
    versions: {
      wordpress: str(versions.wordpress),
      php: str(versions.php),
      plugin: str(versions.plugin),
      checkedAt: date(versions.checkedAt),
    },
    certificate: {
      expiresAt: date(cert.expiresAt),
      checkedAt: date(cert.checkedAt),
      renewsAutomatically: cert.renewsAutomatically === true,
    },
    backups: backups ? { lastOkAt: date(backups.lastOkAt), lastFailedAt: date(backups.lastFailedAt) } : null,
    hosted: b.hosted === true,
  };
}

export const SITE_HEALTH_COPY = {
  loadFailed: "We could not read this site's health. Try again in a moment.",
  checkFailed: 'The check did not run. Try again in a moment.',
  /** The API's own sentence when Check now has run 6 times this hour (HEALTH_CHECK_LIMIT). */
  limited: 'You checked this site several times in the last hour. Try again a little later.',
  /** Under the disabled Check now, while the hour's checks are used up. */
  limitedFor: (minutes: number) => (minutes <= 1
    ? 'You checked this site several times in the last hour. Try again in a minute.'
    : `You checked this site several times in the last hour. Try again in ${minutes} minutes.`),
  loading: "Checking your site's health",
};

/** The checks a business may run in an hour (the API's HEALTH_CHECKS_PER_HOUR). */
export const HEALTH_CHECKS_PER_HOUR = 6;

/** Why Check now did nothing: the API's sentence, and whether it was the hour's limit (and for how long). */
export class SiteHealthCheckRefused extends Error {
  constructor(message: string, readonly limited: boolean, readonly retryAfterSec: number | null = null) {
    super(message);
    this.name = 'SiteHealthCheckRefused';
  }
}

export async function readSiteHealth(transport: ScreensTransport, instanceId: string): Promise<SiteHealthView> {
  const health = parseSiteHealth(await transport.get<unknown>(`/instances/${enc(instanceId)}/health`));
  if (!health) throw new Error(SITE_HEALTH_COPY.loadFailed);
  return health;
}

/**
 * Check now: the API pings the site, reads its flags and updates, and
 * answers the fresh health. 6 an hour per business, whoever asks: past it
 * the API answers 429 HEALTH_CHECK_LIMIT with how many seconds to wait.
 * Rejects with SiteHealthCheckRefused, in the API's words when it gave some.
 */
export async function checkSiteHealth(transport: ScreensTransport, instanceId: string): Promise<SiteHealthView> {
  let body: unknown;
  try {
    body = await transport.post<unknown>(`/instances/${enc(instanceId)}/health/check`, {});
  } catch (err) {
    const data = (err as { response?: { data?: unknown }; data?: unknown } | null)?.response?.data
      ?? (err as { data?: unknown } | null)?.data;
    const code = (err as { code?: unknown } | null)?.code ?? (isObj(data) ? data.code : null);
    const limited = statusOf(err) === 429 || code === 'HEALTH_CHECK_LIMIT';
    const retryAfter = isObj(data) ? num(data.retryAfter) : null;
    throw new SiteHealthCheckRefused(
      errorMessage(err, limited ? SITE_HEALTH_COPY.limited : SITE_HEALTH_COPY.checkFailed),
      limited,
      retryAfter != null && retryAfter > 0 ? Math.ceil(retryAfter) : null,
    );
  }
  const health = parseSiteHealth(body);
  if (!health) throw new SiteHealthCheckRefused(SITE_HEALTH_COPY.checkFailed, false);
  return health;
}

// ── Activity ─────────────────────────────────────────────────────────────

export type ActivityGroup = 'changes' | 'approvals' | 'tasks' | 'payments' | 'site';

/** One row of GET /instances/:id/activity: one owner sentence, who did it, when. */
export interface ActivityItem {
  id: string;
  at: string;
  kind: string;
  group: ActivityGroup | string;
  actor: { type: string; label: string; operator?: unknown };
  text: string;
  link: { label: string; path: string } | null;
}

/** The newest rows of the business's activity log (the API pages it; a site never reads public work's content). */
export async function readRecentActivity(transport: ScreensTransport, instanceId: string, limit = 5): Promise<ActivityItem[]> {
  const data = await transport.get<{ items?: unknown } | null>(`/instances/${enc(instanceId)}/activity`, { limit });
  const items = Array.isArray(data?.items) ? data!.items : [];
  return items
    .filter((i): i is Record<string, unknown> => isObj(i) && typeof i.id === 'string' && typeof i.text === 'string' && !!date(i.at))
    .map((i) => ({
      id: i.id as string,
      at: i.at as string,
      kind: typeof i.kind === 'string' ? i.kind : 'other',
      group: typeof i.group === 'string' ? i.group : 'site',
      actor: isObj(i.actor)
        ? { type: String(i.actor.type ?? ''), label: String(i.actor.label ?? ''), operator: i.actor.operator }
        : { type: '', label: '' },
      text: i.text as string,
      link: isObj(i.link) && typeof i.link.path === 'string' && typeof i.link.label === 'string'
        ? { label: i.link.label, path: i.link.path }
        : null,
    }))
    .slice(0, limit);
}

// ── Report, up next, goals ───────────────────────────────────────────────

/** A report as the reports list sends it. */
export interface LatestReport {
  id: string;
  type: string;
  period: string;
  summary: string;
  createdAt: string;
}

/** The newest report of the business, or null when it has none. */
export async function readLatestReport(transport: ScreensTransport, instanceId: string): Promise<LatestReport | null> {
  const data = await transport.get<{ reports?: unknown } | null>(`/reports/${enc(instanceId)}`, { limit: 1 });
  const first = Array.isArray(data?.reports) ? data!.reports[0] : null;
  if (!isObj(first) || typeof first.id !== 'string') return null;
  return {
    id: first.id,
    type: typeof first.type === 'string' ? first.type : '',
    period: typeof first.period === 'string' ? first.period : '',
    summary: typeof first.summary === 'string' ? first.summary : '',
    createdAt: typeof first.createdAt === 'string' ? first.createdAt : '',
  };
}

/** A task's next run, as GET /scheduled-tasks/upcoming sends it. */
export interface UpcomingTask {
  id: string;
  prompt: string;
  nextRunAt: string | null;
  source: string;
  operator: TaskOperator | null;
}

/** The business's next runs, soonest first. */
export async function readUpcomingTasks(transport: ScreensTransport, instanceId: string, limit = 5): Promise<UpcomingTask[]> {
  const data = await transport.get<unknown>('/scheduled-tasks/upcoming', { instanceId, limit });
  const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.items) ? data.items : [];
  return list
    .filter((t): t is Record<string, unknown> => isObj(t) && typeof t.id === 'string')
    .map((t) => ({
      id: t.id as string,
      prompt: typeof t.prompt === 'string' ? t.prompt : '',
      nextRunAt: date(t.nextRunAt),
      source: typeof t.source === 'string' ? t.source : 'USER',
      operator: isObj(t.operator) && typeof t.operator.id === 'string'
        ? { id: t.operator.id, title: typeof t.operator.title === 'string' ? t.operator.title : '' } as TaskOperator
        : null,
    }))
    .slice(0, limit);
}

/** A goal as the kit's GoalWidget draws it (GET /analytics/:id/goals). */
export interface HomeGoal {
  id: string;
  name: string;
  currentCount: number;
  targetCount: number | null;
  progress: number | null;
  periodType: string | null;
  periodLabel: string;
}

export async function readGoals(transport: ScreensTransport, instanceId: string): Promise<HomeGoal[]> {
  const data = await transport.get<unknown>(`/analytics/${enc(instanceId)}/goals`);
  const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.goals) ? data.goals : [];
  return list
    .filter((g): g is Record<string, unknown> => isObj(g) && typeof g.id === 'string' && typeof g.name === 'string')
    .map((g) => ({
      id: g.id as string,
      name: g.name as string,
      currentCount: num(g.currentCount) ?? 0,
      targetCount: num(g.targetCount),
      progress: num(g.progress),
      periodType: typeof g.periodType === 'string' ? g.periodType : null,
      periodLabel: typeof g.periodLabel === 'string' ? g.periodLabel : '',
    }));
}

/** A new goal, as the short form says it. */
export interface NewGoal {
  name: string;
  type: 'url' | 'event';
  matchValue: string;
  /** Empty: no target. */
  targetCount: number | null;
  periodType: 'daily' | 'weekly' | 'monthly';
}

export function createGoal(transport: ScreensTransport, instanceId: string, goal: NewGoal): Promise<unknown> {
  return transport.post(`/analytics/${enc(instanceId)}/goals`, {
    name: goal.name.trim(),
    type: goal.type,
    matchValue: goal.matchValue.trim(),
    ...(goal.targetCount != null ? { targetCount: Math.round(goal.targetCount), periodType: goal.periodType } : {}),
  });
}

// ── What you have built here ─────────────────────────────────────────────
//
// What the owner has put into this business, read back to them (moved from
// the dashboard, 2026-10-17). The API counts things that ALREADY HAPPENED:
// the decisions made on drafts, the corrections written in the owner's own
// words, the channels they connected, what went out and where, and how many
// weeks of their own history the plan now works from. Nothing here is a
// target, a projection or a score.

export interface StoredValueDecisions {
  approved: number;
  changesRequested: number;
  rejected: number;
  /** When the owner first decided anything, or null if they never have. */
  firstDecisionAt: string | null;
}

/** One correction, in the owner's own words. Never paraphrased on the way out. */
export interface StoredVoiceNote {
  note: string;
  at: string | null;
}

export interface StoredValueVoice {
  corrections: number;
  latestNotes: StoredVoiceNote[];
}

export interface StoredValueChannel {
  /** Connect Center network id (facebook, instagram, tiktok, ...). */
  platform: string;
  status: string | null;
  connectedAt: string | null;
}

export interface StoredValuePublished {
  /**
   * Every metered publication, of every kind. NOT a post count: the ledger
   * behind this counts social posts, site pages, site posts, email campaigns
   * and setup actions in one total, so no copy anywhere may call it "posts".
   * `byType` is how the card tells the kinds apart.
   */
  total: number;
  byChannel: Array<{ channel: string; count: number }>;
  /** Deliverable kinds from the ledger: 'social_post', 'page', 'post', ... */
  byType: Array<{ type: string; count: number }>;
  firstAt: string | null;
}

export interface StoredValueHistory {
  /** Weeks of the owner's own history the plan works from. */
  weeks: number;
  firstWeekStart: string | null;
}

export interface StoredValueData {
  decisions: StoredValueDecisions;
  voice: StoredValueVoice;
  channels: StoredValueChannel[];
  published: StoredValuePublished;
  history: StoredValueHistory;
  /** Days since this business started with its operators; null if unknown. */
  sinceDays: number | null;
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const items = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Coerce the payload into the shape the card reads.
 *
 * Defensive on purpose: a partially-deployed API that omits `voice` or sends
 * `channels: null` must leave the owner with a smaller true card, never with
 * a blank screen from a thrown TypeError.
 */
export function normalizeStoredValue(payload: unknown): StoredValueData | null {
  if (!isObj(payload)) return null;
  const p = payload;
  // The one required marker. Without it this is not a stored-value payload:
  // it is an error body, an empty envelope, or an API that answered something
  // else, and a card that says "nothing has built up here yet" would be
  // telling the owner a fact about their account that we did not actually
  // read. Say nothing instead. Every OTHER field stays optional on purpose,
  // so a half-deployed API still yields a smaller true card.
  if (!isObj(p.decisions)) return null;
  const decisions = p.decisions;
  const voice = isObj(p.voice) ? p.voice : {};
  const published = isObj(p.published) ? p.published : {};
  const history = isObj(p.history) ? p.history : {};

  return {
    decisions: {
      approved: count(decisions.approved),
      changesRequested: count(decisions.changesRequested),
      rejected: count(decisions.rejected),
      firstDecisionAt: str(decisions.firstDecisionAt),
    },
    voice: {
      corrections: count(voice.corrections),
      latestNotes: items(voice.latestNotes)
        .map((n) => {
          const row = (n ?? {}) as Record<string, unknown>;
          const note = str(row.note);
          return note ? { note, at: str(row.at) } : null;
        })
        .filter((n): n is StoredVoiceNote => n !== null),
    },
    channels: items(p.channels)
      .map((c) => {
        const row = (c ?? {}) as Record<string, unknown>;
        const platform = str(row.platform);
        return platform
          ? { platform, status: str(row.status), connectedAt: str(row.connectedAt) }
          : null;
      })
      .filter((c): c is StoredValueChannel => c !== null),
    published: {
      total: count(published.total),
      byChannel: items(published.byChannel)
        .map((b) => {
          const row = (b ?? {}) as Record<string, unknown>;
          const channel = str(row.channel);
          const n = count(row.count);
          return channel && n > 0 ? { channel, count: n } : null;
        })
        .filter((b): b is { channel: string; count: number } => b !== null),
      byType: items(published.byType)
        .map((b) => {
          const row = (b ?? {}) as Record<string, unknown>;
          const type = str(row.type);
          const n = count(row.count);
          return type && n > 0 ? { type, count: n } : null;
        })
        .filter((b): b is { type: string; count: number } => b !== null),
      firstAt: str(published.firstAt),
    },
    history: {
      weeks: count(history.weeks),
      firstWeekStart: str(history.firstWeekStart),
    },
    sinceDays: typeof p.sinceDays === 'number' && Number.isFinite(p.sinceDays) && p.sinceDays >= 0
      ? Math.floor(p.sinceDays)
      : null,
  };
}

/**
 * What the owner has built here, for one business: null when the route is
 * not there (not deployed, or not one a site may call), when what came back
 * is not a stored-value payload, and on any other failure. The card treats
 * them all the same way: it does not render.
 */
export async function readStoredValue(transport: ScreensTransport, instanceId: string): Promise<StoredValueData | null> {
  try {
    // Every /operators read is scoped to one business by its query.
    return normalizeStoredValue(await transport.get<unknown>('/operators/stored-value', { instanceId }));
  } catch {
    return null;
  }
}
