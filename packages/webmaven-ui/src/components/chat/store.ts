/**
 * The Co-CEO chat's state, without React (2026-10-16).
 *
 * One store per adapter: the plugin's Home card and its full view, or the
 * editor's panel, draw the same thread, so switching views keeps the
 * messages, the turn in progress and the draft. Everything here is plain
 * logic with the adapter, the clock, the timers and the storage injected, so
 * the node unit tests drive the whole flow without a browser.
 *
 * What it keeps, from the plugin's chat and the dashboard's Co-CEO bar:
 *  - the latest conversation, or one created on the first send;
 *  - its last 20 messages, and 20 older ones at a time on request;
 *  - the draft, per conversation, in sessionStorage too, so it survives the
 *    card and full view switch and a reload;
 *  - nothing typed is lost: a send that fails gives its words back, ahead of
 *    whatever was typed since, with the reason;
 *  - no send while a turn runs (busy, with the reason said);
 *  - the subject, from the conversation's title and the live
 *    `conversation.title` event; a placeholder title is no subject;
 *  - never the old `welcome` greeting.
 */
import { operatorTitle } from '../operator/catalog';
import {
  CHAT_TURN_FAILED_TEXT,
  CO_CEO_OPERATOR,
  chatSubjectOf,
  fromAgentEvent,
  fromStoredMessage,
  type ChatApproval,
  type ChatEvent,
  type ChatMessage,
  type ChatProgress,
  type ChatSiteChange,
  type ChatStep,
} from './events';

// ── The adapter: what each app gives the chat ────────────────────────────

/** A conversation as the API lists it. */
export interface ChatConversation {
  id: string;
  title: string;
}

/**
 * A message as the API sends it from a thread (GET messages): `role` in any
 * case (USER, ASSISTANT, SYSTEM), `content`, `createdAt`, `metadata`.
 */
export interface ChatStoredMessage {
  id?: string;
  role?: string;
  content?: string;
  createdAt?: string | null;
  metadata?: Record<string, unknown> | null;
  images?: unknown;
  [key: string]: unknown;
}

/** One page of a thread, newest first as the API sends it; the chat orders it. */
export interface ChatMessagesPage {
  items: ChatStoredMessage[];
  /** Older messages exist. When left out: a full page means there may be more. */
  hasMore?: boolean;
}

/**
 * What an app gives the chat: its own transport, never an address in the kit.
 *
 * Keep the object stable (useMemo): the chat keeps one state per adapter, so
 * every view drawn with the same adapter shares the thread, and a new adapter
 * (another business) starts from its own.
 */
export interface CoCeoChatAdapter {
  /** The newest conversation of this chat (its channel, its business), or null when there is none yet. Never creates one. */
  latest(): Promise<ChatConversation | null>;
  /** A new conversation, for "New chat" and for the first message when there is none. Throws when it cannot; an error's `sentence` is said. */
  create(): Promise<ChatConversation>;
  /** Every conversation of this chat, for the switcher. Leave it out to have none. */
  list?(): Promise<ChatConversation[]>;
  /** One page of a conversation's messages, newest first. Page 1 is the newest. */
  messages(conversationId: string, page: { page: number; limit: number }): Promise<ChatMessagesPage>;
  /**
   * Send one message. Resolves once the turn is accepted; the answer comes on
   * the stream. Throws when it did not go through: the words go back into the
   * box, and an error's `sentence` (a string) is said as the reason.
   */
  send(conversationId: string, text: string, extra?: unknown): Promise<unknown>;
  /** The owner's yes or no to a step that waits for it. */
  approve(conversationId: string, stepId: string, approved: boolean, extra?: unknown): Promise<unknown>;
  /**
   * Listen to a conversation's stream: call `onFrame` with each frame (the
   * parsed `{ type, data, timestamp }`, or the raw text of a line). The app
   * owns tickets, the EventSource and auth. Returns the way to stop.
   */
  subscribe(conversationId: string, onFrame: (frame: unknown) => void): () => void;
}

