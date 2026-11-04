/**
 * Overview's sections (1.7.0): the dashboard's Home for one business, drawn
 * from the very same components (@yotako/wpmaven-screens) for this site,
 * and the plugin's own additions, each only for the roles that may read it
 * (screens/overviewHost.ts):
 *
 *   Report / Your team's plan / Goals   HomeInsights
 *   the growth card and This week       GrowthCard ("Your plan, and where you are" and the milestones), ThisWeekCard
 *   the team and the week's plan        TeamWeekCard
 *   one card for the numbers            the kit's FiguresCard: What changed, then the site's counts
 *   What you have built here            StoredValueCard
 *   the site's preview                  SitePreviewCard, the state's screenshot
 *   Turn on a way to get paid           GetPaidCard (set up from the owner's own WordPress account)
 *   Check what your site says about you BusinessDetailsPrompt
 *   Your website                        YourWebsiteCard: the address, Share, Feature on WPMaven
 *   Site health                         SiteHealthCard, with Check now
 *   Recent activity                     RecentActivityCard, the last five
 *
 * Each draws nothing when it has nothing to say. One read of the business
 * (useBusinessHome) feeds the growth card, This week, the week's plan, What
 * changed and What you have built here.
 */
import React, { useEffect, useMemo } from 'react';
import { FiguresCard, type FigureItem } from '@yotako/webmaven-ui';
import {
  BusinessDetailsPrompt, GetPaidCard, GrowthCard, HomeInsights, RecentActivityCard, SiteHealthCard, SitePreviewCard, StoredValueCard,
  TeamWeekCard, ThisWeekCard, YourWebsiteCard, useBusinessHome, whatChangedItems,
  type BusinessHome, type HomeFinance, type HomeTraffic, type ScreensHost,
} from '@yotako/wpmaven-screens';
import { useDashboard, type DashboardStats } from '../../../contexts/DashboardContext';
import { overviewAccess, overviewHost, type OverviewAccess } from '../../../screens/overviewHost';
import { pluginPageOpen } from '../../../screens/pluginLinks';
import { downloadReportPdf } from '../../../utils/reportPdf';
import { useSiteState, type SiteState } from '../../../utils/siteState';
import { currentTier } from '../../../utils/tier';

/** What Overview's sections share: the host, what this person sees, and the business's reads. */
export interface Overview {
  host: ScreensHost;
  access: OverviewAccess;
  home: BusinessHome;
  site: SiteState;
}

/** The business's reads, once for every section, for this site and this WordPress user. */
export function useOverview(): Overview {
  const live = useSiteState();
  const tier = currentTier();
  // The same state is the same host: a status read that changed nothing
  // reads nothing again.
  const key = JSON.stringify(live);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const site = useMemo(() => live, [key]);
  const host = useMemo(() => overviewHost(site, tier), [site, tier]);
  const access = useMemo(() => overviewAccess(site, tier), [site, tier]);
  // A flag or a role changed: read again, under the new rule.
  const home = useBusinessHome(host, null, { reloadKey: host });
  return { host, access, home, site };
}

/** Report / Your team's plan / Goals: the faces this person may see. */
export function OverviewInsights({ overview }: { overview: Overview }) {
  const { faces } = overview.access;
  if (!faces.report && !faces.plan && !faces.goals) return null;
  return <HomeInsights host={overview.host} faces={faces} downloadReport={downloadReportPdf} />;
}

