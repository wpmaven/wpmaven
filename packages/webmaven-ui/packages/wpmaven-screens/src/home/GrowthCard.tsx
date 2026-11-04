/**
 * The growth card (2026-10-11, shared 2026-10-16): the plan's chart and,
 * beside it, the milestones checklist, as the dashboard's Home draws them
 * for one business. The plugin's Overview draws the same card, the chart
 * included (2026-10-17). With the charts off (`chartsActive={false}`) it is
 * the checklist alone, at the card's whole width.
 *
 * The milestones read the plan, the channels and the year's money; until
 * those answer they state nothing (a placeholder at their own height). The
 * chart reads the forecast the owner accepted, the weekly check-ins and
 * this week's money.
 */
import React from 'react';
import { GlassCard } from '@yotako/webmaven-ui';
import { ScreensHostProvider } from '../host/HostContext';
import { connectedCount, postableCount } from '../team/connectRules';
import { GrowthGraph, asScenario, type GrowthEvent } from './GrowthGraph';
import { MilestoneChecklist } from './MilestoneChecklist';
import { checklistShows, type MilestoneInputs } from './milestoneLadder';
import { SampleFiguresChip } from './SampleFiguresChip';
import { useHomeSectionStyles } from './styles';
import type { FrozenForecast } from './reads';
import type { BusinessHome } from './useBusinessHome';

/** The tools that publish to the business's channels: a first post is one of these. */
export const PUBLISH_TOOLS: readonly string[] = ['social_post', 'social_publish'];

/**
 * The milestones' inputs, from verified state only; a source that did not
 * answer is null and its step is hidden, never drawn as regressed.
 *
 * `businessStatus` is the business's own state as the app knows it: 'active'
 * is live, 'paused' says nothing (a business over the plan's cap is paused
 * though it deployed and published, so its "Business live" tick must not go
 * out), anything else is not live yet. Absent (a site the plugin runs on):
 * live.
 */
export function homeMilestoneInputs(home: Pick<BusinessHome, 'plan' | 'approvals' | 'connect' | 'financeYear'>, businessStatus?: string | null): MilestoneInputs {
  const { plan, approvals, connect, financeYear } = home;
  const publishedViaApproval = approvals.some((a) => a.status === 'EXECUTED' && PUBLISH_TOOLS.includes(a.toolName));
  const launchPostRan = (plan?.tasks ?? []).some((t) => t.sourceKind === 'launch_post' && t.lastRunAt != null);
  const status = businessStatus === undefined ? 'active' : businessStatus;
  return {
    businessLive: status === 'active' ? true : (status === 'paused' ? null : false),
    // A channel counts once a post can really go out there (the API's
    // `postable`), not merely once it is connected.
    channelsConnected: connect ? postableCount(connect.networks) > 0 : null,
    anyChannelConnected: connect ? connectedCount(connect.networks) > 0 : null,
    firstPostPublished: plan || approvals.length ? publishedViaApproval || launchPostRan : null,
    // A post waiting for the owner's yes: the first post is theirs to approve.
    firstPostWaiting: approvals.some((a) => a.status === 'PENDING' && PUBLISH_TOOLS.includes(a.toolName)),
    // Year-scoped so lifetime milestones never reset on Monday.
    orderCount: financeYear?.orderCount ?? null,
  };
}

/**
 * The flags on the chart's baseline: real dates only, and only for things
 * that can be proved. A milestone that cannot be dated gets no flag.
 */
export function homeGrowthEvents(home: Pick<BusinessHome, 'plan' | 'approvals' | 'progress'>): GrowthEvent[] {
  const { plan, approvals, progress } = home;
  const events: GrowthEvent[] = [];
  if (plan?.activatedAt) events.push({ label: 'Launched', at: plan.activatedAt });
  const firstPublish = approvals
    .filter((a) => a.status === 'EXECUTED' && PUBLISH_TOOLS.includes(a.toolName) && a.executedAt)
    .map((a) => a.executedAt as string)
    .sort()[0]
    ?? (plan?.tasks ?? [])
      .filter((t) => t.sourceKind === 'launch_post' && t.lastRunAt)
      .map((t) => t.lastRunAt as string)
      .sort()[0];
  if (firstPublish) events.push({ label: 'First post', at: firstPublish });
  const firstSale = [...progress]
    .filter((sn) => (sn.actuals?.revenueCents ?? 0) > 0)
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))[0]?.periodStart;
  if (firstSale) events.push({ label: 'First sale', at: firstSale });
  return events;
}

