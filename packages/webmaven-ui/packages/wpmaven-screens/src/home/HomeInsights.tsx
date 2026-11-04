/**
 * Report / Your team's plan / Goals, as a Home section (2026-10-16): the
 * plugin's rolling card (the kit's RollingTabs), right under Welcome back on
 * its Overview. The dashboard's Home does not draw it.
 *
 *   Report            the business's newest report (GET /reports/:id?limit=1),
 *                     its summary, View full report and, when the app can
 *                     download it, Download PDF;
 *   Your team's plan  what runs next (GET /scheduled-tasks/upcoming) and what
 *                     the team is working on now (the tasks running, the
 *                     background runs), with the way to Your team;
 *   Goals             the kit's GoalWidget on GET /analytics/:id/goals, and
 *                     a short form to add one for whoever may.
 *
 * Each face only where the app lets this person see it (`faces`). The card
 * waits for the report's read before it is drawn, so the Report face never
 * flickers in or out; with no face left there is no card.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge, Button, Dropdown, GlassCard, GoalWidget, Input, OperatorAvatar, OPERATOR_AVATAR_SIZES, RollingTabs,
  Skeleton, type RollingTabItem,
} from '@yotako/webmaven-ui';
import { FiChevronRight, FiClock, FiDownload, FiFileText, FiTarget, FiZap } from 'react-icons/fi';
import type { ScreensHost } from '../host/types';
import { ScreensHostProvider, useScreensHost } from '../host/HostContext';
import { openPage } from '../approvals/ReceiptNote';
import { teamBusiness, readTeamRuns, readTeamTasks } from '../team/reads';
import { inOneLine, runIsLive, runLines, type BackgroundRun, type TaskRow } from '../team/tasks';
import { weekPlanHref } from './WeekPlan';
import {
  createGoal, readGoals, readLatestReport, readUpcomingTasks,
  type HomeGoal, type LatestReport, type NewGoal, type UpcomingTask,
} from './reads';
import { isRefusal, sectionErrorText } from './SectionState';
import { SECTION_LABEL } from './styles';

export const INSIGHTS_COPY = {
  report: 'Report',
  plan: "Your team's plan",
  goals: 'Goals',
  latestReport: 'Latest report',
  downloadPdf: 'Download PDF',
  viewReport: 'View full report',
  pdfFailed: 'The PDF could not be downloaded. Try again in a minute.',
  reportFailed: 'Your latest report could not be loaded. Try again in a minute.',
  upNext: 'Up next',
  workingNow: 'Working on it now',
  nothingScheduled: 'Nothing is scheduled yet.',
  byTeam: 'by your team',
  seePlan: "See your team's plan",
  planLoading: "Loading your team's plan",
  planFailed: "Your team's plan could not be loaded. Try again in a minute.",
  goalsLoading: 'Loading your goals',
  goalsFailed: 'Your goals could not be loaded. Try again in a minute.',
  noGoals: 'No goals yet.',
  noGoalsSite: 'No goals yet. An administrator of this site can add one.',
  addGoal: 'Add a goal',
  goalName: 'Goal name',
  goalNamePlaceholder: '100 sales this month',
  goalCounts: 'What counts',
  goalUrl: 'A visit to a page',
  goalEvent: 'An event on the site',
  goalPage: 'The page address',
  goalEventName: 'The event name',
  goalTarget: 'Target (optional)',
  goalEvery: 'Every',
  goalDay: 'Day',
  goalWeek: 'Week',
  goalMonth: 'Month',
  saveGoal: 'Save goal',
  saving: 'Saving',
  cancel: 'Cancel',
  goalFailed: 'The goal could not be saved. Try again in a minute.',
  retry: 'Retry',
};

/** The card's height while no report is there: about two goals, the plan's footprint. */
export const INSIGHTS_NO_REPORT_HEIGHT = 260;

/** How often the plan's face reads again: every minute, every 10 seconds while work runs. */
export const PLAN_FACE_POLL_MS = 60_000;
export const PLAN_FACE_ACTIVE_POLL_MS = 10_000;

