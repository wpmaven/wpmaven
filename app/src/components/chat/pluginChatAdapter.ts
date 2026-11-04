/**
 * The kit's chat (useCoCeoChat) on the plugin's own routes.
 *
 * One adapter per channel: `web` for Home, `editor` for the editor, and in
 * the editor one per editor (2026-10-18): the page editor's chat (the Web
 * Designer's), the post editor's (the Content Writer's) and the product
 * editor's (the E-commerce Manager's), each its own thread. Each is
 * kept for the page's life, so the chat's state (the thread, the turn in
 * progress, the draft) is the same on Home's card and its full view, and is
 * still there when the owner comes back to Home. Every call goes through
 * WordPress: the nonce, the plugin's routes, and the stream's ticket (the
 * site's token and the actor claim stay in PHP). One live line per
 * conversation (services/chatStream): the chat opens it with the
 * conversation and closes it when it moves to another one or leaves.
 */
import type { ChatConversation, ChatMessagesPage, CoCeoChatAdapter } from '@yotako/webmaven-ui';
import { api as defaultApi } from '../../services/api';
import { createdConversation } from '../../services/chatTurn';
import {
  chatInstanceId,
  defaultStreamDeps,
  openChatStream,
  type ChatStream,
  type ChatStreamDeps,
  type ChatStreamStatus,
} from '../../services/chatStream';

export type ChatChannel = 'web' | 'editor';

/** The editor's three chats: the page editor's, the post editor's, the product editor's. */
export type EditorChatKind = 'page' | 'post' | 'product';

/**
 * The live line as the chat's banner reads it; `reconnects` counts the times
 * it opened again, and `moved` says an update of the API moved it the last
 * time (the thread is then read again, busy or not).
 */
export interface ChatConnection {
  status: ChatStreamStatus | null;
  reconnects: number;
  moved: boolean;
}

export interface PluginChatAdapter extends CoCeoChatAdapter {
  channel: ChatChannel;
  /** The editor's chat this is (the editor channel only). */
  editorKind: EditorChatKind;
  /** The live line: its state, to listen to, and Retry once it gave up. */
  connection: {
    get(): ChatConnection;
    subscribe(listener: () => void): () => void;
    retry(): void;
  };
  /** The preview the owner picked on a change's card (another version, the reviewed values), by the approval's step. */
  pickedPreview(stepId: string): string | undefined;
}

export interface PluginChatDeps {
  api: any;
  stream: ChatStreamDeps;
  instanceId: () => string | null;
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A conversation as the chat keeps it, or null. */
export function conversationOf(raw: unknown): ChatConversation | null {
  if (!isObj(raw)) return null;
  const conv = typeof raw.id === 'string' && raw.id ? raw : isObj(raw.conversation) ? raw.conversation : null;
  if (!conv || typeof conv.id !== 'string' || !conv.id) return null;
  return { id: conv.id, title: typeof conv.title === 'string' ? conv.title : '' };
}

/** The list GET /conversations answers: the API's page ({ data, pagination }) or a bare list. */
function listOf(body: any): unknown[] {
  const raw = body?.conversations?.data ?? body?.data ?? body?.conversations ?? [];
  return Array.isArray(raw) ? raw : [];
}

export function createPluginChatAdapter(channel: ChatChannel, deps: Partial<PluginChatDeps> = {}, editorKind: EditorChatKind = 'page'): PluginChatAdapter {
  // The thread of one editor: post or product; the page editor's carries none (its threads so far).
  const kind = channel === 'editor' && editorKind !== 'page' ? editorKind : null;
  const api = deps.api ?? defaultApi;
  const streamDeps = deps.stream ?? defaultStreamDeps();
  const instanceId = deps.instanceId ?? chatInstanceId;

  let connection: ChatConnection = { status: null, reconnects: 0, moved: false };
  const listeners = new Set<() => void>();
  const setConnection = (next: Partial<ChatConnection>) => {
    connection = { ...connection, ...next };
    listeners.forEach((l) => l());
  };
  let stream: ChatStream | null = null;
  const picked = new Map<string, string>();

  return {
    channel,
    editorKind: channel === 'editor' ? editorKind : 'page',

    async latest() {
      const body = await api.getLatestConversation(channel, kind);
      return body?.success ? conversationOf(body.data) : null;
    },

    async create() {
      // A refusal (the site's daily new-chat limit) throws with WPMaven's sentence.
      return conversationOf(createdConversation(await api.createConversation('New chat', channel, kind)))!;
    },

    async list() {
      const body = await api.listConversations(1, 20, channel, kind);
      if (!body?.success) return [];
      return listOf(body).map(conversationOf).filter((c): c is ChatConversation => !!c);
    },

    async messages(conversationId, page): Promise<ChatMessagesPage> {
      const body = await api.getMessages(conversationId, page.page, page.limit);
      if (!body?.success) throw new Error('The messages could not be read.');
      const items = Array.isArray(body.data?.messages) ? body.data.messages : [];
      return { items, ...(typeof body.data?.hasMore === 'boolean' ? { hasMore: body.data.hasMore } : {}) };
    },

    async send(conversationId, text, extra) {
      // The editor's selection rides as context.editor. A refused turn throws
      // with WPMaven's sentence: the words go back into the box.
      return api.executeAgentViaSSE(text, conversationId, instanceId(), isObj(extra) ? extra : {});
    },

    async approve(conversationId, stepId, approved, extra) {
      const previewId = isObj(extra) && typeof extra.previewId === 'string' && ID.test(extra.previewId) ? extra.previewId : null;
      await api.sendApprovalViaSSE(stepId, conversationId, approved, previewId ? { previewId } : null);
      if (approved && previewId) picked.set(stepId, previewId);
    },

    subscribe(conversationId, onFrame) {
      stream?.close();
      const mine = openChatStream(conversationId, {
        onFrame,
        onStatus: (status) => {
          if (stream === mine) setConnection({ status });
        },
        onReconnected: (moved) => {
          if (stream === mine) setConnection({ reconnects: connection.reconnects + 1, moved });
        },
      }, streamDeps);
      stream = mine;
      return () => {
        mine.close();
        if (stream === mine) {
          stream = null;
          setConnection({ status: null });
        }
      };
    },

    connection: {
      get: () => connection,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      retry() {
        stream?.retry();
      },
    },

    pickedPreview: (stepId) => picked.get(stepId),
  };
}

const adapters = new Map<string, PluginChatAdapter>();

/** The channel's adapter (in the editor, the editor's), the same one for the page's life. */
export function pluginChatAdapter(channel: ChatChannel, editorKind: EditorChatKind = 'page'): PluginChatAdapter {
  const key = channel === 'editor' ? `${channel}:${editorKind}` : channel;
  let adapter = adapters.get(key);
  if (!adapter) {
    adapter = createPluginChatAdapter(channel, {}, editorKind);
    adapters.set(key, adapter);
  }
  return adapter;
}

/** Tests: forget the adapters, and with them the chats' state. */
export function resetPluginChatAdapters(): void {
  adapters.clear();
}
