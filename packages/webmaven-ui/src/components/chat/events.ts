/**
 * The chat's own words for what the API's stream and thread say (2026-10-16).
 *
 * One chat for the plugin and the dashboard: each app owns its transport
 * (WordPress's nonce and ticket, the dashboard's session) and hands the kit
 * the frames it reads. `fromAgentEvent` turns each frame into the chat's own
 * events; `fromStoredMessage` turns a message read back from a thread into a
 * message the chat draws. Both are pure, so the whole mapping is tested
 * without a browser, and the kit never knows an address.
 *
 * The frames, as the API writes them: `data: {"type","data","timestamp"}`,
 * with `: ping` comments to keep the line open. `pipeline_complete` ends
 * every turn; its `reply` is the answer as stored, with what the
 * send-and-wait reply carries (the answering operator, next steps, what waits
 * for the owner). A runtime that throws ends with `error`, and the failed
 * answer it stored rides in `reply` too.
 */

/**
 * The lead of the team: the Co-CEO, whose face signs the chat unless the app
 * gives the chat another lead (the editor's Web Designer, 2026-10-17).
 */
export const CO_CEO_OPERATOR = 'chief_of_staff';

/** A member of the team as a payload names one: the API id, and the title when it came with it. */
export interface ChatOperatorRef {
  id: string;
  title?: string;
}

/**
 * Whose work a running turn is doing: handed to that member's own run, done
 * with them, or asked of them while the lead waits for the answer (the Web
 * Designer asking the Co-CEO, 2026-10-17).
 */
export interface ChatProgress {
  kind: 'handoff' | 'with' | 'ask';
  operator: string;
}

/** What another member said to the lead inside a turn (a step's owner view, `said`): plain words, never Markdown. */
export interface ChatSaid {
  operator: string;
  text: string;
}

/** A question the lead asked the Co-CEO during a turn, as the stored answer keeps it (`metadata.consults`). */
export interface ChatConsult {
  callId: string;
  request: string;
  answer: string;
  status: string;
}

export type ChatStepStatus = 'running' | 'completed' | 'error';

/** The kinds of things a step may change on the site, as the API names them. */
export type ChatSiteChangeKind = 'page' | 'post' | 'product' | 'media' | 'menu' | 'term' | 'site' | 'design';

/**
 * One thing a step changed on the site (the API's `changed` on a tool result,
 * 2026-10-19): its kind and, when WPMaven knows it, the record's WordPress id.
 * Pages, posts and products share WordPress's ids, so an id names one record
 * whatever the kind says. `site` is the whole site (its settings, identity,
 * forms, home page) or a change WPMaven could not place; `design` the header,
 * the footer, the colors, the fonts or the theme. A host showing the site
 * (the plugin's editor) refreshes from it.
 */
export interface ChatSiteChange {
  kind: ChatSiteChangeKind | (string & {});
  id?: number;
}

/** One step of a turn, as the stream tells it (a tool the team runs). */
export interface ChatStep {
  /** The runtime's call id (or a legacy pipeline's step id). */
  callId: string;
  /** The tool's name: never shown to an owner, kept for a host's renderer. */
  name: string;
  /** The owner's sentence for the step: the result's summary once done, else the start's. */
  summary: string;
  status: ChatStepStatus;
  /** Who does the step. */
  operator: ChatOperatorRef | null;
  /** What starting it says about the turn (a hand-off, or work with a specialist). */
  progress: ChatProgress | null;
  params?: Record<string, unknown>;
  /** The API's owner-safe view of the result (pictures, an item, a few lines). */
  result?: unknown;
  /** The owner's sentence when the step did not work. */
  error?: string;
  durationMs?: number;
  /** An edit operation's result card, for the host's renderer. */
  edit?: unknown;
  /** What the finished step changed on the site. */
  changed?: ChatSiteChange[];
  resultComponent?: string;
  collapseByDefault?: boolean;
  /** Set when the step belongs to a sub-run, the parent's call id. */
  parentCallId?: string;
}

export type ChatApprovalStatus = 'waiting' | 'sending' | 'approved' | 'declined';

