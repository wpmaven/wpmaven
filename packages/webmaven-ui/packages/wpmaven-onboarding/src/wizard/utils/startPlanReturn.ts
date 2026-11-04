/**
 * Coming back from a plan started inside the wizard.
 *
 * The dashboard's "Start for $1" sheet takes the visitor to the payment page,
 * which brings them back to /create: the wizard is mounted again, its state
 * gone, with host.resumeAction saying what to run. So the moment the sheet is
 * asked for, the wizard keeps what it needs to reopen where the visitor was
 * (the step, the idea, the analysis as confirmed, the lineup and the picked
 * direction) in the host's per-browser storage (the dashboard's tab memory),
 * written at once, since the sheet may leave the page right after. Back with
 * a resumeAction, the wizard reads it for the same session, reopens there and
 * runs the action once; it is taken out of storage at that mount, so a
 * reload of the page it came back to opens as usual. Pure, but for storage.
 */
import type { WizardResumeAction, WizardStorage } from '../../host/types';
import type { OnboardingStep } from '../types';
import { buildLimitOf, rerollsOf, type BuildLimit, type RerollState } from '../../api/onboarding';

export const START_PLAN_RETURN_KEY = 'wm-onb-start-plan';

/** Kept this long: a payment page left open longer starts from the wizard as usual. */
export const START_PLAN_RETURN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The build step a limit stopped: the reading of the idea, the style step's directions, the plan, the site build. */
export type LimitedStep = 'analyze' | 'concepts' | 'plan' | 'build';

/** What runs once the wizard is back: other directions, the reading of the idea again, the build again; null when the step's own load does it. */
export type ResumeRun = 'reroll' | 'analyze' | 'build';

/** The steps the wizard reopens on. */
const RETURN_STEPS: ReadonlySet<OnboardingStep> = new Set<OnboardingStep>(['describe', 'confirm', 'forecast', 'style']);

export interface StartPlanReturn {
  v: 1;
  reason: 'rerolls' | 'build';
  /** The session the sheet was asked from: only the same session reopens. */
  sessionId: string | null;
  /** When the sheet was asked for (ms since the epoch). */
  at: number;
  /** The build step the limit stopped (reason 'build'), else null. */
  limited: LimitedStep | null;
  /** The step to reopen on. */
  step: OnboardingStep;
  description: string;
  analysis: unknown;
  selectedPages: unknown[];
  selectedPlugins: unknown[];
  confirmStage: number | null;
  confirmMaxConfirmed: number;
  businessPlan: unknown;
  forecastScenario: string;
  /** The direction picked on the style step: kept picked when the directions load again. */
  conceptId: string | null;
  /** The limit card shown when the sheet was asked for (a build): shown again by 'restore'. */
  limit?: BuildLimit | null;
  /** Whether other directions came with a plan (rerolls): said again by 'restore'. */
  rerolls?: RerollState | null;
}

/**
 * The step to reopen on: the style step for other directions and for the
 * build and the directions the limit stopped, the idea for its reading, and
 * the step the visitor was on for the plan (the confirm step loads it too).
 */
export function returnStepOf(reason: 'rerolls' | 'build', limited: LimitedStep | null, current: OnboardingStep): OnboardingStep {
  if (reason === 'rerolls') return 'style';
  if (limited === 'analyze') return 'describe';
  if (limited === 'concepts' || limited === 'build') return 'style';
  if (limited === 'plan') return current === 'confirm' ? 'confirm' : 'forecast';
  return RETURN_STEPS.has(current) ? current : 'describe';
}

/**
 * What runs once back. The directions and the plan a limit stopped load by
 * themselves when their step opens again, so nothing more runs for them;
 * back without paying ('restore'), nothing runs at all.
 */
export function resumeRunFor(r: Pick<StartPlanReturn, 'reason' | 'limited'>, action: WizardResumeAction | null | undefined): ResumeRun | null {
  return action === 'restore' ? null : resumeRunOf(r);
}

