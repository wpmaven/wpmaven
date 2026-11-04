import React from 'react';
import { GlassCard } from './GlassCard';
import { Skeleton } from './Skeleton';
import { NavIcon } from '../icons/NavIcon';
import { formatRelativeTime, toDate } from '../lib/timeWords';
import s from './ActivityList.module.css';

export interface ActivityRow {
  id: string;
  /** Drawn first, in a 32px slot: a member's face, an icon. */
  lead?: React.ReactNode;
  /** The sentence: what happened. */
  text: React.ReactNode;
  /** When: an ISO string or a Date. */
  time: string | Date;
  /** Opens what the row is about. */
  href?: string;
  onClick?: () => void;
}

export interface ActivityListProps {
  items: ReadonlyArray<ActivityRow>;
  title?: React.ReactNode;
  /** Shown when there is nothing to list. */
  emptyText?: React.ReactNode;
  /** "See all", on the right of the title: to the full list. */
  seeAll?: { label?: React.ReactNode; href?: string; onClick?: () => void };
  /** The time in words; "5 min ago", "Yesterday", "Oct 3" by default. */
  formatTime?: (time: Date, now: Date) => string;
  /** The "now" the times are read against (tests, a page's own clock). */
  now?: Date;
  /** Draws placeholder rows. */
  loading?: boolean;
  loadingLabel?: string;
  /** In a card (the default), or the bare list inside the caller's own. */
  card?: boolean;
  className?: string;
  testId?: string;
}

/**
 * What happened, newest first (2026-10-16): the plugin's Recent activity and
 * the dashboard's activity rows. Each row is a face or an icon, a sentence
 * and a short time; a row with an href or an onClick opens what it is about.
 * The times are full dates on hover, and machine-readable (<time>).
 */
export const ActivityList: React.FC<ActivityListProps> = ({
  items,
  title,
  emptyText = 'Nothing yet.',
  seeAll,
  formatTime = formatRelativeTime,
  now,
  loading = false,
  loadingLabel = 'Loading',
  card = true,
  className,
  testId,
}) => {
  const at = now ?? new Date();
  const seeAllLabel = seeAll?.label ?? 'See all';
  const seeAllBody = (
    <>
      {seeAllLabel}
      <NavIcon name="chevron-right" size={14} strokeWidth={2} />
    </>
  );

  const header = (title != null || seeAll) && (
    <div className={s.header}>
      {title != null && <h3 className={s.title}>{title}</h3>}
      {seeAll && (seeAll.href != null
        ? <a className={s.seeAll} href={seeAll.href} onClick={seeAll.onClick}>{seeAllBody}</a>
        : <button type="button" className={s.seeAll} onClick={seeAll.onClick}>{seeAllBody}</button>)}
    </div>
  );

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div className={s.list} role="status" aria-label={loadingLabel} aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className={s.row}>
            <span className={s.lead}><Skeleton width={28} height={28} rounded="full" /></span>
            <span className={s.text}><Skeleton width="80%" height={12} /></span>
            <Skeleton width={48} height={10} />
          </div>
        ))}
      </div>
    );
  } else if (items.length === 0) {
    body = <p className={s.empty}>{emptyText}</p>;
  } else {
    body = (
      <ul className={s.list}>
        {items.map((item) => {
          const when = toDate(item.time);
          const inner = (
            <>
              {item.lead != null && <span className={s.lead}>{item.lead}</span>}
              <span className={s.text}>{item.text}</span>
              {when && (
                <time className={s.time} dateTime={when.toISOString()} title={when.toLocaleString('en-US')}>
                  {formatTime(when, at)}
                </time>
              )}
            </>
          );
          return (
            <li key={item.id} className={s.item} data-testid="activity-row">
              {item.href != null ? (
                <a className={`${s.row} ${s.link}`} href={item.href} onClick={item.onClick}>{inner}</a>
              ) : item.onClick ? (
                <button type="button" className={`${s.row} ${s.link}`} onClick={item.onClick}>{inner}</button>
              ) : (
                <div className={s.row}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  const content = <>{header}{body}</>;
  const cls = [s.root, className].filter(Boolean).join(' ');
  return card
    ? <GlassCard padding="20px 24px" className={cls} data-testid={testId}>{content}</GlassCard>
    : <div className={cls} data-testid={testId}>{content}</div>;
};