/** Something the turn waits on: the owner's yes or no. */
export interface ChatApproval {
  /** The id the answer goes back with (the runtime's call id, or a legacy step id). */
  stepId: string;
  name: string;
  /** What it does, in the owner's words. */
  reason: string;
  params: Record<string, unknown>;
  /** Who asks for the yes. */
  operator: ChatOperatorRef | null;
  progress: ChatProgress | null;
  networkNotes?: Array<{ network: string; note: string }>;
  /** An edit operation's preview card, for the host's renderer. */
  edit?: unknown;
  status: ChatApprovalStatus;
  /** From the older pipeline (pipeline_update, user_approval_request). */
  legacy?: boolean;
}

/**
 * What a thread item is:
 *  - user: the owner's own words, always drawn as plain text;
 *  - reply: an answer from the team;
 *  - step: a step of a running turn;
 *  - approval: a turn waiting for the owner's yes;
 *  - error: a line saying why something did not happen;
 *  - notice: a quiet line from the system ("Using 2 blocks as context").
 * A host may add its own kinds and draw them through `renderers`.
 */
export type ChatMessageKind = 'user' | 'reply' | 'step' | 'approval' | 'error' | 'notice';

export interface ChatMessage {
  id: string;
  kind: ChatMessageKind | (string & {});
  role: 'user' | 'assistant' | 'system';
  /** The words. The owner's are never read as Markdown or HTML. */
  text: string;
  /** Who answered (a reply) or who acts (a step, an approval). */
  operator: ChatOperatorRef | null;
  /** When it was written (ISO), null when unknown. */
  createdAt: string | null;
  /** The API's metadata, cleaned of nothing: a host's renderer reads its own fields (edits, nextSteps...). */
  metadata: Record<string, unknown>;
  /** A turn that did not finish: the answer says so and the chat marks it. */
  failed?: boolean;
  /** Pictures that came with the answer. */
  images?: string[];
  step?: ChatStep;
  approval?: ChatApproval;
  /** The owner's message is on its way. */
  sending?: boolean;
  /** The answer arrived while the chat was open (not read back from the thread). */
  answeredHere?: boolean;
  /** An owner's message that never got an answer. */
  unanswered?: boolean;
  /** The run's own final words (agent.complete): replaced in place by the stored answer. */
  provisional?: boolean;
}

/** Why a frame changes nothing on screen. */
export type ChatIgnoreReason =
  | 'ping'
  | 'welcome'
  | 'interim'
  | 'usage'
  | 'connection'
  | 'navigation'
  | 'subagent'
  | 'empty'
  | 'malformed'
  | 'unknown';

/** The chat's own events, as `fromAgentEvent` reads them from the stream. */
export type ChatEvent =
  /** A turn runs (it may have been started elsewhere, in another tab). */
  | { type: 'turn.started' }
  | { type: 'step.started'; step: ChatStep }
  | {
      type: 'step.finished';
      callId: string;
      status: 'completed' | 'error';
      summary?: string;
      durationMs?: number;
      result?: unknown;
      error?: string;
      edit?: unknown;
      changed?: ChatSiteChange[];
    }
  | { type: 'approval.required'; approval: ChatApproval }
  /**
   * An answer. `stored`: the answer as the thread keeps it (pipeline_complete
   * or error's `reply`, a legacy ai_response). Not stored: the run's own final
   * words (agent.complete), shown at once and replaced by the stored answer.
   */
  | { type: 'reply'; message: ChatMessage; stored: boolean }
  /** Something did not work: a step (with its callId) or the turn. The words are the owner's. */
  | { type: 'failed'; text: string; code?: string; callId?: string; detail?: string }
  /** The turn is over: Send works again. */
  | { type: 'busy.cleared'; chatWindow?: unknown }
  /** The conversation found its subject; `subject` is null for a placeholder title. */
  | { type: 'subject'; conversationId: string; title: string; subject: string | null }
  | { type: 'ignore'; reason: ChatIgnoreReason };

// ── Words ────────────────────────────────────────────────────────────────

/** What the API stores and says for a turn that did not finish (API TURN_FAILED_ANSWER). */
export const CHAT_TURN_FAILED_TEXT = 'I could not finish this just now. Your message is back in the box, so you can send it again.';

/** A turn that ended in an error with no words of its own. */
export const CHAT_TURN_ERROR_TEXT = 'This answer could not finish. Please try again.';

/**
 * The titles a conversation carries before it has a subject: the plugin's
 * "New chat" and "AI Chat", the dashboard's "Co-CEO", WhatsApp's, and the
 * API's own placeholders (conversationTitleService). Lower-cased.
 */
