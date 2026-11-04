/**
 * The team and its week, as a Home section (shared 2026-10-16): the team's
 * faces with what each one is doing, then "Your team is on it", this week's
 * plan with what waits for the owner's yes first. The dashboard's Home and
 * the plugin's Overview draw the same card.
 */
import React, { useState } from 'react';
import { GlassCard } from '@yotako/webmaven-ui';
import { ScreensHostProvider } from '../host/HostContext';
import { TeamFacesView, teamFacesShow, useTeamFaceMembers } from '../team/TeamFaces';
import { WeekPlan, weekPlanShows } from './WeekPlan';
import type { BusinessHome } from './useBusinessHome';

export interface TeamWeekCardProps {
  /** The business's Home (useBusinessHome): its plan, its approvals and the team's titles. */
  home: BusinessHome;
  /**
   * The app's own row after the week's (the dashboard's video upsell and
   * its dialog); it counts as something to show.
   */
  upsell?: React.ReactNode;
  /**
   * Refine on a waiting post: the task's title as the model wrote it
   * (refinePrefill makes it the Co-CEO's words). No Refine without it.
   */
  onRefine?: (taskTitle: string) => void;
  /** A yes or a no is on its way (`approved`), or did not go through (null). */
  onDeciding?: (approvalId: string, approved: boolean | null) => void;
  /** A decision went through: what to read again. Default: the whole Home (home.reload). */
  onDecided?: () => void;
  /** In its own card (the default), or bare inside the app's (the dashboard's Home card). */
  card?: boolean;
}

export const TeamWeekCard: React.FC<TeamWeekCardProps> = (props) => (
  <ScreensHostProvider host={props.home.host}>
    <TeamWeekSection {...props} />
  </ScreensHostProvider>
);

const TeamWeekSection: React.FC<TeamWeekCardProps> = ({ home, upsell, onRefine, onDeciding, onDecided, card = true }) => {
  const members = useTeamFaceMembers(home.host.transport, home.instanceId);
  const [receiptShown, setReceiptShown] = useState(false);
  const faces = teamFacesShow(members);
  const week = weekPlanShows(home.plan, home.approvals, upsell);
  if (!faces && !week && !receiptShown) return null;
  const body = (
    <>
      {members && <TeamFacesView members={members} look="home" />}
      <WeekPlan
        instanceId={home.instanceId}
        plan={home.plan}
        approvals={home.approvals}
        catalog={home.catalog}
        upsell={upsell}
        onRefine={onRefine}
        onDeciding={onDeciding}
        onDecided={onDecided ?? home.reload}
        onReceiptShown={setReceiptShown}
      />
    </>
  );
  return card ? <GlassCard padding={24} data-testid="team-week-card">{body}</GlassCard> : body;
};

export default TeamWeekCard;
