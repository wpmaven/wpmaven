import React, { useMemo, useState } from 'react';
import { Button, Chart, GlassCard, PageHeader, Skeleton } from '@yotako/webmaven-ui';
import { ChartNoAxesColumn, ExternalLink } from 'lucide-react';
import { getInstanceId } from '../../../services/proxyClient';
import { useProxyQuery } from '../../../hooks/useProxyQuery';
import { dashboardPhrase, siteBrand } from '../../../utils/brand';
import { dashboardLink, useSiteState } from '../../../utils/siteState';
import {
  TRAFFIC_COPY, TRAFFIC_PERIODS, chartDays, chartSummaryText, countText, durationText, noVisitsYet,
  readDays, readSources, readTopPages, readTraffic, shortDay, shortPath, siteName, sourceName, trafficFigures,
  type DayCount, type TopPage, type TrafficPeriod, type TrafficSources, type TrafficSummary,
} from '../../../utils/trafficView';
import ScreenState from '../ui/ScreenState';
import '../../../styles/analytics.css';

/**
 * Analytics in WordPress: the website's visitors, as the dashboard shows
 * them (the period's figures with their change against the period before,
 * the visitors of each day, the most viewed pages and where the visits come
 * from), then a card to the channels, which only the dashboard reads.
 * Visitors are counted once a day each, and every visitors figure says so.
 */

export const ANALYTICS_PAGE_COPY = {
  title: 'Analytics',
  subtitle: 'Who visits your website and where they come from.',
  channelsTitle: 'Your channels',
  channelsText: 'What your team published on each network, and the numbers each network reports for it.',
  channelsLink: (dashboard: string) => `See your channels in ${dashboard}`,
} as const;

/** What the section draws: the four answers for one period. */
export interface TrafficData {
  summary: TrafficSummary;
  days: DayCount[];
  pages: TopPage[];
  sources: TrafficSources;
}

const Figure: React.FC<{ label: string; value: string; change?: string | null; detail?: string | null; testId: string }> = ({ label, value, change, detail, testId }) => (
  <div className="wm-analytics__figure" data-testid={testId}>
    <span className="wm-analytics__figure-label">{label}</span>
    <p className="wm-analytics__figure-value">{value}</p>
    {detail && <p className="wm-analytics__dim">{detail}</p>}
    {change && <p className="wm-analytics__dim">{change}</p>}
  </div>
);

