/**
 * A business's scheduled tasks, its background runs and its team's plan, as
 * Your team reads and says them, one copy for the dashboard and the
 * WordPress plugin (2026-10-16). Both apps had their own: the dashboard's
 * Plan tab and the plugin's Tasks page, which said the same sentences from
 * two files.
 *
 *   GET    /scheduled-tasks?instanceId=          the business's tasks
 *   PATCH  /scheduled-tasks/:taskId              pause and resume ({ status })
 *   POST   /scheduled-tasks/:taskId/run          run it now
 *   DELETE /scheduled-tasks/:taskId              delete it
 *   GET    /deferred-runs?instanceId=            the business's background runs
 *   POST   /deferred-runs/:id/cancel             stop one
 *   GET    /operators/plan?instanceId=           the team's plan
 *
 * A task made or changed from WordPress (createdVia 'site', or siteTouchedAt
 * set) runs with the site's limits and says so. A site reads the business's
 * whole plan but changes only the tasks made in WordPress (the API's rule,
 * told apart by siteTouchedAt): the others are read only there.
 *
 * Every sentence below is built from the data, never written by a model.
 */
import cronstrue from 'cronstrue';
import type { BadgeColor, OperatorPresence } from '@yotako/webmaven-ui';
import { productName, toPlainLine } from '@yotako/wpmaven-onboarding/shared';
import type { ScreensScope } from '../host/types';

export type TaskStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

/** Who on the team does it, as the API names them ({ id, title }). */
export interface TaskOperator {
  id: string;
  title: string;
}

/** A task's last finished run, as GET /scheduled-tasks sends it (absent from an older API). */
export interface TaskLastRun {
  status: string;
  /** The run's own words, never its raw error. */
  resultSummary: string | null;
  completedAt: string | null;
}

export interface TaskRow {
  id: string;
  prompt: string;
  schedule: string;
  type: 'one_shot' | 'recurring';
  status: TaskStatus;
  nextRunAt: string | null;
  lastRunAt: string | null;
  runCount: number;
  isRunning: boolean;
  createdVia: string | null;
  siteTouchedAt: string | null;
  /** The team member it runs as. Null when a person made it: the Co-CEO speaks for it. */
  operator: TaskOperator | null;
  source: 'USER' | 'AGENT' | null;
  /** Failed runs in a row: three pause the task (the API's MAX_CONSECUTIVE_FAILURES). */
  consecutiveFailures: number;
  lastRun: TaskLastRun | null;
  timezone: string | null;
}

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BackgroundRun {
  id: string;
  instanceId: string | null;
  /** The run's short label, the words the owner reads. */
  description: string;
  status: RunStatus;
  createdAt: string;
  completedAt: string | null;
  operator: TaskOperator | null;
  /** The full instruction the run works from. */
  prompt: string | null;
  result: string | null;
  error: string | null;
  startedAt: string | null;
}

/** A plan task's scheduled task, as GET /operators/plan sends it. */
export interface PlanScheduledTask {
  id: string;
  schedule: string;
  type: 'one_shot' | 'recurring';
  status: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  /** The last few runs, newest first (read tolerantly: subjectOfPlanTask). */
  runs?: unknown;
}

/** A task of the team's plan. */
export interface PlanTask {
  id: string;
  operatorId: string;
  title: string;
  channel: string | null;
  sourceKind: string;
  cadence: string | null;
  status: string;
  lastRunAt: string | null;
  createdAt: string;
  /** The scheduled task this plan task stands on (unique): that task is part of the plan. */
  scheduledTaskId?: string | null;
  scheduledTask: PlanScheduledTask | null;
}

/** The business's active plan (GET /operators/plan): the parts Your team reads. */
export interface TeamPlan {
  id: string;
  version: number;
  status: string;
  activatedAt: string;
  lastReplannedAt: string | null;
  tasks: PlanTask[];
}