export const CHAT_PLACEHOLDER_TITLES: readonly string[] = [
  'new chat',
  'ai chat',
  'untitled',
  'co-ceo',
  'whatsapp chat',
  'new conversation',
  'chat',
  'untitled conversation',
];

/**
 * The subject a conversation's title gives the header, or null when the title
 * is a placeholder (any case) or empty: the header then says "Your Co-CEO"
 * alone, never "Your Co-CEO: New chat".
 */
export function chatSubjectOf(title: string | null | undefined): string | null {
  if (typeof title !== 'string') return null;
  const t = title.replace(/\s+/g, ' ').trim();
  if (!t || CHAT_PLACEHOLDER_TITLES.includes(t.toLowerCase())) return null;
  return t;
}

/**
 * "Your Co-CEO is working on it: handing this to your Social Media Manager…",
 * the dashboard's words; "Your Web Designer is asking your Co-CEO…" while the
 * lead waits for an answer. A progress naming the lead itself is no
 * specialist: the plain line.
 */
export function chatWorkingLine(
  progress: ChatProgress | null,
  title: string,
  titleOf: (operatorId: string) => string | undefined,
  lead: string = CO_CEO_OPERATOR,
): string {
  const who = progress && progress.operator !== lead ? titleOf(progress.operator) : undefined;
  if (progress && who && progress.kind === 'ask') return `Your ${title} is asking your ${who}…`;
  if (progress && who && progress.kind === 'handoff') return `Your ${title} is working on it: handing this to your ${who}…`;
  if (progress && who) return `Your ${title} is working on it with your ${who}…`;
  return `Your ${title} is working on it…`;
}

// ── Reading payloads ─────────────────────────────────────────────────────

const OPERATOR_ID = /^[a-z][a-z0-9_]{0,39}$/;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** One line of plain words: whitespace folded, trimmed. */
function line(v: unknown): string {
  return str(v).replace(/\s+/g, ' ').trim();
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** A member from a payload: an id string, or `{ id, title }`; null when it is neither. */
export function chatOperatorOf(raw: unknown): ChatOperatorRef | null {
  if (typeof raw === 'string') return OPERATOR_ID.test(raw) ? { id: raw } : null;
  if (!isObj(raw) || typeof raw.id !== 'string' || !OPERATOR_ID.test(raw.id)) return null;
  const title = line(raw.title);
  return title ? { id: raw.id, title } : { id: raw.id };
}

/** The progress fact of a step, or null when it is not one. */
export function chatProgressOf(raw: unknown): ChatProgress | null {
  if (!isObj(raw)) return null;
  if (raw.kind !== 'handoff' && raw.kind !== 'with' && raw.kind !== 'ask') return null;
  if (typeof raw.operator !== 'string' || !OPERATOR_ID.test(raw.operator)) return null;
  return { kind: raw.kind, operator: raw.operator };
}

/** The most a said line shows (the API sends at most 600 characters; a consult's stored answer at most 2,000). */
const SAID_MAX = 2_000;

/** Plain words kept as written, line breaks included, empty when there are none. */
function saidText(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, SAID_MAX) : '';
}

/**
 * What another member said inside a turn, from a step's owner view
 * (`{ said: { operator, text } }`), or null when the result is not one.
 */
export function chatSaidOf(result: unknown): ChatSaid | null {
  if (!isObj(result) || !isObj(result.said)) return null;
  const operator = result.said.operator;
  const text = saidText(result.said.text);
  if (typeof operator !== 'string' || !OPERATOR_ID.test(operator) || !text) return null;
  return { operator, text };
}

/** The questions a stored answer says its lead asked the Co-CEO (`metadata.consults`), the ones with an answer. */
export function chatConsultsOf(metadata: Record<string, unknown> | null | undefined): ChatConsult[] {
  const raw = metadata && Array.isArray(metadata.consults) ? metadata.consults : [];
  const out: ChatConsult[] = [];
  for (const c of raw) {
    if (!isObj(c) || typeof c.callId !== 'string' || !c.callId) continue;
    const answer = saidText(c.answer);
    if (!answer) continue;
    out.push({ callId: c.callId, request: line(c.request), answer, status: str(c.status) });
  }
  return out;
}

const SITE_CHANGE_KIND = /^[a-z][a-z_]{0,19}$/;