/** What a paid return runs (resumeRunFor without 'restore'). */
export function resumeRunOf(r: Pick<StartPlanReturn, 'reason' | 'limited'>): ResumeRun | null {
  if (r.reason === 'rerolls') return 'reroll';
  if (r.limited === 'analyze') return 'analyze';
  if (r.limited === 'build') return 'build';
  return null;
}

/** Kept at once (the sheet may leave the page right after). A storage that refuses it keeps nothing. */
export function saveStartPlanReturn(storage: WizardStorage, r: StartPlanReturn): void {
  try {
    storage.set(START_PLAN_RETURN_KEY, JSON.stringify(r));
  } catch { /* private mode, or a full quota: the wizard opens as usual on the way back */ }
}

export function clearStartPlanReturn(storage: WizardStorage): void {
  try { storage.remove(START_PLAN_RETURN_KEY); } catch { /* nothing to do */ }
}

/**
 * What was kept, when the wizard is mounted with `action` for the same
 * session, for the same reason ('reroll' for other directions, 'build' for a
 * build; 'restore', back without paying, for either), within a day; else
 * null. The session is the draft's id, which a sign-in inside the sheet
 * keeps (the account owns the session then, and its anonymous key is gone).
 * Reads only.
 */
export function readStartPlanReturn(
  storage: WizardStorage,
  opts: { action: WizardResumeAction | null | undefined; sessionId: string | null; now: number },
): StartPlanReturn | null {
  if (opts.action !== 'reroll' && opts.action !== 'build' && opts.action !== 'restore') return null;
  let raw: string | null = null;
  try { raw = storage.get(START_PLAN_RETURN_KEY); } catch { return null; }
  if (!raw) return null;
  let r: Partial<StartPlanReturn> | null = null;
  try { r = JSON.parse(raw) as Partial<StartPlanReturn>; } catch { return null; }
  if (!r || typeof r !== 'object' || r.v !== 1) return null;
  if (r.reason !== 'rerolls' && r.reason !== 'build') return null;
  if (opts.action !== 'restore' && r.reason !== (opts.action === 'reroll' ? 'rerolls' : 'build')) return null;
  if ((r.sessionId ?? null) !== opts.sessionId) return null;
  if (typeof r.at !== 'number' || r.at > opts.now + 60_000 || opts.now - r.at > START_PLAN_RETURN_MAX_AGE_MS) return null;
  if (typeof r.step !== 'string' || !RETURN_STEPS.has(r.step as OnboardingStep)) return null;
  if (typeof r.description !== 'string') return null;
  // A step past the idea needs the analysis it was drawn from.
  if (r.step !== 'describe' && (!r.analysis || typeof r.analysis !== 'object')) return null;
  const limited = r.limited === 'analyze' || r.limited === 'concepts' || r.limited === 'plan' || r.limited === 'build' ? r.limited : null;
  return {
    v: 1,
    reason: r.reason,
    sessionId: r.sessionId ?? null,
    at: r.at,
    limited,
    step: r.step as OnboardingStep,
    description: r.description,
    analysis: r.analysis ?? null,
    selectedPages: Array.isArray(r.selectedPages) ? r.selectedPages : [],
    selectedPlugins: Array.isArray(r.selectedPlugins) ? r.selectedPlugins : [],
    confirmStage: typeof r.confirmStage === 'number' ? r.confirmStage : null,
    confirmMaxConfirmed: typeof r.confirmMaxConfirmed === 'number' ? r.confirmMaxConfirmed : 0,
    businessPlan: r.businessPlan ?? null,
    forecastScenario: typeof r.forecastScenario === 'string' && r.forecastScenario ? r.forecastScenario : 'expected',
    conceptId: typeof r.conceptId === 'string' && r.conceptId ? r.conceptId : null,
    limit: r.limit ? buildLimitOf(r.limit) : null,
    rerolls: rerollsOf(r.rerolls),
  };
}