export const TASKS_COPY = {
  loadFailed: 'We could not read the tasks. Try again in a moment.',
  runsFailed: 'We could not read the background work. Try again in a moment.',
  actionFailed: 'That did not work. Try again in a moment.',
  fromWordPress: 'Created from WordPress',
  fromWordPressNote: 'It runs with the limits of a WordPress site: this business only, and posts or messages to customers wait for your yes.',
  notScheduled: 'Not scheduled',
  readOnly: 'Only the account owner, an admin or an editor can change tasks.',
  planTitle: "Your team's plan",
  nowTitle: 'Working on it now',
  askedTitle: 'What you asked for',
  newTask: 'New task',
  noPlanTitle: 'No active plan yet',
  noPlan: "Publish a business, and your AI team's plan starts by itself: the launch post, first-week marketing, and standing weekly moves.",
  /** A site's plan, while there is none. */
  planEmpty: 'Nothing is planned here yet.',
  /** The Co-CEO, in the plan's empty state. */
  coCeoHint: 'Ask me in the chat on Home, for example "publish a blog post every Monday at 9am".',
  /** The same hint where the chat does not run. */
  coCeoHintNoChat: 'Set one up with New task, for example "publish a blog post every Monday at 9am".',
  deleteTitle: 'Delete this task?',
  deleteNote: "This can't be undone. Past run history will also be removed.",
  deleteConfirm: 'Delete it',
  deleteKeep: 'Not now',
  deleteFailed: 'The task could not be deleted. Try again in a minute.',
};

/** In a site's scope: the plan is the business's whole one, and only what was made in WordPress changes there. */
export function siteReadOnlyNote(): string {
  return `You can change the tasks made in WordPress here. The rest of your team's plan is changed in your ${productName()} dashboard.`;
}

/**
 * What a team member says on a task's card, in the first person. Each line
 * is built from the task's own data, never written by a model.
 */
export const TASK_SPEECH = {
  onIt: "I'm on it now.",
  paused: 'I paused this. Resume it when you want me back on it.',
  stopped: (times: number) => (times >= 2 ? `I stopped after it failed ${times} times in a row.` : 'I stopped after it failed.'),
  lastError: (words: string) => `The last error: ${sentence(words)}`,
  waitingForYes: "I'm waiting for your yes on this.",
  done: 'I did this one. Nothing more is planned.',
  cancelled: 'This one is stopped.',
  notScheduled: 'Nothing is scheduled for this yet.',
  next: (when: string) => `Next one: ${when}.`,
  lastTime: (day: string, said: string) => `Last time (${day}): ${said}`,
  lastTimeDone: (day: string) => `Last time: ${day}.`,
  lastTimeFailed: (day: string) => `Last time (${day}) it did not work.`,
  asked: (prompt: string) => `You asked: "${prompt}"`,
  runQueued: (what: string) => `I'm about to start on: ${what}.`,
  runWorking: (what: string) => `I'm working on: ${what}.`,
  runDone: (what: string) => `I finished: ${what}.`,
  runFailed: (what: string) => `I could not finish: ${what}.`,
  runStopped: (what: string) => `I stopped: ${what}.`,
};

/**
 * A background run a site may not read the words of (the API answers a
 * site with fixed sentences, the run's words are the owner's): what the
 * member says instead, and where the result is.
 */
export const RUN_SPEECH_FOR_SITE = {
  queued: "I'm about to start on something in the background.",
  running: "I'm working on this in the background.",
  completed: () => `I finished this in the background. The result is in your ${productName()} dashboard.`,
  failed: () => `I could not finish this in the background. The details are in your ${productName()} dashboard.`,
  cancelled: 'I stopped this background work.',
};

/** The sentences the API answers a site with in place of a run's own words. */
const SITE_RUN_WORDS = new Set([
  'Background work is waiting to start.',
  'Your team is working on this in the background.',
  'Background work finished. Its result is in the dashboard.',
  'Background work did not finish. The details are in the dashboard.',
  'Background work was stopped.',
  'Background work.',
]);

const STATUSES = new Set<TaskStatus>(['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED']);
const RUN_STATUSES = new Set<RunStatus>(['queued', 'running', 'completed', 'failed', 'cancelled']);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const date = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

/** The API's { id, title }; null for anything else (an older API sends none). */
function readOperator(v: unknown): TaskOperator | null {
  return isObj(v) && str(v.id) && str(v.title) ? { id: v.id as string, title: v.title as string } : null;
}

function readLastRun(v: unknown): TaskLastRun | null {
  if (!isObj(v)) return null;
  return { status: str(v.status) ?? '', resultSummary: str(v.resultSummary), completedAt: date(v.completedAt) };
}

