/**
 * The operator's own note on a change, on its own line under what the change
 * does: smaller and dimmer than the facts, and labeled as the team's words
 * (teamNote.ts). Nothing when the sentence has
 * no note.
 */

import React from 'react';
import { OperatorInline } from '@yotako/wpmaven-onboarding/shared';
import { TEAM_NOTE_LABEL, splitTeamNote } from './teamNote';

export interface TeamNoteLineProps {
  /** The approval's whole sentence, as the API sent it. */
  sentence: string | null | undefined;
  as?: 'p' | 'span' | 'div';
  className?: string;
  style?: React.CSSProperties;
}

export const TeamNoteLine: React.FC<TeamNoteLineProps> = ({ sentence, as = 'span', className, style }) => {
  const { note } = splitTeamNote(sentence);
  if (!note) return null;
  const Tag = as;
  return (
    <Tag
      className={className}
      style={{ fontSize: 12, color: 'var(--text-dim)', ...style }}
      data-testid="approval-team-note"
    >
      {TEAM_NOTE_LABEL} “<OperatorInline text={note} />”
    </Tag>
  );
};

export default TeamNoteLine;