/** A report's kind in words ("Plan progress"), never the stored code ("plan_progress"). */
export function reportTypeLabel(type: string | undefined | null): string {
  const t = String(type ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : '';
}

/** Where a report is read in full: the business page's Reports tab, that report open. */
export function reportHref(instanceId: string, reportId: string): string {
  return `/instances/${encodeURIComponent(instanceId)}?tab=reports&report=${encodeURIComponent(reportId)}`;
}

/** When a task runs next, in short words: "in 5m", "Tomorrow at 9:00 AM", "Monday at 9:00 AM". */
export function nextRunWords(nextRunAt: string | null | undefined, now = Date.now()): string {
  if (!nextRunAt) return 'Not scheduled';
  const d = new Date(nextRunAt);
  if (Number.isNaN(d.getTime())) return 'Not scheduled';
  const diffMin = (d.getTime() - now) / 60000;
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diffMin < -1) return `overdue ${Math.abs(Math.round(diffMin))}m`;
  if (Math.abs(diffMin) < 1) return 'now';
  if (diffMin < 60) return `in ${Math.round(diffMin)}m`;
  if (diffMin < 60 * 24) return `in ${Math.round(diffMin / 60)}h`;
  if (diffMin < 60 * 24 * 2) return `Tomorrow at ${time}`;
  if (diffMin < 60 * 24 * 7) return `${d.toLocaleDateString('en-US', { weekday: 'long' })} at ${time}`;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const FACE_LABEL: React.CSSProperties = { ...SECTION_LABEL, fontWeight: 600, fontSize: 11, letterSpacing: '0.05em' };
const FACE: React.CSSProperties = { minHeight: 'var(--rt-face-height, auto)', display: 'flex', flexDirection: 'column' };
const LINK_BUTTON: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, border: 'none', background: 'none',
  fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer',
};

type ReadStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'refused';

