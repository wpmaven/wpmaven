/**
 * Your team > Plan, one tab for both apps (2026-10-16): the dashboard's Plan
 * tab (the team's plan, read with each task's schedule) together with the
 * plugin's Tasks page (its three parts and its New task).
 *
 *   wide    "Your team's plan" on the left: the plan's tasks, then the
 *           team's own schedules no plan task stands on; on the right,
 *           narrow, "Working on it now" then "What you asked for". The
 *           right column sticks under the app's header and scrolls on its
 *           own (--screens-sticky-top says where the header ends).
 *   narrow  one column: "Working on it now", the plan, "What you asked for".
 *
 * Each right part is hidden when it is empty; with both empty the plan takes
 * the whole width. Every card is drawn as an approval is (TeamCard), the
 * team member doing the work signing what they say in a bubble (the
 * sentences come from tasks.ts, built from the data, never from a model).
 *
 * The buttons keep each app's rules: for the account, the person's role
 * (viewer.writesTasks, viewer.deletesTasks); for a site, the whole plan is
 * read but only a task made in WordPress changes there (siteTouchedAt), the
 * others are read only. A failed press is said on its card.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge, Button, ChatBubble, EmptyState, Modal, NavIcon, OperatorAvatar, OPERATOR_AVATAR_SIZES, Skeleton,
} from '@yotako/webmaven-ui';
import { OperatorInline, errorMessage } from '@yotako/wpmaven-onboarding/shared';
import type { ScreensHost } from '../host/types';
import { HostLink } from '../host/HostLink';
import {
  CO_CEO_ID, NEW_TASK_COPY, RUN_BADGES, TASKS_COPY, TASK_SPEECH, askedByOwner, createdFromWordPress, planScheduledIds,
  runIsLive, runLines, runPresence, scheduleText, siteReadOnlyNote, splitWork, subjectBadge, subjectOfPlanTask, subjectOfTask,
  subjectPresence, taskChangeable, taskLines,
  type BackgroundRun, type PlanTask, type SpeechOptions, type TaskOperator, type TaskRow, type TeamPlan, type WorkBadge,
} from './tasks';
import { memberMeta, type TeamCatalog } from './catalog';
import { SpeakingCard, TeamCardActions, type TeamCardMember } from './TeamCard';
import { NewTaskCard } from './NewTask';
import {
  cancelRun, deleteTask, readTeamPlan, readTeamRuns, readTeamTasks, runTaskNow, setTaskStatus,
} from './reads';
import { useWidth } from './useWidth';

/** Who speaks on a card: the task's own team member, else the Co-CEO (a task a person made names nobody). */
export function speakerOf(operator: TaskOperator | null, catalog: TeamCatalog | null | undefined): TeamCardMember {
  const id = operator?.id ?? CO_CEO_ID;
  const meta = memberMeta(catalog, id);
  // The API's title when it sends one, in the catalog's colour.
  return { id, title: operator?.title ?? meta.title, color: meta.color };
}

export interface TaskActions {
  onPause: (t: TaskRow) => void;
  onResume: (t: TaskRow) => void;
  onRun: (t: TaskRow) => void;
  onDelete: (t: TaskRow) => void;
}

/** What the person may do here, and what is being sent. */
export interface PlanRights {
  canWrite: boolean;
  canDelete: boolean;
  busyId: string | null;
  /** May this screen change this task (a site: only one made in WordPress)? Absent: yes. */
  changeable?: (t: TaskRow) => boolean;
  /** What the last press on a card left to say, by the card's task or run id. */
  errors?: Readonly<Record<string, string>>;
}

/** The task's buttons, with their gating: readers none, editors no Delete, a site's read-only task none. */
export const TaskButtons: React.FC<{ task: TaskRow; canWrite: boolean; canDelete: boolean; busy: boolean; actions: TaskActions }> = ({
  task: t, canWrite, canDelete, busy, actions,
}) => {
  if (!canWrite && !canDelete) return null;
  return (
    <TeamCardActions>
      {canWrite && !t.isRunning && (t.status === 'ACTIVE' || t.status === 'PAUSED') && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => actions.onRun(t)}>Run now</Button>
      )}
      {canWrite && t.status === 'ACTIVE' && <Button size="sm" variant="outline" disabled={busy} onClick={() => actions.onPause(t)}>Pause</Button>}
      {canWrite && t.status === 'PAUSED' && <Button size="sm" variant="outline" disabled={busy} onClick={() => actions.onResume(t)}>Resume</Button>}
      {canDelete && <Button size="sm" variant="danger" disabled={busy} onClick={() => actions.onDelete(t)}>Delete</Button>}
    </TeamCardActions>
  );
};

