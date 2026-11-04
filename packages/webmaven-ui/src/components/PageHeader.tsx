import React from 'react';
import s from './PageHeader.module.css';

export interface PageHeaderProps {
  title: React.ReactNode;
  /** One quiet line under the title. */
  subtitle?: React.ReactNode;
  /** Buttons or links on the right; they wrap under the title on a narrow screen. */
  actions?: React.ReactNode;
  /** The heading's level: h1 for a page, h2 for a header inside one. */
  as?: 'h1' | 'h2';
  className?: string;
  style?: React.CSSProperties;
  /** The heading's id, for an aria-labelledby on the page's region. */
  titleId?: string;
  testId?: string;
}

const shown = (node: React.ReactNode): boolean => node != null && node !== false && node !== '';

/**
 * One page title for the plugin and the dashboard (2026-10-16): Instrument
 * Serif at 20px and weight 400 (--font-title, --text-title), as the dashboard
 * draws its titles, with an optional dim line under it and the page's actions
 * on the right. The page sets the room below it (className or style).
 *
 * Its rules are scoped under the root class, so wp-admin's own h1 and h2
 * (their size, weight, colour and margins, and `.wrap h1`) never reach it.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  actions,
  as: Heading = 'h1',
  className,
  style,
  titleId,
  testId,
}) => (
  // A div, not a header: inside wp-admin a header could read as the page's
  // banner landmark, beside the one WordPress already has.
  <div className={[s.root, className].filter(Boolean).join(' ')} style={style} data-testid={testId}>
    <div className={s.text}>
      <Heading className={s.title} id={titleId}>{title}</Heading>
      {shown(subtitle) && <p className={s.subtitle}>{subtitle}</p>}
    </div>
    {shown(actions) && <div className={s.actions}>{actions}</div>}
  </div>
);
