import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChatBubble } from '../ChatBubble';
import { ChatInput } from '../ChatInput';
import { Button } from '../Button';
import { GlassCard } from '../GlassCard';
import { Loader } from '../Loader';
import { AgentTimeline } from '../AgentTimeline';
import { OperatorAvatar, OPERATOR_AVATAR_SIZES, operatorTitle } from '../operator';
import { NavIcon } from '../../icons/NavIcon';
import { operatorAccent } from '../../foundation/tokens';
import type { ChatPanelStatus } from '../ChatPanel';
import type { ToolCallEntry } from '../tools/types';
import {
  CO_CEO_OPERATOR,
  chatConsultsOf,
  chatSaidOf,
  chatSubjectOf,
  chatWorkingLine,
  type ChatMessage,
  type ChatOperatorRef,
} from './events';
import { chatFailedReplyText } from './store';
import { CoCeoSuggestions, type ChatSiteFacts, type CoCeoSuggestionsVariant } from './coCeoSuggestions';
import type { CoCeoChatHandle } from './useCoCeoChat';
import s from './CoCeoChat.module.css';

/** What a renderer gets besides the message. */
export interface ChatRenderContext {
  chat: CoCeoChatHandle;
  /** Who leads the chat, the API's operator id ("chief_of_staff" unless the app named another). */
  lead: string;
  /** The lead's title ("Co-CEO"). */
  title: string;
  /** The kit's own drawing of this message: to wrap, or to fall back to. */
  fallback: () => ReactNode;
}

/**
 * Draws one kind of message. Return a node to draw it, `null` to draw
 * nothing, or `undefined` to leave it to the kit (an approval renderer can
 * draw the edit previews it knows and leave every other approval to the
 * kit's card).
 */
export type ChatRenderer = (message: ChatMessage, ctx: ChatRenderContext) => ReactNode | undefined;

/** Renderers by message kind: user, reply, step, approval, error, notice, or a host's own kind. */
export type ChatRenderers = Record<string, ChatRenderer | undefined>;

export interface CoCeoChatTestIds {
  panel: string;
  message: string;
  step: string;
  working: string;
  input: string;
  send: string;
  approval: string;
}

const TEST_IDS: CoCeoChatTestIds = {
  panel: 'chat-panel',
  message: 'chat-message',
  step: 'chat-step',
  working: 'chat-working',
  input: 'chat-input',
  send: 'chat-send',
  approval: 'approval-card',
};

export type CoCeoChatLook = 'card' | 'full' | 'sidebar';