/** What a tool result says it changed on the site (`changed`): kinds and positive ids, nothing else; [] when none. */
export function chatSiteChangesOf(raw: unknown): ChatSiteChange[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatSiteChange[] = [];
  for (const c of raw) {
    if (!isObj(c) || typeof c.kind !== 'string' || !SITE_CHANGE_KIND.test(c.kind)) continue;
    const id = typeof c.id === 'number' && Number.isSafeInteger(c.id) && c.id > 0 ? c.id : undefined;
    out.push(id !== undefined ? { kind: c.kind, id } : { kind: c.kind });
  }
  return out;
}

/** The owner's sentence of a runtime error, without a code in front of it ("RUN_CAP_REACHED: ..."). */
function errorSentence(raw: unknown): string {
  return line(raw).replace(/^[A-Z][A-Z0-9_]{2,}:\s*/, '').trim();
}

/** A finished run that reads as an error: a declined turn with its reply is an ordinary answer. */
function completedTurnIsError(status: unknown, finalMessage: string): boolean {
  if (!status || status === 'completed') return false;
  if (status === 'rejected' && finalMessage.trim()) return false;
  return true;
}

function imagesOf(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
  return out.length > 0 ? out : undefined;
}

/** A message the API never meant as words from the team: the old greeting on every empty chat. */
function isWelcome(metadata: Obj): boolean {
  return metadata.type === 'welcome';
}

/**
 * A message read back from a thread (or carried by a stream's `reply`), as
 * the chat draws it; null for what the chat never shows: a `welcome`
 * greeting, a message with no words (except an answer to a named message,
 * which is a turn that did not finish), an unknown role.
 */
export function fromStoredMessage(raw: unknown, fallbackId?: string): ChatMessage | null {
  if (!isObj(raw)) return null;
  const metadata: Obj = isObj(raw.metadata) ? raw.metadata : {};
  if (isWelcome(metadata)) return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : fallbackId;
  if (!id) return null;
  const role = str(raw.role).toLowerCase();
  const content = str(raw.content ?? raw.text);
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : null;
  const images = imagesOf(raw.images);
  const base = { id, createdAt, metadata, ...(images ? { images } : {}) };

  if (role === 'user') {
    if (!content.trim()) return null;
    return { ...base, kind: 'user', role: 'user', text: content, operator: null };
  }
  if (role === 'system') {
    if (!content.trim()) return null;
    return { ...base, kind: 'notice', role: 'system', text: content, operator: null };
  }
  if (role !== 'assistant' && role !== 'error') return null;

  const empty = !content.trim();
  // A turn that did not finish: the API says so (metadata.failed), stored it
  // as an empty answer to a named message (older), or kept the runtime's
  // error on a run that did not complete (the plugin's older replies).
  const status = metadata.status;
  const erred = metadata.error != null && metadata.error !== false && status !== 'completed' && status !== 'rejected';
  const failed = metadata.failed === true || role === 'error' || erred || (empty && typeof metadata.inReplyTo === 'string');
  if (empty && !failed) return null;
  return {
    ...base,
    kind: 'reply',
    role: 'assistant',
    text: empty ? CHAT_TURN_FAILED_TEXT : content,
    operator: chatOperatorOf(metadata.operator),
    ...(failed ? { failed: true } : {}),
  };
}

/** The answer a `pipeline_complete` or `error` frame carries ({ messageId, content, metadata }), or null. */
function storedReplyOf(raw: unknown, fallbackId: string): ChatMessage | null {
  if (!isObj(raw)) return null;
  const id = typeof raw.messageId === 'string' && raw.messageId ? raw.messageId : fallbackId;
  const message = fromStoredMessage({ id, role: 'assistant', content: raw.content, metadata: raw.metadata, images: raw.images });
  return message ? { ...message, answeredHere: true } : null;
}

// ── Frames ───────────────────────────────────────────────────────────────

interface Frame {
  type: string;
  data: Obj;
  timestamp: string;
}

/**
 * A frame as an app hands it over: the parsed object, the JSON text of a
 * `data:` line (with or without its prefix), or a comment line (`: ping`).
 */
function readFrame(frame: unknown): Frame | 'ping' | null {
  let f: unknown = frame;
  if (typeof f === 'string') {
    const text = f.trim();
    if (!text) return null;
    if (text.startsWith(':')) return 'ping';
    const json = text.startsWith('data:') ? text.slice(5).trim() : text;
    try {
      f = JSON.parse(json);
    } catch {
      return null;
    }
  }
  if (!isObj(f) || typeof f.type !== 'string' || !f.type) return null;
  // The API wraps each event in `data`; an app may also hand the inner event itself.
  const data = isObj(f.data) ? f.data : f;
  const timestamp = typeof f.timestamp === 'string' ? f.timestamp : str(data.timestamp);
  return { type: f.type, data, timestamp };
}