/** The schedule beside the badge, unless the badge already says it ("Not scheduled"). */
function besideBadge(when: string, badge: WorkBadge): string | null {
  return when === badge.label ? null : when;
}

/** The buttons a task gets here: none at all on one this screen may not change. */
function buttonsFor(t: TaskRow, rights: PlanRights, actions: TaskActions) {
  if (rights.changeable && !rights.changeable(t)) return null;
  return <TaskButtons task={t} canWrite={rights.canWrite} canDelete={rights.canDelete} busy={rights.busyId === t.id} actions={actions} />;
}

const smallLine: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--text-dim)', overflowWrap: 'anywhere' };

/** A scheduled task: the owner's own, the team's own, or one running now. */
export const TaskCard: React.FC<PlanRights & {
  task: TaskRow;
  catalog?: TeamCatalog | null;
  actions: TaskActions;
  speech?: SpeechOptions;
  testId?: string;
}> = ({ task: t, catalog, actions, speech, testId = 'task-card', ...rights }) => {
  const subject = subjectOfTask(t);
  const fromWordPress = createdFromWordPress(t);
  const status = subjectBadge(subject);
  const asked = askedByOwner(t);
  return (
    <SpeakingCard
      testId={testId}
      member={speakerOf(t.operator, catalog)}
      presence={subjectPresence(subject)}
      status={status}
      lines={taskLines(subject, speech)}
      when={besideBadge(scheduleText(t), status)}
      // The team's own setup says what it is about above the bubble.
      title={asked ? undefined : <OperatorInline text={t.prompt} />}
      footer={(asked || fromWordPress) && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {asked && <p style={smallLine}>{TASK_SPEECH.asked(t.prompt)}</p>}
          {fromWordPress && (
            <p style={smallLine} data-testid="task-from-wordpress">
              <Badge color="peach">{TASKS_COPY.fromWordPress}</Badge> {TASKS_COPY.fromWordPressNote}
            </p>
          )}
        </div>
      )}
      error={rights.errors?.[t.id] ?? null}
      actions={buttonsFor(t, rights, actions)}
    />
  );
};

/** A background run, with Stop while it is queued or running. */
export const RunCard: React.FC<{
  run: BackgroundRun;
  catalog?: TeamCatalog | null;
  canWrite: boolean;
  busyId: string | null;
  error?: string | null;
  onCancel: (r: BackgroundRun) => void;
}> = ({ run: r, catalog, canWrite, busyId, error, onCancel }) => (
  <SpeakingCard
    testId="run-card"
    member={speakerOf(r.operator, catalog)}
    presence={runPresence(r)}
    status={RUN_BADGES[r.status]}
    lines={runLines(r)}
    error={error}
    actions={canWrite && runIsLive(r) && (
      <TeamCardActions>
        <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => onCancel(r)}>Stop</Button>
      </TeamCardActions>
    )}
  />
);

/** A task of the team's plan, read with its schedule from the task list when the list has it. */
export const PlanTaskCard: React.FC<PlanRights & {
  task: PlanTask;
  row: TaskRow | undefined;
  catalog?: TeamCatalog | null;
  actions: TaskActions;
  speech?: SpeechOptions;
  /** Under a task that waits for the owner's yes: where that yes is given. */
  waitingLink?: React.ReactNode;
}> = ({ task: t, row, catalog, actions, speech, waitingLink, ...rights }) => {
  const subject = subjectOfPlanTask(t, row);
  const st = t.scheduledTask;
  const status = subjectBadge(subject);
  return (
    <SpeakingCard
      testId="plan-task"
      member={memberMeta(catalog, t.operatorId)}
      presence={subjectPresence(subject)}
      status={status}
      lines={taskLines(subject, speech)}
      when={besideBadge(row ? scheduleText(row) : st ? scheduleText(st) : TASKS_COPY.notScheduled, status)}
      title={<OperatorInline text={t.title} />}
      note={t.channel || null}
      footer={subject.awaitingApproval && waitingLink ? <div style={{ marginTop: 8, fontSize: 13 }} data-testid="plan-task-waiting">{waitingLink}</div> : null}
      error={row ? rights.errors?.[row.id] ?? null : null}
      actions={row ? buttonsFor(row, rights, actions) : null}
    />
  );
};