export interface CoCeoChatProps {
  /** The hook's result: useCoCeoChat(adapter, options). */
  chat: CoCeoChatHandle;
  /** The lead's title in the header ("Your Co-CEO"); the hook's by default. */
  title?: string;
  /** card: Home's card. full: the full view. sidebar: the editor's panel, flush and compact. */
  look?: CoCeoChatLook;
  /** The full view is on: the button says so, and Esc leaves it. */
  full?: boolean;
  /** Draws the full view button (an icon button in the header), once the conversation has a message. */
  onToggleFull?: () => void;
  /** The New chat button (on by default; not for an empty conversation that is the only one). */
  showNewChat?: boolean;
  /** The conversation switcher, when the adapter lists conversations and there is more than one (on by default). */
  showSwitcher?: boolean;
  /**
   * An answer's body inside its bubble: each app passes its Markdown renderer
   * and sanitizer, and what goes under an answer (next steps, receipts). The
   * default is the plain text with its line breaks. The owner's own words
   * never go through it.
   */
  renderReply?: (message: ChatMessage) => ReactNode;
  /** Special messages: edit cards, approval cards, receipts, what a step shows. */
  renderers?: ChatRenderers;
  /**
   * The suggestions an empty conversation shows ("Try asking me to…"), the
   * kit's one catalog: the chips this site can do (`facts`, what the app
   * knows of it; nothing known shows the chips with no condition), for a
   * home or the editor. `lead` is drawn beside their heading (the editor's
   * Web Designer, its face). false for none.
   */
  suggestions?: { variant?: CoCeoSuggestionsVariant; facts?: ChatSiteFacts | null; lead?: ReactNode } | false;
  /** What an empty conversation shows instead of the suggestions. */
  emptyState?: ReactNode;
  /**
   * An empty conversation starts compact (2026-10-17): the header and the box
   * only. The middle (the suggestions, or emptyState) opens once the box has
   * the focus, and closes again when a click or the focus goes outside the
   * chat while it is still empty. On by default for the card, off for the
   * full view and the editor's panel.
   */
  compactWhenEmpty?: boolean;
  /** Above the messages. */
  aboveMessages?: ReactNode;
  /** Over the input, inside its area (the editor's "Talking about" line); it shows in the compact chat too. */
  aboveInput?: ReactNode;
  /** Under the input (the dashboard's plan pauses and gates). */
  footer?: ReactNode;
  placeholder?: string;
  /** Turns the input off (the stream cannot be reached). */
  disabled?: boolean;
  /**
   * Send is off for the app's own reason (a plan pause, a budget used), said
   * beside it; the box stays typeable, so the words wait for Send to come
   * back. Wins over the turn's own reason.
   */
  sendDisabledReason?: string | null;
  /** The keyboard's hint under the box, on the right ("Shift + Enter for a new line" by default; null for none). */
  hint?: string | null;
  /** The stream's state as the app knows it: a banner when it is not connected. */
  status?: ChatPanelStatus;
  /** The thread's height limit in the card (it scrolls past it). */
  threadMaxHeight?: number | string;
  onAttach?: () => void;
  /** A member's title for an id the stream named without one; the kit's catalog otherwise. */
  operatorTitleOf?: (operatorId: string) => string | undefined;
  /** The heading level of "Your Co-CEO" (h2). */
  headingLevel?: 2 | 3 | 4;
  testIds?: Partial<CoCeoChatTestIds>;
  className?: string;
}

export const CHAT_LONG_LINE = 'Bigger requests can take a few minutes. The answer will show up here, even if you leave this page.';
export const CHAT_UNANSWERED_LINE = 'No answer came back for this message. Put it back in the box to send it again.';

/** The header's words: "Your Co-CEO", and ": {subject}" when the conversation has one. */
export function chatHeaderText(title: string, subject: string | null | undefined): { lead: string; subject: string | null; full: string } {
  const lead = `Your ${title}`;
  const sub = chatSubjectOf(subject ?? null);
  return { lead, subject: sub, full: sub ? `${lead}: ${sub}` : lead };
}

/** The answer's words as text, line breaks kept: the default body of a reply. */
const PlainText: React.FC<{ text: string; className?: string }> = ({ text, className }) => (
  <p className={className ?? s.plain}>{text}</p>
);

/** The header's face in the editor's panel, smaller than the card's and the full view's 32px (2026-10-17). */
const SIDEBAR_HEADER_FACE = 24;

/**
 * What another member said to the lead inside a turn (the Co-CEO answering
 * the Web Designer, 2026-10-17): their face at a row's size, "Your Co-CEO",
 * then the words as written, never read as Markdown.
 */
const SaidLine: React.FC<{ operator: string; title: string; text: string }> = ({ operator, title, text }) => (
  <div className={s.said} data-testid="chat-said" data-operator={operator}>
    <p className={s.saidWho}>
      <OperatorAvatar id={operator} title={title} presence="still" size={OPERATOR_AVATAR_SIZES.row} decorative />
      <span>{`Your ${title}`}</span>
    </p>
    <p className={s.saidText}>{text}</p>
  </div>
);

/**
 * The thread in drawing order: the steps of a sub-run (a `parentCallId` of a
 * step in the thread) right under that step, nested; everything else as it
 * came.
 */
