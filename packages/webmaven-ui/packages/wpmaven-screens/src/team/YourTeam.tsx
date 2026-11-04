/**
 * Your team: the AI team of one business, the same screen in the dashboard
 * and in the WordPress plugin (2026-10-16). The plugin's Tasks page and the
 * dashboard's Your team drifted apart; the plugin's Tasks becomes this.
 *
 *   on top   the team's faces, with what each one is doing;
 *   tabs     the account's (the dashboard, one business at a time, chosen by
 *            the app): Approvals (n), Plan, Progress, Connect. A site's (the
 *            plugin, its own business): Plan, Progress, Connect, and above
 *            them one line, "3 waiting for your yes", that opens Waiting for
 *            you, where a site decides.
 *
 * The Approvals tab is the app's own (the dashboard's inbox, drawn on the
 * shared approval card), handed in with its count. The Plan tab reads the
 * team's plan, its schedules and its background work, and has New task;
 * Progress reads the weekly check-ins; Connect the business's channels (a
 * site's Connect opens the dashboard: the connection is the account's).
 *
 * The tab is the app's to keep in its address (`tab`, `onTabChange`).
 * People (members, invites) are not here: they are the account's, on the
 * dashboard's own page.
 */
import React, { useEffect, useState } from 'react';
import { NavIcon, PageHeader, Skeleton, Tabs, TabPanel } from '@yotako/webmaven-ui';
import type { ScreensHost } from '../host/types';
import { ScreensHostProvider } from '../host/HostContext';
import { HostLink } from '../host/HostLink';
import { SCREENS_VERSION } from '../version';
import { activeTeamTab, teamTabLabel, teamTabs, waitingLine, type TeamTab } from './tabs';
import { loadCatalog, type TeamCatalog } from './catalog';
import { readWaitingYes, teamBusiness } from './reads';
import { TeamFaces } from './TeamFaces';
import { PlanTab } from './PlanTab';
import { ProgressTab } from './ProgressTab';
import { ConnectTab } from './ConnectTab';

/** How often a site reads again how many approvals wait for a yes. */
const WAITING_POLL_MS = 60_000;

export const YOUR_TEAM_COPY = {
  title: 'Your team',
  subtitle: "Your team's plan, its weekly progress, and the actions waiting for your yes.",
  siteSubtitle: "Your team's plan, its weekly progress, and the channels it posts to.",
  tabsLabel: 'Your team',
  openApprovals: 'Open Approvals',
  openWaiting: 'Open Waiting for you',
};

export interface YourTeamProps {
  host: ScreensHost;
  /**
   * The account's scope: the business on screen, chosen by the app (its
   * picker, a link's business). Null while it is chosen. A site's scope
   * ignores it: the site's own business.
   */
  instanceId?: string | null;
  /** The tab the address names (the dashboard's ?tab=, the plugin's #/team/<tab>), or null. */
  tab: string | null | undefined;
  /** A tab was chosen: the app puts it in its address. */
  onTabChange: (tab: TeamTab) => void;
  /** The address of a tab, for a link's href (a middle click opens it). */
  tabHref?: (tab: TeamTab) => string;
  /** The page's title (the dashboard: "Your teams" with more than one business). Default "Your team". */
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** On the right of the title: the dashboard's business picker. */
  headerActions?: React.ReactNode;
  /**
   * The account's Approvals tab, drawn by the app (its inbox, on the shared
   * approval card), and how many wait. Absent, or in a site's scope: no
   * Approvals tab.
   */
  approvals?: { count: number; panel: React.ReactNode };
  /** The team's titles and colours, when the app holds them; else the screen reads them. */
  catalog?: TeamCatalog | null;
  /** The Co-CEO's chat runs here (the empty plan's hint says where to ask for work). Default yes. */
  chat?: boolean;
}

export const YourTeam: React.FC<YourTeamProps> = (props) => (
  <ScreensHostProvider host={props.host}>
    <YourTeamScreen {...props} />
  </ScreensHostProvider>
);

