/**
 * Your team's tabs (2026-10-16). The dashboard's page for one business of
 * the account has four: Approvals (with how many wait), Plan, Progress and
 * Connect. A site's (the plugin's Your team, which replaces its Tasks page)
 * has three: what waits for a yes is decided on Waiting for you, which a
 * line above the tabs opens.
 *
 * The tab is the app's to keep in its address (the dashboard's ?tab=plan,
 * the plugin's #/team/plan) and to hand to the screen.
 *
 * No runtime imports, so the node tests load it directly.
 */
import type { ScreensScope } from '../host/types';
import { TEAM_TABS_COPY } from './teamCopy';

export type TeamTab = 'approvals' | 'plan' | 'progress' | 'connect';

/** The tabs' names, in the page's language (./teamCopy, namespace screensTeamTabs), read where they are drawn. */
export const TEAM_TAB_LABELS: Readonly<Record<TeamTab, string>> = {
  get approvals(): string { return TEAM_TABS_COPY.approvals; },
  get plan(): string { return TEAM_TABS_COPY.plan; },
  get progress(): string { return TEAM_TABS_COPY.progress; },
  get connect(): string { return TEAM_TABS_COPY.connect; },
};

/** The tabs a scope shows, in their order. */
export function teamTabs(scope: ScreensScope): TeamTab[] {
  return scope.kind === 'site' ? ['plan', 'progress', 'connect'] : ['approvals', 'plan', 'progress', 'connect'];
}

export function isTeamTab(v: unknown): v is TeamTab {
  return v === 'approvals' || v === 'plan' || v === 'progress' || v === 'connect';
}

/**
 * The tab on screen: the one the address names when the screen shows it,
 * else the first one (`tabs`: the ones shown, the scope's by default).
 */
export function activeTeamTab(named: string | null | undefined, scope: ScreensScope, tabs: readonly TeamTab[] = teamTabs(scope)): TeamTab {
  return isTeamTab(named) && tabs.includes(named) ? named : tabs[0] ?? 'plan';
}

/** "Approvals (3)"; just the name when nothing waits. */
export function teamTabLabel(tab: TeamTab, waiting = 0): string {
  return tab === 'approvals' && waiting > 0 ? TEAM_TABS_COPY.withCount(TEAM_TAB_LABELS.approvals, waiting) : TEAM_TAB_LABELS[tab];
}

/** The line a site shows above its tabs: "3 waiting for your yes". */
export function waitingLine(count: number): string {
  return TEAM_TABS_COPY.waitingLine(count);
}