export function chatThreadOrder(messages: ChatMessage[]): Array<{ message: ChatMessage; nested: boolean }> {
  const stepIds = new Set<string>();
  for (const m of messages) if (m.step) stepIds.add(m.step.callId);
  const parentOf = (m: ChatMessage): string | null => {
    const parent = m.step?.parentCallId;
    return parent && parent !== m.step?.callId && stepIds.has(parent) ? parent : null;
  };
  const children = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    const parent = parentOf(m);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), m]);
  }
  if (children.size === 0) return messages.map((message) => ({ message, nested: false }));
  const out: Array<{ message: ChatMessage; nested: boolean }> = [];
  const seen = new Set<string>();
  const emit = (m: ChatMessage, nested: boolean) => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    out.push({ message: m, nested });
    for (const child of (m.step && children.get(m.step.callId)) || []) emit(child, true);
  };
  for (const m of messages) if (!parentOf(m)) emit(m, false);
  // Parents that name each other (never sent): drawn where they came.
  for (const m of messages) if (!seen.has(m.id)) emit(m, false);
  return out;
}

/**
 * One chat for the plugin and the dashboard (2026-10-16): "Your Co-CEO" with
 * the Co-CEO's face, the subject once the conversation has one, the thread,
 * the turn's steps and approvals as they come, and the input with the kit's
 * Send. It draws what useCoCeoChat holds; each app keeps its transport, its
 * Markdown and its cards (renderReply, renderers). The chat's lead (the
 * hook's `lead`, the Web Designer in the editor since 2026-10-17) takes the
 * Co-CEO's place everywhere: the header, the working bubble, an answer or an
 * approval that names no one, and the dot of its own steps.
 */