/** Where the draft is kept between mounts and reloads; sessionStorage by default. */
export interface ChatDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CoCeoChatOptions {
  /**
   * Who leads this chat, the API's operator id: the Co-CEO by default, the
   * Web Designer in the editor (2026-10-17). Its face signs the header, the
   * working bubble and an answer that names no one; its own steps keep the dot.
   */
  lead?: string;
  /** The lead's title ("Co-CEO"; the catalog's title of `lead` by default): the header, the working line and the reasons say it. */
  title?: string;
  /** Messages per page (20). */
  pageSize?: number;
  /** Where the draft is kept: sessionStorage by default, null for memory only. */
  storage?: ChatDraftStorage | null;
  /** The storage key's prefix ("wpmaven-chat-draft"); the conversation's id follows it. */
  storageKey?: string;
  /** Sent with every message (the editor's selection as `{ editor }`). */
  sendExtra?: () => unknown;
  /** The reason said when a send did not go through. Default: the error's `sentence`, else the dashboard's line. */
  failedSendText?: (error: unknown, title: string) => string;
  /** Every frame, with the events it made: an app's own reactions (navigation, usage). */
  onFrame?: (frame: unknown, events: ChatEvent[]) => void;
  /**
   * A step of a turn finished and changed something on the site (2026-10-19):
   * called once per step, with what it changed, so a host showing the site
   * (the plugin's editor) refreshes without a reload. A step with a published
   * edit counts even when the API did not say what changed: it says `site`
   * then. Never for what a thread read back says.
   */
  onSiteChanged?: (changes: ChatSiteChange[]) => void;
  /** A turn with no end on the stream stops counting as running after this long (15 minutes); the thread is read again. */
  turnTimeoutMs?: number;
  /** After this long, the working bubble says bigger requests take a few minutes (20 seconds). */
  longAfterMs?: number;
  /** Test seams: the clock and the timers. */
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

// ── State ────────────────────────────────────────────────────────────────

/** How the messages last changed, for the thread's scrolling. */
export type ChatChangeKind = 'load' | 'append' | 'own' | 'prepend' | 'update';

export interface CoCeoChatState {
  /** Started and the latest conversation looked for. */
  ready: boolean;
  conversation: ChatConversation | null;
  conversations: ChatConversation[];
  /** The conversation's subject for the header, null while it has none. */
  subject: string | null;
  /** The thread, oldest first: the owner's messages, the answers, a turn's steps and approvals. */
  messages: ChatMessage[];
  /** The newest page is being read. */
  loading: boolean;
  hasMore: boolean;
  loadingOlder: boolean;
  /** A turn runs: Send waits for it. */
  busy: boolean;
  /** A new conversation is being opened for the first message. */
  opening: boolean;
  /** Whose work the running turn is doing. */
  progress: ChatProgress | null;
  /** The turn has run long enough to say bigger requests take a few minutes. */
  long: boolean;
  /** What is in the box. */
  draft: string;
  /** Bumped when words are given back to the box: the input takes the focus. */
  focusToken: number;
  /** A suggestion to fill the box with (bracketed slots become a template); applied when `token` changes. */
  seed: { text: string; token: number };
  /** Why the last message went back into the box. */
  error: string | null;
  /** Titles the stream gave the team's members, by id. */
  titles: Record<string, string>;
  change: { kind: ChatChangeKind; seq: number };
}

const INITIAL: CoCeoChatState = {
  ready: false,
  conversation: null,
  conversations: [],
  subject: null,
  messages: [],
  loading: false,
  hasMore: false,
  loadingOlder: false,
  busy: false,
  opening: false,
  progress: null,
  long: false,
  draft: '',
  focusToken: 0,
  seed: { text: '', token: 0 },
  error: null,
  titles: {},
  change: { kind: 'load', seq: 0 },
};

export const CHAT_PAGE_SIZE = 20;
/** How long an owner's message with no answer still counts as being worked on (the dashboard's 15 minutes). */
export const CHAT_STILL_WORKING_MS = 15 * 60_000;
const LONG_AFTER_MS = 20_000;
/** After the run's own final words, how long the stored answer has to arrive before Send works again anyway. */
const SETTLE_AFTER_FINAL_MS = 15_000;
const DRAFT_KEY = 'wpmaven-chat-draft';

/** A message going back into the box, ahead of what was typed since: nothing is overwritten. */
export function joinDraft(restored: string, current: string): string {
  return current.trim() ? `${restored}\n\n${current}` : restored;
}

/** The chat's lead from its options: the Co-CEO unless the app named another. */
export function chatLeadOf(options: Pick<CoCeoChatOptions, 'lead'>): string {
  return options.lead || CO_CEO_OPERATOR;
}

/** The lead's title from the options: the one given, else the catalog's title of the lead ("Co-CEO"). */
export function chatTitleOf(options: Pick<CoCeoChatOptions, 'lead' | 'title'>): string {
  return options.title || operatorTitle(chatLeadOf(options));
}

/** The dashboard's line when a message did not reach the team. */
export function chatSendFailedLine(title: string): string {
  return `Your message did not reach your ${title}. It is back in the box, so press Send to try again.`;
}

export const CHAT_NEW_CHAT_FAILED_TEXT = 'A new chat could not be opened just now. Try again in a minute.';

/** An error's own sentence for the owner (the apps' refusals carry one), or null. */
function sentenceOf(error: unknown): string | null {
  const s = error && typeof error === 'object' ? (error as { sentence?: unknown }).sentence : null;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

/**
 * Why Send is off while a turn runs, said beside it. Waiting for an answer
 * to a question above, the question is what to do first.
 */
export function chatBusyReason(state: Pick<CoCeoChatState, 'busy' | 'opening' | 'draft' | 'messages'>, title: string): string | null {
  if (state.opening) return 'Opening a new chat…';
  if (!state.busy) return null;
  if (state.messages.some((m) => m.approval && (m.approval.status === 'waiting' || m.approval.status === 'sending'))) {
    return `Your ${title} is waiting for your answer above.`;
  }
  return state.draft.trim()
    ? `You can send this as soon as your ${title} answers.`
    : `You can write your next message while your ${title} answers.`;
}

/**
 * A page from the API (newest first) in reading order, the ones the chat
 * never draws left out. Sorted by time when every message has one.
 */
export function orderPage(items: ChatStoredMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  items.forEach((raw, i) => {
    const m = fromStoredMessage(raw, `stored:${String(raw?.createdAt ?? '')}:${i}`);
    if (m) out.push(m);
  });
  out.reverse();
  const at = out.map((m) => (m.createdAt ? Date.parse(m.createdAt) : NaN));
  if (at.every((t) => Number.isFinite(t))) {
    const idx = out.map((m, i) => ({ m, t: at[i], i }));
    idx.sort((a, b) => a.t - b.t || a.i - b.i);
    return idx.map((x) => x.m);
  }
  return out;
}

/**
 * Marks what a thread read back says about its turns: an owner's message
 * with no answer after it is still being worked on when recent (the result's
 * `runningSince`), or unanswered when older.
 */
export function markTurns(messages: ChatMessage[], now: number): { messages: ChatMessage[]; runningSince: number | null } {
  let runningSince: number | null = null;
  const out = messages.slice();
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (m.kind !== 'user' || m.sending) continue;
    let answered = false;
    let nextUser = false;
    for (let k = i + 1; k < out.length; k++) {
      if (out[k].kind === 'user') { nextUser = true; break; }
      if (out[k].kind === 'reply' || out[k].kind === 'error') { answered = true; break; }
    }
    if (answered) continue;
    const sent = m.createdAt ? Date.parse(m.createdAt) : NaN;
    if (!Number.isFinite(sent)) continue;
    if (!nextUser && now - sent < CHAT_STILL_WORKING_MS) {
      runningSince = sent;
      continue;
    }
    out[i] = { ...m, unanswered: true };
  }
  return { messages: out, runningSince };
}

/**
 * The newest page read again, merged into what is on screen: a known id is
 * updated in place; an owner's message sent from here takes its stored id
 * where it stands; the stored answer takes the place of the run's own final
 * words; anything else new goes at the end. Steps and approvals stay where
 * they are.
 */
export function mergeNewest(current: ChatMessage[], fetched: ChatMessage[]): ChatMessage[] {
  const out = current.slice();
  const index = new Map(out.map((m, i) => [m.id, i]));
  const claimed = new Set<number>();
  for (const f of fetched) {
    const at = index.get(f.id);
    if (at !== undefined) {
      out[at] = { ...out[at], ...f, ...(out[at].answeredHere ? { answeredHere: true } : {}) };
      claimed.add(at);
      continue;
    }
    let match = -1;
    if (f.kind === 'user') {
      match = out.findIndex((m, i) => !claimed.has(i) && m.kind === 'user' && m.id.startsWith('local:') && m.text.trim() === f.text.trim());
    } else if (f.kind === 'reply') {
      match = out.findIndex((m, i) => !claimed.has(i) && m.kind === 'reply' && m.provisional);
    }
    if (match >= 0) {
      const was = out[match];
      out[match] = { ...f, ...(was.answeredHere ? { answeredHere: true } : {}) };
      index.set(f.id, match);
      claimed.add(match);
      continue;
    }
    out.push(f);
    index.set(f.id, out.length - 1);
    claimed.add(out.length - 1);
  }
  return out;
}

/**
 * What a reading of the thread found while a turn was followed here: the
 * answers new to the screen after the owner's last message arrived during
 * this visit, as if the stream had brought them (`answeredHere`), so the app
 * treats them as new, not as read back.
 */
export function markAnsweredHere(before: ChatMessage[], merged: ChatMessage[]): ChatMessage[] {
  const seen = new Set(before.map((m) => m.id));
  let lastUser = -1;
  for (let i = merged.length - 1; i >= 0; i--) if (merged[i].kind === 'user') { lastUser = i; break; }
  let changed = false;
  const out = merged.map((m, i) => {
    if (i <= lastUser || m.kind !== 'reply' || m.answeredHere || seen.has(m.id)) return m;
    changed = true;
    return { ...m, answeredHere: true };
  });
  return changed ? out : merged;
}

/** The owner's last message has its answer after it: a turn the stream did not end here is over. */
export function lastTurnAnswered(messages: ChatMessage[]): boolean {
  let last = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].kind === 'user') { last = i; break; }
  if (last < 0) return false;
  return messages.slice(last + 1).some((m) => m.kind === 'reply' && !m.provisional);
}

