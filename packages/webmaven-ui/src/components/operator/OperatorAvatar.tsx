import React from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { OperatorFace } from './faces';
import { operatorTitle } from './catalog';
import { operatorAccent } from '../../foundation/tokens';
import s from './OperatorAvatar.module.css';

/**
 * A member of the team, with what they are doing worn on the avatar.
 *
 *   still    the portrait alone
 *   working  an arc in the member's colour turns around the disc
 *            (with reduced motion: a still three-quarter arc)
 *   waiting  a still full ring and a dot badge: something waits for the owner
 *   done     a check badge
 *   failed   a cross badge
 *   queued   the portrait dimmed and desaturated: up next
 *
 * The face never animates; only the arc does. Every state is also in the
 * accessible name ("Web Designer, working"), and each badge has its own shape,
 * so no state is told by colour alone.
 */
export type OperatorPresence = 'still' | 'working' | 'waiting' | 'done' | 'failed' | 'queued';

export const OPERATOR_PRESENCES: readonly OperatorPresence[] = [
  'still',
  'working',
  'waiting',
  'done',
  'failed',
  'queued',
];

/** The words read after the title for each presence. */
export const OPERATOR_PRESENCE_WORDS: Readonly<Record<OperatorPresence, string | null>> = {
  still: null,
  working: 'working',
  waiting: 'waiting for you',
  done: 'done',
  failed: 'could not finish',
  queued: 'up next',
};

/** The sizes the surfaces use: step rows, cards, chat bubbles, panel headers, heroes. */
export const OPERATOR_AVATAR_SIZES = {
  row: 20,
  card: 28,
  bubble: 32,
  header: 40,
  hero: 64,
} as const;

export interface OperatorAvatarProps {
  /** An API operator id. An unknown id draws a neutral silhouette, never nothing. */
  id: string | null | undefined;
  /** The title from the API payload; the accessible name. Defaults to the catalog's. */
  title?: string;
  presence?: OperatorPresence;
  /** In px; see OPERATOR_AVATAR_SIZES. */
  size?: number;
  /** True when the same title and state are printed right next to the avatar. */
  decorative?: boolean;
  /** Replaces the whole accessible name ("{title}, {state}"). */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** "Web Designer, working": the name a screen reader gives the avatar. */
export function operatorAvatarLabel(title: string, presence: OperatorPresence = 'still'): string {
  const words = OPERATOR_PRESENCE_WORDS[presence];
  return words ? `${title}, ${words}` : title;
}

function ringGeometry(size: number) {
  const stroke = size >= 40 ? 2.5 : size >= 28 ? 2 : 1.5;
  const gap = size >= 40 ? 3 : 2;
  const r = size / 2 + gap + stroke / 2;
  const box = size + 2 * (gap + stroke);
  const circumference = 2 * Math.PI * r;
  return { stroke, r, box, offset: gap + stroke, circumference };
}

function badgeSize(size: number): number {
  return Math.max(9, Math.min(22, Math.round(size * 0.36)));
}

export function OperatorAvatar({
  id,
  title,
  presence = 'still',
  size = OPERATOR_AVATAR_SIZES.header,
  decorative = false,
  label,
  className,
  style,
}: OperatorAvatarProps): ReactElement {
  const name = title || operatorTitle(id);
  const a11y = decorative
    ? { 'aria-hidden': true as const }
    : { role: 'img' as const, 'aria-label': label ?? operatorAvatarLabel(name, presence) };
  const halo = presence === 'working' || presence === 'waiting';
  const badge = presence === 'waiting' || presence === 'done' || presence === 'failed';
  const ring = ringGeometry(size);
  const b = badgeSize(size);
  const dot = Math.round(b * 0.8);

  const rootStyle = {
    width: size,
    height: size,
    '--wmop-accent': operatorAccent(id),
    '--wmop-accent-dark': operatorAccent(id, 'dark'),
    ...style,
  } as CSSProperties;

  return (
    <span
      className={[s.root, presence === 'queued' ? s.queued : '', className].filter(Boolean).join(' ')}
      style={rootStyle}
      data-operator-avatar={id ?? ''}
      data-presence={presence}
      {...a11y}
    >
      <span className={s.disc}>
        <OperatorFace id={id} size={size} />
      </span>
      {halo && (
        <svg
          className={`${s.halo} ${presence === 'working' ? s.orbit : ''}`}
          width={ring.box}
          height={ring.box}
          viewBox={`0 0 ${ring.box} ${ring.box}`}
          style={{ top: -ring.offset, left: -ring.offset }}
          aria-hidden
          focusable="false"
        >
          <circle
            className={presence === 'working' ? s.arc : s.ring}
            cx={ring.box / 2}
            cy={ring.box / 2}
            r={ring.r}
            fill="none"
            strokeWidth={ring.stroke}
            transform={`rotate(-90 ${ring.box / 2} ${ring.box / 2})`}
            style={{
              '--wmop-run': `${(ring.circumference * 0.26).toFixed(2)} ${(ring.circumference * 0.74).toFixed(2)}`,
              '--wmop-still': `${(ring.circumference * 0.75).toFixed(2)} ${(ring.circumference * 0.25).toFixed(2)}`,
            } as CSSProperties}
          />
        </svg>
      )}
      {badge && (
        <span
          className={`${s.badge} ${presence === 'done' ? s.badgeDone : presence === 'failed' ? s.badgeFailed : s.badgeWaiting}`}
          style={presence === 'waiting' ? { width: dot, height: dot } : { width: b, height: b }}
          aria-hidden
        >
          {presence === 'done' && (
            <svg viewBox="0 0 16 16" focusable="false">
              <path d="M3.6 8.4 L6.7 11.3 L12.4 5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {presence === 'failed' && (
            <svg viewBox="0 0 16 16" focusable="false">
              <path d="M5 5 L11 11 M11 5 L5 11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          )}
        </span>
      )}
    </span>
  );
}

export default OperatorAvatar;
