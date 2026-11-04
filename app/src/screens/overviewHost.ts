/**
 * What Overview reads, and for whom (1.7.0). Overview draws the dashboard's
 * Home sections for this site (@yotako/wpmaven-screens): Report / Your
 * team's plan / Goals, the growth card and This week, the team and its
 * week, What changed, What you have built here, Site health and Recent
 * activity, and the dashboard Home's side column (2026-10-17): the site's
 * preview, Turn on a way to get paid, Check what your site says about you
 * and Your website. They read through the plugin's host (pluginScreensHost) with
 * the rule every screen of the plugin keeps: a part whose flag the account
 * keeps off for this site, or that this WordPress user's role may not read,
 * makes no call.
 *
 * useBusinessHome reads eight things at once for every section; a read this
 * site or this person may not make is refused here, before any call, the
 * way the proxy refuses it (403), and the section leaves that part out. The
 * tiers are the API's route table's (site-route-policy.json).
 *
 * The team's catalog (titles, badge colours) comes through the wizard's
 * proxy (teamCatalog.ts), never the REST proxy, which does not forward it.
 *
 * The side column's writes follow the API's rule too: setting up a way to
 * get paid and Feature on WPMaven only from the owner's own WordPress
 * account (the host's viewer: anyone else makes no call, and gets the way
 * to the dashboard, or no Feature on WPMaven).
 *
 * What you have built here reads GET /operators/stored-value, which the
 * API's route table does not give a site yet: it is not listed here, so the
 * call goes on to the proxy, which refuses it before the API (403
 * wpmaven_not_allowed), and the card stays out. Once the table the plugin
 * ships lists it, the card reads it.
 */
import type { InsightsFaces, ScreensCallOptions, ScreensHost, ScreensQuery, ScreensTransport } from '@yotako/wpmaven-screens';
import { hasFeature, type SiteFeature, type SiteState } from '../utils/siteState';
import { tierIn, TIERS, type Tier } from '../utils/tier';
import { homePlace, pluginHref } from './pluginLinks';
import { openPluginPlace, pluginScreensHost } from './pluginScreensHost';
import { PluginScreensError } from './screensTransport';
import { siteInstanceId } from './siteScope';
import { loadPluginTeamCatalog } from './teamCatalog';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface OverviewRead {
  method: Method;
  path: RegExp;
  /** The account's flag for this site. */
  feature: SiteFeature;
  /** The WordPress tiers the API's route table gives it. */
  tiers: readonly Tier[];
}