// ── The parts ────────────────────────────────────────────────────────────

const Part: React.FC<{ id: string; title: string; children: React.ReactNode; testId: string }> = ({ id, title, children, testId }) => (
  <section aria-labelledby={id} data-testid={testId} style={{ minWidth: 0 }}>
    <h2 id={id} style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>{title}</h2>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
  </section>
);

/** The Co-CEO's hint, in the plan's empty state: where to ask for work. */
export const CoCeoHint: React.FC<{ title: string; lines: ReadonlyArray<string> }> = ({ title, lines }) => (
  <div style={{ margin: '0 auto', maxWidth: 448, textAlign: 'left' }} data-testid="plan-coceo-hint">
    <ChatBubble
      variant="assistant"
      author={{
        avatar: <OperatorAvatar id={CO_CEO_ID} title={title} presence="still" size={OPERATOR_AVATAR_SIZES.bubble} />,
        name: `Your ${title}`,
      }}
    >
      {lines.map((line, i) => <p key={i} style={{ margin: i > 0 ? '4px 0 0' : 0 }}>{line}</p>)}
    </ChatBubble>
  </div>
);

/** From this width the plan and the narrow column sit side by side. */
export const PLAN_TWO_COLUMNS_PX = 760;
/** The narrow column's width. */
const SIDE_PX = 320;

/**
 * The layout alone. Wide, the plan is the left column and the two parts
 * share the narrow right one, which sticks and scrolls by itself. Narrow,
 * the right column has no box (display: contents), so its parts take their
 * own places around the plan: now first, asked last. The plan keeps its
 * place in the tree either way.
 */
export const PlanBoard: React.FC<{ plan: React.ReactNode; now?: React.ReactNode; asked?: React.ReactNode; width?: number }> = ({ plan, now, asked, width }) => {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const two = !!now || !!asked;
  const wide = two && (width ?? measured) >= PLAN_TWO_COLUMNS_PX;
  return (
    <div
      ref={ref}
      data-testid="plan-board"
      data-columns={two ? '2' : '1'}
      data-wide={wide ? 'true' : 'false'}
      style={{ display: 'flex', flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'flex-start' : 'stretch', gap: 24, minWidth: 0 }}
    >
      <div data-testid="plan-main" style={{ order: wide ? 1 : 2, flex: wide ? 1 : undefined, minWidth: 0 }}>{plan}</div>
      {two && (
        <div
          data-testid="plan-side"
          style={wide ? {
            order: 2, width: SIDE_PX, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 24,
            position: 'sticky', top: 'var(--screens-sticky-top, 16px)',
            maxHeight: 'calc(100vh - var(--screens-sticky-top, 16px) - 16px)', overflowY: 'auto', padding: 2, boxSizing: 'border-box',
          } : { display: 'contents' }}
        >
          {now && <div data-plan-part="now" style={{ order: wide ? 0 : 1, minWidth: 0 }}>{now}</div>}
          {asked && <div data-plan-part="asked" style={{ order: wide ? 0 : 3, minWidth: 0 }}>{asked}</div>}
        </div>
      )}
    </div>
  );
};

