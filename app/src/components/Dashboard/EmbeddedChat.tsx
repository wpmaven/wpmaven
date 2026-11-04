import React, { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { CoCeoChat, joinDraft, useCoCeoChat, type ChatPanelStatus, type ChatSiteChange } from '@yotako/webmaven-ui';
import { EDITOR_LEAD_OPERATOR, LEAD_OPERATOR, leadTitle, TEAM_COPY } from '../../utils/team';
import { TeamFace } from '../team/TeamFace';
import DashboardOnlyCard from './DashboardOnlyCard';
import { isSiteChatEnabled } from '../../utils/siteChat';
import { hasFeature, useSiteState } from '../../utils/siteState';
import { STREAM_MAX_ATTEMPTS, type ChatStreamStatus } from '../../services/chatStream';
import { pluginChatAdapter, type ChatChannel, type EditorChatKind, type PluginChatAdapter } from '../chat/pluginChatAdapter';
import { pluginChatRenderers, renderPluginReply } from '../chat/chatRenderers';
import { chatSiteFactsOf } from '../chat/chatSiteFacts';

/** The banner over the thread while the live line is down: after a few tries, then once it gave up (Retry). */
export function connectionBanner(status: ChatStreamStatus | null, onRetry: () => void): ChatPanelStatus | undefined {
  if (status?.state === 'failed') {
    return { type: 'error', message: TEAM_COPY.notConnected, retryLabel: 'Retry', onRetry };
  }
  if (status?.state === 'connecting' && status.attempt >= 3) {
    return { type: 'connecting', message: 'Reconnecting to your team…', attempt: status.attempt, maxAttempts: STREAM_MAX_ATTEMPTS };
  }
  return undefined;
}

/** The editor's box when the Web Designer leads its chat (1.8.0). */
export const EDITOR_DESIGNER_PLACEHOLDER = 'Tell your Web Designer what to change on this page…';
/** The box's words in the post editor and the product editor (2026-10-18). */
const EDITOR_LEAD_PLACEHOLDERS: Readonly<Record<string, string>> = {
  content_writer: 'Tell your Content Writer what to change in this post…',
  ecommerce_manager: 'Tell your E-commerce Manager what to change on this product…',
};

/** The editor window's questions already handled, per chat: a chat drawn again never asks one twice. */
const handledAsks = new WeakMap<PluginChatAdapter, number>();
/** Overview's words already put in the box, per chat: the full view's switch never puts them there again. */
const handledFills = new WeakMap<PluginChatAdapter, number>();

export interface EmbeddedChatProps {
  /** The editor's panel: flush and compact (the kit's sidebar look). */
  sidebar?: boolean;
  /** Which suggestions an empty chat shows. Default 'dashboard'. */
  promptVariant?: 'dashboard' | 'editor';
  /** The editor's selection, sent with each message as context.editor ("this" means it). */
  context?: object;
  /**
   * The editor's chat of one editor (2026-10-18): the page editor's (the Web
   * Designer's), the post editor's (the Content Writer's) or the product
   * editor's (the E-commerce Manager's). Each its own thread, whose kind the
   * server reads to name its lead.
   */
  editorKind?: EditorChatKind;
  /** A question the editor window asks about its element: sent once per token, or left in the box while a turn runs. */
  ask?: { text: string; token: number } | null;
  /** Words Overview puts in the box (a milestone's request), once per token: never sent. */
  fill?: { text: string; token: number } | null;
  /** Above the messages. */
  aboveMessages?: React.ReactNode;
  /** Over the input: the editor's "Talking about" line. */
  aboveInput?: React.ReactNode;
  /** Home's full view is on: the button says so, and Esc leaves it. */
  full?: boolean;
  /** Home: the full view button in the header. */
  onToggleFull?: () => void;
  /** Home's card: the thread's height limit (it scrolls past it), as the dashboard's Home has it. */
  threadMaxHeight?: number | string;
  /** A step of the chat changed the site (once per step): the editor shows it without a reload by hand. */
  onSiteChanged?: (changes: ChatSiteChange[]) => void;
}

function EmbeddedChatPanel({ sidebar = false, promptVariant = 'dashboard', context, editorKind = 'page', ask = null, fill = null, aboveMessages, aboveInput, full = false, onToggleFull, threadMaxHeight, onSiteChanged }: EmbeddedChatProps) {
  // Home's chat is the `web` channel, the editor's its own; each keeps one
  // adapter (and so one chat) for the page's life.
  const channel: ChatChannel = promptVariant === 'editor' ? 'editor' : 'web';
  const adapter = pluginChatAdapter(channel, editorKind);

  // The editor's chat is the Web Designer's once the account says so
  // (features.editorDesigner, 1.8.0, which also follows the server's
  // switch); Home's stays the Co-CEO's.
  const site = useSiteState();
  const editorLead = editorKind === 'post' ? 'content_writer' : editorKind === 'product' ? 'ecommerce_manager' : EDITOR_LEAD_OPERATOR;
  const lead = channel === 'editor' && hasFeature(site, 'editorDesigner') ? editorLead : LEAD_OPERATOR;
  const designer = lead !== LEAD_OPERATOR;

  // The editor's selection rides with every message, as it is when it is sent.
  const contextRef = useRef(context);
  contextRef.current = context;
  const siteChangedRef = useRef(onSiteChanged);
  siteChangedRef.current = onSiteChanged;
  const chat = useCoCeoChat(adapter, {
    onSiteChanged: (changes) => siteChangedRef.current?.(changes),
    lead,
    title: leadTitle(lead),
    // One draft per chat: the editor's three chats each keep their own.
    storageKey: `wpmaven-chat-draft-${adapter.channel}${adapter.channel === 'editor' && adapter.editorKind !== 'page' ? `-${adapter.editorKind}` : ''}`,
    sendExtra: () => (contextRef.current ? { editor: contextRef.current } : undefined),
  });
  const chatRef = useRef(chat);
  chatRef.current = chat;

  // The live line: a banner while it is down, and the newest messages read
  // again when it comes back during a turn (its end may have been missed).
  // After an update of the API moved it (2026-10-19) they are read again
  // busy or not: a turn may have ended, or been stopped by the update.
  const connection = useSyncExternalStore(adapter.connection.subscribe, adapter.connection.get, adapter.connection.get);
  useEffect(() => {
    if (connection.reconnects > 0 && (connection.moved || chatRef.current.state.busy)) void chatRef.current.refresh();
  }, [connection.reconnects, connection.moved]);

  // The editor window's question about its element goes out once, like a
  // message the owner typed. While a turn runs it waits in the box.
  const ready = chat.state.ready;
  useEffect(() => {
    const c = chatRef.current;
    if (!ask || !ask.text.trim() || !ready || handledAsks.get(adapter) === ask.token) return;
    handledAsks.set(adapter, ask.token);
    if (c.state.busy || c.state.opening) {
      if (c.state.draft.trim()) c.setDraft(joinDraft(ask.text, c.state.draft));
      else c.fill(ask.text);
      return;
    }
    void c.send(ask.text);
  }, [ask, ready, adapter]);

  // Overview's words for the box wait there for the owner to send them.
  useEffect(() => {
    if (!fill || !fill.text.trim() || !ready || handledFills.get(adapter) === fill.token) return;
    handledFills.set(adapter, fill.token);
    chatRef.current.fill(fill.text);
  }, [fill, ready, adapter]);

  const renderers = useMemo(() => pluginChatRenderers(adapter), [adapter]);
  // The empty chat's suggestions (the kit's, as in the dashboard): the chips
  // this site can do, beside the Web Designer's face when it leads.
  const suggestions = useMemo(
    () => ({
      // The post editor's and the product editor's own chips (2026-10-18).
      variant: promptVariant !== 'editor' ? ('home' as const) : lead === 'content_writer' ? ('post' as const) : lead === 'ecommerce_manager' ? ('product' as const) : ('editor' as const),
      facts: chatSiteFactsOf(site),
      ...(designer ? { lead: <TeamFace id={lead} title={leadTitle(lead)} size="row" /> } : {}),
    }),
    [promptVariant, site, designer, lead],
  );
  const look = sidebar ? 'sidebar' : full ? 'full' : 'card';

  const panel = (
    <CoCeoChat
      chat={chat}
      look={look}
      full={full}
      onToggleFull={sidebar ? undefined : onToggleFull}
      renderReply={renderPluginReply}
      renderers={renderers}
      aboveMessages={aboveMessages}
      aboveInput={aboveInput}
      status={connectionBanner(connection.status, adapter.connection.retry)}
      suggestions={suggestions}
      placeholder={designer ? (EDITOR_LEAD_PLACEHOLDERS[lead] ?? EDITOR_DESIGNER_PLACEHOLDER) : undefined}
      threadMaxHeight={threadMaxHeight}
    />
  );
  // The editor's panel is a column: the chat takes the room under the strips above it.
  return sidebar ? <div className="wm-chat-sidebar">{panel}</div> : panel;
}

/**
 * The chat on Home and in the editor: the kit's Co-CEO chat on the plugin's
 * routes, led in the editor by the Web Designer when the account says so.
 * While the chat does not run in WP-admin for this site (the account's
 * features.chat, or the plugin's WEBMAVEN_WP_SITE_TOKEN_CHAT) it is the
 * dashboard card instead, and nothing here calls the API.
 */
function EmbeddedChat(props: EmbeddedChatProps) {
  if (!isSiteChatEnabled()) {
    return <DashboardOnlyCard variant="chat" compact={!!props.sidebar} bare={!!props.sidebar} />;
  }
  return <EmbeddedChatPanel {...props} />;
}

export default EmbeddedChat;
