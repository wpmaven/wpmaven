/**
 * Where one of the dashboard's addresses goes in the plugin (1.7.0). The
 * shared screens link to the dashboard's own pages ('/store/orders/1042',
 * '/billing'); the plugin opens its own page when it has one for this site
 * and this WordPress user, and the dashboard in a new tab otherwise: only
 * what the API keeps there (billing, a post to TikTok or an upload to
 * YouTube, the customers' conversations, a campaign) leaves WordPress.
 *
 *   /                          Overview
 *   /waiting?tab=<tab>         Waiting for you (#/approvals/<tab>)
 *   /instances/<this site>     Overview; ?tab=blog the Blog, ?tab=activity
 *                              Activity, ?tab=reports Reports, with
 *                              &report=<id> that report (#/reports/<id>);
 *                              with a card's anchor (#business-details),
 *                              the dashboard's business page at that card
 *   /store, /store/products/<id>, /store/orders/<n>
 *                              the Store (#/store/products/<id>, ...)
 *   /messages?message=<id>     Messages (#/messages/<id>)
 *   /analytics                 Analytics
 *   anything else              the dashboard
 *
 * Your team's links to the dashboard's own Your team open the dashboard:
 * its Plan, where a task not made in WordPress changes; its Connect, where
 * a channel is connected to the account; an approval only it decides.
 * Overview's sections are the exception (homePlace): their way to the Plan
 * opens Your team's Plan here.
 *
 * A page this site does not show (its account flag off, another role) and
 * an address about another business go to the dashboard too.
 */
import { dashboardLink, type SiteState } from '../utils/siteState';
import { routeAllowsTier, routeById, routeFeaturesOn } from '../components/Dashboard/pages/registry/routes';

export type PluginPlace =
  /** A page of the plugin: the address after #/ ('' is Overview). */
  | { kind: 'app'; hash: string }
  /** The dashboard (or any web address): opened in a new tab. */
  | { kind: 'web'; url: string };

/**
 * Whether this site shows the page to this WordPress user: the page
 * router's rule (the account's flag, the role), and a place in the sidebar
 * for a page that has one there (the Store without WooCommerce, Messages
 * for a user who may not read them, have none).
 */
export function pluginPageOpen(id: string, site: SiteState): boolean {
  const route = routeById(id);
  if (!route) return false;
  if (!routeFeaturesOn(route, site)) return false;
  if (route.group && typeof route.order !== 'number') return false;
  return routeAllowsTier(route);
}

const ID = /^\d{1,12}$/;
/** A report's id, as the Reports page takes it in its address. */
const REPORT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The business page's tabs the plugin has a page for. */
function instanceTab(params: URLSearchParams): { page: string; hash: string } {
  switch (params.get('tab')) {
    case 'blog':
      return { page: 'blog', hash: 'blog' };
    case 'activity':
      return { page: 'activity', hash: 'activity' };
    case 'reports': {
      const report = params.get('report');
      return { page: 'reports', hash: report && REPORT_ID.test(report) ? `reports/${report}` : 'reports' };
    }
    default:
      return { page: 'home', hash: '' };
  }
}

/** The plugin's page for a dashboard address, or null when it has none. */
function appPlace(path: string, params: URLSearchParams, instanceId: string, anchor = ''): { page: string; hash: string } | null {
  const business = params.get('business');
  if (business && business !== instanceId) return null;
  const seg = path.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  if (seg.length === 0) return { page: 'home', hash: '' };
  switch (seg[0]) {
    case 'waiting': {
      const tab = params.get('tab');
      return { page: 'approvals', hash: tab && /^[a-z]{1,20}$/.test(tab) ? `approvals/${tab}` : 'approvals' };
    }
    case 'instances': {
      if (seg[1] !== instanceId) return null;
      if (seg.length > 2) return null; // a campaign, a page of the business the plugin does not have
      if (anchor) return null; // a card of the dashboard's business page (Business details)
      return instanceTab(params);
    }

    case 'store': {
      if (seg.length === 1) return { page: 'store', hash: 'store' };
      if ((seg[1] === 'products' || seg[1] === 'orders') && seg.length <= 3 && (seg.length === 2 || ID.test(seg[2]))) {
        return { page: 'store', hash: seg.slice(0, 3).join('/') };
      }
      return null;
    }
    case 'messages': {
      if (seg.length > 1) return null;
      const message = params.get('message');
      return { page: 'messages', hash: message && ID.test(message) ? `messages/${message}` : 'messages' };
    }
    case 'analytics':
      return seg.length === 1 ? { page: 'analytics', hash: 'analytics' } : null;
    default:
      return null;
  }
}

/** Where `to` goes for this site: a page of the plugin, or the dashboard in a new tab. */
export function pluginPlace(to: string, site: SiteState, instanceId: string): PluginPlace {
  if (/^https?:\/\//i.test(to)) return { kind: 'web', url: to };
  let url: URL;
  try {
    url = new URL(to.startsWith('/') ? to : `/${to}`, 'https://dashboard.invalid');
  } catch {
    return { kind: 'web', url: dashboardLink(site, '/') };
  }
  const found = appPlace(url.pathname, url.searchParams, instanceId, url.hash.replace(/^#/, ''));
  if (found && pluginPageOpen(found.page, site)) return { kind: 'app', hash: found.hash };
  return { kind: 'web', url: dashboardLink(site, `${url.pathname}${url.search}${url.hash}`) };
}

/**
 * Where an address of Overview's sections goes: their "See your team's
 * plan" and the week's "See all" (/team?tab=plan for this business) open
 * Your team's Plan here, when this site shows it to this user; everything
 * else as pluginPlace. On Your team itself the same address is the
 * dashboard's Plan, where the tasks not made in WordPress change.
 */
export function homePlace(to: string, site: SiteState, instanceId: string): PluginPlace {
  if (!/^https?:\/\//i.test(to)) {
    try {
      const url = new URL(to.startsWith('/') ? to : `/${to}`, 'https://dashboard.invalid');
      const business = url.searchParams.get('business');
      const plan = url.pathname.replace(/\/+$/, '') === '/team' && url.searchParams.get('tab') === 'plan';
      if (plan && (!business || business === instanceId) && pluginPageOpen('team', site)) return { kind: 'app', hash: 'team/plan' };
    } catch {
      // The general rule says where.
    }
  }
  return pluginPlace(to, site, instanceId);
}

/** The href of `to`: the plugin's own address (#/...), or the dashboard's. */
export function pluginHref(place: PluginPlace): string {
  return place.kind === 'app' ? `#/${place.hash}` : place.url;
}
