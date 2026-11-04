import React from 'react';
import { NavIcon } from '../icons/NavIcon';
import s from './NavItem.module.css';

interface NavItemOwnProps {
  label: React.ReactNode;
  /** Drawn in a 20px slot left of the label: a NavIcon, a SiteIcon, any glyph. */
  icon?: React.ReactNode;
  /** The page this row opens is the one on screen. */
  active?: boolean;
  /** A count in the dashboard's bubble: hidden at 0 (or below), "9+" past 9. */
  badge?: number | string | null;
  /** What a screen reader hears for the badge ("3 waiting for you"); the bubble itself is then silent. */
  badgeLabel?: string;
  /** Opens outside the app: a small arrow after the label, and a new tab for an href. */
  external?: boolean;
  /** What a screen reader hears after an external row's label. */
  externalLabel?: string;
  href?: string;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  testId?: string;
  title?: string;
  className?: string;
}

export type NavItemProps<C extends React.ElementType = 'a'> = NavItemOwnProps & {
  /** The element or component to render: a router's link (react-router's NavLink, given `to`). Without it, an `<a>` with an href, else a button. */
  as?: C;
} & Omit<React.ComponentPropsWithoutRef<C>, keyof NavItemOwnProps | 'as' | 'children'>;

/** The count as the bubble shows it, or null when there is none to show. */
export function navBadgeText(badge: number | string | null | undefined): string | null {
  if (badge == null) return null;
  const text = String(badge).trim();
  if (!text) return null;
  const n = typeof badge === 'number' ? badge : /^-?\d+$/.test(text) ? Number(text) : NaN;
  if (Number.isNaN(n)) return text;
  if (n > 9) return '9+';
  return n >= 1 ? String(Math.floor(n)) : null;
}

/**
 * One row of a sidebar (2026-10-16), as the dashboard draws its own: a 20px
 * icon, the label at 15px medium, 10px corners; the open page tinted with the
 * accent, its label in the accent and semibold; the others in the dim text.
 * A count shows in the dashboard's dark bubble.
 *
 * Router-free: the dashboard passes react-router's NavLink as `as` (with `to`),
 * the plugin an `href` to its hash route or an `onClick`. `active` is the
 * caller's to say.
 *
 * Inside wp-admin, WordPress colours every link and rings it on focus: the row
 * sets its colour, ground and shadow for each of those states itself.
 */
export function NavItem<C extends React.ElementType = 'a'>({
  as,
  label,
  icon,
  active = false,
  badge,
  badgeLabel,
  external = false,
  externalLabel = '(opens in a new tab)',
  href,
  onClick,
  testId,
  title,
  className,
  ...rest
}: NavItemProps<C>) {
  const Comp: React.ElementType = as ?? (href != null ? 'a' : 'button');
  const count = navBadgeText(badge);
  const linkProps: Record<string, unknown> = {};
  if (href != null) linkProps.href = href;
  if (Comp === 'button') linkProps.type = 'button';
  if (external && href != null) {
    linkProps.target = '_blank';
    linkProps.rel = 'noopener noreferrer';
  }
  return (
    <Comp
      {...linkProps}
      {...rest}
      className={[s.row, active ? s.active : '', className].filter(Boolean).join(' ')}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      title={title}
      data-testid={testId}
      data-active={active ? 'true' : undefined}
    >
      {icon != null && <span className={s.icon} aria-hidden="true">{icon}</span>}
      <span className={s.label}>{label}</span>
      {external && (
        <span className={s.external}>
          <NavIcon name="arrow-top-right-on-square" size={14} />
          <span className={s.srOnly}>{externalLabel}</span>
        </span>
      )}
      {count != null && (
        badgeLabel
          ? <><span className={s.badge} aria-hidden="true">{count}</span><span className={s.srOnly}>{badgeLabel}</span></>
          : <span className={s.badge}>{count}</span>
      )}
    </Comp>
  );
}