function planDate(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

export interface PlanViewProps extends PlanRights {
  /** The plan: undefined while it loads, null when the business has none. */
  plan: TeamPlan | null | undefined;
  tasks: ReadonlyArray<TaskRow> | null;
  runs: ReadonlyArray<BackgroundRun> | null;
  tasksError?: string | null;
  runsError?: string | null;
  catalog?: TeamCatalog | null;
  actions: TaskActions;
  onCancelRun: (r: BackgroundRun) => void;
  /** A site's scope: its empty plan says so in its own words. */
  site?: boolean;
  /** The Co-CEO's chat runs here (where to ask for work, in the empty plan). */
  chat?: boolean;
  now?: number;
  speech?: SpeechOptions;
  /** For the tests: the board's width, instead of measuring it. */
  width?: number;
  /** Under a plan task that waits for the owner's yes: where that yes is given. */
  waitingLink?: React.ReactNode;
}

/** What the tab shows, from what it loaded: pure, so the tests render it. */
export const PlanView: React.FC<PlanViewProps> = ({
  plan, tasks, runs, tasksError, runsError, catalog, actions, onCancelRun, site = false, chat = true, now, speech, width,
  waitingLink, ...rights
}) => {
  // Until the plan is read, no schedule is called the owner's or the team's
  // own: a plan task's would show there for a moment, then jump.
  const work = splitWork(tasks ?? [], runs ?? [], planScheduledIds(plan?.tasks), now);
  if (plan === undefined) { work.asked = []; work.team = []; }
  const rows = new Map((tasks ?? []).map((t) => [t.id, t]));
  const coCeo = memberMeta(catalog, CO_CEO_ID).title;
  const cardRights: PlanRights = rights;

  const planPart = (
    <Part id="plan-team" title={TASKS_COPY.planTitle} testId="plan-team">
      {plan === undefined && <Skeleton height={160} rounded="lg" />}
      {plan === null && work.team.length === 0 && (
        <EmptyState
          icon={<NavIcon name="sparkles" size={40} />}
          title={TASKS_COPY.noPlanTitle}
          description={site ? TASKS_COPY.planEmpty : TASKS_COPY.noPlan}
          action={<CoCeoHint title={coCeo} lines={[chat ? TASKS_COPY.coCeoHint : TASKS_COPY.coCeoHintNoChat]} />}
        />
      )}
      {plan && (
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-dim)' }} data-testid="plan-meta">
          Activated {planDate(plan.activatedAt)}
          {plan.lastReplannedAt ? ` · last reviewed ${planDate(plan.lastReplannedAt)}` : ''}
          {` · version ${plan.version}`}
        </p>
      )}
      {plan?.tasks.map((t) => (
        <PlanTaskCard
          key={t.id}
          task={t}
          row={rows.get(t.scheduledTaskId ?? t.scheduledTask?.id ?? '')}
          catalog={catalog}
          actions={actions}
          speech={speech}
          waitingLink={waitingLink}
          {...cardRights}
        />
      ))}
      {work.team.map((t) => <TaskCard key={t.id} task={t} catalog={catalog} actions={actions} speech={speech} {...cardRights} />)}
    </Part>
  );

  const hasNow = work.runs.length > 0 || work.running.length > 0 || !!runsError;
  const nowPart = hasNow && (
    <Part id="plan-now" title={TASKS_COPY.nowTitle} testId="plan-now">
      {runsError && <p role="alert" style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{runsError}</p>}
      {work.runs.filter(runIsLive).map((r) => (
        <RunCard key={r.id} run={r} catalog={catalog} canWrite={rights.canWrite} busyId={rights.busyId} error={rights.errors?.[r.id]} onCancel={onCancelRun} />
      ))}
      {work.running.map((t) => <TaskCard key={t.id} task={t} catalog={catalog} actions={actions} speech={speech} {...cardRights} />)}
      {work.runs.filter((r) => !runIsLive(r)).map((r) => (
        <RunCard key={r.id} run={r} catalog={catalog} canWrite={rights.canWrite} busyId={rights.busyId} error={rights.errors?.[r.id]} onCancel={onCancelRun} />
      ))}
    </Part>
  );
  const hasAsked = work.asked.length > 0 || !!tasksError;
  const askedPart = hasAsked && (
    <Part id="plan-asked" title={TASKS_COPY.askedTitle} testId="plan-asked">
      {tasksError && <p role="alert" style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{tasksError}</p>}
      {work.asked.map((t) => <TaskCard key={t.id} task={t} catalog={catalog} actions={actions} speech={speech} {...cardRights} />)}
    </Part>
  );

  return <PlanBoard plan={planPart} now={nowPart || null} asked={askedPart || null} width={width} />;
};