const ignore = (reason: ChatIgnoreReason): ChatEvent[] => [{ type: 'ignore', reason }];

function stepFrom(d: Obj, callId: string): ChatStep {
  const params = isObj(d.params) ? d.params : undefined;
  return {
    callId,
    name: str(d.name),
    summary: line(d.summary),
    status: 'running',
    operator: chatOperatorOf(d.operatorRef) ?? chatOperatorOf(d.operator),
    progress: chatProgressOf(d.progress),
    ...(params ? { params } : {}),
    ...(typeof d.resultComponent === 'string' ? { resultComponent: d.resultComponent } : {}),
    ...(typeof d.collapseByDefault === 'boolean' ? { collapseByDefault: d.collapseByDefault } : {}),
    ...(typeof d.parentCallId === 'string' ? { parentCallId: d.parentCallId } : {}),
  };
}

function notesOf(raw: unknown): Array<{ network: string; note: string }> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter(isObj)
    .map((n) => ({ network: line(n.network), note: line(n.note) }))
    .filter((n) => n.network && n.note);
  return out.length > 0 ? out : undefined;
}

/**
 * The chat's own events for one frame of the stream. Most frames make one
 * event; the end of a turn makes two (its answer, then Send works again). A
 * frame that changes nothing on screen makes `ignore` with its reason: a
 * keep-alive ping, the old `welcome` greeting (always dropped), the run's
 * interim text, usage counts, an unknown type.
 */
