import React, { type CSSProperties } from 'react';
import { getLanguage, OperatorAvatar, presenceFromState, type OperatorPresence, type OperatorState } from '@yotako/webmaven-ui';
import { OPERATOR_PORTRAIT_COPY } from './operatorPortraitCopy';

export type { OperatorState };

/**
 * The wizard's name for a team member's face. The face, its colours and its
 * presence are the library's OperatorAvatar, the one set every app shows; the
 * wizard keeps its own state words:
 *
 *   state="working"  the arc turns around the disc: someone is on it now
 *   state="speaking" the same arc, so a typing line reads as live
 *   otherwise        a still portrait
 *
 * `presence` takes the library's states directly (queued, done, failed,
 * waiting) and wins over `state`.
 */
export function OperatorPortrait({
  id,
  state = 'still',
  presence,
  size = 40,
  title,
  className,
  style,
}: {
  id: string | undefined;
  state?: OperatorState;
  presence?: OperatorPresence;
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const shown = presence ?? presenceFromState(state);
  // On a page in another language, the whole accessible name in it (the
  // library says its state words in English); an English page as before.
  const words = shown === 'still' ? null : OPERATOR_PORTRAIT_COPY.presence[shown];
  const label = title && getLanguage() !== 'en' ? (words ? OPERATOR_PORTRAIT_COPY.named(title, words) : title) : undefined;
  return (
    <OperatorAvatar
      id={id}
      title={title}
      label={label}
      presence={shown}
      size={size}
      decorative={!title}
      className={className}
      style={style}
    />
  );
}

export default OperatorPortrait;