// ── The store ────────────────────────────────────────────────────────────

/** The turn this chat is following. */
interface Turn {
  /** The owner's words, when they were sent from here. */
  text: string | null;
  localId: string | null;
  /** The stored answer arrived. */
  replied: boolean;
  /** The words already went back to the box once. */
  restored: boolean;
  provisionalId: string | null;
}

const memoryDrafts = new Map<string, string>();

function defaultStorage(): ChatDraftStorage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const h = setTimeout(fn, ms);
  return () => clearTimeout(h);
}

export interface CoCeoChatStore {
  getState(): CoCeoChatState;
  subscribe(listener: () => void): () => void;
  setOptions(options: CoCeoChatOptions): void;
  /** Looks for the latest conversation and listens to it; again after `stop`, it reads the newest page again. */
  start(): void;
  /** Stops listening and every timer; the state stays for a later `start`. */
  stop(): void;
  send(text?: string, extra?: unknown): Promise<boolean>;
  setDraft(text: string): void;
  /** Seeds the box (a suggestion): bracketed slots become a template. */
  fill(text: string): void;
  /** Puts a message's words back in the box: an owner's message, or the one a failed answer answers. */
  reuse(messageId: string): void;
  approve(stepId: string, approved: boolean, extra?: unknown): Promise<boolean>;
  newChat(): Promise<boolean>;
  selectConversation(id: string): Promise<void>;
  loadOlder(): Promise<void>;
  /** Reads the newest page again and merges it. */
  refresh(): Promise<void>;
  /** One frame of the stream, as `subscribe` hands it (exposed for tests and for apps that route frames themselves). */
  receive(frame: unknown, conversationId?: string): void;
}