function readTask(raw: unknown): TaskRow | null {
  if (!isObj(raw) || !str(raw.id) || !str(raw.prompt)) return null;
  const failures = raw.consecutiveFailures;
  return {
    id: raw.id as string,
    prompt: raw.prompt as string,
    schedule: typeof raw.schedule === 'string' ? raw.schedule : '',
    type: raw.type === 'one_shot' ? 'one_shot' : 'recurring',
    status: STATUSES.has(raw.status as TaskStatus) ? raw.status as TaskStatus : 'PAUSED',
    nextRunAt: date(raw.nextRunAt),
    lastRunAt: date(raw.lastRunAt),
    runCount: typeof raw.runCount === 'number' ? raw.runCount : 0,
    isRunning: raw.isRunning === true,
    createdVia: str(raw.createdVia),
    siteTouchedAt: date(raw.siteTouchedAt),
    operator: readOperator(raw.operator),
    source: raw.source === 'USER' || raw.source === 'AGENT' ? raw.source : null,
    consecutiveFailures: typeof failures === 'number' && Number.isFinite(failures) && failures > 0 ? Math.floor(failures) : 0,
    lastRun: readLastRun(raw.lastRun),
    timezone: str(raw.timezone),
  };
}

/** The list out of GET /scheduled-tasks ({ items }, or its { data: { items } } envelope); null for anything else. */
export function readTasks(body: unknown): TaskRow[] | null {
  const d = isObj(body) && isObj(body.data) ? body.data : body;
  if (!isObj(d) || !Array.isArray(d.items)) return null;
  return d.items.map(readTask).filter((t): t is TaskRow => !!t);
}

/** The runs out of GET /deferred-runs ({ runs }, or its envelope), this business's only. */
export function readRuns(body: unknown, instanceId: string): BackgroundRun[] | null {
  const d = isObj(body) && isObj(body.data) ? body.data : body;
  if (!isObj(d) || !Array.isArray(d.runs)) return null;
  return d.runs
    .filter(isObj)
    .filter((r) => str(r.id) && RUN_STATUSES.has(r.status as RunStatus) && date(r.createdAt))
    // An API that does not filter by business yet sends every run of the account.
    .filter((r) => r.instanceId === instanceId)
    .map((r) => ({
      id: r.id as string,
      instanceId: str(r.instanceId),
      description: str(r.description) ?? 'Background work',
      status: r.status as RunStatus,
      createdAt: r.createdAt as string,
      completedAt: date(r.completedAt),
      operator: readOperator(r.operator),
      prompt: str(r.prompt),
      result: str(r.result),
      error: str(r.error),
      startedAt: date(r.startedAt),
    }));
}

/** The plan out of GET /operators/plan; null when the business has none. */
export function readPlan(body: unknown): TeamPlan | null {
  const d = isObj(body) && 'success' in body && 'data' in body ? body.data : body;
  if (!isObj(d) || !str(d.id)) return null;
  return { ...(d as unknown as TeamPlan), tasks: Array.isArray(d.tasks) ? (d.tasks as PlanTask[]).filter((t) => isObj(t) && str(t.id)) : [] };
}

/** Made or changed from a WordPress site. */
export function createdFromWordPress(t: Pick<TaskRow, 'createdVia' | 'siteTouchedAt'>): boolean {
  return t.createdVia === 'site' || !!t.siteTouchedAt;
}

/**
 * Whether this screen may change a task: always for the account (the
 * person's role decides, ScreensViewer); in a site's scope only a task made
 * in WordPress (the API reaches no other: siteTouchedAt), the others are the
 * owner's and read only there.
 */
export function taskChangeable(scope: ScreensScope, t: Pick<TaskRow, 'siteTouchedAt'>): boolean {
  return scope.kind !== 'site' || !!t.siteTouchedAt;
}

/**
 * "Every Monday at 9:00 AM", "Oct 9, 2026, 9:00 AM", or "Not scheduled": never
 * a cron line, never a dash. A schedule kept in UTC says so.
 */
