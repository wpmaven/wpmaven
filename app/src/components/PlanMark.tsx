import React from 'react';
import { PlanIcon, hasPlanIcon } from '@yotako/webmaven-ui';
import { isWpmavenSite } from '../utils/brand';

/** On a card, on the left of the plan's name. */
export const PLAN_MARK_CARD = 32;
/** In a row, a line or a heading, on the left of the plan's name. */
export const PLAN_MARK_INLINE = 24;

/**
 * A plan's icon (the kit's PlanIcon, one per plan), from the plan's code, on
 * the left of the plan's name on the same line, as the dashboard draws it.
 * Decorative: the plan's name is right next to it, so the icon is hidden
 * from screen readers (PlanIcon without a label).
 *
 * The icons are drawn from the WPMaven mark, so a site under an agency's or
 * a partner's brand, or a neutral one, shows none. A code with no icon
 * (FREE and the older plans) draws nothing.
 */
export function PlanMark({ plan, size, style }: { plan: string | null | undefined; size: number; style?: React.CSSProperties }) {
  if (!isWpmavenSite() || !hasPlanIcon(plan)) return null;
  return (
    <span data-testid="wm-plan-icon" data-plan={plan} style={{ display: 'inline-flex', flex: '0 0 auto', lineHeight: 0, ...style }}>
      <PlanIcon plan={plan as string} size={size} />
    </span>
  );
}

export default PlanMark;