/** The screen itself, under its host (exported for the node tests' hook harness). */
export const YourTeamScreen: React.FC<YourTeamProps> = ({
  host, instanceId, tab: named, onTabChange, tabHref, title, subtitle, headerActions, approvals, catalog: given, chat = true,
}) => {
  const { transport, scope } = host;
  const site = scope.kind === 'site';
  const business = teamBusiness(scope, instanceId);

  // The catalog: the app's, else read once (a member reads with the kit's title meanwhile).
  const [read, setRead] = useState<TeamCatalog | null>(null);
  useEffect(() => {
    if (given) return undefined;
    let alive = true;
    loadCatalog(transport).then((c) => { if (alive) setRead(c); }).catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [given]);
  const catalog = given ?? read;

  // A site: how many approvals wait for a yes on its business, for the line over the tabs.
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    if (!site || !business) return undefined;
    let alive = true;
    const count = () => {
      readWaitingYes(transport, business).then((n) => { if (alive) setWaiting(n); }).catch(() => undefined);
    };
    count();
    const timer = setInterval(count, WAITING_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, business]);

  const tabs = teamTabs(scope).filter((t) => t !== 'approvals' || !!approvals);
  const tab = activeTeamTab(named, scope, tabs);
  const selectTab = (key: string) => {
    if (key === tab) return;
    host.track?.('team', 'tab', key);
    onTabChange(key as TeamTab);
  };

  /** Where a plan task's yes is given: the account's Approvals tab, a site's Waiting for you. */
  const waitingLink = site
    ? <HostLink to="/waiting" style={{ color: 'var(--purple)', textDecoration: 'underline' }}>{YOUR_TEAM_COPY.openWaiting}</HostLink>
    : approvals
      ? (
        <a
          href={tabHref ? tabHref('approvals') : '?tab=approvals'}
          onClick={(e) => { e.preventDefault(); selectTab('approvals'); }}
          style={{ color: 'var(--purple)', textDecoration: 'underline' }}
        >
          {YOUR_TEAM_COPY.openApprovals}
        </a>
      )
      : null;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}
      data-testid="your-team"
      data-tour-page="team"
      data-scope={scope.kind}
      data-screens-version={SCREENS_VERSION}
    >
      <PageHeader
        title={title ?? YOUR_TEAM_COPY.title}
        subtitle={subtitle ?? (site ? YOUR_TEAM_COPY.siteSubtitle : YOUR_TEAM_COPY.subtitle)}
        actions={headerActions}
      />

      {business && <TeamFaces transport={transport} instanceId={business} />}

      {site && waiting > 0 && (
        <p style={{ margin: 0, fontSize: 'var(--text-data, 13.5px)' }}>
          <HostLink
            to="/waiting"
            testId="team-waiting-line"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)', fontWeight: 600, textDecoration: 'underline' }}
            onClick={() => host.track?.('team', 'click', 'waiting_line')}
          >
            <NavIcon name="bell-alert" size={16} />
            {waitingLine(waiting)}
          </HostLink>
        </p>
      )}

      <div>
        {/* A block around the bar: on a phone it scrolls sideways inside the
            page's width when the labels do not fit. */}
        <div data-testid="team-tabs" style={{ maxWidth: '100%', overflowX: 'auto', marginBottom: 20 }}>
          <Tabs
            items={tabs.map((key) => ({ key, label: teamTabLabel(key, key === 'approvals' ? approvals?.count ?? 0 : 0) }))}
            activeKey={tab}
            onChange={selectTab}
            ariaLabel={YOUR_TEAM_COPY.tabsLabel}
          />
        </div>

        {!business ? (
          <Skeleton height={160} rounded="lg" />
        ) : (
          <>
            <TabPanel isActive={tab === 'approvals'}>
              {tab === 'approvals' && approvals?.panel}
            </TabPanel>
            <TabPanel isActive={tab === 'plan'}>
              {tab === 'plan' && <PlanTab host={host} instanceId={business} catalog={catalog} chat={chat} waitingLink={waitingLink} />}
            </TabPanel>
            <TabPanel isActive={tab === 'progress'}>
              {tab === 'progress' && <ProgressTab host={host} instanceId={business} catalog={catalog} />}
            </TabPanel>
            <TabPanel isActive={tab === 'connect'}>
              {tab === 'connect' && <ConnectTab host={host} instanceId={business} />}
            </TabPanel>
          </>
        )}
      </div>
    </div>
  );
};

export default YourTeam;