/** One read of a face, with the states a face shows; a refusal stops it for good. */
function useFaceRead<T>(
  host: ScreensHost,
  business: string | null,
  enabled: boolean,
  read: (host: ScreensHost, id: string) => Promise<T>,
  fallback: string,
): { status: ReadStatus; data: T | null; error: string | null; reload: () => Promise<void> } {
  const [state, setState] = useState<{ status: ReadStatus; data: T | null; error: string | null }>(
    { status: enabled && business ? 'loading' : 'idle', data: null, error: null },
  );
  const current = useRef<string | null>(null);
  current.current = enabled ? business : null;
  const reload = useCallback(async () => {
    if (!enabled || !business) return;
    const asked = business;
    try {
      const data = await read(host, asked);
      if (current.current === asked) setState({ status: 'ready', data, error: null });
    } catch (e) {
      if (current.current !== asked) return;
      if (isRefusal(e)) setState({ status: 'refused', data: null, error: null });
      else setState((s) => (s.status === 'ready' ? s : { status: 'failed', data: null, error: sectionErrorText(host, e, fallback) }));
    }
    // The host may be a new object on each render: read again only for another business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, business]);
  useEffect(() => {
    setState({ status: enabled && business ? 'loading' : 'idle', data: null, error: null });
    void reload();
  }, [reload, enabled, business]);
  return { ...state, reload };
}

// ── Report ───────────────────────────────────────────────────────────────

export const ReportFace: React.FC<{
  report: LatestReport;
  instanceId: string;
  downloadReport?: (reportId: string) => Promise<void>;
}> = ({ report, instanceId, downloadReport }) => {
  const host = useScreensHost();
  const [pdfError, setPdfError] = useState<string | null>(null);
  const typeLabel = reportTypeLabel(report.type);
  const dateStr = (() => {
    const d = new Date(report.createdAt);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
  })();
  return (
    <GlassCard padding="24px" style={FACE} data-testid="insights-report">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FiClock size={16} color="var(--purple)" aria-hidden="true" />
          <span style={FACE_LABEL}>{INSIGHTS_COPY.latestReport}</span>
          {typeLabel && <Badge color="purple">{typeLabel}</Badge>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{dateStr}</span>
      </div>
      {/* The summary takes the room left, so the actions sit at the bottom of a stretched face. */}
      <p style={{ color: 'var(--text)', fontSize: 14, margin: '0 0 16px', lineHeight: 1.7, flex: 1 }}>{report.summary}</p>
      {pdfError && <p role="alert" style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--rose)' }}>{pdfError}</p>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
        {downloadReport && (
          <button
            type="button"
            data-testid="insights-report-pdf"
            onClick={async () => {
              setPdfError(null);
              try {
                await downloadReport(report.id);
              } catch (err) {
                setPdfError(sectionErrorText(host, err, INSIGHTS_COPY.pdfFailed));
              }
            }}
            style={{ ...LINK_BUTTON, color: 'var(--text-dim)' }}
          >
            <FiDownload size={14} aria-hidden="true" />
            {INSIGHTS_COPY.downloadPdf}
          </button>
        )}
        <button
          type="button"
          data-testid="insights-report-open"
          onClick={() => {
            host.track?.('home', 'report_open');
            openPage(host, reportHref(instanceId, report.id));
          }}
          style={{ ...LINK_BUTTON, color: 'var(--purple)' }}
        >
          {INSIGHTS_COPY.viewReport}
          <FiChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </GlassCard>
  );
};

/** A face's failure: what happened, and Retry. */
const FaceProblem: React.FC<{ text: string; onRetry: () => void; testId: string }> = ({ text, onRetry, testId }) => (
  <GlassCard padding={20} style={FACE} data-testid={testId}>
    <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{text}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>{INSIGHTS_COPY.retry}</Button>
    </div>
  </GlassCard>
);

/** A face while its first answer is on its way. */
const FaceLoading: React.FC<{ label: string }> = ({ label }) => (
  <GlassCard padding={20} style={FACE}>
    <div role="status" aria-label={label} aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Skeleton height={12} width="40%" rounded="sm" />
      <Skeleton height={14} width="90%" rounded="sm" />
      <Skeleton height={14} width="75%" rounded="sm" />
    </div>
  </GlassCard>
);

// ── Your team's plan ─────────────────────────────────────────────────────

export interface TeamPlanWork {
  upcoming: UpcomingTask[];
  /** The tasks running now. */
  running: TaskRow[];
  /** The background runs queued or running. */
  runs: BackgroundRun[];
}

/** What runs next and what runs now, each read on its own: one refused or failed read never blanks the others. */
export async function readTeamPlanWork(host: ScreensHost, instanceId: string): Promise<TeamPlanWork> {
  const [upcoming, tasks, runs] = await Promise.allSettled([
    readUpcomingTasks(host.transport, instanceId, 5),
    readTeamTasks(host.transport, instanceId),
    readTeamRuns(host.transport, instanceId),
  ]);
  // Up next is the face's own read: its failure is the face's.
  if (upcoming.status === 'rejected') throw upcoming.reason;
  return {
    upcoming: upcoming.value,
    running: tasks.status === 'fulfilled' ? tasks.value.filter((t) => t.isRunning) : [],
    runs: runs.status === 'fulfilled' ? runs.value.filter(runIsLive) : [],
  };
}

const CHIP: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap' };
const ROW: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center', padding: '6px 0' };
const ROW_TEXT: React.CSSProperties = { fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

export const TeamPlanFace: React.FC<{ work: TeamPlanWork; instanceId: string; now?: number }> = ({ work, instanceId, now }) => {
  const host = useScreensHost();
  const active = work.running.length > 0 || work.runs.length > 0;
  return (
    <GlassCard padding={20} style={FACE} data-testid="insights-plan">
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: work.upcoming.length ? 12 : 0 }}>
          <FiClock size={16} color="var(--purple)" aria-hidden="true" />
          <span style={FACE_LABEL}>{INSIGHTS_COPY.upNext}</span>
        </div>
        {work.upcoming.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {work.upcoming.map((t) => (
              <div key={t.id} style={ROW} data-testid="insights-plan-next">
                <span style={{ ...CHIP, background: 'color-mix(in srgb, var(--purple) 15%, transparent)', color: 'var(--purple)' }}>
                  {nextRunWords(t.nextRunAt, now)}
                </span>
                <span style={ROW_TEXT} title={t.prompt}>{inOneLine(t.prompt) ?? t.prompt}</span>
                {t.operator
                  ? <OperatorAvatar id={t.operator.id} title={t.operator.title || undefined} size={OPERATOR_AVATAR_SIZES.row} />
                  : t.source === 'AGENT' ? <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{INSIGHTS_COPY.byTeam}</span> : <span />}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-dim)', padding: '8px 0' }}>{INSIGHTS_COPY.nothingScheduled}</div>
        )}
        {active && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 8 }}>
              <FiZap size={16} color="var(--mauve)" aria-hidden="true" />
              <span style={FACE_LABEL}>{INSIGHTS_COPY.workingNow}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {work.runs.map((r) => (
                <div key={r.id} style={ROW} data-testid="insights-plan-now">
                  <span style={{ ...CHIP, background: 'color-mix(in srgb, var(--mauve) 15%, transparent)', color: 'var(--mauve)' }}>
                    {r.status === 'queued' ? 'Queued' : 'Running'}
                  </span>
                  <span style={ROW_TEXT}>{runLines(r)[0]}</span>
                  {r.operator ? <OperatorAvatar id={r.operator.id} title={r.operator.title || undefined} size={OPERATOR_AVATAR_SIZES.row} /> : <span />}
                </div>
              ))}
              {work.running.map((t) => (
                <div key={t.id} style={ROW} data-testid="insights-plan-now">
                  <span style={{ ...CHIP, background: 'color-mix(in srgb, var(--mauve) 15%, transparent)', color: 'var(--mauve)' }}>Running</span>
                  <span style={ROW_TEXT} title={t.prompt}>{inOneLine(t.prompt) ?? t.prompt}</span>
                  {t.operator ? <OperatorAvatar id={t.operator.id} title={t.operator.title || undefined} size={OPERATOR_AVATAR_SIZES.row} /> : <span />}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--glass-border)' }}>
        <button
          type="button"
          data-testid="insights-plan-open"
          onClick={() => {
            host.track?.('home', 'team_plan_open');
            openPage(host, weekPlanHref(instanceId));
          }}
          style={{ ...LINK_BUTTON, color: 'var(--purple)', fontSize: 12 }}
        >
          {INSIGHTS_COPY.seePlan}
        </button>
      </div>
    </GlassCard>
  );
};

// ── Goals ────────────────────────────────────────────────────────────────

interface GoalForm {
  name: string;
  type: 'url' | 'event';
  matchValue: string;
  targetCount: string;
  periodType: 'daily' | 'weekly' | 'monthly';
}

const EMPTY_GOAL: GoalForm = { name: '', type: 'url', matchValue: '', targetCount: '', periodType: 'monthly' };
const FORM_LABEL: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--text-dim)', margin: '8px 0 4px' };

/** The short form that adds a goal. */
export const NewGoalForm: React.FC<{ instanceId: string; onSaved: () => void; onCancel: () => void }> = ({ instanceId, onSaved, onCancel }) => {
  const host = useScreensHost();
  const [form, setForm] = useState<GoalForm>(EMPTY_GOAL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof GoalForm>(k: K, v: GoalForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const target = Number(form.targetCount);
  const valid = form.name.trim() !== '' && form.matchValue.trim() !== '' && (form.targetCount === '' || (Number.isFinite(target) && target > 0));

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    const goal: NewGoal = {
      name: form.name, type: form.type, matchValue: form.matchValue,
      targetCount: form.targetCount !== '' ? target : null, periodType: form.periodType,
    };
    try {
      await createGoal(host.transport, instanceId, goal);
      host.track?.('home', 'goal_added');
      onSaved();
    } catch (err) {
      setError(sectionErrorText(host, err, INSIGHTS_COPY.goalFailed));
      setSaving(false);
    }
  };

  return (
    <form data-testid="insights-goal-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label style={FORM_LABEL} htmlFor="wms-goal-name">{INSIGHTS_COPY.goalName}</label>
      <Input id="wms-goal-name" value={form.name} maxLength={80} placeholder={INSIGHTS_COPY.goalNamePlaceholder} onChange={(e) => set('name', e.target.value)} />
      <span style={FORM_LABEL}>{INSIGHTS_COPY.goalCounts}</span>
      <Dropdown
        options={[{ key: 'url', label: INSIGHTS_COPY.goalUrl }, { key: 'event', label: INSIGHTS_COPY.goalEvent }]}
        value={form.type}
        onChange={(key) => set('type', key === 'event' ? 'event' : 'url')}
      />
      <label style={FORM_LABEL} htmlFor="wms-goal-match">{form.type === 'url' ? INSIGHTS_COPY.goalPage : INSIGHTS_COPY.goalEventName}</label>
      <Input
        id="wms-goal-match"
        value={form.matchValue}
        maxLength={200}
        placeholder={form.type === 'url' ? '/checkout/order-received' : 'purchase'}
        onChange={(e) => set('matchValue', e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={FORM_LABEL} htmlFor="wms-goal-target">{INSIGHTS_COPY.goalTarget}</label>
          <Input id="wms-goal-target" inputMode="numeric" value={form.targetCount} onChange={(e) => set('targetCount', e.target.value.replace(/[^0-9]/g, ''))} />
        </div>
        <div style={{ flex: 1 }}>
          <span style={FORM_LABEL}>{INSIGHTS_COPY.goalEvery}</span>
          <Dropdown
            options={[
              { key: 'daily', label: INSIGHTS_COPY.goalDay },
              { key: 'weekly', label: INSIGHTS_COPY.goalWeek },
              { key: 'monthly', label: INSIGHTS_COPY.goalMonth },
            ]}
            value={form.periodType}
            onChange={(key) => set('periodType', key === 'daily' || key === 'weekly' ? key : 'monthly')}
          />
        </div>
      </div>
      {error && <p role="alert" style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--rose)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button type="submit" variant="primary" size="sm" disabled={!valid || saving}>{saving ? INSIGHTS_COPY.saving : INSIGHTS_COPY.saveGoal}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>{INSIGHTS_COPY.cancel}</Button>
      </div>
    </form>
  );
};

export const GoalsFace: React.FC<{
  goals: HomeGoal[] | null;
  status: ReadStatus;
  error: string | null;
  instanceId: string;
  onReload: () => void;
}> = ({ goals, status, error, instanceId, onReload }) => {
  const host = useScreensHost();
  const [adding, setAdding] = useState(false);
  const adds = host.viewer?.addsGoals !== false;
  const list = goals ?? [];

  let body: React.ReactNode;
  if (status === 'loading' || status === 'idle') {
    body = (
      <div role="status" aria-label={INSIGHTS_COPY.goalsLoading} aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Skeleton height={14} width="70%" rounded="sm" />
        <Skeleton height={8} rounded="full" />
      </div>
    );
  } else if (status === 'failed') {
    body = (
      <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>{error ?? INSIGHTS_COPY.goalsFailed}</p>
        <Button variant="outline" size="sm" onClick={onReload}>{INSIGHTS_COPY.retry}</Button>
      </div>
    );
  } else if (adding) {
    body = <NewGoalForm instanceId={instanceId} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); onReload(); }} />;
  } else if (list.length === 0 && !adds) {
    body = <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>{host.scope.kind === 'site' ? INSIGHTS_COPY.noGoalsSite : INSIGHTS_COPY.noGoals}</p>;
  } else {
    body = <GoalWidget goals={list} onCreateGoal={adds ? () => setAdding(true) : undefined} />;
  }

  return (
    <GlassCard padding={20} style={FACE} data-testid="insights-goals">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <span style={FACE_LABEL}>{INSIGHTS_COPY.goals}</span>
        {adds && !adding && list.length > 0 && status === 'ready' && (
          <Button variant="bare" size="sm" onClick={() => setAdding(true)}>{INSIGHTS_COPY.addGoal}</Button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>{body}</div>
    </GlassCard>
  );
};

// ── The card ─────────────────────────────────────────────────────────────

/** Which faces this person sees; each defaults to shown. */
export interface InsightsFaces {
  report?: boolean;
  plan?: boolean;
  goals?: boolean;
}

export interface HomeInsightsProps {
  host: ScreensHost;
  /** The account's scope: the business on screen. A site's scope ignores it: its own instance. */
  instanceId?: string | null;
  /**
   * The faces this person may see (the plugin: the report for owners and
   * shop managers, the plan for owners, the goals for every role). A face
   * left out makes no call. Default: all three.
   */
  faces?: InsightsFaces;
  /** Downloads a report's PDF (the app's own download); no Download PDF without it. */
  downloadReport?: (reportId: string) => Promise<void>;
  /** The card turns to the next face every this many ms (0: never). Default 30 seconds. */
  autoRotateMs?: number;
}

export const HomeInsights: React.FC<HomeInsightsProps> = (props) => (
  <ScreensHostProvider host={props.host}>
    <HomeInsightsSection {...props} />
  </ScreensHostProvider>
);

const readReport = (host: ScreensHost, id: string) => readLatestReport(host.transport, id);
const readGoalsOf = (host: ScreensHost, id: string) => readGoals(host.transport, id);

/** The faces' reads, for one business (exported for the tests' hook harness). */
export function useHomeInsights(host: ScreensHost, instanceId: string | null | undefined, faces: InsightsFaces = {}) {
  const business = teamBusiness(host.scope, instanceId);
  const showReport = faces.report !== false;
  const showPlan = faces.plan !== false;
  const showGoals = faces.goals !== false;
  const report = useFaceRead(host, business, showReport, readReport, INSIGHTS_COPY.reportFailed);
  const plan = useFaceRead(host, business, showPlan, readTeamPlanWork, INSIGHTS_COPY.planFailed);
  const goals = useFaceRead(host, business, showGoals, readGoalsOf, INSIGHTS_COPY.goalsFailed);

  // The plan's face reads again: every minute, every 10 seconds while work runs, only while the page is visible.
  const active = !!plan.data && (plan.data.running.length > 0 || plan.data.runs.length > 0);
  const reloadPlan = plan.reload;
  useEffect(() => {
    if (!showPlan || !business || plan.status === 'refused') return undefined;
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void reloadPlan();
    }, active ? PLAN_FACE_ACTIVE_POLL_MS : PLAN_FACE_POLL_MS);
    return () => clearInterval(timer);
  }, [showPlan, business, plan.status, active, reloadPlan]);

  return { business, showReport, showPlan, showGoals, report, plan, goals };
}

/** The rolling card's faces, in order, for the reads' states. */
export function insightsItems(
  state: ReturnType<typeof useHomeInsights>,
  opts: { downloadReport?: (reportId: string) => Promise<void>; now?: number } = {},
): RollingTabItem[] {
  const { business, showReport, showPlan, showGoals, report, plan, goals } = state;
  if (!business) return [];
  const items: RollingTabItem[] = [];
  const reportFace = report.status === 'failed'
    ? <FaceProblem text={report.error ?? INSIGHTS_COPY.reportFailed} onRetry={() => void report.reload()} testId="insights-report-failed" />
    : report.status === 'ready' && report.data
      ? <ReportFace report={report.data} instanceId={business} downloadReport={opts.downloadReport} />
      : null;
  if (showReport && reportFace) items.push({ key: 'report', label: INSIGHTS_COPY.report, icon: <FiFileText size={13} aria-hidden="true" />, content: reportFace });
  if (showPlan && plan.status !== 'refused') {
    const content = plan.status === 'failed'
      ? <FaceProblem text={plan.error ?? INSIGHTS_COPY.planFailed} onRetry={() => void plan.reload()} testId="insights-plan-failed" />
      : plan.data
        ? <TeamPlanFace work={plan.data} instanceId={business} now={opts.now} />
        : <FaceLoading label={INSIGHTS_COPY.planLoading} />;
    items.push({ key: 'plan', label: INSIGHTS_COPY.plan, icon: <FiClock size={13} aria-hidden="true" />, content });
  }
  if (showGoals && goals.status !== 'refused') {
    items.push({
      key: 'goals',
      label: INSIGHTS_COPY.goals,
      icon: <FiTarget size={13} aria-hidden="true" />,
      content: <GoalsFace goals={goals.data} status={goals.status} error={goals.error} instanceId={business} onReload={() => void goals.reload()} />,
    });
  }
  return items;
}

const HomeInsightsSection: React.FC<HomeInsightsProps> = ({ host, instanceId, faces, downloadReport, autoRotateMs = 30_000 }) => {
  const state = useHomeInsights(host, instanceId, faces);
  // The Report face never flickers in or out: the card waits for its read.
  if (state.showReport && state.report.status === 'loading') return null;
  const items = insightsItems(state, { downloadReport });
  if (items.length === 0) return null;
  const hasReport = items.some((i) => i.key === 'report') && state.report.status === 'ready';
  return (
    <div data-testid="home-insights">
      <RollingTabs
        autoRotateMs={autoRotateMs}
        equalHeight
        minHeight={hasReport ? undefined : INSIGHTS_NO_REPORT_HEIGHT}
        items={items}
      />
    </div>
  );
};

export default HomeInsights;
