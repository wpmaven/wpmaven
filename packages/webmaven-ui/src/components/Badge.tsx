import React from 'react';
import styles from './Badge.module.css';
import type { BadgeColor } from '../foundation/tokens';

// Re-export so consumers can `import { Badge, BadgeColor } from 'webmaven-ui'`
// without reaching into foundation/.
export type { BadgeColor };

export interface BadgeProps {
  color: BadgeColor;
  children: React.ReactNode;
  /** Drawn where the dot is (a plan's icon, a glyph): the badge then has no dot. Decorative. */
  icon?: React.ReactNode;
  /** The coloured dot before the label; false for a plain tag. An icon always replaces it. */
  dot?: boolean;
  className?: string;
  testId?: string;
}

/**
 * A pill label in one of the meaning colours. Since 0.7.0 (2026-10-16) an
 * icon can take the dot's place, so a plan tag shows its plan's icon and no
 * dot beside it, and `dot={false}` draws a plain tag.
 */
export const Badge: React.FC<BadgeProps> = ({ color, children, icon, dot = true, className, testId }) => {
  const hasIcon = icon != null && icon !== false;
  const cls = [
    styles.badge,
    styles[color],
    hasIcon ? styles.withIcon : '',
    hasIcon || !dot ? styles.noDot : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <span className={cls} data-testid={testId}>
      {hasIcon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
};