const OWNER: readonly Tier[] = ['owner'];
const STORE: readonly Tier[] = ['owner', 'store'];
const ANY: readonly Tier[] = TIERS;
const at = (path: string) => new RegExp(`^${path.replace(/:id/g, '[^/]+')}$`); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp (the paths are this file's own constants)

/** Every read and write Overview's sections make, with what each needs. */
export const OVERVIEW_READS: readonly OverviewRead[] = [
  // The team's plan, its progress, its milestones and its channels: the
  // growth card's checklist, This week and the week's rows.
  { method: 'GET', path: at('/operators/plan'), feature: 'teamPlan', tiers: OWNER },
  { method: 'GET', path: at('/operators/progress'), feature: 'teamPlan', tiers: OWNER },
  { method: 'GET', path: at('/operators/plans/:id/milestones'), feature: 'teamPlan', tiers: OWNER },
  { method: 'GET', path: at('/operators/connect'), feature: 'teamPlan', tiers: OWNER },
  // What waits for a yes.
  { method: 'GET', path: at('/operators/approvals'), feature: 'approvals', tiers: OWNER },
  { method: 'GET', path: at('/operators/approvals/:id/before'), feature: 'approvals', tiers: OWNER },
  // What changed: this week's money and the last 7 days' visitors, for the
  // roles that read them elsewhere in the plugin (Income, Analytics).
  { method: 'GET', path: at('/instances/:id/finance/summary'), feature: 'finance', tiers: STORE },
  { method: 'GET', path: at('/analytics/:id/summary'), feature: 'analytics', tiers: STORE },
  // The team's faces.
  { method: 'GET', path: at('/instances/:id/team'), feature: 'activity', tiers: ANY },
  // Report / Your team's plan / Goals.
  { method: 'GET', path: at('/reports/:id'), feature: 'reports', tiers: STORE },
  { method: 'GET', path: at('/scheduled-tasks'), feature: 'tasks', tiers: OWNER },
  { method: 'GET', path: at('/scheduled-tasks/upcoming'), feature: 'tasks', tiers: OWNER },
  { method: 'GET', path: at('/deferred-runs'), feature: 'tasks', tiers: OWNER },
  { method: 'GET', path: at('/analytics/:id/goals'), feature: 'analytics', tiers: ANY },
  { method: 'POST', path: at('/analytics/:id/goals'), feature: 'analytics', tiers: OWNER },
  // Site health and Check now.
  { method: 'GET', path: at('/instances/:id/health'), feature: 'health', tiers: OWNER },
  { method: 'POST', path: at('/instances/:id/health/check'), feature: 'health', tiers: OWNER },
  // Recent activity.
  { method: 'GET', path: at('/instances/:id/activity'), feature: 'activity', tiers: OWNER },
  // Turn on a way to get paid: the store's gateways, WPMaven Payments, and
  // a gateway's setup (the owner's own WordPress account, the host's viewer).
  { method: 'GET', path: at('/instances/:id/payments/status'), feature: 'getPaid', tiers: OWNER },
  { method: 'GET', path: at('/instances/:id/payments/wpmaven/status'), feature: 'getPaid', tiers: OWNER },
  { method: 'POST', path: at('/instances/:id/payments/setup'), feature: 'getPaid', tiers: OWNER },
  // Check what your site says about you.
  { method: 'GET', path: at('/instances/:id/business-details'), feature: 'businessDetails', tiers: OWNER },
  // Your website: the referral link a share carries, and Feature on WPMaven
  // (the owner's own WordPress account, the host's viewer).
  { method: 'GET', path: at('/referrals/me'), feature: 'referrals', tiers: OWNER },
  { method: 'GET', path: at('/instances/:id/social/x/status'), feature: 'featureOnWpmaven', tiers: OWNER },
  { method: 'POST', path: at('/instances/:id/social/consent'), feature: 'featureOnWpmaven', tiers: OWNER },
  { method: 'POST', path: at('/instances/:id/social/x/share'), feature: 'featureOnWpmaven', tiers: OWNER },
];

/** The team's catalog, as the sections ask for it. */
export const CATALOG_PATH = '/onboarding/operators';

const REFUSED_TEXT = 'This is not available from WordPress.';

function refusal(code: 'SITE_NOT_ENABLED' | 'wpmaven_role'): PluginScreensError {
  return new PluginScreensError({ status: 403, code, data: { success: false, code, error: REFUSED_TEXT }, message: REFUSED_TEXT }, null);
}

/**
 * Why Overview may not make this call for this site and this person, or
 * null when it may. A call Overview does not know goes on to the proxy,
 * whose route table decides.
 */
export function overviewRefusal(method: Method, path: string, site: SiteState, tier: Tier | null): PluginScreensError | null {
  const read = OVERVIEW_READS.find((r) => r.method === method && r.path.test(path));
  if (!read) return null;
  if (!hasFeature(site, read.feature)) return refusal('SITE_NOT_ENABLED');
  if (!tierIn(read.tiers, tier)) return refusal('wpmaven_role');
  return null;
}

/** Whether the team's catalog is read: for an administrator, when a team section shows. */
function readsCatalog(site: SiteState, tier: Tier | null): boolean {
  return tier === 'owner' && (hasFeature(site, 'teamPlan') || hasFeature(site, 'activity'));
}

/** The plugin's transport with Overview's rule in front of it, and the catalog from the wizard's proxy. */
export function overviewTransport(base: ScreensTransport, site: SiteState, tier: Tier | null): ScreensTransport {
  const gate = (method: Method, path: string): void => {
    const refused = overviewRefusal(method, path, site, tier);
    if (refused) throw refused;
  };
  return {
    get: async <T = unknown>(path: string, query?: ScreensQuery, opts?: ScreensCallOptions): Promise<T> => {
      if (path === CATALOG_PATH) {
        if (!readsCatalog(site, tier)) throw refusal('wpmaven_role');
        // The sections read the catalog's own answer: the members as a list.
        const catalog = await loadPluginTeamCatalog();
        return Array.from(catalog.values()) as unknown as T;
      }
      gate('GET', path);
      return base.get<T>(path, query, opts);
    },
    post: async <T = unknown>(path: string, body?: unknown, opts?: ScreensCallOptions): Promise<T> => {
      gate('POST', path);
      return base.post<T>(path, body, opts);
    },
    patch: async <T = unknown>(path: string, body?: unknown, opts?: ScreensCallOptions): Promise<T> => {
      gate('PATCH', path);
      return base.patch<T>(path, body, opts);
    },
    del: async <T = unknown>(path: string, opts?: ScreensCallOptions): Promise<T> => {
      gate('DELETE', path);
      return base.del<T>(path, opts);
    },
  };
}

/**
 * The plugin's host for Overview's sections: Overview's rule in front of
 * the proxy, and its way to the Plan, which opens Your team's Plan here
 * (homePlace) rather than the dashboard's.
 */
export function overviewHost(site: SiteState, tier: Tier | null): ScreensHost {
  const host = pluginScreensHost(site);
  const instanceId = siteInstanceId(site);
  return {
    ...host,
    transport: overviewTransport(host.transport, site, tier),
    navigate: (to) => openPluginPlace(homePlace(to, site, instanceId)),
    link: (to) => pluginHref(homePlace(to, site, instanceId)),
  };
}

/** What Overview draws for this site and this WordPress user. */
export interface OverviewAccess {
  /** Report for administrators and shop managers, Your team's plan for administrators, Goals for every role. */
  faces: Required<InsightsFaces>;
  /** The growth card (the plan's chart and its milestones) and This week: the team's plan. */
  growth: boolean;
  /** What you have built here: administrators, as the team's plan. */
  built: boolean;
  /** The team's faces, and the week's plan for an administrator. */
  team: boolean;
  /** Site health, with Check now: administrators. */
  health: boolean;
  /** Recent activity: administrators (the other roles cannot read the log). */
  activity: boolean;
  /** The site's screenshot: every role (a picture of the public site). */
  sitePreview: boolean;
  /** Turn on a way to get paid: administrators (set up from the owner's own WordPress account). */
  getPaid: boolean;
  /** Check what your site says about you: administrators. */
  businessDetails: boolean;
}

export function overviewAccess(site: SiteState, tier: Tier | null): OverviewAccess {
  const may = (feature: SiteFeature, tiers: readonly Tier[]) => hasFeature(site, feature) && tierIn(tiers, tier);
  return {
    faces: { report: may('reports', STORE), plan: may('tasks', OWNER), goals: may('analytics', ANY) },
    growth: may('teamPlan', OWNER),
    built: may('teamPlan', OWNER),
    team: may('activity', ANY) || may('teamPlan', OWNER),
    health: may('health', OWNER),
    activity: may('activity', OWNER),
    sitePreview: may('sitePreview', ANY),
    getPaid: may('getPaid', OWNER),
    businessDetails: may('businessDetails', OWNER),
  };
}
