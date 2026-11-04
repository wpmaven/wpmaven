import React from 'react';
import { Badge, type BadgeColor } from './Badge';
import { PlanIcon, hasPlanIcon } from './PlanIcon';

export interface PlanTagProps {
  /** The API's plan code (Subscription.plan): its icon, when it has one. */
  code: string | null | undefined;
  /** The plan's name, as the account shows it ("Operator"). */
  name: React.ReactNode;
  /** False on a site under an agency's or a partner's brand: the icons are drawn from the WPMaven mark. */
  showIcon?: boolean;
  color?: BadgeColor;
  className?: string;
  testId?: string;
}

/**
 * The plan in the account menus (2026-10-16): the Badge with the plan's
 * PlanIcon at 14px in place of the dot, where the menus drew an icon beside a
 * Badge that drew its own dot. With no icon to show (a branded site, or a code
 * with no icon such as FREE), a plain tag: no icon and no dot.
 */
export const PlanTag: React.FC<PlanTagProps> = ({ code, name, showIcon = true, color = 'purple', className, testId }) => {
  const icon = showIcon && hasPlanIcon(code) ? <PlanIcon plan={code} size={14} /> : undefined;
  return (
    <Badge color={color} icon={icon} dot={false} className={className} testId={testId}>
      {name}
    </Badge>
  );
};
