/**
 * One member of the AI team, with what they are doing worn on the face
 * (webmaven-ui's OperatorAvatar): working, waiting for you, done, could not
 * finish, up next. Sizes by place: a step row, a card, a chat bubble, a panel
 * header. Draws nothing when the library has no faces (a test's stand-in).
 */
import React from 'react';
import * as ui from '@yotako/webmaven-ui';

export type TeamPresence = 'still' | 'working' | 'waiting' | 'done' | 'failed' | 'queued';

export const TEAM_FACE_SIZES = { row: 20, card: 28, bubble: 32, header: 40, hero: 64 } as const;

export interface TeamFaceProps {
  id: string;
  title?: string;
  presence?: TeamPresence;
  size?: keyof typeof TEAM_FACE_SIZES;
  /** True when the title is printed right beside the face. */
  decorative?: boolean;
}

export function TeamFace({ id, title, presence = 'still', size = 'card', decorative }: TeamFaceProps) {
  const Avatar = (ui as unknown as { OperatorAvatar?: React.ComponentType<Record<string, unknown>> }).OperatorAvatar;
  if (typeof Avatar !== 'function') return null;
  return <Avatar id={id} title={title} presence={presence} size={TEAM_FACE_SIZES[size]} decorative={decorative} />;
}