/** The daily visitors, as the kit's area chart in the product accent, or as a table. */
export const VisitorsPerDay: React.FC<{ days: DayCount[]; initialTable?: boolean }> = ({ days, initialTable = false }) => {
  const [asTable, setAsTable] = useState(initialTable);
  return (
    <div data-testid="wm-traffic-per-day">
      <div className="wm-analytics__card-head">
        <h3 className="wm-analytics__card-title">{TRAFFIC_COPY.perDay}</h3>
        <button type="button" className="wm-analytics__switch" aria-expanded={asTable} onClick={() => setAsTable((v) => !v)}>
          {asTable ? TRAFFIC_COPY.showChart : TRAFFIC_COPY.showTable}
        </button>
      </div>
      {asTable ? (
        <div className="wm-analytics__days">
          <table className="wm-analytics__table" data-testid="wm-traffic-days-table">
            <thead>
              <tr>
                <th>{TRAFFIC_COPY.day}</th>
                <th className="wm-analytics__num">{TRAFFIC_COPY.perDay}</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{shortDay(d.date)}</td>
                  <td className="wm-analytics__num">{countText(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div role="img" aria-label={chartSummaryText(days)} data-testid="wm-traffic-chart">
          <Chart
            type="area"
            data={{ labels: days.map((d) => d.date), datasets: [{ label: 'Visitors', data: days.map((d) => d.value), color: 'var(--accent)' }] }}
            options={{ showLegend: false, formatLabel: shortDay }}
          />
        </div>
      )}
      <p className="wm-analytics__dim wm-analytics__after">{TRAFFIC_COPY.perDayNote}</p>
    </div>
  );
};

/** One source or site: its name and count, over a thin bar against the largest. */
const SourceRow: React.FC<{ name: string; count: number; max: number }> = ({ name, count, max }) => (
  <li className="wm-analytics__source">
    <div className="wm-analytics__source-line">
      <span className="wm-analytics__source-name" title={name}>{name}</span>
      <span className="wm-analytics__num">{countText(count)}</span>
    </div>
    <div aria-hidden="true" className="wm-analytics__bar">
      <div style={{ width: `${max > 0 ? Math.max(2, (count / max) * 100) : 0}%` }} />
    </div>
  </li>
);

/** A short path with a chance to wrap after each slash, so a narrow column breaks it between its parts. */
const PathText: React.FC<{ path: string }> = ({ path }) => (
  <>
    {path.split('/').map((part, i) => (
      <React.Fragment key={i}>{i > 0 && <>/<wbr /></>}{part}</React.Fragment>
    ))}
  </>
);

const TopPages: React.FC<{ pages: TopPage[] }> = ({ pages }) => (
  <GlassCard padding="20px">
    <h3 className="wm-analytics__card-title wm-analytics__card-title--alone">{TRAFFIC_COPY.topPages}</h3>
    {pages.length === 0 ? (
      <p className="wm-analytics__dim">{TRAFFIC_COPY.noPages}</p>
    ) : (
      <table className="wm-analytics__table wm-analytics__table--fixed" data-testid="wm-traffic-top-pages">
        <thead>
          <tr>
            <th>{TRAFFIC_COPY.page}</th>
            <th className="wm-analytics__num" style={{ width: 64 }}>{TRAFFIC_COPY.views}</th>
            <th className="wm-analytics__num" style={{ width: 112 }}>{TRAFFIC_COPY.timeOnPage}</th>
          </tr>
        </thead>
        <tbody>
          {pages.slice(0, 5).map((p) => (
            <tr key={p.url}>
              <td><span className="wm-analytics__path" title={p.url}><PathText path={shortPath(p.url)} /></span></td>
              <td className="wm-analytics__num">{countText(p.views)}</td>
              <td className="wm-analytics__num">{durationText(p.avgTimeOnPage)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </GlassCard>
);

const Sources: React.FC<{ sources: TrafficSources }> = ({ sources }) => {
  const kinds = sources.bySources;
  const sites = sources.byDomain.slice(0, 5);
  const maxKind = Math.max(0, ...kinds.map((s) => s.count));
  const maxSite = Math.max(0, ...sites.map((s) => s.count));
  return (
    <GlassCard padding="20px">
      <h3 className="wm-analytics__card-title wm-analytics__card-title--alone">{TRAFFIC_COPY.sources}</h3>
      <h4 className="wm-analytics__subhead">{TRAFFIC_COPY.bySource}</h4>
      {kinds.length === 0 ? (
        <p className="wm-analytics__dim">{TRAFFIC_COPY.noSources}</p>
      ) : (
        <ul className="wm-analytics__sources" data-testid="wm-traffic-sources">
          {kinds.map((s) => <SourceRow key={s.source} name={sourceName(s.source)} count={s.count} max={maxKind} />)}
        </ul>
      )}
      <h4 className="wm-analytics__subhead wm-analytics__subhead--next">{TRAFFIC_COPY.bySite}</h4>
      {sites.length === 0 ? (
        <p className="wm-analytics__dim">{TRAFFIC_COPY.noSites}</p>
      ) : (
        <ul className="wm-analytics__sources" data-testid="wm-traffic-sites">
          {sites.map((s) => <SourceRow key={s.domain} name={siteName(s.domain)} count={s.count} max={maxSite} />)}
        </ul>
      )}
    </GlassCard>
  );
};

export type TrafficState =
  | { state: 'loading' }
  | { state: 'refused'; error: unknown }
  | { state: 'failed'; error: unknown; onRetry: () => void }
  | { state: 'ready'; data: TrafficData };

export interface TrafficSectionViewProps {
  period: TrafficPeriod;
  onPeriod: (period: TrafficPeriod) => void;
  traffic: TrafficState;
  /** The chart's days end yesterday, from this time. */
  now: number;
}

/** The section as drawn, from its state: exported for its tests. */
export const TrafficSectionView: React.FC<TrafficSectionViewProps> = ({ period, onPeriod, traffic, now }) => {
  let body: React.ReactNode;
  if (traffic.state === 'refused') {
    body = <ScreenState state="refused" error={traffic.error} />;
  } else if (traffic.state === 'failed') {
    body = <ScreenState state="failed" error={traffic.error} fallback={TRAFFIC_COPY.loadError} onRetry={traffic.onRetry} />;
  } else if (traffic.state === 'loading') {
    body = (
      <div className="wm-analytics__stack" aria-busy="true" role="status" aria-label={TRAFFIC_COPY.loading}>
        <Skeleton height={112} rounded="lg" />
        <Skeleton height={320} rounded="lg" />
      </div>
    );
  } else if (noVisitsYet(traffic.data.summary)) {
    body = (
      <GlassCard padding="20px">
        <p className="wm-analytics__empty" data-testid="wm-traffic-empty">{TRAFFIC_COPY.empty}</p>
      </GlassCard>
    );
  } else {
    const { data } = traffic;
    body = (
      <div className="wm-analytics__stack">
        <GlassCard padding="20px">
          <div className="wm-analytics__figures" data-testid="wm-traffic-figures">
            {trafficFigures(data.summary, period).map((f) => (
              <Figure key={f.key} testId={`wm-traffic-figure-${f.key}`} label={f.label} value={f.value} change={f.change} detail={f.detail} />
            ))}
          </div>
        </GlassCard>
        <GlassCard padding="20px">
          <VisitorsPerDay days={chartDays(data.days, period, now)} />
        </GlassCard>
        <div className="wm-analytics__pair">
          <TopPages pages={data.pages} />
          <Sources sources={data.sources} />
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="wm-analytics-traffic-title" data-testid="wm-analytics-traffic" className="wm-analytics__section">
      <div className="wm-analytics__section-head">
        <h2 id="wm-analytics-traffic-title" className="wm-analytics__section-title">{TRAFFIC_COPY.title}</h2>
        <div className="wm-analytics__periods" role="group" aria-label={TRAFFIC_COPY.period}>
          {TRAFFIC_PERIODS.map((p) => (
            <Button key={p.key} size="sm" variant={period === p.key ? 'primary' : 'outline'} aria-pressed={period === p.key} onClick={() => onPeriod(p.key)}>
              {p.label}
            </Button>
          ))}
        </div>
      </div>
      {body}
    </section>
  );
};

/**
 * The four reads through the plugin's proxy (summary, timeseries, pages and
 * referrers, each allowed to sites by the route table), for the period.
 */
export function useTraffic(period: TrafficPeriod): { traffic: TrafficState; now: number } {
  const instanceId = getInstanceId() || '';
  const base = instanceId ? `analytics/${instanceId}` : null;
  const summary = useProxyQuery<unknown>(base && `${base}/summary`, { period });
  const days = useProxyQuery<unknown>(base && `${base}/timeseries`, { metric: 'visitors', granularity: 'day', period });
  const pages = useProxyQuery<unknown>(base && `${base}/pages`, { sort: 'views', limit: 5, period });
  const sources = useProxyQuery<unknown>(base && `${base}/referrers`, { period });
  const reads = [summary, days, pages, sources];
  const ready = reads.every((r) => r.status === 'ready');

  const data = useMemo<TrafficData | null>(() => {
    if (!ready) return null;
    const s = readTraffic(summary.data);
    const d = readDays(days.data);
    const p = readTopPages(pages.data);
    const o = readSources(sources.data);
    return s && d && p && o ? { summary: s, days: d, pages: p, sources: o } : null;
  }, [ready, summary.data, days.data, pages.data, sources.data]);
  // The chart ends yesterday, from the moment the answers came.
  const now = useMemo(() => Date.now(), [data]);

  const refused = reads.find((r) => r.status === 'refused');
  const failed = reads.find((r) => r.status === 'failed');
  const retry = () => { for (const r of reads) if (r.status !== 'ready') void r.refetch(); };
  let traffic: TrafficState;
  if (refused) traffic = { state: 'refused', error: refused.error };
  else if (failed) traffic = { state: 'failed', error: failed.error, onRetry: retry };
  else if (!ready) traffic = { state: 'loading' };
  // An answer that is not what the route sends: said like any failure.
  else if (!data) traffic = { state: 'failed', error: null, onRetry: () => { for (const r of reads) void r.refetch(); } };
  else traffic = { state: 'ready', data };
  return { traffic, now };
}

export const TrafficSection: React.FC = () => {
  const [period, setPeriod] = useState<TrafficPeriod>('30d');
  const { traffic, now } = useTraffic(period);
  return <TrafficSectionView period={period} onPeriod={setPeriod} traffic={traffic} now={now} />;
};

/** WordPress does not read the networks: one card to the dashboard's Analytics, where they are. */
export function ChannelsCard() {
  const site = useSiteState();
  const dashboard = dashboardPhrase(siteBrand());
  return (
    <section aria-labelledby="wm-analytics-channels-title" data-testid="wm-analytics-channels" className="wm-analytics__section">
      <h2 id="wm-analytics-channels-title" className="wm-analytics__section-title wm-analytics__section-title--alone">{ANALYTICS_PAGE_COPY.channelsTitle}</h2>
      <GlassCard padding="16px 20px">
        <div className="wm-analytics__channels">
          <ChartNoAxesColumn size={22} strokeWidth={1.8} className="wm-analytics__channels-glyph" />
          <p className="wm-analytics__channels-text">{ANALYTICS_PAGE_COPY.channelsText}</p>
          <a
            className="wm-analytics__channels-link"
            href={dashboardLink(site, '/analytics')}
            target="_blank"
            rel="noopener noreferrer"
            title={`Opens ${dashboard} in a new tab`}
            data-testid="wm-analytics-channels-link"
          >
            {ANALYTICS_PAGE_COPY.channelsLink(dashboard)}
            <ExternalLink size={12} />
          </a>
        </div>
      </GlassCard>
    </section>
  );
}

const AnalyticsPage: React.FC = () => (
  <div className="wm-main__inner wm-analytics" style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
    <PageHeader className="wm-analytics__header" title={ANALYTICS_PAGE_COPY.title} subtitle={ANALYTICS_PAGE_COPY.subtitle} />
    <TrafficSection />
    <ChannelsCard />
  </div>
);

export default AnalyticsPage;