export function scheduleText(t: Pick<TaskRow, 'schedule' | 'type'> & { timezone?: string | null }): string {
  if (!t.schedule) return TASKS_COPY.notScheduled;
  if (t.type === 'one_shot') {
    const d = new Date(t.schedule);
    return Number.isNaN(d.getTime()) ? TASKS_COPY.notScheduled : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }).replace(/ /g, ' ');
  }
  try {
    const words = cronstrue.toString(t.schedule, { use24HourTimeFormat: false })
      .replace(/^At (\d{1,2}):(\d{2})( ?[AP]M), only on (.+)$/i, (_m, h, m, ap, day) => `Every ${day} at ${parseInt(h, 10)}:${m}${ap}`)
      .replace(/^At (\d{1,2}):(\d{2})( ?[AP]M), on day (\d{1,2}) of the month$/i, (_m, h, m, ap, d) => `On day ${d} of each month at ${parseInt(h, 10)}:${m}${ap}`)
      .replace(/^At (\d{1,2}):(\d{2})( ?[AP]M)$/i, (_m, h, m, ap) => `Every day at ${parseInt(h, 10)}:${m}${ap}`)
      .replace(/, only on/gi, ' on');
    return t.timezone === 'UTC' ? `${words} UTC` : words;
  } catch {
    return TASKS_COPY.notScheduled;
  }
}

// ── What the team says ───────────────────────────────────────────────────

/** The API pauses a task after this many failed runs in a row (schedulerService). */
export const FAILURES_THAT_STOP = 3;

/** A finished background run stays under "Working on it now" this long, its result with it. */
export const FINISHED_RUN_SHOWN_MS = 24 * 60 * 60_000;

/** The Co-CEO speaks for a task no team member was named on (the API's own fallback). */
export const CO_CEO_ID = 'chief_of_staff';

/** What a card is about, whether a scheduled task or a plan task read with its schedule. */
export interface TaskSubject {
  running: boolean;
  /** The schedule's status; null when nothing is scheduled. */
  status: TaskStatus | null;
  consecutiveFailures: number;
  nextRunAt: string | null;
  lastRun: TaskLastRun | null;
  /** A plan task whose work waits for the owner's yes. */
  awaitingApproval?: boolean;
  /** A plan task the plan marks failed, while its schedule may still go on. */
  planFailed?: boolean;
  /** The last failed run's error, when the screen was sent one. */
  lastError?: string | null;
}

export interface SpeechOptions {
  /** For the tests: the dates in one zone, whatever the machine's. */
  timeZone?: string;
}

