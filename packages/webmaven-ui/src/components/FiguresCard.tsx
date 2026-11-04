import React from 'react';
import { GlassCard } from './GlassCard';
import { Skeleton } from './Skeleton';
import s from './FiguresCard.module.css';

export interface FigureItem {
  /** Unique among the items; the label when it is a string. */
  key?: string;
  label: React.ReactNode;
  value: React.ReactNode;
  /** A quieter line under the label ("Each person counted once a day"). */
  hint?: React.ReactNode;
  /** Opens the page behind the number. */
  href?: string;
  onClick?: () => void;
  testId?: string;
}

export interface FiguresCardProps {
  title?: React.ReactNode;
  /** On the right of the title: a link, a period, a chip. */
  action?: React.ReactNode;
  items: ReadonlyArray<FigureItem>;
  /** Draws placeholders in place of the numbers. */
  loading?: boolean;
  /** How many placeholders while loading (default: the items', else 4). */
  loadingCount?: number;
  /** What a screen reader hears while loading. */
  loadingLabel?: string;
  /** The most columns on a wide card, 2 to 4 (default 4). */
  maxColumns?: 2 | 3 | 4;
  className?: string;
  testId?: string;
}

/**
 * Columns for `count` figures: two on a narrow card, then up to `max` on a
 * wide one, chosen so the last row is full when it can be (six figures make
 * two rows of three, not four and two).
 */
export function figureColumns(count: number, max: 2 | 3 | 4 = 4): { narrow: number; wide: number } {
  const n = Math.max(1, count);
  const narrow = Math.min(n, 2);
  if (n <= max) return { narrow, wide: n };
  for (let c = max; c >= 2; c--) if (n % c === 0) return { narrow, wide: c };
  return { narrow, wide: max };
}

/**
 * Several numbers in one card (2026-10-16): the plugin's four stat cards and
 * the dashboard's metric cards, as one. A big number over a short uppercase
 * label, in an even grid of 2 to 4 columns that follows the card's own width
 * (a container query), so it fits a side column as well as the main one.
 * A figure with an href or an onClick opens its page. With no items and not
 * loading, nothing is drawn.
 */
export const FiguresCard: React.FC<FiguresCardProps> = ({
  title,
  action,
  items,
  loading = false,
  loadingCount,
  loadingLabel = 'Loading',
  maxColumns = 4,
  className,
  testId,
}) => {
  if (!loading && items.length === 0) return null;
  const count = loading ? (loadingCount ?? (items.length || 4)) : items.length;
  const cols = figureColumns(count, maxColumns);
  const gridStyle = { '--figures-narrow': cols.narrow, '--figures-wide': cols.wide } as React.CSSProperties;

  return (
    <GlassCard padding="20px 24px" className={[s.root, className].filter(Boolean).join(' ')} data-testid={testId}>
      {(title != null || action != null) && (
        <div className={s.header}>
          {title != null && <h3 className={s.title}>{title}</h3>}
          {action != null && <div className={s.action}>{action}</div>}
        </div>
      )}
      <div className={s.frame}>
        {loading ? (
          <div className={s.grid} style={gridStyle} role="status" aria-label={loadingLabel} aria-busy="true">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className={s.cell}>
                <Skeleton width="55%" height={26} />
                <Skeleton width="70%" height={10} style={{ marginTop: 8 }} />
              </div>
            ))}
          </div>
        ) : (
          <ul className={s.grid} style={gridStyle}>
            {items.map((item, i) => {
              const body = (
                <>
                  <span className={s.value}>{item.value}</span>
                  <span className={s.label}>{item.label}</span>
                  {item.hint != null && <span className={s.hint}>{item.hint}</span>}
                </>
              );
              const key = item.key ?? (typeof item.label === 'string' ? item.label : String(i));
              return (
                <li key={key} className={s.item} data-testid={item.testId}>
                  {item.href != null ? (
                    <a className={`${s.cell} ${s.link}`} href={item.href} onClick={item.onClick}>{body}</a>
                  ) : item.onClick ? (
                    <button type="button" className={`${s.cell} ${s.link}`} onClick={item.onClick}>{body}</button>
                  ) : (
                    <div className={s.cell}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </GlassCard>
  );
};