export function createCoCeoChatStore(adapter: CoCeoChatAdapter, initialOptions: CoCeoChatOptions = {}): CoCeoChatStore {
  let options = initialOptions;
  let state: CoCeoChatState = INITIAL;
  const listeners = new Set<() => void>();
  let started = false;
  let unsubscribeStream: (() => void) | null = null;
  /** Bumped on every conversation switch: answers to older requests are dropped. */
  let epoch = 0;
  let pagesLoaded = 0;
  let localSeq = 0;
  let turn: Turn | null = null;
  let sending = false;
  let booting = false;
  const timers = new Map<string, () => void>();
  /** The step whose start said the lead is asking someone: its end brings the plain working line back. */
  let askCallId: string | null = null;
  /** The steps whose change on the site was told to the host: a frame seen twice tells it once. */
  const siteChangesTold = new Set<string>();

  const title = () => chatTitleOf(options);
  const pageSize = () => Math.max(1, options.pageSize ?? CHAT_PAGE_SIZE);
  const now = () => (options.now ? options.now() : Date.now());
  const storage = () => (options.storage === undefined ? defaultStorage() : options.storage);
  const draftKey = (conversationId: string | null) => `${options.storageKey || DRAFT_KEY}:${conversationId || 'new'}`;

  function set(patch: Partial<CoCeoChatState>, change?: ChatChangeKind) {
    state = { ...state, ...patch, ...(change ? { change: { kind: change, seq: state.change.seq + 1 } } : {}) };
    listeners.forEach((l) => l());
  }

  function timer(name: string, ms: number, fn: () => void) {
    timers.get(name)?.();
    const cancel = (options.schedule ?? defaultSchedule)(() => {
      timers.delete(name);
      fn();
    }, ms);
    timers.set(name, cancel);
  }

  function clearTimer(name: string) {
    timers.get(name)?.();
    timers.delete(name);
  }

  // ── The draft, kept per conversation ──

  function readDraft(conversationId: string | null): string {
    const key = draftKey(conversationId);
    const s = storage();
    if (s) {
      try {
        return s.getItem(key) ?? '';
      } catch {
        /* storage refused: the memory copy below */
      }
    }
    return memoryDrafts.get(key) ?? '';
  }

  function writeDraft(conversationId: string | null, text: string) {
    const key = draftKey(conversationId);
    if (text) memoryDrafts.set(key, text);
    else memoryDrafts.delete(key);
    try {
      const s = storage();
      if (!s) return;
      if (text) s.setItem(key, text);
      else s.removeItem(key);
    } catch {
      /* private mode or a full quota: the memory copy holds it for this page */
    }
  }

  function setDraft(text: string) {
    writeDraft(state.conversation?.id ?? null, text);
    set({ draft: text });
  }

  function giveBack(text: string, error: string | null) {
    const draft = joinDraft(text, state.draft);
    writeDraft(state.conversation?.id ?? null, draft);
    set({ draft, error, focusToken: state.focusToken + 1 });
  }

  // ── Turns ──

  function beginBusy() {
    if (!state.busy) set({ busy: true, long: false });
    timer('long', options.longAfterMs ?? LONG_AFTER_MS, () => set({ long: true }));
    timer('turn', options.turnTimeoutMs ?? CHAT_STILL_WORKING_MS, () => endTurn(true));
  }

  function endTurn(readAgain: boolean) {
    const followed = turn;
    turn = null;
    clearTimer('long');
    clearTimer('turn');
    clearTimer('settle');
    askCallId = null;
    set({ busy: false, long: false, progress: null });
    // The turn ended without its stored answer reaching us: the thread has it.
    if (readAgain || (followed && !followed.replied)) void readNewest(followed !== null);
  }

  function upsert(id: string, make: () => ChatMessage, update: (m: ChatMessage) => ChatMessage) {
    const at = state.messages.findIndex((m) => m.id === id);
    if (at < 0) {
      set({ messages: [...state.messages, make()] }, 'append');
      return;
    }
    const messages = state.messages.slice();
    messages[at] = update(messages[at]);
    set({ messages }, 'update');
  }

  function learnTitle(ref: { id: string; title?: string } | null) {
    if (ref?.title && state.titles[ref.id] !== ref.title) set({ titles: { ...state.titles, [ref.id]: ref.title } });
  }

  function apply(e: ChatEvent) {
    switch (e.type) {
      case 'ignore':
        return;
      case 'turn.started':
        if (!turn) turn = { text: null, localId: null, replied: false, restored: false, provisionalId: null };
        beginBusy();
        return;
      case 'step.started': {
        if (!turn) turn = { text: null, localId: null, replied: false, restored: false, provisionalId: null };
        beginBusy();
        learnTitle(e.step.operator);
        // A step of a sub-run (the Co-CEO's own work while the lead asked it)
        // leaves the working line as the lead's step set it (2026-10-17).
        if (e.step.progress && !e.step.parentCallId) {
          askCallId = e.step.progress.kind === 'ask' ? e.step.callId : null;
          set({ progress: e.step.progress });
        }
        const id = `step:${e.step.callId}`;
        upsert(
          id,
          () => ({ id, kind: 'step', role: 'system', text: e.step.summary, operator: e.step.operator, createdAt: null, metadata: {}, step: e.step }),
          (m) => ({ ...m, text: e.step.summary || m.text, step: { ...(m.step as ChatStep), ...e.step, summary: e.step.summary || m.step?.summary || '' } }),
        );
        return;
      }
      case 'step.finished': {
        const id = `step:${e.callId}`;
        const patch: Partial<ChatStep> = {
          status: e.status,
          ...(e.summary ? { summary: e.summary } : {}),
          ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
          ...(e.result !== undefined ? { result: e.result } : {}),
          ...(e.error ? { error: e.error } : {}),
          ...(e.edit !== undefined ? { edit: e.edit } : {}),
          ...(e.changed ? { changed: e.changed } : {}),
        };
        upsert(
          id,
          () => {
            const step: ChatStep = { callId: e.callId, name: '', summary: e.summary ?? '', status: e.status, operator: null, progress: null, ...patch };
            return { id, kind: 'step', role: 'system', text: step.summary, operator: null, createdAt: null, metadata: {}, step };
          },
          (m) => {
            const step = { ...(m.step as ChatStep), ...patch };
            return { ...m, text: step.summary, step };
          },
        );
        // The answer came back: the lead works on its own again.
        if (askCallId === e.callId) {
          askCallId = null;
          if (state.progress?.kind === 'ask') set({ progress: null });
        }
        if (e.status === 'completed') tellSiteChanged(e.callId, e.changed, e.edit);
        return;
      }
      case 'approval.required': {
        if (!turn) turn = { text: null, localId: null, replied: false, restored: false, provisionalId: null };
        beginBusy();
        learnTitle(e.approval.operator);
        const id = `approval:${e.approval.stepId}`;
        upsert(
          id,
          () => ({ id, kind: 'approval', role: 'system', text: e.approval.reason, operator: e.approval.operator, createdAt: null, metadata: {}, approval: e.approval }),
          (m) => m,
        );
        return;
      }
      case 'reply':
        receiveReply(e.message, e.stored);
        return;
      case 'failed': {
        if (e.callId && state.messages.some((m) => m.id === `step:${e.callId}`)) {
          apply({ type: 'step.finished', callId: e.callId, status: 'error', error: e.text });
          return;
        }
        localSeq += 1;
        const id = `error:${localSeq}`;
        set({ messages: [...state.messages, { id, kind: 'error', role: 'system', text: e.text, operator: null, createdAt: null, metadata: {} }] }, 'append');
        return;
      }
      case 'busy.cleared':
        endTurn(false);
        return;
      case 'subject': {
        if (!state.conversation || e.conversationId !== state.conversation.id) {
          // Another conversation of the list found its subject.
          if (state.conversations.some((c) => c.id === e.conversationId)) {
            set({ conversations: state.conversations.map((c) => (c.id === e.conversationId ? { ...c, title: e.title } : c)) });
          }
          return;
        }
        const conversation = { ...state.conversation, title: e.title };
        set({
          conversation,
          subject: e.subject,
          conversations: state.conversations.map((c) => (c.id === conversation.id ? conversation : c)),
        });
        return;
      }
    }
  }

  /**
   * A finished step that changed the site, told to the host once. Only the
   * stream's steps get here: a thread read back holds no steps.
   */
  function tellSiteChanged(callId: string, changed: ChatSiteChange[] | undefined, edit: unknown) {
    const published = !!edit && typeof edit === 'object' && (edit as { status?: unknown }).status === 'published';
    const changes: ChatSiteChange[] = changed && changed.length > 0 ? changed : published ? [{ kind: 'site' }] : [];
    if (changes.length === 0 || siteChangesTold.has(callId)) return;
    siteChangesTold.add(callId);
    try {
      options.onSiteChanged?.(changes);
    } catch {
      /* an app's listener never stops the chat */
    }
  }

  function receiveReply(message: ChatMessage, stored: boolean) {
    learnTitle(message.operator);
    const t = turn;
    // A turn that did not finish, answered while we watch: its words go back
    // into the box, once, as the answer says.
    if (t && stored && message.failed && t.text && !t.restored) {
      t.restored = true;
      giveBack(t.text, null);
    }
    if (!stored) {
      if (t) {
        t.provisionalId = message.id;
        // The stored answer and the turn's end follow; if they never come, Send works again anyway.
        timer('settle', SETTLE_AFTER_FINAL_MS, () => { if (turn === t) endTurn(false); });
      }
      if (state.messages.some((m) => m.id === message.id)) return;
      set({ messages: [...state.messages, message] }, 'append');
      return;
    }
    if (t) t.replied = true;
    const known = state.messages.findIndex((m) => m.id === message.id);
    const provisional = t?.provisionalId ? state.messages.findIndex((m) => m.id === t.provisionalId) : -1;
    const at = known >= 0 ? known : provisional;
    if (at >= 0) {
      const messages = state.messages.slice();
      messages[at] = { ...message, answeredHere: true };
      if (t) t.provisionalId = null;
      set({ messages }, 'update');
      return;
    }
    set({ messages: [...state.messages, message] }, 'append');
  }

  // ── Conversations ──

  function listen(conversationId: string) {
    unsubscribeStream?.();
    unsubscribeStream = null;
    try {
      unsubscribeStream = adapter.subscribe(conversationId, (frame) => receive(frame, conversationId));
    } catch {
      unsubscribeStream = null;
    }
  }

  async function open(conversation: ChatConversation, opts: { empty?: boolean } = {}) {
    epoch += 1;
    const mine = epoch;
    turn = null;
    clearTimer('long');
    clearTimer('turn');
    clearTimer('settle');
    askCallId = null;
    pagesLoaded = 0;
    // Words typed before the conversation was known move to it.
    const typed = state.conversation ? '' : state.draft;
    if (typed) {
      writeDraft(null, '');
      writeDraft(conversation.id, typed);
    }
    const draft = typed || readDraft(conversation.id);
    set({
      conversation,
      subject: chatSubjectOf(conversation.title),
      messages: [],
      hasMore: false,
      loading: !opts.empty,
      loadingOlder: false,
      busy: false,
      long: false,
      progress: null,
      draft,
      error: null,
    }, 'load');
    if (started) listen(conversation.id);
    if (opts.empty) {
      pagesLoaded = 1;
      return;
    }
    try {
      const page = await adapter.messages(conversation.id, { page: 1, limit: pageSize() });
      if (mine !== epoch) return;
      pagesLoaded = 1;
      const ordered = orderPage(page?.items ?? []);
      const { messages, runningSince } = markTurns(ordered, now());
      set({ messages, hasMore: page?.hasMore ?? (page?.items?.length ?? 0) >= pageSize(), loading: false }, 'load');
      // A turn still running when the chat was opened again is picked up.
      if (runningSince !== null) {
        turn = { text: null, localId: null, replied: false, restored: false, provisionalId: null };
        set({ busy: true });
        timer('long', Math.max(0, runningSince + (options.longAfterMs ?? LONG_AFTER_MS) - now()), () => set({ long: true }));
        timer('turn', Math.max(0, runningSince + (options.turnTimeoutMs ?? CHAT_STILL_WORKING_MS) - now()), () => endTurn(true));
      }
    } catch {
      if (mine !== epoch) return;
      set({ loading: false, hasMore: false }, 'load');
    }
  }

  async function loadList() {
    if (!adapter.list) return;
    try {
      const list = await adapter.list();
      if (Array.isArray(list)) set({ conversations: list.filter((c) => c && typeof c.id === 'string') });
    } catch {
      /* no switcher this time */
    }
  }

  async function bootstrap() {
    if (booting) return;
    booting = true;
    try {
      await bootstrapOnce();
    } finally {
      booting = false;
    }
  }

  async function bootstrapOnce() {
    const mine = epoch;
    set({ loading: true });
    void loadList();
    let latest: ChatConversation | null = null;
    try {
      latest = await adapter.latest();
    } catch {
      latest = null;
    }
    if (mine !== epoch) return;
    if (latest && typeof latest.id === 'string') {
      set({ ready: true });
      await open(latest);
      return;
    }
    // No conversation yet: one is opened on the first message.
    const draft = state.draft || readDraft(null);
    set({ ready: true, loading: false, draft }, 'load');
  }

  function refresh() {
    return readNewest(turn !== null || state.busy);
  }

  /** Reads the newest page again; `followed`: a turn was being followed here when it was asked for. */
  async function readNewest(followed: boolean) {
    const conversation = state.conversation;
    if (!conversation) return;
    const mine = epoch;
    try {
      const page = await adapter.messages(conversation.id, { page: 1, limit: pageSize() });
      if (mine !== epoch) return;
      const fetched = orderPage(page?.items ?? []);
      const fresh = mergeNewest(state.messages, fetched);
      // An answer the stream missed while the turn was followed arrived in this visit all the same.
      const merged = followed || turn !== null || state.busy ? markAnsweredHere(state.messages, fresh) : fresh;
      const grew = merged.length > state.messages.length;
      set({ messages: merged }, grew ? 'append' : 'update');
      // The turn's end was missed (the stream dropped, the chat was away): its answer is here.
      const waiting = merged.some((m) => m.approval && (m.approval.status === 'waiting' || m.approval.status === 'sending'));
      if (state.busy && !sending && !waiting && lastTurnAnswered(merged)) {
        turn = null;
        clearTimer('long');
        clearTimer('turn');
        clearTimer('settle');
        askCallId = null;
        set({ busy: false, long: false, progress: null });
      }
    } catch {
      /* the stream may still bring it */
    }
  }

  async function loadOlder() {
    const conversation = state.conversation;
    if (!conversation || !state.hasMore || state.loadingOlder || state.loading) return;
    const mine = epoch;
    set({ loadingOlder: true });
    try {
      const page = await adapter.messages(conversation.id, { page: pagesLoaded + 1, limit: pageSize() });
      if (mine !== epoch) return;
      pagesLoaded += 1;
      const known = new Set(state.messages.map((m) => m.id));
      // Pages shift as new messages arrive: the overlap is left out.
      const older = orderPage(page?.items ?? []).filter((m) => !known.has(m.id));
      // Read with the thread under them: the last question of an older page
      // has its answer in the newer messages already on screen.
      const marked = markTurns([...older, ...state.messages], now()).messages.slice(0, older.length);
      set({
        messages: [...marked, ...state.messages],
        hasMore: page?.hasMore ?? (page?.items?.length ?? 0) >= pageSize(),
        loadingOlder: false,
      }, 'prepend');
    } catch {
      if (mine !== epoch) return;
      set({ loadingOlder: false, hasMore: false });
    }
  }

  // ── Sending ──

  async function send(textArg?: string, extra?: unknown): Promise<boolean> {
    const text = (textArg ?? state.draft).trim();
    if (!text || state.busy || sending) return false;
    sending = true;
    try {
      let conversation = state.conversation;
      if (!conversation) {
        set({ opening: true });
        try {
          conversation = await adapter.create();
        } catch (err) {
          set({ opening: false });
          giveBackFromBox(text, textArg);
          set({ error: sentenceOf(err) ?? CHAT_NEW_CHAT_FAILED_TEXT, focusToken: state.focusToken + 1 });
          return false;
        }
        set({ opening: false, conversations: [conversation, ...state.conversations.filter((c) => c.id !== conversation!.id)] });
        await open(conversation, { empty: true });
      }
      const conversationId = conversation.id;
      localSeq += 1;
      const localId = `local:${localSeq}`;
      const mine: Turn = { text, localId, replied: false, restored: false, provisionalId: null };
      turn = mine;
      // The box empties; the words stay on screen as the owner's message.
      writeDraft(conversationId, '');
      set({
        draft: textArg === undefined || textArg.trim() === state.draft.trim() ? '' : state.draft,
        error: null,
        messages: [...state.messages, {
          id: localId, kind: 'user', role: 'user', text, operator: null,
          createdAt: new Date(now()).toISOString(), metadata: {}, sending: true,
        }],
      }, 'own');
      if (state.draft) writeDraft(conversationId, state.draft);
      beginBusy();
      try {
        await adapter.send(conversationId, text, extra ?? options.sendExtra?.());
      } catch (err) {
        if (state.conversation?.id !== conversationId) return false;
        // It never reached the team: off the thread, back into the box, with the reason.
        if (turn === mine) {
          turn = null;
          clearTimer('long');
          clearTimer('turn');
          clearTimer('settle');
        }
        set({ messages: state.messages.filter((m) => m.id !== localId), busy: false, long: false, progress: null }, 'update');
        const reason = options.failedSendText ? options.failedSendText(err, title()) : sentenceOf(err) ?? chatSendFailedLine(title());
        giveBack(text, reason);
        return false;
      }
      if (state.conversation?.id === conversationId) {
        set({ messages: state.messages.map((m) => (m.id === localId ? { ...m, sending: false } : m)) }, 'update');
      }
      return true;
    } finally {
      sending = false;
    }
  }

  /** A send that never started (no conversation could be opened): the words stay in, or go back into, the box. */
  function giveBackFromBox(text: string, textArg: string | undefined) {
    if (textArg !== undefined && textArg.trim() !== state.draft.trim()) {
      const draft = joinDraft(text, state.draft);
      writeDraft(state.conversation?.id ?? null, draft);
      set({ draft });
    }
  }

  async function approve(stepId: string, approved: boolean, extra?: unknown): Promise<boolean> {
    const conversation = state.conversation;
    const id = `approval:${stepId}`;
    const item = state.messages.find((m) => m.id === id);
    if (!conversation || !item?.approval || item.approval.status === 'sending') return false;
    const setStatus = (status: ChatApproval['status']) =>
      set({ messages: state.messages.map((m) => (m.id === id && m.approval ? { ...m, approval: { ...m.approval, status } } : m)) }, 'update');
    setStatus('sending');
    try {
      await adapter.approve(conversation.id, stepId, approved, extra);
    } catch (err) {
      if (state.conversation?.id !== conversation.id) return false;
      setStatus('waiting');
      localSeq += 1;
      const line = sentenceOf(err) ?? `Your answer did not reach your ${title()}. Try again.`;
      set({ messages: [...state.messages, { id: `error:${localSeq}`, kind: 'error', role: 'system', text: line, operator: null, createdAt: null, metadata: {} }] }, 'append');
      return false;
    }
    if (state.conversation?.id === conversation.id) setStatus(approved ? 'approved' : 'declined');
    return true;
  }

  async function newChat(): Promise<boolean> {
    if (state.opening) return false;
    set({ opening: true });
    let conversation: ChatConversation;
    try {
      conversation = await adapter.create();
    } catch (err) {
      // WPMaven refused it (a site's daily new-chat limit): the owner stays where they were, told why.
      localSeq += 1;
      const line = sentenceOf(err) ?? CHAT_NEW_CHAT_FAILED_TEXT;
      set({ opening: false, messages: [...state.messages, { id: `error:${localSeq}`, kind: 'error', role: 'system', text: line, operator: null, createdAt: null, metadata: {} }] }, 'append');
      return false;
    }
    set({ opening: false, conversations: [conversation, ...state.conversations.filter((c) => c.id !== conversation.id)] });
    // Words in the box stay in the box.
    const typed = state.draft;
    await open(conversation, { empty: true });
    if (typed && !state.draft) setDraft(typed);
    return true;
  }

  async function selectConversation(id: string) {
    if (state.conversation?.id === id) return;
    const conversation = state.conversations.find((c) => c.id === id) ?? { id, title: '' };
    await open(conversation);
  }

  function reuse(messageId: string) {
    const at = state.messages.findIndex((m) => m.id === messageId);
    if (at < 0) return;
    const m = state.messages[at];
    let text: string | null = null;
    if (m.kind === 'user') text = m.text;
    else {
      const asked = typeof m.metadata.inReplyTo === 'string' ? state.messages.find((x) => x.id === m.metadata.inReplyTo && x.kind === 'user') : undefined;
      if (asked) text = asked.text;
      else {
        for (let i = at - 1; i >= 0; i--) {
          if (state.messages[i].kind === 'user') { text = state.messages[i].text; break; }
          if (state.messages[i].kind === 'reply') break;
        }
      }
    }
    if (text) giveBack(text, null);
  }

  function receive(frame: unknown, conversationId?: string) {
    if (conversationId && state.conversation && conversationId !== state.conversation.id) return;
    const events = fromAgentEvent(frame);
    try {
      options.onFrame?.(frame, events);
    } catch {
      /* an app's listener never stops the chat */
    }
    for (const e of events) apply(e);
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setOptions(next) {
      options = next;
    },
    start() {
      if (started) return;
      started = true;
      if (state.conversation) {
        // Back after a stop: listening again, and the newest page read again
        // for what was said meanwhile. A turn still running keeps its limit.
        listen(state.conversation.id);
        if (state.busy) timer('turn', options.turnTimeoutMs ?? CHAT_STILL_WORKING_MS, () => endTurn(true));
        void refresh();
        return;
      }
      if (!state.ready) void bootstrap();
    },
    stop() {
      if (!started) return;
      started = false;
      unsubscribeStream?.();
      unsubscribeStream = null;
      for (const cancel of timers.values()) cancel();
      timers.clear();
    },
    send,
    setDraft,
    fill(text: string) {
      set({ seed: { text, token: state.seed.token + 1 } });
    },
    reuse,
    approve,
    newChat,
    selectConversation,
    loadOlder,
    refresh,
    receive,
  };
}

/** The failed answer as an older visit reads it back: its words are no longer in the box, so it offers to put them back. */
export function chatFailedReplyText(message: ChatMessage, title: string): string {
  if (!message.failed || message.answeredHere) return message.text;
  const earlier = `Your ${title} could not finish this. Put it back in the box to send it again.`;
  return message.text.startsWith(CHAT_TURN_FAILED_TEXT) ? earlier + message.text.slice(CHAT_TURN_FAILED_TEXT.length) : message.text;
}