/** Ends with a full stop unless it already ends a sentence. */
function sentence(words: string): string {
  const w = words.trim();
  return /[.!?"')]$/.test(w) ? w : `${w}.`;
}

/** A label inside a sentence: no full stop of its own. */
function label(words: string): string {
  return words.trim().replace(/[\s.!?;:,]+$/, '');
}

const SAID_MAX = 240;

/** The run's own words on one line, cut at a word near SAID_MAX; null when there are none. */
export function inOneLine(text: string | null | undefined, max = SAID_MAX): string | null {
  if (!text) return null;
  const line = toPlainLine(text).replace(/\s+/g, ' ').trim();
  if (!line) return null;
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/**
 * An error as the owner can read it: a short sentence, else null. A stack,
 * a code, JSON or a library's message stays off the screen.
 */
export function plainError(error: string | null | undefined): string | null {
  const line = error?.trim().replace(/^(?:[A-Za-z]*Error|Error):\s*/, '').trim();
  if (!line || line.length > 200) return null;
  if (/[\n{}[\]<>`]/.test(line)) return null;
  if (/\bat \S+ \(|\bE[A-Z]{3,}\b|\b(?:undefined|null|NaN|stack|status code|prisma|axios|fetch failed)\b/i.test(line)) return null;
  return sentence(line);
}

function dayText(iso: string, o: SpeechOptions): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: o.timeZone });
}

/** "Monday Oct 13, 9:00 AM": when a task runs next. */
export function taskWhenText(iso: string, o: SpeechOptions = {}): string {
  const d = new Date(iso);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: o.timeZone });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: o.timeZone }).replace(/ /g, ' ');
  return `${weekday} ${dayText(iso, o)}, ${time}`;
}

export const subjectOfTask = (t: TaskRow): TaskSubject => ({
  running: t.isRunning,
  status: t.status,
  consecutiveFailures: t.consecutiveFailures,
  nextRunAt: t.nextRunAt,
  lastRun: t.lastRun,
});

/** Stopped by failures: failed for good, or paused by the API after three in a row. */
export function stoppedAfterFailures(s: Pick<TaskSubject, 'status' | 'consecutiveFailures'>): boolean {
  return s.status === 'FAILED' || (s.status === 'PAUSED' && s.consecutiveFailures >= FAILURES_THAT_STOP);
}

/** What the speaker wears on their face: working, still, failed, done, waiting, or up next. */
export function subjectPresence(s: TaskSubject): OperatorPresence {
  if (s.running) return 'working';
  if (s.awaitingApproval) return 'waiting';
  if (stoppedAfterFailures(s) || s.planFailed) return 'failed';
  if (s.status === 'COMPLETED') return 'done';
  if (s.status === 'ACTIVE' || s.status === null) return 'queued';
  return 'still';
}

/** A card's status badge: its words, and an approval's colour for the same kind of state. */
export interface WorkBadge {
  color: BadgeColor;
  label: string;
}

/**
 * The status a task's card wears beside its member, as an approval's does:
 * peach waits for the owner, blue is on its way, cyan is working or done,
 * rose did not work, mauve is stopped or not planned.
 */
export const TASK_BADGES = {
  working: { color: 'cyan', label: 'Working on it' },
  waiting: { color: 'peach', label: 'Waiting for you' },
  stopped: { color: 'rose', label: 'Stopped after failing' },
  failed: { color: 'rose', label: 'Failed' },
  done: { color: 'cyan', label: 'Done' },
  cancelled: { color: 'mauve', label: 'Stopped' },
  paused: { color: 'mauve', label: 'Paused' },
  scheduled: { color: 'blue', label: 'Scheduled' },
  notScheduled: { color: 'mauve', label: TASKS_COPY.notScheduled },
} as const satisfies Record<string, WorkBadge>;

/** The badge for what the card says, in the same order as subjectPresence and taskLines. */
export function subjectBadge(s: TaskSubject): WorkBadge {
  if (s.running) return TASK_BADGES.working;
  if (s.awaitingApproval) return TASK_BADGES.waiting;
  if (stoppedAfterFailures(s)) return TASK_BADGES.stopped;
  if (s.planFailed) return TASK_BADGES.failed;
  if (s.status === 'COMPLETED') return TASK_BADGES.done;
  if (s.status === 'CANCELLED') return TASK_BADGES.cancelled;
  if (s.status === 'PAUSED') return TASK_BADGES.paused;
  if (s.status === 'ACTIVE') return TASK_BADGES.scheduled;
  return TASK_BADGES.notScheduled;
}

/** A background run's badge. */
export const RUN_BADGES: Readonly<Record<RunStatus, WorkBadge>> = {
  queued: { color: 'mauve', label: 'Waiting to start' },
  running: TASK_BADGES.working,
  completed: TASK_BADGES.done,
  failed: { color: 'rose', label: 'Did not finish' },
  cancelled: TASK_BADGES.cancelled,
};

/** The card's sentences, in the order they are said. */
export function taskLines(s: TaskSubject, o: SpeechOptions = {}): string[] {
  const lines: string[] = [];
  const said = s.lastRun ? inOneLine(s.lastRun.resultSummary) : null;
  if (s.running) lines.push(TASK_SPEECH.onIt);
  else if (s.awaitingApproval) lines.push(TASK_SPEECH.waitingForYes);
  else if (stoppedAfterFailures(s)) {
    lines.push(TASK_SPEECH.stopped(s.consecutiveFailures));
    // The last error, unless the last run's own words already say it.
    const words = plainError(s.lastError);
    if (words && !(said && words.startsWith(said))) lines.push(TASK_SPEECH.lastError(words));
  } else if (s.status === 'PAUSED') lines.push(TASK_SPEECH.paused);
  else if (s.status === 'COMPLETED') lines.push(TASK_SPEECH.done);
  else if (s.status === 'CANCELLED') lines.push(TASK_SPEECH.cancelled);
  else if (s.status === null || !s.nextRunAt) lines.push(TASK_SPEECH.notScheduled);
  if (s.status === 'ACTIVE' && s.nextRunAt) lines.push(TASK_SPEECH.next(taskWhenText(s.nextRunAt, o)));
  if (s.lastRun?.completedAt) {
    const day = dayText(s.lastRun.completedAt, o);
    lines.push(said ? TASK_SPEECH.lastTime(day, said)
      : s.lastRun.status === 'failed' ? TASK_SPEECH.lastTimeFailed(day) : TASK_SPEECH.lastTimeDone(day));
  }
  return lines;
}

/** A person asked for it (in the chat, on the dashboard or from WordPress), not the team's own setup. */
export function askedByOwner(t: Pick<TaskRow, 'createdVia'>): boolean {
  return t.createdVia !== 'system';
}

export function runPresence(r: Pick<BackgroundRun, 'status'>): OperatorPresence {
  switch (r.status) {
    case 'queued': return 'queued';
    case 'running': return 'working';
    case 'completed': return 'done';
    case 'failed': return 'failed';
    default: return 'still';
  }
}

/** Queued or running. */
export function runIsLive(r: Pick<BackgroundRun, 'status'>): boolean {
  return r.status === 'queued' || r.status === 'running';
}

/** The API sent a site's fixed sentence, not the run's own words. */
export function runWordsHidden(r: Pick<BackgroundRun, 'description'>): boolean {
  return SITE_RUN_WORDS.has((r.description ?? '').trim()) || !str(r.description);
}

/** A background run's sentences: what it works on, then its result once done. */
export function runLines(r: Pick<BackgroundRun, 'status' | 'description' | 'result' | 'error'>): string[] {
  if (runWordsHidden(r)) {
    switch (r.status) {
      case 'queued': return [RUN_SPEECH_FOR_SITE.queued];
      case 'running': return [RUN_SPEECH_FOR_SITE.running];
      case 'completed': return [RUN_SPEECH_FOR_SITE.completed()];
      case 'failed': return [RUN_SPEECH_FOR_SITE.failed()];
      default: return [RUN_SPEECH_FOR_SITE.cancelled];
    }
  }
  const what = label(r.description);
  switch (r.status) {
    case 'queued': return [TASK_SPEECH.runQueued(what)];
    case 'running': return [TASK_SPEECH.runWorking(what)];
    case 'completed': {
      const said = inOneLine(r.result);
      return said ? [TASK_SPEECH.runDone(what), said] : [TASK_SPEECH.runDone(what)];
    }
    case 'failed': {
      const words = plainError(r.error);
      return words ? [TASK_SPEECH.runFailed(what), words] : [TASK_SPEECH.runFailed(what)];
    }
    default: return [TASK_SPEECH.runStopped(what)];
  }
}

/** Still going, or finished within FINISHED_RUN_SHOWN_MS. */
export function runIsCurrent(r: Pick<BackgroundRun, 'status' | 'completedAt' | 'createdAt'>, now = Date.now()): boolean {
  if (runIsLive(r)) return true;
  const at = Date.parse(r.completedAt ?? r.createdAt);
  return Number.isFinite(at) && now - at <= FINISHED_RUN_SHOWN_MS;
}

/** A plan task as the API sends it, read tolerantly (the parts this screen speaks from). */
export interface PlanTaskLike {
  status: string;
  scheduledTaskId?: string | null;
  scheduledTask?: {
    id: string;
    status?: string;
    nextRunAt?: string | null;
    runs?: unknown;
  } | null;
}

/** The scheduled tasks behind the team's plan: each plan task names its own. */
export function planScheduledIds(tasks: ReadonlyArray<PlanTaskLike> | null | undefined): Set<string> {
  const ids = new Set<string>();
  for (const t of tasks ?? []) {
    const id = t.scheduledTaskId ?? t.scheduledTask?.id ?? null;
    if (id) ids.add(id);
  }
  return ids;
}

/** The plan's own runs of a task (newest first), read tolerantly. */
function planRuns(t: PlanTaskLike): Array<{ status: string; resultSummary: string | null; error: string | null; completedAt: string | null }> {
  const runs = t.scheduledTask?.runs;
  if (!Array.isArray(runs)) return [];
  return runs.filter(isObj).map((r) => ({
    status: str(r.status) ?? '',
    resultSummary: str(r.resultSummary),
    error: str(r.error),
    completedAt: date(r.completedAt),
  }));
}

const PLAN_STATUS_AS_TASK: Record<string, TaskStatus> = { COMPLETED: 'COMPLETED', FAILED: 'FAILED', CANCELLED: 'CANCELLED' };

/**
 * A plan task, read with its scheduled task from GET /scheduled-tasks when
 * the list has it (running, failures in a row, the last run), else from the
 * plan's own copy of the schedule.
 */
export function subjectOfPlanTask(p: PlanTaskLike, row: TaskRow | undefined): TaskSubject {
  const st = p.scheduledTask ?? null;
  const runs = planRuns(p);
  const finished = runs.find((r) => r.completedAt);
  const failed = runs.find((r) => r.status === 'failed');
  const scheduled = st && STATUSES.has(st.status as TaskStatus) ? st.status as TaskStatus : null;
  return {
    running: row?.isRunning === true || p.status === 'RUNNING',
    status: row?.status ?? scheduled ?? PLAN_STATUS_AS_TASK[p.status] ?? null,
    consecutiveFailures: row?.consecutiveFailures ?? 0,
    nextRunAt: row?.nextRunAt ?? date(st?.nextRunAt) ?? null,
    lastRun: row?.lastRun ?? (finished ? { status: finished.status, resultSummary: finished.resultSummary, completedAt: finished.completedAt } : null),
    awaitingApproval: p.status === 'AWAITING_APPROVAL',
    planFailed: p.status === 'FAILED',
    lastError: failed?.error ?? null,
  };
}

/**
 * The Plan tab's parts, from what it read:
 *   runs     the background work going on, or finished today, live first;
 *   running  any task running now (said once, under "Working on it now");
 *   team     the team's own scheduled work that no plan task stands on (it
 *            is said with the plan, as the plugin's Tasks page said it);
 *   asked    the schedules a person asked for (in the chat, on the dashboard
 *            or from WordPress) that no plan task stands on.
 */
export function splitWork(
  tasks: ReadonlyArray<TaskRow>,
  runs: ReadonlyArray<BackgroundRun>,
  planIds: ReadonlySet<string>,
  now = Date.now(),
): { runs: BackgroundRun[]; running: TaskRow[]; team: TaskRow[]; asked: TaskRow[] } {
  const own = tasks.filter((t) => !t.isRunning && !planIds.has(t.id));
  return {
    runs: runs.filter((r) => runIsCurrent(r, now)).sort((a, b) => Number(runIsLive(b)) - Number(runIsLive(a))),
    running: tasks.filter((t) => t.isRunning),
    team: own.filter((t) => !askedByOwner(t)),
    asked: own.filter((t) => askedByOwner(t)),
  };
}

// ── A new task ───────────────────────────────────────────────────────────

/** What the owner chose on the New task card: let the team tell, or say it. */
export type NewTaskType = 'auto' | 'recurring' | 'one_shot';

/** What POST /scheduled-tasks/parse understood from the owner's sentence. */
export interface ParsedTask {
  prompt: string;
  type: 'one_shot' | 'recurring';
  schedule: string;
  timezone: string;
  /** Where its notices go, when the sentence said (the account's; a site's go to its bell). */
  notifyChannels?: string[] | null;
}

/** The parse's answer, read strictly; null when it found no schedule in the sentence. */
export function readParsedTask(body: unknown): ParsedTask | null {
  const d = isObj(body) && 'success' in body && 'data' in body ? body.data : body;
  if (!isObj(d) || !str(d.prompt) || !str(d.schedule)) return null;
  if (d.type !== 'one_shot' && d.type !== 'recurring') return null;
  const channels = Array.isArray(d.notifyChannels) ? d.notifyChannels.filter((c): c is string => typeof c === 'string') : null;
  return {
    prompt: d.prompt as string,
    type: d.type,
    schedule: d.schedule as string,
    timezone: str(d.timezone) ?? 'UTC',
    ...(channels && channels.length ? { notifyChannels: channels } : {}),
  };
}

export const NEW_TASK_COPY = {
  title: 'New task',
  close: 'Cancel',
  typeLabel: 'Task type',
  types: { auto: 'Auto-detect', recurring: 'Recurring', one_shot: 'One-time' } as Record<NewTaskType, string>,
  placeholders: {
    auto: 'Describe your task and when it should run, e.g. "publish a blog post every Monday at 9am"',
    recurring: 'What should run on a schedule? e.g. "publish a blog post every Monday at 9am"',
    one_shot: 'What should run once? e.g. "tomorrow at 3pm publish my draft"',
  } as Record<NewTaskType, string>,
  reading: 'Reading your task…',
  noSchedule: 'I didn\'t catch a scheduling intent. Try something like "publish a blog post every Monday at 9am".',
  parseFailed: 'Your task could not be read. Try again in a minute.',
  confirmLead: 'Here is what I understood:',
  what: 'The task',
  when: 'When',
  kind: { recurring: 'Again and again', one_shot: 'Once' } as Record<'recurring' | 'one_shot', string>,
  create: 'Create task',
  change: 'Change it',
  creating: 'Creating task…',
  createFailed: 'The task could not be created. Try again in a minute.',
  created: 'Task created. It is under "What you asked for".',
};