/** Whether the milestones are still waiting for their sources (the plan, the channels, the year's money). */
export function milestonesLoading(home: Pick<BusinessHome, 'planLoaded' | 'connectLoaded' | 'financeYearLoaded'>): boolean {
  return !home.planLoaded || !home.connectLoaded || !home.financeYearLoaded;
}

export interface GrowthCardProps {
  /** The business's Home (useBusinessHome). */
  home: BusinessHome;
  /**
   * The plan's chart ("Your plan, and where you are"). False draws no chart,
   * the milestones checklist alone. Default true.
   */
  chartsActive?: boolean;
  /**
   * The business's state, as the app knows it ('active', 'paused', ...).
   * Absent: live (a site the plugin runs on).
   */
  businessStatus?: string | null;
  /** The business's site, for "Share your store"; that button is left out without one. */
  site?: { url: string; name?: string | null } | null;
  /**
   * A milestone's request ("Ask for your first post"): it goes in the
   * Co-CEO's box, which takes the owner to it, and is never sent for them.
   * The ask buttons are left out without it.
   */
  onAsk?: (text: string) => void;
  /** In its own card (the default), or bare inside the app's (the dashboard's Home card). */
  card?: boolean;
}

/**
 * The plan and where the business stands, with the milestones beside the
 * chart: two columns once the card is wide enough (640px inside it), the
 * chart first when they stack. Nothing at all while it has nothing to show:
 * no chart (no accepted forecast, or the charts off) and no milestone.
 */
export const GrowthCard: React.FC<GrowthCardProps> = (props) => (
  <ScreensHostProvider host={props.home.host}>
    <GrowthSection {...props} />
  </ScreensHostProvider>
);

const GrowthSection: React.FC<GrowthCardProps> = ({ home, chartsActive = true, businessStatus, site = null, onAsk, card = true }) => {
  useHomeSectionStyles();
  const { plan, finance, financeYear, progress } = home;
  const inputs = homeMilestoneInputs(home, businessStatus);
  const loading = milestonesLoading(home);
  const frozen = plan?.forecast as FrozenForecast;
  const hasChart = chartsActive && !!frozen?.assumptions && !!plan?.activatedAt;
  const hasChecklist = checklistShows(inputs, loading);
  if (!hasChart && !hasChecklist) return null;

  const body = (
    <div className="wms-growth" data-charts={chartsActive ? 'on' : 'off'}>
      <div className="wms-growth-grid">
        {hasChart && (
          <div data-growth="chart">
            {/* This period's point is the API's development sample (never in production). */}
            {finance?.sample && <SampleFiguresChip style={{ marginBottom: 8 }} />}
            <GrowthGraph
              assumptions={frozen?.assumptions ?? null}
              currency={frozen?.currency || financeYear?.currency || 'USD'}
              scenario={asScenario(frozen?.scenario)}
              snapshots={progress}
              activatedAt={plan?.activatedAt ?? null}
              events={homeGrowthEvents(home)}
              currentPeriodCents={finance?.netRevenue != null ? Math.round(finance.netRevenue * 100) : null}
              // The team's work per week, the bars under the chart: the runs
              // the plan has it do with the runs done inside, or, without
              // those, what went out.
              published={plan?.publishedByWeek ?? null}
              planned={plan?.plannedByWeek ?? null}
              ran={plan?.ranByWeek ?? null}
            />
          </div>
        )}
        {hasChecklist && (
          <div data-growth="steps">
            {/* The year's figures are the API's development sample (never in production). */}
            {financeYear?.sample && <SampleFiguresChip style={{ marginBottom: 8 }} />}
            <MilestoneChecklist
              inputs={inputs}
              loading={loading}
              site={site}
              onAsk={onAsk}
            />
          </div>
        )}
      </div>
    </div>
  );
  return card ? <GlassCard padding={24} data-testid="growth-card">{body}</GlassCard> : body;
};

export default GrowthCard;