/** The site to share from the milestones (Share your store). */
function shareSite(site: SiteState): { url: string; name: string | null } | null {
  const page = (window as any).WEBMAVEN_WP_DATA?.site;
  const url = site.instance?.siteUrl || (typeof page?.url === 'string' ? page.url : '');
  if (!/^https?:\/\//i.test(url)) return null;
  return { url, name: site.instance?.siteName || site.business?.name || (typeof page?.name === 'string' ? page.name : null) };
}

/**
 * The growth card and This week, from the dashboard's Home: "Your plan, and
 * where you are" (the plan's chart) with the milestones beside it, then this
 * week's goal. A milestone's request goes into the chat's box (onAsk).
 */
export function OverviewGrowth({ overview, onAsk }: { overview: Overview; onAsk?: (text: string) => void }) {
  if (!overview.access.growth) return null;
  const { home, site } = overview;
  return (
    <>
      <GrowthCard
        home={home}
        businessStatus={site.instance?.paused ? 'paused' : undefined}
        site={shareSite(site)}
        onAsk={onAsk}
      />
      <ThisWeekCard home={home} />
    </>
  );
}

/** The team's faces and the week's plan; a waiting row is decided in Waiting for you. */
export function OverviewTeam({ overview }: { overview: Overview }) {
  if (!overview.access.team) return null;
  return <TeamWeekCard home={overview.home} />;
}

export const OVERVIEW_FIGURES_COPY = {
  title: 'Your numbers',
  loading: 'Loading your numbers',
  onSite: 'On your site',
  inStore: 'In your store',
} as const;

/** The site's own counts as figures, each opening its page when this site shows it here. */
export function siteFigureItems(stats: DashboardStats | null, site: SiteState): FigureItem[] {
  if (!stats) return [];
  const blog = pluginPageOpen('blog', site);
  const store = pluginPageOpen('store', site);
  const figure = (key: string, label: string, value: number, hint: string, href?: string): FigureItem => ({
    key: `site:${key}`, label, value: String(value), hint, testId: `site-figure-${key}`, ...(href ? { href } : {}),
  });
  const { onSite, inStore } = OVERVIEW_FIGURES_COPY;
  const items = [
    figure('posts', 'Posts', stats.posts, onSite, blog ? '#/blog' : undefined),
    figure('pages', 'Pages', stats.pages, onSite),
    figure('comments', 'Comments', stats.comments, onSite),
    figure('users', 'Users', stats.users, onSite),
  ];
  if (typeof stats.products === 'number') items.push(figure('products', 'Products', stats.products, inStore, store ? '#/store/products' : undefined));
  if (typeof stats.orders === 'number') items.push(figure('orders', 'Orders', stats.orders, inStore, store ? '#/store/orders' : undefined));
  return items;
}

/** The numbers card's figures: What changed (this week's money, the last 7 days' visitors), then the site's counts. */
export function overviewFigureItems(finance: HomeFinance | null, traffic: HomeTraffic | null, stats: DashboardStats | null, site: SiteState): FigureItem[] {
  return [...whatChangedItems(finance, traffic), ...siteFigureItems(stats, site)];
}

/**
 * One card for all the numbers, in place of the four count cards and the
 * store's tiles. What changed shows what its reads answered; a count that
 * could not be read is left out, never shown as zero.
 */
export function OverviewFigures({ overview }: { overview: Overview }) {
  const { stats, isLoadingStats, ensureContent } = useDashboard();
  // Read the site's counts when this card shows, once.
  useEffect(() => { ensureContent?.(); }, [ensureContent]);
  const items = overviewFigureItems(overview.home.finance, overview.home.traffic, stats ?? null, overview.site);
  return (
    <FiguresCard
      title={OVERVIEW_FIGURES_COPY.title}
      items={items}
      loading={!!isLoadingStats && items.length === 0}
      loadingLabel={OVERVIEW_FIGURES_COPY.loading}
      testId="wm-home-figures"
    />
  );
}

/**
 * What you have built here, from the dashboard's Home, beside the numbers:
 * administrators. Its read (GET /operators/stored-value) is not one a site
 * may make yet: the proxy refuses it and the card stays out, the numbers
 * card alone on its row.
 */
export function OverviewBuilt({ overview }: { overview: Overview }) {
  if (!overview.access.built) return null;
  return <StoredValueCard home={overview.home} />;
}

/**
 * The site itself, at the top of the side column, as on the dashboard's
 * Home: its screenshot, the whole card a link to it. Nothing until there is
 * a screenshot, or when it does not load.
 */
export function OverviewSitePreview({ overview }: { overview: Overview }) {
  if (!overview.access.sitePreview) return null;
  const site = shareSite(overview.site);
  if (!site) return null;
  return (
    <SitePreviewCard
      siteUrl={site.url}
      thumbnailUrl={overview.site.instance?.thumbnailUrl ?? null}
      name={site.name || site.url}
      host={overview.host}
    />
  );
}

/**
 * Turn on a way to get paid, for a store that cannot take money yet:
 * administrators read it, the owner's own WordPress account sets it up
 * (anyone else gets the way to the dashboard). Nothing for a site that is
 * not a store, has not answered, or already gets paid. The fees line in the
 * store's own currency, which the business's reads have already.
 */
export function OverviewGetPaid({ overview }: { overview: Overview }) {
  if (!overview.access.getPaid) return null;
  const { home } = overview;
  return <GetPaidCard host={overview.host} currency={home.finance?.storeCurrency ?? home.financeYear?.storeCurrency ?? null} />;
}

/** Check what your site says about you, until the owner has saved the details once: administrators. */
export function OverviewBusinessDetails({ overview }: { overview: Overview }) {
  if (!overview.access.businessDetails) return null;
  return <BusinessDetailsPrompt host={overview.host} />;
}

/**
 * Your website: the site's address, Share your site (the referral link for
 * administrators, when the account has one and the dashboard records it),
 * and Feature on WPMaven for the owner's own WordPress account.
 */
export function OverviewWebsite({ overview }: { overview: Overview }) {
  const site = shareSite(overview.site);
  if (!site) return null;
  return <YourWebsiteCard host={overview.host} siteUrl={site.url} siteName={site.name} />;
}

/** Site health, with Check now: administrators. No link to the dashboard. */
export function OverviewHealth({ overview }: { overview: Overview }) {
  if (!overview.access.health) return null;
  return <SiteHealthCard host={overview.host} canCheck />;
}

/** The last five things that happened, with See all: administrators; a refused read leaves the card out. */
export function OverviewActivity({ overview }: { overview: Overview }) {
  if (!overview.access.activity) return null;
  return <RecentActivityCard host={overview.host} />;
}
