import React from 'react';
import { WaitingForYou, type WaitingTab } from '@yotako/wpmaven-screens';
import { useSubPath } from '../../store/shared/useSubPath';
import { usePluginScreensHost } from '../../../../screens/pluginScreensHost';

/**
 * Waiting for you (1.7.0): the dashboard's own screen, shared through
 * @yotako/wpmaven-screens, for this site alone. Everything that needs the
 * owner, in the same tabs and on the same cards as in the dashboard: what
 * the team wants to publish (changes to the site, posts and messages to
 * customers, money), what was said yes to and waits for the plan's
 * actions, the changes a person on the team prepared, what is worth
 * fixing, and the customers who can still be answered. Each card is
 * decided here; the dashboard opens only where the API keeps the decision
 * there (a post to TikTok, an upload to YouTube, buying more actions).
 *
 * The page gives the screen the plugin's host (its proxy, this site, its
 * own pages, its words) and the tab in the address, after #/approvals
 * (#/approvals/yes), set with a push so Back returns to the tab before.
 */
export default function ApprovalsPage() {
  const host = usePluginScreensHost();
  const { parts, go } = useSubPath('approvals');
  return (
    <div className="wm-main__inner" style={{ padding: '24px', maxWidth: 760, margin: '0 auto' }}>
      <div data-testid="wm-approvals">
        <WaitingForYou
          host={host}
          tab={parts[0] ?? null}
          onTabChange={(key: WaitingTab) => go([key])}
          tabHref={(key: WaitingTab) => `#/approvals/${key}`}
        />
      </div>
    </div>
  );
}
