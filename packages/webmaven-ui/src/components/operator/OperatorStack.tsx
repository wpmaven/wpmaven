import React from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { OperatorAvatar, type OperatorPresence } from './OperatorAvatar';
import { operatorTitle } from './catalog';
import s from './OperatorAvatar.module.css';

export interface OperatorStackProps {
  /** API operator ids, in the order to show them. */
  ids: string[];
  /** Titles from the API payload, by id; the catalog's otherwise. */
  titles?: Record<string, string>;
  /** Presence per id (default still). */
  presence?: Record<string, OperatorPresence>;
  /** Faces shown before "+N". */
  max?: number;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** "Web Designer, Content Writer and 2 more". */
export function operatorStackLabel(titles: string[], shown: number): string {
  const named = titles.slice(0, shown);
  const rest = titles.length - named.length;
  if (rest > 0) return `${named.join(', ')} and ${rest} more`;
  if (named.length <= 1) return named.join('');
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}

/** Several members of the team, overlapping, with "+N" past `max`. */
export function OperatorStack({
  ids,
  titles,
  presence,
  max = 3,
  size = 28,
  className,
  style,
}: OperatorStackProps): ReactElement | null {
  const unique = ids.filter((id, i) => ids.indexOf(id) === i);
  if (unique.length === 0) return null;
  // "+1" would take the same room as the face it hides: show the face instead.
  const shown = unique.length === max + 1 ? unique.length : Math.min(max, unique.length);
  const rest = unique.length - shown;
  const names = unique.map((id) => titles?.[id] || operatorTitle(id));

  return (
    <span
      className={[s.stack, className].filter(Boolean).join(' ')}
      style={{ '--wmop-overlap': `${-Math.round(size * 0.3)}px`, ...style } as CSSProperties}
      role="img"
      aria-label={operatorStackLabel(names, shown)}
    >
      {unique.slice(0, shown).map((id, i) => (
        <span key={id} className={s.stackItem} style={{ zIndex: shown - i }}>
          <OperatorAvatar id={id} title={names[i]} presence={presence?.[id]} size={size} decorative />
        </span>
      ))}
      {rest > 0 && (
        <span
          className={`${s.stackItem} ${s.more}`}
          style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)) }}
          aria-hidden
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

export default OperatorStack;