export const CoCeoChat: React.FC<CoCeoChatProps> = ({
  chat,
  title: titleProp,
  look = 'card',
  full = false,
  onToggleFull,
  showNewChat = true,
  showSwitcher = true,
  renderReply,
  renderers,
  suggestions = {},
  emptyState,
  compactWhenEmpty,
  aboveMessages,
  aboveInput,
  footer,
  placeholder,
  disabled = false,
  sendDisabledReason,
  hint,
  status,
  threadMaxHeight,
  onAttach,
  operatorTitleOf,
  headingLevel = 2,
  testIds,
  className = '',
}) => {
  const ids = { ...TEST_IDS, ...testIds };
  // A host's own handle may predate the lead: the Co-CEO then.
  const lead = chat.lead || CO_CEO_OPERATOR;
  const title = titleProp || chat.title;
  const { state } = chat;
  const header = chatHeaderText(title, state.subject);
  const waitingForYou = state.messages.some((m) => m.approval && (m.approval.status === 'waiting' || m.approval.status === 'sending'));
  const busy = state.busy || state.opening;
  const empty = state.messages.length === 0;
  const showEmpty = state.ready && !state.loading && empty && !busy;
  // Compact until the box is focused, and again once the owner leaves the
  // chat with nothing said yet (compactWhenEmpty).
  const [opened, setOpened] = useState(false);
  const compact = (compactWhenEmpty ?? look === 'card') && showEmpty && !opened;
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!opened || !empty || typeof document === 'undefined') return undefined;
    // A click or the focus outside the chat closes it. Not the box's own
    // blur: a click on a suggestion takes the focus from the box (or, in
    // Safari, nowhere) before it lands, and the suggestion would go first.
    const leaves = (e: Event) => {
      const panel = panelRef.current;
      if (panel && e.target instanceof Node && !panel.contains(e.target)) setOpened(false);
    };
    document.addEventListener('pointerdown', leaves, true);
    document.addEventListener('focusin', leaves, true);
    return () => {
      document.removeEventListener('pointerdown', leaves, true);
      document.removeEventListener('focusin', leaves, true);
    };
  }, [opened, empty]);
  const Heading = `h${headingLevel}` as 'h2';

  // A suggestion or a focus request made before this view mounted (the card,
  // before the full view) is not applied again by it.
  const mounted = useRef({ seed: state.seed.token, focus: state.focusToken });
  const seedToken = state.seed.token > mounted.current.seed ? state.seed.token : undefined;
  const focusToken = state.focusToken > mounted.current.focus ? state.focusToken : undefined;

  // Esc leaves the full view (a template slot's own Esc is left alone).
  useEffect(() => {
    if (!full || !onToggleFull || typeof document === 'undefined') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onToggleFull();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [full, onToggleFull]);

  const titleOf = (id: string): string => {
    if (id === lead) return title;
    return state.titles[id] || operatorTitleOf?.(id) || operatorTitle(id);
  };
  const refTitle = (ref: ChatOperatorRef) => (ref.id === lead ? title : ref.title || titleOf(ref.id));

  // An answer that names no one is the lead's; an older one keeps who answered then.
  const author = (m: ChatMessage) => {
    const who = m.operator ?? { id: lead };
    const name = refTitle(who);
    return {
      avatar: <OperatorAvatar id={who.id} title={name} presence={m.failed ? 'failed' : 'still'} size={OPERATOR_AVATAR_SIZES.bubble} />,
      name: `Your ${name}`,
    };
  };

  const reuseButton = (m: ChatMessage) => (
    <div className={s.reuse}>
      <Button size="sm" variant="outline" onClick={() => chat.reuse(m.id)}>
        Put it back in the box
      </Button>
    </div>
  );

  const drawUser = (m: ChatMessage) => (
    <>
      <ChatBubble variant="user">
        {/* Exactly what the owner sent, as text: never read as Markdown or
            HTML, line breaks kept. */}
        <PlainText text={m.text} className={s.ownerText} />
      </ChatBubble>
      {m.unanswered && (
        <div className={s.underOwner}>
          <p className={s.subLine}>{CHAT_UNANSWERED_LINE}</p>
          {reuseButton(m)}
        </div>
      )}
    </>
  );

  // What the lead asked the Co-CEO in that turn, read back with the answer:
  // drawn above it unless the live step is still in the thread (it says it
  // already), so a consult is never drawn twice.
  const consultLines = (m: ChatMessage) =>
    chatConsultsOf(m.metadata)
      .filter((c) => !state.messages.some((x) => x.step?.callId === c.callId))
      .map((c) => <SaidLine key={c.callId} operator={CO_CEO_OPERATOR} title={titleOf(CO_CEO_OPERATOR)} text={c.answer} />);

  const drawReply = (m: ChatMessage) => {
    const shown = m.failed ? { ...m, text: chatFailedReplyText(m, title) } : m;
    return (
      <>
        {consultLines(m)}
        <ChatBubble variant="assistant" author={author(m)}>
          <div className={m.failed ? s.failed : undefined} data-outcome={m.failed ? 'failed' : undefined}>
            {renderReply ? renderReply(shown) : <PlainText text={shown.text} />}
          </div>
          {m.images && m.images.length > 0 && (
            <div className={s.images}>
              {m.images.map((url, i) => (
                <img key={i} src={url} alt="" loading="lazy" className={s.image} />
              ))}
            </div>
          )}
          {m.failed && !m.answeredHere && reuseButton(m)}
        </ChatBubble>
      </>
    );
  };

  const drawError = (m: ChatMessage) => (
    <ChatBubble variant="assistant">
      <span className={s.errorText}>{m.text}</span>
    </ChatBubble>
  );

  const drawNotice = (m: ChatMessage) => <p className={s.notice}>{m.text}</p>;

  const drawStep = (m: ChatMessage) => {
    const step = m.step;
    if (!step) return null;
    const who = step.operator;
    const said = step.summary || m.text;
    const entry: ToolCallEntry = {
      callId: step.callId,
      // The tool's name is never shown to an owner.
      name: '',
      status: step.status,
      summary: said || (step.status === 'error' ? 'This step did not work.' : step.status === 'completed' ? 'Finished this step.' : 'Working on it'),
      ...(step.error ? { error: step.error } : {}),
      ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
      // A specialist's step shows their face with its state; the lead's own steps keep the dot.
      ...(who && who.id !== lead ? { operator: who.id, operatorTitle: refTitle(who) } : {}),
    };
    // What another member answered the lead (the Co-CEO in a consult), under the step.
    const answered = chatSaidOf(step.result);
    return (
      <>
        <AgentTimeline calls={[entry]} compact />
        {answered && <SaidLine operator={answered.operator} title={titleOf(answered.operator)} text={answered.text} />}
      </>
    );
  };

  const drawApproval = (m: ChatMessage) => {
    const a = m.approval;
    if (!a) return null;
    const asker = a.operator ?? { id: lead };
    const askerTitle = refTitle(asker);
    const open = a.status === 'waiting' || a.status === 'sending';
    return (
      <GlassCard padding="16px" accent data-testid={ids.approval} data-status={a.status}>
        <strong className={s.approvalTitle}>
          <OperatorAvatar id={asker.id} title={askerTitle} presence={open ? 'waiting' : 'done'} size={OPERATOR_AVATAR_SIZES.card} decorative />
          {`Your ${askerTitle} needs your yes`}
        </strong>
        {/* Plain words: the reason can quote a title as written. */}
        {a.reason && <p className={s.approvalText}>{a.reason}</p>}
        {open ? (
          <div className={s.approvalActions}>
            <Button size="sm" variant="ghost" data-testid="approval-decline" disabled={a.status === 'sending'} onClick={() => void chat.approve(a.stepId, false)}>
              Decline
            </Button>
            <Button size="sm" variant="primary" data-testid="approval-approve" disabled={a.status === 'sending'} onClick={() => void chat.approve(a.stepId, true)}>
              Approve
            </Button>
          </div>
        ) : (
          <p className={s.approvalDone} role="status">{a.status === 'approved' ? 'You said yes.' : 'You said no.'}</p>
        )}
      </GlassCard>
    );
  };

  const defaults: Record<string, (m: ChatMessage) => ReactNode> = {
    user: drawUser,
    reply: drawReply,
    error: drawError,
    notice: drawNotice,
    step: drawStep,
    approval: drawApproval,
  };

  const drawItem = ({ message: m, nested }: { message: ChatMessage; nested: boolean }) => {
    const fallback = () => (defaults[m.kind] ? defaults[m.kind](m) : null);
    const custom = renderers?.[m.kind];
    const drawn = custom ? custom(m, { chat, lead, title, fallback }) : undefined;
    const content = drawn === undefined ? fallback() : drawn;
    if (content === null || content === false) return null;
    switch (m.kind) {
      case 'user':
        return (
          <div key={m.id} className={s.item} data-testid={ids.message} data-role="user" data-pending={m.sending ? 'true' : undefined}>
            {content}
          </div>
        );
      case 'reply':
        return (
          <div key={m.id} className={s.item} data-testid={ids.message} data-role="assistant" data-outcome={m.failed ? 'failed' : undefined}>
            {content}
          </div>
        );
      case 'error':
        return (
          <div key={m.id} className={s.item} data-testid={ids.message} data-role="assistant" data-error="true">
            {content}
          </div>
        );
      case 'step':
        // A sub-run's step (the Co-CEO's work while the lead asked it) sits indented under its parent.
        return (
          <div
            key={m.id}
            className={nested ? `${s.item} ${s.nested}` : s.item}
            data-testid={ids.step}
            data-status={m.step?.status}
            data-nested={nested ? 'true' : undefined}
          >
            {content}
          </div>
        );
      default:
        return (
          <div key={m.id} className={s.item} data-kind={m.kind}>
            {content}
          </div>
        );
    }
  };

  const specialist = state.progress && state.progress.operator !== lead ? state.progress.operator : null;
  const working = state.busy && !waitingForYou && (
    <div className={s.item} data-testid={ids.working} data-role="assistant" data-pending="true">
      <ChatBubble
        variant="assistant"
        author={{
          avatar: <OperatorAvatar id={lead} title={title} presence="working" size={OPERATOR_AVATAR_SIZES.bubble} />,
          name: `Your ${title}`,
        }}
      >
        <p className={s.workingLine}>
          {/* The specialist the lead is working with, or asking, joins, working. */}
          {specialist && (
            <OperatorAvatar id={specialist} title={titleOf(specialist)} presence="working" size={OPERATOR_AVATAR_SIZES.row} decorative />
          )}
          <span>{chatWorkingLine(state.progress, title, titleOf, lead)}</span>
        </p>
        {state.long && <p className={s.subLine}>{CHAT_LONG_LINE}</p>}
      </ChatBubble>
    </div>
  );

  const banner = status && status.type !== 'connected' && (
    <div className={`${s.status} ${s[`status_${status.type}`] ?? ''}`} role="status">
      <span>
        {status.message}
        {status.attempt != null && status.attempt > 0 && status.maxAttempts ? ` (attempt ${status.attempt}/${status.maxAttempts})` : ''}
      </span>
      {status.onRetry && (
        <button type="button" className={s.statusRetry} onClick={status.onRetry}>
          {status.retryLabel || 'Retry'}
        </button>
      )}
    </div>
  );

  const conversations = state.conversations;
  // The open conversation's name: the switcher is as wide as it, up to its
  // limit, cut with an ellipsis there (the whole name is the tooltip). In the
  // editor's panel the switcher is its arrow alone (2026-10-17): the name is
  // the tooltip and is said with the switcher's own name.
  const openId = state.conversation?.id ?? '';
  const openName =
    chatSubjectOf((conversations.find((c) => c.id === openId) ?? state.conversation)?.title ?? null) ?? 'New chat';
  const arrowOnly = look === 'sidebar';
  const switcher = showSwitcher && chat.canList && conversations.length > 1 && (
    <label className={s.switcher} title={openName} data-arrow-only={arrowOnly ? 'true' : undefined}>
      {!arrowOnly && (
        <span className={s.switcherLabel} aria-hidden="true">
          {openName}
        </span>
      )}
      <NavIcon name="chevron-down" size={14} className={s.switcherIcon} />
      {/* The browser's own list, over the drawn name and invisible: the
          keyboard and a phone's picker keep working. */}
      <select
        className={s.switcherSelect}
        aria-label={`Conversation: ${openName}`}
        value={state.conversation?.id ?? ''}
        onChange={(e) => void chat.selectConversation(e.target.value)}
      >
        {!state.conversation && <option value="">New chat</option>}
        {conversations.map((c) => (
          <option key={c.id} value={c.id}>{chatSubjectOf(c.title) ?? 'New chat'}</option>
        ))}
      </select>
    </label>
  );

  // An empty conversation with no other one has nothing a new chat would
  // add, and the full view waits for the first message (2026-10-17); the
  // full view's own button, the way out of it, always shows.
  const newChatShows = showNewChat && !(empty && !conversations.some((c) => c.id !== openId));
  const fullShows = !!onToggleFull && (full || !empty);

  const panelCls = [s.panel, s[look], compact ? s.compact : '', className].filter(Boolean).join(' ');
  const roleColors = {
    '--coceo-accent': operatorAccent(lead),
    '--coceo-accent-dark': operatorAccent(lead, 'dark'),
  } as React.CSSProperties;
  const threadStyle = threadMaxHeight !== undefined ? { maxHeight: threadMaxHeight } : undefined;

  return (
    <section
      ref={panelRef}
      className={panelCls}
      data-testid={ids.panel}
      data-busy={busy ? 'true' : 'false'}
      data-look={look}
      data-lead={lead}
      data-compact={compact ? 'true' : undefined}
      aria-label={header.lead}
    >
      <header className={s.header}>
        <OperatorAvatar
          id={lead}
          title={title}
          presence="still"
          size={look === 'sidebar' ? SIDEBAR_HEADER_FACE : OPERATOR_AVATAR_SIZES.bubble}
          decorative
        />
        {/* "Your Co-CEO", the title in the lead's own colour, then the
            subject in a lighter weight. The whole line in the tooltip when
            the subject is cut. */}
        <Heading className={s.title} title={header.subject ? header.full : undefined}>
          {'Your '}
          <span className={s.role} style={roleColors}>
            {title}
          </span>
          {header.subject && <span className={s.subject}>{`: ${header.subject}`}</span>}
        </Heading>
        <div className={s.actions}>
          {switcher}
          {newChatShows && (
            <button
              type="button"
              className={s.iconBtn}
              onClick={() => void chat.newChat()}
              disabled={state.opening}
              aria-label="New chat"
              title="New chat"
            >
              <NavIcon name="plus" size={18} />
            </button>
          )}
          {fullShows && (
            <button
              type="button"
              className={s.iconBtn}
              onClick={onToggleFull}
              aria-pressed={full}
              aria-label={full ? 'Leave full view' : 'Full view'}
              title={full ? 'Leave full view (Esc)' : 'Full view'}
            >
              <NavIcon name={full ? 'arrows-pointing-in' : 'arrows-pointing-out'} size={18} />
            </button>
          )}
        </div>
      </header>

      {aboveMessages && <div className={s.above}>{aboveMessages}</div>}
      {banner}

      {/* Kept in the page while compact, only not drawn: the thread's scroll
          follows it. It fades in when the box first takes the focus. */}
      <div className={[s.threadWrap, opened && showEmpty ? s.opening : ''].filter(Boolean).join(' ')}>
        <div
          ref={chat.thread.ref}
          onScroll={chat.thread.onScroll}
          className={s.thread}
          style={threadStyle}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label={`Conversation with your ${title}`}
          aria-busy={state.loading ? true : undefined}
          // Scrollable, so reachable from the keyboard.
          tabIndex={0}
        >
          {state.loadingOlder && <p className={s.loadingMore}>Loading earlier messages…</p>}
          {(state.loading || !state.ready) && empty && (
            <div className={s.center}>
              <Loader size={32} />
            </div>
          )}
          {showEmpty && (emptyState ?? (suggestions && (
            <CoCeoSuggestions
              variant={suggestions.variant}
              facts={suggestions.facts}
              lead={suggestions.lead}
              onSend={(text) => void chat.send(text)}
              onFill={chat.fill}
              disabled={disabled || !!chat.busyReason}
            />
          )))}
          {chatThreadOrder(state.messages).map(drawItem)}
          {working}
        </div>
        {/* The way back to the newest message once the owner scrolled up:
            "New messages" when something arrived meanwhile, else the arrow. */}
        {chat.thread.showNewMessages ? (
          <button type="button" className={s.newMessages} onClick={chat.thread.toBottom}>
            <NavIcon name="arrow-down" size={14} strokeWidth={2.25} />
            New messages
          </button>
        ) : chat.thread.showToBottom ? (
          <button
            type="button"
            className={s.toBottom}
            onClick={chat.thread.toBottom}
            aria-label="Back to the newest message"
            title="Back to the newest message"
          >
            <NavIcon name="arrow-down" size={16} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      {/* The box's focus opens a compact chat (React's focus bubbles from the field). */}
      <div className={s.footer} onFocus={compact ? () => setOpened(true) : undefined}>
        {aboveInput && <div className={s.aboveInput}>{aboveInput}</div>}
        <ChatInput
          placeholder={placeholder ?? `Tell your ${title} what you'd like to change…`}
          textareaAriaLabel={`Message to your ${title}`}
          value={state.draft}
          onChange={chat.setDraft}
          onSend={(text) => void chat.send(text)}
          onAttach={onAttach}
          disabled={disabled}
          busy={busy}
          busyReason={chat.busyReason ?? undefined}
          sendDisabledReason={sendDisabledReason}
          hint={hint}
          // The chat empties the box itself once the message is on its way,
          // and gives the words back if it did not go.
          preserveOnSend
          seedText={state.seed.text}
          seedToken={seedToken}
          focusToken={focusToken}
          inputTestId={ids.input}
          sendTestId={ids.send}
        />
        {state.error && (
          <p className={s.error} role="alert">
            {state.error}
          </p>
        )}
        {footer}
      </div>
    </section>
  );
};
