/**
 * useCoCeoChat (2026-10-16): the chat's state for a view, from one adapter.
 *
 * The state lives in a store kept per adapter (createCoCeoChatStore), so the
 * Home card and its full view, drawn one after the other with the same
 * adapter, share the thread, the turn in progress and the draft. The store
 * stops listening a moment after the last view using it goes, and picks up
 * again (reading the newest page) when one comes back.
 *
 * The scrolling is the view's own: the thread sticks to the bottom only while
 * the owner is within 100px of it; otherwise new messages wait behind a "New
 * messages" button. Within 100px of the top, 20 older messages load, and the
 * message being read stays where it was.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  chatBusyReason,
  chatLeadOf,
  chatTitleOf,
  createCoCeoChatStore,
  type CoCeoChatAdapter,
  type CoCeoChatOptions,
  type CoCeoChatState,
  type CoCeoChatStore,
} from './store';
import type { ChatSiteChange } from './events';

/** How near (px) the bottom counts as reading the newest, and the top as asking for older messages. */
export const CHAT_SCROLL_EDGE_PX = 100;

/** The thread's scroll box, as a scroll event reads it. */
export interface ChatScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Within 100px of the bottom: new messages scroll into view. */
export function isNearBottom(m: ChatScrollMetrics, edge = CHAT_SCROLL_EDGE_PX): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= edge;
}

/** Within 100px of the top: older messages are asked for. */
export function isNearTop(m: ChatScrollMetrics, edge = CHAT_SCROLL_EDGE_PX): boolean {
  return m.scrollTop <= edge;
}

/**
 * Where to scroll after older messages went in above: the same distance from
 * the bottom as before, so the message being read does not move.
 */
export function keptScrollTop(before: ChatScrollMetrics, afterScrollHeight: number): number {
  return Math.max(0, afterScrollHeight - (before.scrollHeight - before.scrollTop));
}

/** What a view gets: the state, the actions and the thread's scrolling. */
export interface CoCeoChatHandle {
  state: CoCeoChatState;
  /** Who leads the chat, the API's operator id (the Co-CEO's `chief_of_staff` by default). */
  lead: string;
  /** The lead's title ("Co-CEO"). */
  title: string;
  /** Why Send is off, while a turn runs or a chat opens; null otherwise. */
  busyReason: string | null;
  /** The adapter lists conversations: the header can show a switcher. */
  canList: boolean;
  /** Sends `text`, or the draft. False when nothing was sent (empty, busy, refused). */
  send(text?: string, extra?: unknown): Promise<boolean>;
  setDraft(text: string): void;
  /** Seeds the box with a suggestion; [bracketed] parts become slots to fill. */
  fill(text: string): void;
  /** Puts a message's words back in the box (an unanswered one, or the one a failed answer answers). */
  reuse(messageId: string): void;
  approve(stepId: string, approved: boolean, extra?: unknown): Promise<boolean>;
  newChat(): Promise<boolean>;
  selectConversation(id: string): Promise<void>;
  loadOlder(): Promise<void>;
  /** Reads the newest page again (after the app's stream reconnected, say). */
  refresh(): Promise<void>;
  /** The thread's scroll box: give `ref` and `onScroll` to it (CoCeoChat does). */
  thread: {
    ref: (el: HTMLDivElement | null) => void;
    onScroll: (e: React.UIEvent<HTMLElement>) => void;
    /** Something new arrived while the owner was reading further up. */
    showNewMessages: boolean;
    /** The owner scrolled up, away from the newest message: the way back down shows. */
    showToBottom: boolean;
    toBottom(): void;
  };
}

interface Entry {
  store: CoCeoChatStore;
  users: number;
  cancelStop: (() => void) | null;
}

const stores = new WeakMap<CoCeoChatAdapter, Entry>();
/** A view switch (card to full view) unmounts one view and mounts the next: the store waits this long before it stops. */
const STOP_AFTER_MS = 1_000;

function entryFor(adapter: CoCeoChatAdapter, options: CoCeoChatOptions): Entry {
  let entry = stores.get(adapter);
  if (!entry) {
    entry = { store: createCoCeoChatStore(adapter, options), users: 0, cancelStop: null };
    stores.set(adapter, entry);
  }
  return entry;
}

