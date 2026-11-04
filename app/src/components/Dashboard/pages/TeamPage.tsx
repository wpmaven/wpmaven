import React from 'react';
import { YourTeam, type TeamTab } from '@yotako/wpmaven-screens';
import { useSubPath } from '../store/shared/useSubPath';
import { usePluginScreensHost } from '../../../screens/pluginScreensHost';
import { usePluginTeamCatalog } from '../../../screens/teamCatalog';
import { hasFeature, useSiteState } from '../../../utils/siteState';
import '../../../styles/team.css';

/**
 * Your team (1.7.0, once Tasks): the dashboard's own screen, shared through
 * @yotako/wpmaven-screens, for this site's business. The team's faces on
 * top, then Plan, Progress and Connect, with one line above the tabs when
 * something waits for the owner's yes, which opens Waiting for you (a site
 * decides there: no Approvals tab here).
 *
 *   Plan      the business's whole plan, what runs now and what the owner
 *             asked for. Only a task made in WordPress changes here; the
 *             others read only, with a link to the dashboard's Plan. New
 *             task: the owner writes it, the card says it back, Create task.
 *   Progress  the weekly check-ins, and a link to Analytics.
 *   Connect   the channels; connecting one opens the dashboard's Connect
 *             in a new tab, the connection being the account's.
 *
 * The page gives the screen the plugin's host (its proxy, this site, its
 * own pages, its words), the team's catalog read through the wizard's
 * proxy, whether the chat runs here, and the tab in the address, after
 * #/team (#/team/progress), set with a push so Back returns to the tab
 * before.
 */
export default function TeamPage() {
  const host = usePluginScreensHost();
  const site = useSiteState();
  const catalog = usePluginTeamCatalog();
  const { parts, go } = useSubPath('team');
  return (
    <div className="wm-main__inner wm-team" style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }} data-testid="wm-team">
      <YourTeam
        host={host}
        tab={parts[0] ?? null}
        onTabChange={(key: TeamTab) => go([key])}
        tabHref={(key: TeamTab) => `#/team/${key}`}
        catalog={catalog}
        chat={hasFeature(site, 'chat')}
      />
    </div>
  );
}
