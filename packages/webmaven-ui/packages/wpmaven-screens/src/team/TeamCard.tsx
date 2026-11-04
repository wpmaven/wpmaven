/**
 * The card Your team draws a team member's work on: an approval (the
 * dashboard's Approvals tab draws the shared approval card inside it), a
 * task of the plan, the work going on now, a week's check-in. One look for
 * all of them, the approval's, in both apps since
 * 2026-10-16:
 *
 *   frame    the kit's Card and its content padding
 *   header   the member's face, with what they are doing on it, and their
 *            title in their colour; what the card is about; on the right its
 *            status badge and when
 *   body     the card's own content
 *   actions  small buttons in a row under it, from the left
 *
 * A card where the member speaks (the Plan tab's) signs the bubble with the
 * face instead, beside its small corner (the kit's ChatBubble with an
 * author): the header then carries the title alone, so one face per card.
 *
 * Inline styles on the kit's tokens: the plugin has none of the dashboard's
 * utility classes, and every margin is set (wp-admin gives a bare <p> its own).
 */
import React from 'react';
import {
  Badge, Card, CardContent, ChatBubble, OperatorAvatar, OPERATOR_AVATAR_SIZES,
  type BadgeColor, type OperatorPresence,
} from '@yotako/webmaven-ui';

/** A card's status, in words and in one of the badge colours. */
export interface TeamCardStatus {
  color: BadgeColor;
  label: string;
}

/** Who a card is about: the catalog's id, title and colour. */
export interface TeamCardMember {
  id: string;
  title: string;
  color: BadgeColor;
}

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 };
const dimSmall: React.CSSProperties = { fontSize: 12, lineHeight: 1.4, color: 'var(--text-dim)' };

/** The member's face, with what they are doing on it, and their title in their colour. */
export function OperatorChip({ meta, presence = 'still', face = true }: { meta: TeamCardMember; presence?: OperatorPresence; face?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {face && <OperatorAvatar id={meta.id} title={meta.title} presence={presence} size={OPERATOR_AVATAR_SIZES.card} decorative />}
      <Badge color={meta.color}>{meta.title}</Badge>
    </span>
  );
}

/** The frame: the kit's Card and its content padding. */
export function TeamCardFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function TeamCardHeader({ member, presence, title, note, status, when, asideWraps = false, face = true }: {
  member: TeamCardMember;
  presence?: OperatorPresence;
  /** What the card is about, beside the member. */
  title?: React.ReactNode;
  /** A small word after the title (a plan task's channel). */
  note?: React.ReactNode;
  status?: TeamCardStatus | null;
  /** On the right, after the status. */
  when?: React.ReactNode;
  /**
   * The status and when may go on two lines: a card in a narrow column
   * (the Plan tab's right one) whose schedule is long.
   */
  asideWraps?: boolean;
  /** The face in the header (false where the member signs a bubble under it). */
  face?: boolean;
}) {
  return (
    <div style={{ ...row, justifyContent: 'space-between' }} data-team-card-header="">
      <div style={row}>
        <OperatorChip meta={member} presence={presence} face={face} />
        {title != null && title !== false && <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', overflowWrap: 'anywhere' }}>{title}</span>}
        {note != null && note !== false && <span style={dimSmall}>{note}</span>}
      </div>
      {(status || when) && (
        <div style={{ display: 'flex', flexWrap: asideWraps ? 'wrap' : 'nowrap', alignItems: 'center', gap: 8 }}>
          {status && <Badge color={status.color}>{status.label}</Badge>}
          {when && <span style={dimSmall}>{when}</span>}
        </div>
      )}
    </div>
  );
}

/** The buttons, small, in a row from the left. */
export function TeamCardActions({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }} data-team-card-actions="">{children}</div>;
}

/** A whole card: the header, the body, then the actions (a TeamCardActions row, or nothing). */
export function TeamCard({ member, presence = 'still', title, note, status, when, actions, children, testId, face = true }: {
  member: TeamCardMember;
  presence?: OperatorPresence;
  title?: React.ReactNode;
  note?: React.ReactNode;
  status?: TeamCardStatus | null;
  when?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  testId?: string;
  /** The face in the header (false where the member signs a bubble). */
  face?: boolean;
}) {
  return (
    <article data-testid={testId} data-presence={presence} style={{ minWidth: 0 }}>
      <TeamCardFrame>
        <TeamCardHeader member={member} presence={presence} title={title} note={note} status={status} when={when} asideWraps face={face} />
        {children}
        {actions}
      </TeamCardFrame>
    </article>
  );
}

/**
 * A member speaking: the card's header (their title, what it is about, the
 * status and when), then what they say in a bubble they sign with their
 * face, with what they are doing on it; then what goes under (where it was
 * made, an error) and the buttons. The sentences come from the data
 * (tasks.ts), never from a model.
 */
export const SpeakingCard: React.FC<{
  member: TeamCardMember;
  presence: OperatorPresence;
  status: TeamCardStatus;
  lines: ReadonlyArray<string>;
  /** The schedule, on the right after the status. */
  when?: string | null;
  /** What the card is about, beside the member (a plan task's title). */
  title?: React.ReactNode;
  /** A small word after the title (a plan task's channel). */
  note?: React.ReactNode;
  /** Under the bubble: "You asked", where it was made. */
  footer?: React.ReactNode;
  /** What the last press on this card left to say. */
  error?: string | null;
  actions?: React.ReactNode;
  testId: string;
}> = ({ member, presence, status, lines, when, title, note, footer, error, actions, testId }) => (
  <TeamCard testId={testId} member={member} presence={presence} title={title} note={note} status={status} when={when} actions={actions} face={false}>
    <div style={{ marginTop: 12 }}>
      <ChatBubble
        variant="assistant"
        author={{
          avatar: <OperatorAvatar id={member.id} title={member.title} presence={presence} size={OPERATOR_AVATAR_SIZES.bubble} />,
          name: `Your ${member.title}`,
        }}
      >
        {lines.map((line, i) => <p key={i} style={{ margin: i > 0 ? '4px 0 0' : 0, overflowWrap: 'anywhere' }}>{line}</p>)}
      </ChatBubble>
    </div>
    {footer}
    {error && <p role="alert" data-testid="task-error" style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--rose, var(--danger))' }}>{error}</p>}
  </TeamCard>
);