/** How often the tab reads the work again: often while something runs, else now and then. */
export const LIVE_POLL_MS = 15_000;
export const IDLE_POLL_MS = 60_000;

/** The person's rights on tasks: the account's role (the host says), a site's tier (all of them may write). */
export function planRights(host: ScreensHost): { canWrite: boolean; canDelete: boolean } {
  if (host.scope.kind === 'site') return { canWrite: true, canDelete: true };
  return { canWrite: host.viewer?.writesTasks !== false, canDelete: host.viewer?.deletesTasks !== false };
}

export interface PlanTabProps {
  host: ScreensHost;
  /** The business: the site's own, or the one the app chose. */
  instanceId: string;
  catalog?: TeamCatalog | null;
  /** The Co-CEO's chat runs here (the empty plan's hint says where to ask). */
  chat?: boolean;
  /** Under a plan task that waits for the owner's yes: where that yes is given. */
  waitingLink?: React.ReactNode;
}

/** Your team > Plan, reading and acting on the app's transport. */
export const PlanTab: React.FC<PlanTabProps> = ({ host, instanceId, catalog, chat = true, waitingLink }) => {
  const { transport, scope } = host;
  const site = scope.kind === 'site';
  const errorText = host.errorText ?? errorMessage;
  const { canWrite, canDelete } = planRights(host);
  const [plan, setPlan] = useState<TeamPlan | null | undefined>(undefined);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [runs, setRuns] = useState<BackgroundRun[] | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<TaskRow | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  // The business on screen: an answer for the one before a switch is dropped.
  const shown = useRef(instanceId);
  shown.current = instanceId;

  const loadPlan = useCallback(async (id: string) => {
    await readTeamPlan(transport, id)
      .then((p) => { if (shown.current === id) setPlan(p); })
      .catch(() => { if (shown.current === id) setPlan(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  const loadWork = useCallback(async (id: string) => {
    await Promise.all([
      readTeamTasks(transport, id)
        .then((t) => { if (shown.current === id) { setTasks(t); setTasksError(null); } })
        .catch((err) => { if (shown.current === id) setTasksError(errorText(err, TASKS_COPY.loadFailed)); }),
      readTeamRuns(transport, id)
        .then((r) => { if (shown.current === id) { setRuns(r); setRunsError(null); } })
        .catch((err) => { if (shown.current === id) setRunsError(errorText(err, TASKS_COPY.runsFailed)); }),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  useEffect(() => {
    setPlan(undefined);
    setTasks(null);
    setRuns(null);
    setTasksError(null);
    setRunsError(null);
    setErrors({});
    setCreating(false);
    setCreated(false);
    void loadPlan(instanceId);
    void loadWork(instanceId);
  }, [instanceId, loadPlan, loadWork]);

  // Live: read again every few seconds while something runs.
  const live = useMemo(
    () => (runs ?? []).some(runIsLive) || (tasks ?? []).some((t) => t.isRunning),
    [runs, tasks],
  );
  useEffect(() => {
    const timer = setInterval(() => { void loadWork(instanceId); }, live ? LIVE_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [instanceId, live, loadWork]);

  /** One press on a card: its failure is said on that card. */
  const act = async (id: string, what: string, call: () => Promise<unknown>, fallback = TASKS_COPY.actionFailed): Promise<boolean> => {
    setBusyId(id);
    setErrors((e) => { const { [id]: _said, ...rest } = e; return rest; });
    try {
      await call();
      host.track?.('tasks', 'action', what);
      await Promise.all([loadWork(instanceId), loadPlan(instanceId)]);
      return true;
    } catch (err) {
      setErrors((e) => ({ ...e, [id]: errorText(err, fallback) }));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const actions: TaskActions = {
    onPause: (t) => void act(t.id, 'task_paused', () => setTaskStatus(transport, t.id, 'PAUSED')),
    onResume: (t) => void act(t.id, 'task_resumed', () => setTaskStatus(transport, t.id, 'ACTIVE')),
    onRun: (t) => void act(t.id, 'task_run_now', () => runTaskNow(transport, t.id)),
    onDelete: (t) => { setConfirmError(null); setConfirm(t); },
  };

  const removeConfirmed = async () => {
    const t = confirm;
    if (!t) return;
    setConfirmError(null);
    setBusyId(t.id);
    try {
      await deleteTask(transport, t.id);
      host.track?.('tasks', 'action', 'task_deleted');
      setConfirm(null);
      await Promise.all([loadWork(instanceId), loadPlan(instanceId)]);
    } catch (err) {
      setConfirmError(errorText(err, TASKS_COPY.deleteFailed));
    } finally {
      setBusyId(null);
    }
  };

  const changeable = (t: TaskRow) => taskChangeable(scope, t);
  const readOnlyNote = site
    ? siteReadOnlyNote()
    : !canWrite && (tasks?.length ?? 0) > 0 ? TASKS_COPY.readOnly : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="plan-tab">
      {(readOnlyNote || canWrite) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {readOnlyNote
            ? (
              <p style={{ margin: 0, flex: '1 1 260px', fontSize: 14, color: 'var(--text-dim)' }} data-testid="plan-read-only">
                {readOnlyNote}
                {site && (
                  <>
                    {' '}
                    <HostLink to={`/team?tab=plan&business=${encodeURIComponent(instanceId)}`} style={{ color: 'inherit', textDecoration: 'underline' }} testId="plan-open-dashboard">
                      Open your dashboard
                    </HostLink>
                  </>
                )}
              </p>
            )
            : <span />}
          {canWrite && (
            <Button
              size="sm"
              variant="primary"
              leftIcon={<NavIcon name="plus" size={16} />}
              onClick={() => { setCreated(false); setCreating(true); }}
              disabled={creating}
              data-testid="new-task-open"
            >
              {TASKS_COPY.newTask}
            </Button>
          )}
        </div>
      )}

      {creating && (
        <NewTaskCard
          host={host}
          instanceId={instanceId}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setCreated(true);
            void loadWork(instanceId);
            void loadPlan(instanceId);
          }}
        />
      )}
      {created && <p role="status" style={{ margin: 0, fontSize: 14, color: 'var(--text)' }} data-testid="new-task-created">{NEW_TASK_COPY.created}</p>}

      <PlanView
        plan={plan}
        tasks={tasks}
        runs={runs}
        tasksError={tasksError}
        runsError={runsError}
        catalog={catalog}
        actions={actions}
        onCancelRun={(r) => void act(r.id, 'run_cancelled', () => cancelRun(transport, r.id), 'This could not be stopped. Try again in a minute.')}
        site={site}
        chat={chat}
        waitingLink={waitingLink}
        canWrite={canWrite}
        canDelete={canDelete}
        busyId={busyId}
        changeable={changeable}
        errors={errors}
      />

      <Modal
        isOpen={!!confirm}
        onClose={() => { if (busyId === null) { setConfirm(null); setConfirmError(null); } }}
        title={TASKS_COPY.deleteTitle}
        description={TASKS_COPY.deleteNote}
        size="sm"
      >
        {confirm && (
          <p style={{ margin: 0, fontSize: 'var(--text-data, 13.5px)', color: 'var(--text-dim)', lineHeight: 1.5, overflowWrap: 'anywhere' }} data-testid="task-delete-prompt">
            {confirm.prompt}
          </p>
        )}
        {confirmError && (
          <p role="alert" style={{ margin: '12px 0 0', fontSize: 'var(--text-data, 13.5px)', color: 'var(--rose, var(--danger))', lineHeight: 1.5 }}>{confirmError}</p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          <Button
            size="sm"
            variant="dangerSolid"
            isLoading={busyId !== null}
            disabled={busyId !== null}
            onClick={() => void removeConfirmed()}
            data-testid="task-delete-confirm"
          >
            {TASKS_COPY.deleteConfirm}
          </Button>
          <Button size="sm" variant="primary" disabled={busyId !== null} onClick={() => { setConfirm(null); setConfirmError(null); }}>
            {TASKS_COPY.deleteKeep}
          </Button>
        </div>
      </Modal>
    </div>
  );
};