export function fromAgentEvent(frame: unknown): ChatEvent[] {
  const f = readFrame(frame);
  if (f === 'ping') return ignore('ping');
  if (!f) return ignore('malformed');
  const d = f.data;
  const callId = typeof d.callId === 'string' && d.callId ? d.callId : '';

  switch (f.type) {
    case 'ping':
      return ignore('ping');

    // ── The agent runtime ──
    case 'agent.tool_call_start':
      if (!callId) return ignore('malformed');
      return [{ type: 'step.started', step: stepFrom(d, callId) }];

    case 'agent.tool_call_result': {
      if (!callId) return ignore('malformed');
      const error = typeof d.error === 'string' && d.error.trim() ? errorSentence(d.error) : undefined;
      const summary = line(d.ownerSummary);
      const durationMs = num(d.durationMs);
      const changed = d.error ? [] : chatSiteChangesOf(d.changed);
      return [{
        type: 'step.finished',
        callId,
        status: d.error ? 'error' : 'completed',
        ...(summary ? { summary } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(d.result !== undefined ? { result: d.result } : {}),
        ...(error ? { error } : {}),
        ...(d.edit !== undefined ? { edit: d.edit } : {}),
        ...(changed.length > 0 ? { changed } : {}),
      }];
    }

    case 'agent.tool_call_approval_required': {
      if (!callId) return ignore('malformed');
      const notes = notesOf(d.networkNotes);
      return [{
        type: 'approval.required',
        approval: {
          stepId: callId,
          name: str(d.name),
          reason: line(d.reason),
          params: isObj(d.params) ? d.params : {},
          operator: chatOperatorOf(d.operatorRef) ?? chatOperatorOf(d.operator),
          progress: chatProgressOf(d.progress),
          ...(notes ? { networkNotes: notes } : {}),
          ...(d.edit !== undefined ? { edit: d.edit } : {}),
          status: 'waiting',
        },
      }];
    }

    case 'agent.complete': {
      // A sub-run's end is a step of the turn, not the turn's answer.
      if (typeof d.parentCallId === 'string' && d.parentCallId) return ignore('subagent');
      const finalMessage = str(d.finalMessage);
      const failed = completedTurnIsError(d.status, finalMessage);
      const text = finalMessage.trim() ? finalMessage : failed ? CHAT_TURN_ERROR_TEXT : '';
      if (!text) return ignore('empty');
      const runId = str(d.runId);
      return [{
        type: 'reply',
        stored: false,
        message: {
          id: `final:${runId || f.timestamp || 'turn'}`,
          kind: 'reply',
          role: 'assistant',
          text,
          operator: chatOperatorOf(d.operatorRef),
          createdAt: f.timestamp || null,
          metadata: {},
          answeredHere: true,
          provisional: true,
          ...(failed ? { failed: true } : {}),
        },
      }];
    }

    case 'agent.error': {
      const text = errorSentence(d.message) || CHAT_TURN_ERROR_TEXT;
      return [{
        type: 'failed',
        text,
        ...(typeof d.code === 'string' && d.code ? { code: d.code } : {}),
        ...(callId ? { callId } : {}),
      }];
    }

    case 'agent.message':
    case 'agent.plan':
    case 'agent.checklist_update':
    case 'agent.code':
    case 'agent.deferred_run_complete':
      return ignore('interim');

    case 'agent.token_usage':
    case 'token_usage':
      return ignore('usage');

    // ── The end of a turn ──
    case 'pipeline_complete': {
      const reply = storedReplyOf(d.reply, `reply:${str(d.runId) || f.timestamp || 'turn'}`);
      const cleared: ChatEvent = { type: 'busy.cleared', ...(d.chatWindow !== undefined ? { chatWindow: d.chatWindow } : {}) };
      return reply ? [{ type: 'reply', stored: true, message: reply }, cleared] : [cleared];
    }

    case 'error': {
      const reply = storedReplyOf(d.reply, `failed:${f.timestamp || 'turn'}`);
      if (reply) return [{ type: 'reply', stored: true, message: { ...reply, failed: true } }, { type: 'busy.cleared' }];
      // The runtime's own message is for the logs, not for the owner.
      const detail = line(d.error) || line(d.message);
      return [{ type: 'failed', text: CHAT_TURN_ERROR_TEXT, ...(detail ? { detail } : {}) }, { type: 'busy.cleared' }];
    }

    case 'conversation.title': {
      const conversationId = str(d.conversationId);
      const title = line(d.title);
      if (!conversationId || !title) return ignore('malformed');
      return [{ type: 'subject', conversationId, title, subject: chatSubjectOf(title) }];
    }

    // ── The older pipeline, still possible ──
    case 'ai_response': {
      const metadata = isObj(d.metadata) ? d.metadata : {};
      if (isWelcome(metadata)) return ignore('welcome');
      const message = fromStoredMessage({ id: d.messageId, role: 'assistant', content: d.content, metadata, images: d.images }, `ai:${f.timestamp || 'turn'}`);
      if (!message) return ignore('empty');
      return [{ type: 'reply', stored: true, message: { ...message, answeredHere: true } }, { type: 'busy.cleared' }];
    }

    case 'thinking_start':
    case 'pipeline_plan':
      return [{ type: 'turn.started' }];

    case 'pipeline_update': {
      const stepId = str(d.stepId);
      // The stream's own hello on connect, not a step.
      if (!stepId || stepId === 'connection') return ignore('connection');
      const display = isObj(d.display) ? d.display : {};
      if (display.hidden === true) return ignore('interim');
      const summary = line(display.label) || line(d.description);
      switch (d.status) {
        case 'pending':
        case 'executing':
          return [{ type: 'step.started', step: { callId: stepId, name: '', summary, status: 'running', operator: null, progress: null } }];
        case 'completed':
          return [{ type: 'step.finished', callId: stepId, status: 'completed', ...(summary ? { summary } : {}) }];
        case 'failed': {
          const error = errorSentence(d.error);
          return [{ type: 'step.finished', callId: stepId, status: 'error', ...(summary ? { summary } : {}), ...(error ? { error } : {}) }];
        }
        case 'requires_approval': {
          const approval = isObj(d.approval) ? d.approval : {};
          return [{
            type: 'approval.required',
            approval: {
              stepId,
              name: '',
              reason: line(approval.message) || line(approval.reason) || summary,
              params: isObj(approval.parameters) ? approval.parameters : {},
              operator: null,
              progress: null,
              status: 'waiting',
              legacy: true,
            },
          }];
        }
        default:
          return ignore('interim');
      }
    }

    case 'user_approval_request': {
      const stepId = str(d.stepId);
      if (!stepId) return ignore('malformed');
      return [{
        type: 'approval.required',
        approval: {
          stepId,
          name: '',
          reason: line(d.reason) || line(d.description),
          params: isObj(d.parameters) ? d.parameters : {},
          operator: null,
          progress: null,
          status: 'waiting',
          legacy: true,
        },
      }];
    }

    case 'typing_indicator':
      return ignore('interim');

    case 'navigation':
      return ignore('navigation');

    default:
      return ignore('unknown');
  }
}
