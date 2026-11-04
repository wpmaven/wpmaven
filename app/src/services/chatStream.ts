/**
 * The chat's live line for one conversation, through WordPress.
 *
 * The stream's address comes from the plugin (/sse/config), then a ticket
 * (/sse/ticket): short-lived and single-use, so the site's token stays in
 * PHP. Each frame goes to the chat as it is parsed ({ type, data, timestamp });
 * the kit's chat reads the events. The stream closes after every turn, and a
 * line can drop: it opens again with a fresh ticket, waiting a little longer
 * each time, and gives up after ten tries in a row (the chat says so, with
 * Retry). An update of the API says `reconnect` before it closes the line
 * (2026-10-19): it opens again at once, and that is not a try. One line per
 * conversation: the chat opens it and closes it.
 *
 * A `navigation` frame opens one of WordPress's own admin screens, never
 * anything else.
 */
import { api } from './api';

export type ChatStreamState = 'connecting' | 'connected' | 'failed';

export interface ChatStreamStatus {
  state: ChatStreamState;
  /** The tries in a row so far (0 once connected). */
  attempt: number;
}

/** What the stream needs from the browser: an EventSource, as the tests fake it. */
export interface EventSourceLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}

/** Where a `navigation` frame sends the owner. */
export interface NavigationTarget {
  url: string;
  newTab: boolean;
  delay: number;
}

export interface ChatStreamDeps {
  getConfig: () => Promise<any>;
  getTicket: (conversationId: string, instanceId: string | null) => Promise<any>;
  instanceId: () => string | null;
  createSource: (url: string) => EventSourceLike;
  schedule: (fn: () => void, ms: number) => () => void;
  navigate: (target: NavigationTarget) => void;
  origin: () => string;
}

export interface ChatStreamHandlers {
  onFrame: (frame: unknown) => void;
  onStatus?: (status: ChatStreamStatus) => void;
  /**
   * The line opened again after it had been open: something may have been
   * said meanwhile. `moved`: an update of the API moved it (`reconnect`).
   */
  onReconnected?: (moved: boolean) => void;
}

export interface ChatStream {
  close(): void;
  /** After it gave up: try again now. */
  retry(): void;
}

/** Tries in a row before the stream gives up. */
export const STREAM_MAX_ATTEMPTS = 10;