/** The store shared by every view of this adapter, for an app that drives it without a view. */
export function coCeoChatStoreFor(adapter: CoCeoChatAdapter, options: CoCeoChatOptions = {}): CoCeoChatStore {
  return entryFor(adapter, options).store;
}

/** Layout effects do nothing in a server render (the unit tests); this is the same effect without the warning. */
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function useCoCeoChat(adapter: CoCeoChatAdapter, options: CoCeoChatOptions = {}): CoCeoChatHandle {
  const entry = entryFor(adapter, options);
  const { store } = entry;

  // The newest options (title, extra context) for whatever the store does next.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // The host's reaction to a change on the site goes through the ref: a step
  // that finishes before the effects below ran still calls the newest one.
  const onSiteChanged = useCallback((changes: ChatSiteChange[]) => optionsRef.current.onSiteChanged?.(changes), []);
  useIsoLayoutEffect(() => {
    store.setOptions({ ...optionsRef.current, onSiteChanged });
  });

  useEffect(() => {
    entry.users += 1;
    entry.cancelStop?.();
    entry.cancelStop = null;
    store.setOptions({ ...optionsRef.current, onSiteChanged });
    store.start();
    return () => {
      entry.users -= 1;
      if (entry.users > 0) return;
      const h = setTimeout(() => {
        entry.cancelStop = null;
        if (entry.users === 0) store.stop();
      }, STOP_AFTER_MS);
      entry.cancelStop = () => clearTimeout(h);
    };
  }, [entry, store, onSiteChanged]);

  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const lead = chatLeadOf(options);
  const title = chatTitleOf(options);

  // ── The thread's scrolling ──
  const elRef = useRef<HTMLDivElement | null>(null);
  const stuckRef = useRef(true);
  const beforeOlderRef = useRef<ChatScrollMetrics | null>(null);
  const [unseen, setUnseen] = useState(false);
  const [away, setAway] = useState(false);

  const toBottom = useCallback((smooth = true) => {
    const el = elRef.current;
    stuckRef.current = true;
    setUnseen(false);
    setAway(false);
    if (!el) return;
    if (smooth && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
  }, []);

  const ref = useCallback((el: HTMLDivElement | null) => {
    elRef.current = el;
    // A view that mounts on a thread already read (the full view) opens at its newest.
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const m = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    stuckRef.current = isNearBottom(m);
    setAway(!stuckRef.current);
    if (stuckRef.current) setUnseen(false);
    const s = store.getState();
    if (isNearTop(m) && s.hasMore && !s.loadingOlder && !s.loading) {
      beforeOlderRef.current = m;
      void store.loadOlder();
    }
  }, [store]);

  const change = state.change;
  useIsoLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    switch (change.kind) {
      case 'load':
        stuckRef.current = true;
        setUnseen(false);
        setAway(false);
        el.scrollTop = el.scrollHeight;
        return;
      case 'own':
        toBottom(false);
        return;
      case 'prepend': {
        const before = beforeOlderRef.current;
        beforeOlderRef.current = null;
        if (before) el.scrollTop = keptScrollTop(before, el.scrollHeight);
        return;
      }
      default:
        if (stuckRef.current) el.scrollTop = el.scrollHeight;
        else if (change.kind === 'append') setUnseen(true);
    }
  }, [change.seq]);

  // The working bubble comes and goes, and says more after a while: the newest stays in view.
  useIsoLayoutEffect(() => {
    const el = elRef.current;
    if (el && stuckRef.current) el.scrollTop = el.scrollHeight;
  }, [state.busy, state.long, state.progress?.operator]);

  const busyReason = chatBusyReason(state, title);

  return useMemo<CoCeoChatHandle>(() => ({
    state,
    lead,
    title,
    busyReason,
    canList: typeof adapter.list === 'function',
    send: store.send,
    setDraft: store.setDraft,
    fill: store.fill,
    reuse: store.reuse,
    approve: store.approve,
    newChat: store.newChat,
    selectConversation: store.selectConversation,
    loadOlder: store.loadOlder,
    refresh: store.refresh,
    thread: { ref, onScroll, showNewMessages: unseen, showToBottom: away, toBottom: () => toBottom(true) },
  }), [state, lead, title, busyReason, adapter, store, ref, onScroll, unseen, away, toBottom]);
}
