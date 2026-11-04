/**
 * What an approval card says first: its title and the sentence under it, in
 * both apps (moved from the dashboard's Waiting for you page, 2026-10-16).
 *
 * No runtime imports but the shared text helpers, so the node tests load it.
 */
import type { CSSProperties } from 'react';
import { toPlainLine } from '@yotako/wpmaven-onboarding/shared';
import type { OperatorApproval } from './types';
import { approvalSentence, publishHeading } from './targets';
import { splitTeamNote } from './teamNote';
import { VIDEO_CHOICE_TITLE, isVideoChoiceApproval } from './videoLabel';
import { canRequestChanges } from './previewData';

/** What an approval's heading and the sentence under it are read from. */
export type ApprovalWords = Pick<OperatorApproval, 'reason' | 'toolName'>
  & Partial<Pick<OperatorApproval, 'params' | 'targets' | 'goesToTikTok' | 'changesSite'>>
  & { task?: { title?: string | null } | null };

/** The sentence an approval does, with the TikTok rule (approvalSentence). */
export function sentenceOf(a: ApprovalWords): string | null {
  return approvalSentence({ ...a, params: a.params ?? {} });
}

/**
 * What the change does, without the operator's note (teamNote.ts): a change
 * made through the site's own interface is said from the call itself, and
 * the operator's summary follows as "Your team's note", never as the title
 * or the sentence.
 */
export function factsOf(a: ApprovalWords): string | null {
  const sentence = sentenceOf(a);
  return sentence ? splitTeamNote(sentence).facts || null : null;
}

/**
 * The sentence under the title: fine print, except for a change the
 * operator added a note to, where it is the only word on what the call does
 * and reads at full contrast above the note.
 */
export function underTitleStyle(a: ApprovalWords): CSSProperties {
  return splitTeamNote(sentenceOf(a)).note
    ? { fontSize: 13, color: 'var(--text)' }
    : { fontSize: 12, color: 'var(--text-dim)' };
}

/**
 * The task title is what a person recognises, then the row's sentence. A
 * TikTok row names its networks, whatever it was stored with
 * (approvalSentence). With neither, the heading Your team gives the row ("A
 * change to your site"), never the tool's name (2026-09-29: an internal name
 * like site_database_write is not words). Plain words on one line: it is
 * also the dialog's title, which holds a string.
 */
export function approvalTitle(a: ApprovalWords): string {
  const fallback = isVideoChoiceApproval(a)
    ? VIDEO_CHOICE_TITLE
    : publishHeading({ toolName: a.toolName, params: a.params ?? {}, targets: a.targets, goesToTikTok: a.goesToTikTok })
      ?? (a.changesSite === false ? 'Waiting for your yes' : 'A change to your site');
  return toPlainLine(a.task?.title || factsOf(a) || fallback) || fallback;
}

/**
 * What the approval does, shown under the heading unless the heading already
 * says it. The operator's note is not part of it: TeamNoteLine shows it on
 * its own line.
 */
export function sentenceUnderTitle(a: ApprovalWords): string | null {
  const facts = factsOf(a);
  if (!facts || !toPlainLine(facts)) return null;
  return approvalTitle(a) !== toPlainLine(facts) ? facts : null;
}

/** The sentence under the title, unless the title already is that sentence. */
export function showsReason(a: ApprovalWords): boolean {
  return sentenceUnderTitle(a) !== null;
}

/**
 * Whether asking for changes could do anything here. An action with no copy
 * (a budget change, a store setting) has no wording to rewrite, and the API
 * caps the back-and-forth at three rounds, so the button hides rather than
 * inviting a request that will be refused. A change to the site (a page, a
 * setting) is not a message: the API refuses to rewrite it (revisable: false).
 */
export function canRevise(a: Pick<OperatorApproval, 'params'> & Partial<Pick<OperatorApproval, 'revisable' | 'revisionRound'>>): boolean {
  return canRequestChanges(a);
}

/** The title of whoever on the team asks: the API's, else the catalog's (operatorTitle, passed in). */
export function approvalByTitle(a: Pick<OperatorApproval, 'operatorId'> & Partial<Pick<OperatorApproval, 'operator'>>, catalogTitle: (id: string) => string): string {
  return a.operator?.title || catalogTitle(a.operatorId);
}