/** How long before the next try: half a second after a drop, then doubling, ten seconds at most. */
export function retryDelay(attempt: number): number {
  return attempt <= 1 ? 500 : Math.min(1000 * 2 ** (attempt - 1), 10_000);
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Where a `navigation` frame goes: one of this site's admin screens
 * ("/wp-admin/..." or "wp-admin/..."), or nowhere (null).
 */
export function navigationTarget(frame: unknown, origin: string): NavigationTarget | null {
  if (!isObj(frame) || frame.type !== 'navigation') return null;
  const d = isObj(frame.data) ? frame.data : {};
  const url = typeof d.url === 'string' ? d.url.trim() : '';
  const path = url.startsWith('/wp-admin/') ? url : url.startsWith('wp-admin/') ? `/${url}` : null;
  if (!path) return null;
  const delay = typeof d.delay === 'number' && Number.isFinite(d.delay) && d.delay > 0 ? Math.min(d.delay, 10_000) : 0;
  return { url: `${origin}${path}`, newTab: d.target === 'new', delay };
}

function wpData(): any {
  return typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA ?? {} : {};
}

/** This site's instance, as the ticket and the turn name it. */
export function chatInstanceId(): string | null {
  const data = wpData();
  return data.instanceId || data.status?.instance_id || null;
}

export function defaultStreamDeps(): ChatStreamDeps {
  return {
    getConfig: () => api.getSSEConfig(),
    getTicket: (conversationId, instanceId) => api.getSSETicket(conversationId, instanceId),
    instanceId: chatInstanceId,
    createSource: (url) => new EventSource(url) as unknown as EventSourceLike,
    schedule: (fn, ms) => {
      const h = setTimeout(fn, ms);
      return () => clearTimeout(h);
    },
    navigate: (t) => {
      const go = () => {
        if (t.newTab) window.open(t.url, '_blank', 'noopener');
        else window.location.assign(t.url);
      };
      if (t.delay > 0) setTimeout(go, t.delay);
      else go();
    },
    origin: () => window.location.origin,
  };
}

export function openChatStream(conversationId: string, handlers: ChatStreamHandlers, deps: ChatStreamDeps = defaultStreamDeps()): ChatStream {
  let closed = false;
  let source: EventSourceLike | null = null;
  let attempt = 0;
  let wasOpen = false;
  // The API asked for the next opening: an update moved the line.
  let moved = false;
  let cancelTimer: (() => void) | null = null;

  const status = (state: ChatStreamState) => {
    try {
      handlers.onStatus?.({ state, attempt: state === 'connected' ? 0 : attempt });
    } catch {
      /* a listener never stops the line */
    }
  };

  const drop = () => {
    const s = source;
    source = null;
    if (s) {
      s.onopen = null;
      s.onmessage = null;
      s.onerror = null;
      s.close();
    }
  };

  const deliver = (raw: string) => {
    let frame: unknown = raw;
    try {
      frame = JSON.parse(raw);
    } catch {
      /* the kit reads a line it cannot parse as nothing */
    }
    if (isObj(frame) && frame.type === 'reconnect') {
      moveNow();
      return;
    }
    const target = navigationTarget(frame, deps.origin());
    if (target) deps.navigate(target);
    handlers.onFrame(frame);
  };

  // The API is moving to its updated copy and ends this line: a fresh
  // ticket at once, no wait, and not one of the ten tries.
  const moveNow = () => {
    drop();
    moved = true;
    cancelTimer?.();
    cancelTimer = null;
    attempt = 0;
    void connect();
  };

  const retryLater = () => {
    if (closed) return;
    if (attempt >= STREAM_MAX_ATTEMPTS) {
      status('failed');
      return;
    }
    status('connecting');
    cancelTimer = deps.schedule(() => {
      cancelTimer = null;
      void connect();
    }, retryDelay(attempt));
  };

  async function connect() {
    if (closed) return;
    attempt += 1;
    status('connecting');
    try {
      const cfg = await deps.getConfig();
      if (closed) return;
      if (!cfg?.success || !cfg.config?.url) throw new Error('No stream address');
      const url = new URL(cfg.config.url, deps.origin());
      if (cfg.config.useTicket) {
        const ticket = await deps.getTicket(conversationId, deps.instanceId());
        if (closed) return;
        if (!ticket?.success || !ticket.ticket) throw new Error('No ticket');
        url.searchParams.set('ticket', ticket.ticket);
      }
      url.searchParams.set('conversationId', conversationId);
      const es = deps.createSource(url.toString());
      source = es;
      es.onopen = () => {
        if (source !== es) return;
        const again = wasOpen;
        const byUpdate = moved;
        wasOpen = true;
        moved = false;
        attempt = 0;
        status('connected');
        if (again) handlers.onReconnected?.(byUpdate);
      };
      es.onmessage = (ev) => {
        if (source === es) deliver(ev.data);
      };
      // The server closed the line (a turn ended) or it dropped: a ticket
      // serves once, so the browser's own retry would fail. A fresh one.
      es.onerror = () => {
        if (source !== es) return;
        drop();
        retryLater();
      };
    } catch {
      retryLater();
    }
  }

  void connect();

  return {
    close() {
      closed = true;
      cancelTimer?.();
      cancelTimer = null;
      drop();
    },
    retry() {
      if (closed) return;
      cancelTimer?.();
      cancelTimer = null;
      drop();
      attempt = 0;
      void connect();
    },
  };
}
