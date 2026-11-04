/**
 * What Your team reads and writes, for one business, on the app's transport
 * (2026-10-16). Every read names the business: the account's screen passes
 * the one the app chose, a site's screen its own instance, so the plugin's
 * proxy (which refuses another business anyway) is never asked for one.
 *
 *   faces     GET  /instances/:id/team
 *   plan      GET  /operators/plan?instanceId=
 *   tasks     GET  /scheduled-tasks?instanceId=&limit=100
 *   runs      GET  /deferred-runs?instanceId=&limit=50
 *   progress  GET  /operators/progress?instanceId=&limit=12
 *   channels  GET  /operators/connect?instanceId=
 *   a yes     GET  /operators/approvals?status=PENDING&limit=1&instanceId= (the count only)
 *
 *   pause and resume  PATCH  /scheduled-tasks/:taskId { status }
 *   run now           POST   /scheduled-tasks/:taskId/run
 *   delete            DELETE /scheduled-tasks/:taskId
 *   stop a run        POST   /deferred-runs/:id/cancel
 *   a new task        POST   /scheduled-tasks/parse, then POST /scheduled-tasks
 */
import type { ScreensScope, ScreensTransport } from '../host/types';
import {
  TASKS_COPY, readParsedTask, readPlan, readRuns, readTasks,
  type BackgroundRun, type NewTaskType, type ParsedTask, type TaskRow, type TeamPlan,
} from './tasks';
import { readProgress, type ProgressSnapshot } from './progress';
import type { ConnectCenter } from './connectRules';

/** The business a screen reads: the site's own in its scope, else the one the app chose. */
export function teamBusiness(scope: ScreensScope, chosen: string | null | undefined): string | null {
  return scope.kind === 'site' ? scope.instanceId : (chosen || null);
}

const enc = encodeURIComponent;

// ── The faces ────────────────────────────────────────────────────────────

export type TeamFacePresence = 'working' | 'waiting' | 'still';

export interface TeamFaceMember {
  id: string;
  title: string;
  presence: TeamFacePresence;
  /** The run's own sentence while working (null for a site: the API keeps it). */
  line: string | null;
}

const ID = /^[a-z][a-z_]{1,40}$/;
const PRESENCES: readonly TeamFacePresence[] = ['working', 'waiting', 'still'];
const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null;

/** The members out of GET /instances/:id/team, cleaned: the Co-CEO first, as the API gives them. */
export function readTeamMembers(raw: unknown): TeamFaceMember[] {
  const members = raw && typeof raw === 'object' && Array.isArray((raw as { members?: unknown }).members)
    ? (raw as { members: unknown[] }).members
    : [];
  return members.flatMap((m): TeamFaceMember[] => {
    if (!m || typeof m !== 'object') return [];
    const o = m as Record<string, unknown>;
    const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : null;
    const title = text(o.title, 60);
    if (!id || !title) return [];
    const presence = PRESENCES.includes(o.presence as TeamFacePresence) ? (o.presence as TeamFacePresence) : 'still';
    return [{ id, title, presence, line: presence === 'still' ? null : text(o.line, 140) }];
  }).slice(0, 13);
}

export async function readTeamFaces(transport: ScreensTransport, instanceId: string): Promise<TeamFaceMember[]> {
  return readTeamMembers(await transport.get<unknown>(`/instances/${enc(instanceId)}/team`));
}

// ── The plan, the tasks, the runs ────────────────────────────────────────

export async function readTeamPlan(transport: ScreensTransport, instanceId: string): Promise<TeamPlan | null> {
  return readPlan(await transport.get<unknown>('/operators/plan', { instanceId }));
}

export async function readTeamTasks(transport: ScreensTransport, instanceId: string): Promise<TaskRow[]> {
  // The API's most: the plan's own tasks and the owner's share the list.
  const tasks = readTasks(await transport.get<unknown>('/scheduled-tasks', { instanceId, limit: 100 }));
  if (!tasks) throw new Error(TASKS_COPY.loadFailed);
  return tasks;
}

export async function readTeamRuns(transport: ScreensTransport, instanceId: string): Promise<BackgroundRun[]> {
  const runs = readRuns(await transport.get<unknown>('/deferred-runs', { instanceId, limit: 50 }), instanceId);
  if (!runs) throw new Error(TASKS_COPY.runsFailed);
  return runs;
}

export function setTaskStatus(transport: ScreensTransport, taskId: string, status: 'ACTIVE' | 'PAUSED'): Promise<unknown> {
  return transport.patch(`/scheduled-tasks/${enc(taskId)}`, { status });
}

export function runTaskNow(transport: ScreensTransport, taskId: string): Promise<unknown> {
  return transport.post(`/scheduled-tasks/${enc(taskId)}/run`, {});
}

export function deleteTask(transport: ScreensTransport, taskId: string): Promise<unknown> {
  return transport.del(`/scheduled-tasks/${enc(taskId)}`);
}

export function cancelRun(transport: ScreensTransport, runId: string): Promise<unknown> {
  return transport.post(`/deferred-runs/${enc(runId)}/cancel`, { reason: 'cancelled by user' });
}

/**
 * The owner's sentence, read by the API (AI work, on the account's pool):
 * null when it found no schedule in it. A type the owner picked is sent so
 * the API does not read it otherwise.
 */
export async function parseNewTask(
  transport: ScreensTransport,
  instanceId: string,
  message: string,
  type: NewTaskType,
  timezone: string,
): Promise<ParsedTask | null> {
  return readParsedTask(await transport.post<unknown>('/scheduled-tasks/parse', {
    message,
    timezone,
    instanceId,
    ...(type === 'auto' ? {} : { forceType: type }),
  }));
}

/**
 * The task the owner confirmed, for this business (a parse never moves it
 * to another). In a site's scope its notices go to the site's bell, so no
 * channel is sent; the account's keeps the ones the sentence named.
 */
export function createTask(transport: ScreensTransport, scope: ScreensScope, instanceId: string, parsed: ParsedTask): Promise<unknown> {
  return transport.post('/scheduled-tasks', {
    prompt: parsed.prompt,
    schedule: parsed.schedule,
    type: parsed.type,
    timezone: parsed.timezone,
    instanceId,
    ...(scope.kind === 'account' && parsed.notifyChannels?.length ? { notifyChannels: parsed.notifyChannels } : {}),
  });
}

// ── Progress, channels, the waiting count ────────────────────────────────

export async function readTeamProgress(transport: ScreensTransport, instanceId: string, limit = 12): Promise<ProgressSnapshot[]> {
  return readProgress(await transport.get<unknown>('/operators/progress', { instanceId, limit }));
}

export async function readConnectCenter(transport: ScreensTransport, instanceId: string): Promise<ConnectCenter> {
  const data = await transport.get<ConnectCenter | null>('/operators/connect', { instanceId });
  if (!data || !Array.isArray(data.networks)) throw new Error('Could not load the Connect Center.');
  return { ...data, networks: data.networks.filter((n) => n && typeof n.id === 'string') };
}

/** How many approvals wait for a yes on this business (the API's count, past the list's limit). */
export async function readWaitingYes(transport: ScreensTransport, instanceId: string): Promise<number> {
  const data = await transport.get<{ items?: unknown; pendingCount?: unknown } | null>(
    '/operators/approvals',
    { status: 'PENDING', limit: 1, instanceId },
  );
  if (typeof data?.pendingCount === 'number' && Number.isFinite(data.pendingCount)) return Math.max(0, Math.floor(data.pendingCount));
  return Array.isArray(data?.items) ? data!.items.length : 0;
}
