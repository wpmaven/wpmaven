/**
 * The wizard's state and actions.
 *
 * The steps (OnboardingShell + steps) read state/actions from
 * `useOnboarding()`; this provider implements that shape and wires it to the
 * onboarding api on the host's transport (an anonymous draft on the
 * dashboard, the site principal in WordPress) and to the genstudio
 * site-build stream: the same SSE theater grammar as the plugin (shared via
 * generationEvents.ts), a token-gated static preview of the real site, and,
 * when the host has one, a WP-bundle apply into in-browser Playground for
 * the final live pane.
 */
import React, { useContext, useState, useRef, useCallback, useEffect, useMemo, ReactNode } from 'react';
import { localized } from '@yotako/webmaven-ui';
import { CONTEXT_COPY } from './contextCopy';
import { useHost } from '../../host/HostContext';
import { OnboardingStateContext } from './onboardingState';
import type { WizardHost, SiteProfile } from '../../host/types';
import { isRefusal, needsClarification, needsSuggestions, type GrowthPlan, buildLimitOf, isBuildLimitError, type BuildLimit, type PublishOutcome, type SiteOnboardingSession, type SiteOnboardingState, type SiteCheckResult, type SiteCheckLimit, type SiteBriefAnswer, readCheckLimit, KeepFieldsError, rerollPlanRequiredOf, type RerollState } from '../../api/onboarding';
import { clearStartPlanReturn, readStartPlanReturn, resumeRunFor, returnStepOf, saveStartPlanReturn, type LimitedStep, type ResumeRun, type StartPlanReturn } from '../utils/startPlanReturn';
import { keptDefaults, keptSiteType, type KeepValues } from '../components/Onboarding/steps/keepCopy';
import { pendingBusinessIdea } from '../../api/businessIdea';
import { useWizardApis } from '../wizardApis';
import { setOperatorCatalog } from '../constants/operators';
import { bindSession, clearMemory, getUIMemory, rememberUI } from '../utils/onboardingMemory';
import { initialTheaterState, isTheaterEventType, processTheaterEvent, type TheaterState } from './generationEvents';
import { errorEventRefused } from './sessionStatus';
import { apiErrorInfo, errorMessage, noAnswer } from '../../shared/errorMessage';
import { requestProblem, refusalState, REQUEST_PROBLEM, RATE_LIMITED_MESSAGE } from '../../shared/requestProblem';
import { storeCurrencyRefusalOf } from '../../api/storeCurrency';
import { isAiStepStopped } from '../../api/aiStep';
import { STORE_CURRENCY_COPY, currencyName, normalizeCurrencyCode, pricesConvertedLine } from '../../shared/storeCurrencyCopy';
import type { OnboardingStep, DescribePhase, DesignConcept, OnboardingAnalysis, CodeFile, PageSelection, PluginSelection } from '../types';
import type { SiteLanguageAnswer } from '../../host/types';
import { analysisWithLanguage, pagesWithLanguage } from '../utils/siteLanguageAnswer';

/** A later step's refusal, in the visitor's words: the bot check and the
 *  hourly limit read the same as on Analyze, anything else by status. */
function onboardingErrorText(e: unknown, fallback: string): string {
  const problem = requestProblem(e);
  if (problem.kind === 'human_check') return REQUEST_PROBLEM.humanCheck;
  if (problem.kind === 'rate_limited') return REQUEST_PROBLEM.rateLimited;
  return errorMessage(e, fallback);
}

// Re-export the wizard's types so the steps resolve them from this module.
export type {
  OnboardingStep, DescribePhase, OnboardingStatus, InstallType, DesignConcept,
  PageSelection, PluginSelection, PageSuggestion, PluginRecommendation, StylePreset,
  OnboardingAnalysis, LogoVariant, ChecklistVM, CodeFile, OnboardingConfig,
} from '../types';

const browserLocale = (): string | undefined =>
  typeof navigator !== 'undefined' ? navigator.language : undefined;

// Anonymous flow order (no detect; signup wall lives after success).
/** What the success step says when the build fences answered 'high_demand'
 *  without a message of their own. Same words as the API's
 *  HIGH_DEMAND_MESSAGE (anonBuildFence.ts): the waiting list really is built,
 *  usually within a day. */
export const HIGH_DEMAND_FALLBACK_EN = {
  text: 'We are building a lot of sites right now. Leave your email and we will build yours and send you the link, usually within a day.',
} as const;
/** The same, in the page's language (French in src/i18n, namespace 'highDemandFallback'). */
const HIGH_DEMAND_FALLBACK = localized(HIGH_DEMAND_FALLBACK_EN, 'highDemandFallback');
/** How often the wizard asks for the hosted preview, and for how long at most (the fleet may grow for it first). */
export const HOSTED_PREVIEW_POLL_MS = 5_000;
export const HOSTED_PREVIEW_WAIT_MS = 40 * 60_000;
/** The theater's line when an update of the API stopped the build and it started again (2026-10-19). English; the screens read CONTEXT_COPY.buildRestarted. */
export const BUILD_RESTARTED_LINE = 'We restarted your build. It takes a few minutes.';
/** Builds started again in a row before the wizard stops and offers Try Again: never a loop of paid builds. */
const BUILD_RESTARTS_MAX = 3;

const STEPS: OnboardingStep[] = ['describe', 'confirm', 'forecast', 'style', 'whatsapp', 'generating', 'success'];

/**
 * The wizard's steps in order. The CFO's forecast is there only for a
 * business that sells (its analysis has an earning model): the API keeps no
 * plan for one that sells nothing online, so the step would only ever say it
 * could not finish one.
 */
export function stepsFor(isCommercial: boolean): OnboardingStep[] {
  return isCommercial ? [...STEPS] : STEPS.filter((s) => s !== 'forecast');
}

/** The step after `step` (a step off the path, such as clarify, goes back to describe). */
export function nextStepOf(step: OnboardingStep, isCommercial: boolean): OnboardingStep {
  const i = STEPS.indexOf(step);
  if (i === -1) return STEPS[0];
  return STEPS.slice(i + 1).find((s) => isCommercial || s !== 'forecast') ?? step;
}

/** The step before `step` (describe has none; a step off the path goes back to describe). */
export function prevStepOf(step: OnboardingStep, isCommercial: boolean): OnboardingStep {
  const i = STEPS.indexOf(step);
  if (i <= 0) return STEPS[0];
  return STEPS.slice(0, i).reverse().find((s) => isCommercial || s !== 'forecast') ?? STEPS[0];
}

const Ctx = OnboardingStateContext;

/**
 * The context with a value given whole, so a ported card or step can be
 * rendered on its own with the state it reads (the render tests). The app
 * mounts OnboardingProvider below, which starts sessions and streams.
 */
export const OnboardingStateProvider = Ctx.Provider;

// eslint-disable-next-line react-refresh/only-export-components
export function useOnboarding() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOnboarding must be used within OnboardingProvider');
  return v;
}

// eslint-disable-next-line react-refresh/only-export-components
export { useOptionalOnboarding } from './onboardingState';

/** What a reroll or a fetch of the style step's directions came to (the button reads it). */
export type ConceptsOutcome = 'ok' | 'plan_required' | 'limited' | 'failed' | 'skipped';

/**
 * Publishing onto the WordPress site the wizard runs in: idle (the button),
 * confirming (the owner is asked first), starting (the call is out),
 * publishing (followed every 5 s), ended (the outcome is shown).
 */
export type PublishHerePhase = 'idle' | 'confirming' | 'starting' | 'publishing' | 'ended';

export interface PublishHereState {
  phase: PublishHerePhase;
  /** What the last publish onto this site did; null before any. */
  outcome: PublishOutcome | null;
  /** A publish that did not start, in the owner's words (a site built before, a publish elsewhere). */
  error: string | null;
  /** The account's plan refused the build (its free builds used, a failed payment): the card with the way on. */
  limit: BuildLimit | null;
}

const PUBLISH_IDLE: PublishHereState = { phase: 'idle', outcome: null, error: null, limit: null };

/** How often a running publish is read again (GET /onboarding/site-session). */
export const PUBLISH_FOLLOW_MS = 5000;

/** A press that never reached the API (the site reads as not publishing, with nothing new). English; the wizard says CONTEXT_COPY.publishNotStarted. */
export const PUBLISH_NOT_STARTED = 'The publish did not start. Try again in a minute.';

/** Why a publish did not start: the API's own sentence when it wrote one for the owner (shown whole), else ours. */
function publishRefusalText(e: unknown): string {
  const res = (e as { response?: { status?: number; data?: { error?: unknown } } } | null)?.response;
  const sentence = res?.data?.error;
  if (res && res.status && res.status >= 400 && res.status < 500 && typeof sentence === 'string' && sentence.trim()) return sentence.trim();
  return errorMessage(e, CONTEXT_COPY.publishNotStarted);
}

/** The business cap refused a new business (the start's 402 payment_required). */
function businessCapRefusal(e: unknown): boolean {
  const res = (e as { response?: { status?: number; data?: { code?: unknown } } } | null)?.response;
  return res?.status === 402 && res.data?.code === 'payment_required';
}

/**
 * Whether the wizard opens on "Your site" instead of the idea: the plugin
 * only (the dashboard has no site), the api allows it for this business
 * (existingSite), and the plugin says the site holds something of the
 * owner's. Pure.
 */
export function opensOnSite(host: Pick<WizardHost, 'kind' | 'identity' | 'site'>, state: Pick<SiteOnboardingState, 'existingSite'> | null | undefined): boolean {
  if (host.kind !== 'plugin' || host.identity.mode !== 'site') return false;
  const profile = host.site?.profile;
  return !!state?.existingSite && !!profile && profile.kind !== 'empty';
}

/** "Check my site": idle until pressed, running while the team checks, done with its result, or failed with the owner's sentence. */
export interface SiteCheckState {
  phase: 'idle' | 'running' | 'done' | 'failed';
  error: string | null;
  result?: SiteCheckResult | null;
  /** The last check, shown again on a later visit (not one just made). */
  reopened?: boolean;
  /** The checks left this hour, and when the next opens (the api's limit; null from an api before it). */
  limit?: SiteCheckLimit | null;
  /** "Check again" runs: the check shown stays until the new one is done. */
  rechecking?: boolean;
  /** "Check again" refused or failed: the api's sentence (three an hour), else ours. */
  recheckError?: string | null;
}

/** The ways on under the check (their steps follow the choice). */
export type SiteWay = 'keep' | 'fix' | 'redesign';

/** "New design, keep my content": the site read for its new design, then the owner's choice. */
export interface RedesignState {
  phase: 'idle' | 'reading' | 'ready' | 'failed' | 'confirming';
  brief: SiteBriefAnswer | null;
  error: string | null;
}

/** The api's own sentence for a refused check (three an hour), else ours. */
function siteCheckError(e: unknown): string {
  const res = (e as { status?: number; message?: unknown } | null) ?? null;
  return res?.status === 429 && typeof res.message === 'string' && res.message.trim() ? res.message : CONTEXT_COPY.siteCheckFailed;
}

/** The sentence a check that could not start shows (the route is not there yet, or no answer). English; the wizard says CONTEXT_COPY.siteCheckFailed. */
export const SITE_CHECK_FAILED = 'We could not check your site just now. Try again in a minute.';

/** What runs once back from a plan, and on which step; null when nothing does. Pure. */
function pendingResumeOf(r: StartPlanReturn | null, action: WizardHost['resumeAction']): { run: ResumeRun; step: OnboardingStep } | null {
  const run = r ? resumeRunFor(r, action) : null;
  return r && run ? { run, step: r.step } : null;
}

export function OnboardingProvider({ children, onComplete }: { children: ReactNode; onComplete?: () => void; onCancel?: () => void }) {
  // Everything that differs between the dashboard and WordPress comes from
  // the host: the api (on its transport), the tracker, the per-browser
  // storage, the human check and whether an in-browser WordPress is coming.
  const host = useHost();
  const { onboarding: onboardingApi, storeCurrency: storeCurrencyApi } = useWizardApis();
  const getSessionId = onboardingApi.getSessionId;
  // The per-browser memory (the lines already played, the WhatsApp step
  // seen, the forecast's line) is kept per session, in the host's storage:
  // bound as soon as the session is known, so a reload never replays what
  // was already said. A draft's stored session is known on the first render
  // (bound before any step draws); a start (or a resumed session) binds its own.
  const boundSessionRef = useRef<string | null>(null);
  const bindMemory = useCallback((sid: string | null | undefined) => {
    if (!sid || boundSessionRef.current === sid) return;
    boundSessionRef.current = sid;
    bindSession(sid);
  }, []);
  useState(() => {
    bindMemory(getSessionId());
    return true;
  });
  // Back from a plan started here (host.resumeAction): what
  // the wizard kept when the sheet was asked for, for this draft's session.
  // Only read here (StrictMode runs this twice); the mount below takes it
  // out of storage. The state below starts from it: no describe flashes first.
  const [planReturn] = useState<StartPlanReturn | null>(() => (host.identity.mode === 'draft'
    ? readStartPlanReturn(host.storage, { action: host.resumeAction, sessionId: getSessionId(), now: Date.now() })
    : null));
  // Back without paying ('restore'): the step exactly as it was, its card or
  // its line under other directions included, and nothing runs.
  const [restoreOnly] = useState(() => !!planReturn && host.resumeAction === 'restore');
  const trackEvent = useCallback(
    (category: string, action: string, name?: string, value?: number) => host.analytics.track(category, action, name, value),
    [host],
  );
  const storage = host.storage;
  // No human check on this host (a site, or a dashboard without a site key):
  // analyze never waits for a token that is not coming.
  const humanCheckOn = host.humanCheck.kind === 'turnstile';
  // No in-browser WordPress on this host: the wizard completes on the static preview.
  const playgroundComing = !!(host.preview.Applier && host.preview.playgroundRemoteUrl);
  // A draft whose build was started from this browser (its session memory
  // says so) opens on the build, which the boot below attaches to; anything
  // else opens on describe. Decided on the first render, so describe never
  // flashes first.
  // Back from a plan: the step the visitor was on.
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(
    () => (planReturn ? planReturn.step : host.identity.mode === 'draft' && getSessionId() && getUIMemory().buildStarted ? 'generating' : 'describe'),
  );
  // A site's first paint waits for its setup state (GET /onboarding/site-session):
  // a reload during its build or its publish reopens there, not on describe.
  const [booting, setBooting] = useState(host.identity.mode === 'site');
  // Someone who wrote their idea on the not-found page has already answered
  // the Co-CEO's opening question, so they open on the input rather than being
  // asked again. Decided during render, not in an effect, so the "do you have
  // a business in mind?" screen never flashes first.
  const [describePhase, setDescribePhase] = useState<DescribePhase>(
    () => (planReturn || pendingBusinessIdea(storage) ? 'describe' : 'ask'),
  );
  const [description, setDescription] = useState(() => planReturn?.description ?? '');
  const [analysis, setAnalysis] = useState<OnboardingAnalysis | null>(() => (planReturn?.analysis as OnboardingAnalysis | null | undefined) ?? null);
  const [designConcepts, setDesignConcepts] = useState<DesignConcept[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedDesignSystem, setSelectedDesignSystem] = useState<any>(null);
  const [previewDesignConcept, setPreviewDesignConcept] = useState<DesignConcept | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [businessPlan, setBusinessPlan] = useState<any>(() => planReturn?.businessPlan ?? null);
  const [selectedStyle, setSelectedStyle] = useState('');
  // Confirm accordion (the plugin's meet-the-team beat, from describe to confirm):
  // active card, high-water mark of confirmed cards, and the editable selections.
  const [confirmStage, setConfirmStage] = useState<number | null>(() => (planReturn ? planReturn.confirmStage : 0));
  const [confirmMaxConfirmed, setConfirmMaxConfirmed] = useState(() => planReturn?.confirmMaxConfirmed ?? 0);
  const [selectedPages, setSelectedPages] = useState<PageSelection[]>(() => (planReturn?.selectedPages as PageSelection[] | undefined) ?? []);
  const [selectedPlugins, setSelectedPlugins] = useState<PluginSelection[]>(() => (planReturn?.selectedPlugins as PluginSelection[] | undefined) ?? []);
  const [pickedSuggestion, setPickedSuggestion] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingConcepts, setIsLoadingConcepts] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The build stream's error event said the build was refused (errorCode
  // build_refused or retryable:false): the ported generating step reads it
  // so it never offers a Try Again that would be refused again (2026-09-22).
  const [buildRefused, setBuildRefused] = useState(false);
  // Style-step reroll cap (genstudio): the API's 429 message, shown inline
  // under the reroll action, which stays disabled while this is set.
  const [rerollNotice, setRerollNotice] = useState<string | null>(null);
  // Other directions come with a plan: the concepts answer's
  // `rerolls`, or a reroll's 402 plan_required. Null: the API said nothing
  // (an API before it), and rerolls work as they did. The ref is the latest,
  // for a click that just read it.
  const [rerolls, setRerollsState] = useState<RerollState | null>(() => (restoreOnly ? planReturn?.rerolls ?? null : null));
  const rerollsRef = useRef<RerollState | null>(restoreOnly ? planReturn?.rerolls ?? null : null);
  const setRerolls = useCallback((next: RerollState | null) => {
    rerollsRef.current = next;
    setRerollsState(next);
  }, []);
  // The gate's two diversions. Kept here rather than in the steps because a
  // step remounts on every currentStep change (the shell keys on it), so
  // anything held inside one is lost the moment we route to it.
  const [clarifyQuestion, setClarifyQuestion] = useState('');
  const [clarifyRound, setClarifyRound] = useState(0);
  const [feasibilityReason, setFeasibilityReason] = useState('');
  // The business cap refused this business at the start (a signed-in owner
  // at the cap): the host's wall shows instead of the wizard, when it has one.
  const [capWall, setCapWall] = useState(false);
  // Turnstile bot-gate token (null when the widget is disabled or not yet solved).
  const [turnstileToken, setTurnstileTokenState] = useState<string | null>(null);
  const turnstileTokenRef = useRef<string | null>(null);
  const setTurnstileToken = useCallback((t: string | null) => {
    turnstileTokenRef.current = t;
    setTurnstileTokenState(t);
  }, []);
  // Bumped to make the widget run a fresh check (TurnstileWidget resetKey).
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  // The API turned Analyze away: 'human_check' (the bot check said no; the
  // way forward is a fresh check) or a time until which this network is over
  // the hourly limit (the way forward is waiting). Cleared when it no longer
  // applies, so the button comes back on its own.
  const [humanCheckFailed, setHumanCheckFailed] = useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const rateLimitedUntilRef = useRef<number | null>(null);
  rateLimitedUntilRef.current = rateLimitedUntil;
  useEffect(() => {
    if (rateLimitedUntil === null) return;
    const t = window.setTimeout(() => {
      setRateLimitedUntil(null);
      // The limit's sentence, in whichever language it was said in.
      setError((cur) => (cur === RATE_LIMITED_MESSAGE || cur === REQUEST_PROBLEM.rateLimited ? null : cur));
    }, Math.max(0, rateLimitedUntil - Date.now()));
    return () => window.clearTimeout(t);
  }, [rateLimitedUntil]);
  // Genstudio: the picked concept's full-page mock, holding the
  // generating pane until the engine's homepage lands. An interim picture
  // only — sitePreviewUrl replaces it with the actual site.
  const [mockPreview, setMockPreview] = useState<string | null>(null);
  // The STATIC serving of the real site (token-gated multi-page artifacts,
  // set from the stream's preview_ready). The preview ladder is
  // mock picture → this actual site → in-browser WordPress.
  const [sitePreviewUrl, setSitePreviewUrl] = useState<string | null>(null);
  // Bumped (debounced ~3s) each time a page's code window completes, so the
  // static preview remounts and picks up freshly written pages without
  // thrashing on rapid back-to-back pages.
  const [sitePreviewReloadKey, setSitePreviewReloadKey] = useState(0);
  // Set on the terminal complete{wp_ready}: the token the Playground applier
  // fetches the WP bundle with. Null until the compile finished.
  const [wpBundleToken, setWpBundleToken] = useState<string | null>(null);
  // The bucket-hosted bundle zip (terminal complete carries a signed GET URL
  // + integrity hash). Null = no bucket artifact: the applier falls back to
  // the fat-JSON wp-bundle route.
  const [wpBundleZip, setWpBundleZip] = useState<{ url: string; sha256: string; bytes: number } | null>(null);
  // The Playground preview lifecycle: 'preparing' from complete{wp_ready}
  // until the in-browser WordPress answers ('live') or dies/times out
  // ('failed': the wizard stops on an error card saying what failed, with a
  // Try Again that starts the WordPress preview again; it never ends on the
  // static preview). 'idle' means no Playground is coming (errors, high
  // demand) so completion never waits on it.
  const [wpPreview, setWpPreview] = useState<'idle' | 'preparing' | 'live' | 'failed'>('idle');
  // What stopped the in-browser WordPress, in words (null while it has not failed).
  const [wpPreviewError, setWpPreviewError] = useState<string | null>(null);
  // One per WordPress attempt: the pane keys the applier on it, so a retry
  // mounts a fresh one (an applier boots and applies once per mount).
  const [wpAttempt, setWpAttempt] = useState(0);
  // The build stream reached its terminal event. Completion presentation is
  // buildDone AND the Playground settled — never buildDone alone.
  const [buildDone, setBuildDone] = useState(false);
  // The final instance's predicted plugin set (site-build response): the
  // pane PREBOOTS the Playground with these while the site still generates.
  const [predictedPlugins, setPredictedPlugins] = useState<string[] | null>(null);
  // The hosted preview: the site-build
  // answer says hosted_preview when the API makes a private WordPress site
  // for this build. Then no in-browser WordPress starts (no preboot, no
  // bundle, no wait): the pane frames the real site once it is ready
  // (hostedPreviewUrl), the static copy until then, and the success step
  // comes with the build, whatever happens to the preview.
  const [hostedPreview, setHostedPreview] = useState(false);
  const [hostedPreviewToken, setHostedPreviewToken] = useState<string | null>(null);
  const [hostedPreviewUrl, setHostedPreviewUrl] = useState<string | null>(null);
  // The hosted preview will not come (unavailable, or its wait ran out): the
  // static copy is all the pane will show, so it never promises the full site.
  const [hostedPreviewEnded, setHostedPreviewEnded] = useState(false);
  // The generation theater (progress/phase/checklists/feed/tokens), fed by the
  // site-build SSE through the SAME grammar as the plugin's generate stream.
  const [theater, setTheater] = useState<TheaterState>(initialTheaterState);
  // Build fences (launch): the API answered 'high_demand' instead of building —
  // the email-capture card shows above the step the build was asked from.
  const [highDemand, setHighDemand] = useState<{ message: string } | null>(null);
  // A build that ended in an error keeps the wizard on the generating step
  // with a retry, never on "ready to launch" over a site that does not exist.
  const [buildFailed, setBuildFailed] = useState<string | null>(null);
  const buildFailedRef = useRef(false);
  // An update of the API stopped the build and it began again (the stream
  // said so, or the build start's answer did): the theater says so
  // (2026-10-19). The count keeps a build stopped again and again from
  // starting forever.
  const [buildRestarted, setBuildRestarted] = useState(false);
  const buildRestartsRef = useRef(0);
  // Builds (design 0.6, change #9): the API did not start this build (3
  // previews before the first payment, or a failed payment). A card, not an error.
  const [buildLimit, setBuildLimit] = useState<BuildLimit | null>(() => (restoreOnly ? planReturn?.limit ?? null : null));
  // The build step that limit stopped: what runs again once a plan started
  // from the card comes back (startPlan, the return below).
  const limitStepRef = useRef<LimitedStep | null>(planReturn?.limited ?? null);
  const [growthPlan, setGrowthPlan] = useState<GrowthPlan | null>(null);
  // Set when the build's complete event says the store kept a currency of its own.
  const [storeCurrencyNote, setStoreCurrencyNote] = useState<string | null>(null);
  // The reveal: the drafted marketing + "what the team just did" (operate-preview).
  const [launchPost, setLaunchPost] = useState<{ platform: string; text: string } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [marketingTasks, setMarketingTasks] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [projectedReport, setProjectedReport] = useState<any>(null);
  const codeFilesRef = useRef<CodeFile[]>([]);
  const lastCodeCreepRef = useRef(0);
  const previewReloadTimerRef = useRef<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  useEffect(() => () => {
    if (previewReloadTimerRef.current !== null) window.clearTimeout(previewReloadTimerRef.current);
    eventSourceRef.current?.close();
  }, []);

  // Load the operator catalog once — team labels (titles/sigils/colors) come
  // from the API; without it every operator renders as a generic "Team member".
  const [operatorsLoaded, setOperatorsLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    onboardingApi
      .operators()
      .then((ops) => {
        if (cancelled) return;
        if (ops.length) setOperatorCatalog(ops);
        setOperatorsLoaded(true);
      })
      .catch(() => setOperatorsLoaded(true)); // fall back to neutral labels
    return () => { cancelled = true; };
  }, []);

  // A business that sells nothing online has no forecast step (stepsFor):
  // next and back walk past it.
  const isCommercial = !!analysis?.earningModel;
  const isCommercialRef = useRef(isCommercial);
  isCommercialRef.current = isCommercial;
  // A new design of the owner's site: the looks step goes back to its first step.
  const redesignWayRef = useRef(false);
  const go = useCallback((step: OnboardingStep) => setCurrentStep(step), []);
  const nextStep = useCallback(() => setCurrentStep((s) => nextStepOf(s, isCommercialRef.current)), []);
  const prevStep = useCallback(() => setCurrentStep((s) => (redesignWayRef.current && s === 'style' ? 'redesign' : prevStepOf(s, isCommercialRef.current))), []);

  /**
   * A draft the account already owns: signed in inside the "Start for $1"
   * sheet, the dashboard's claim saved it to the account, its anonymous key
   * went with the claim and its session id was put back. The API's start
   * resumes a draft by that key only (without it, a signed-in start opens a
   * new session, or meets the business cap), so this draft is continued as
   * it is: its own session, as the signed-in owner, never started again.
   */
  const ownedDraft = useCallback(() => host.identity.mode === 'draft' && host.identity.signedIn === true
    && !!onboardingApi.getSessionId() && !onboardingApi.getAnonId(), [host, onboardingApi]);

  // describe -> analyze the business, then move to the forecast
  const analyzeDescription = useCallback(async (override?: string, round = 0) => {
    // Still over the limit: sending again would only be refused again (and
    // count against the network). The button says when it unlocks.
    if (rateLimitedUntilRef.current !== null && rateLimitedUntilRef.current > Date.now()) return;
    setError(null);
    setHumanCheckFailed(false);
    setIsAnalyzing(true);
    let failed = false;
    try {
      // A draft the account owns already has its session (ownedDraft).
      if (!ownedDraft()) await onboardingApi.start();
      bindMemory(getSessionId());
      // The invisible widget may still be minting its token when a fast user
      // clicks Analyze - give it a few seconds instead of failing the gate.
      if (humanCheckOn && !turnstileTokenRef.current) {
        for (let waited = 0; waited < 6000 && !turnstileTokenRef.current; waited += 250) {
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      const text = override ?? description;
      // The round MUST go back. The server caps at clarifyRound < 1, so
      // omitting it meant every retry arrived as round 0, the cap never
      // engaged, and an unplaceable description was asked the identical
      // question forever with the suggestions branch unreachable.
      const result = await onboardingApi.analyze(text, turnstileTokenRef.current, round);
      // Read: a limit shown before (a plan started since) no longer stands.
      setBuildLimit(null);

      // analyze() has FOUR outcomes, not one. The classifier can decide it
      // cannot place the idea (asks one question), that the answer did not help
      // (offers suggestions), or that this is not something a WordPress stack
      // builds at all. This wizard has no screen for any of them: those screens
      // were built against the legacy funnel, which was deleted in 30b6436, so
      // they never reached the live route.
      //
      // Surfacing the message beats the alternative, which is reading
      // `.analysis` off a payload that does not carry it and rendering an empty
      // confirm step. Do not "simplify" this back into a destructure.
      if (isRefusal(result)) {
        setFeasibilityReason(result.feasibility?.reason || '');
        trackEvent('onboarding', 'unsupported_shown', result.feasibility?.projectType);
        setCurrentStep('unsupported');
        return;
      }
      if (needsClarification(result)) {
        setClarifyQuestion(result.question);
        setClarifyRound(result.clarifyRound);
        trackEvent('onboarding', 'clarify_shown');
        setCurrentStep('clarify');
        return;
      }
      if (needsSuggestions(result)) {
        // The one question did not place it either. The unsupported screen
        // already carries the suggestions, so reuse it rather than build a
        // third near-identical screen; the empty reason makes it read as "we
        // could not place this" instead of naming a capability we lack.
        setFeasibilityReason('');
        trackEvent('onboarding', 'suggestions_offered');
        setCurrentStep('unsupported');
        return;
      }
      const { analysis: a } = result;
      // The service layer and _pluginDefs describe the same API payload with two
      // parallel type declarations; bridge them at this boundary.
      setAnalysis(a as unknown as OnboardingAnalysis);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyA = a as any;
      setSelectedPages(((anyA.suggestedPages || []) as any[])
        .filter((pg) => pg && (pg.type || pg.slug))
        .map((pg) => ({ type: pg.type || pg.slug, title: pg.title || pg.type || pg.slug, include: true })));
      setSelectedPlugins(((anyA.suggestedPlugins || []) as any[])
        .filter((pl) => pl && pl.slug)
        .map((pl) => ({ slug: pl.slug, name: pl.name || pl.slug, include: true })));
      setConfirmStage(0);
      setConfirmMaxConfirmed(0);
      setCurrentStep('confirm');
    } catch (e) {
      // 3 previews built before the first payment, or a failed payment: a
      // card with the way on (See plans, Update your card), never an error.
      if (isBuildLimitError(e)) {
        setBuildLimit(e.limit);
        limitStepRef.current = 'analyze';
        trackEvent('onboarding', 'build_limit_shown', e.limit.status);
        return;
      }
      // At the business cap: the host's wall (it says why and how to add one).
      if (host.slots.BusinessCapWall && businessCapRefusal(e)) {
        setCapWall(true);
        return;
      }
      failed = true;
      const refused = refusalState(e, Date.now(), CONTEXT_COPY.readIdeaFailed, errorMessage);
      setError(refused.message);
      setHumanCheckFailed(refused.humanCheckFailed);
      if (refused.rateLimitedUntil !== null) setRateLimitedUntil(refused.rateLimitedUntil);
      if (refused.humanCheckFailed) trackEvent('onboarding', 'human_check_failed');
      if (refused.rateLimitedUntil !== null) trackEvent('onboarding', 'rate_limited', 'analyze');
    } finally {
      // A bot-check token is good for one check. After a refusal the next
      // try needs a fresh one, never the one just spent: drop it and have the
      // widget mint a new one now, so it is ready by the time they retry.
      if (failed) {
        setTurnstileToken(null);
        setTurnstileResetKey((k) => k + 1);
      }
      setIsAnalyzing(false);
    }
  }, [description, turnstileToken, setTurnstileToken, humanCheckOn, host, onboardingApi, trackEvent, ownedDraft]);

  /** The error's "Try again" after the bot check said no. The widget was
   *  reset when the refusal came back, so a fresh check is already running;
   *  analyze waits a few seconds for its token before it sends. */
  const retryHumanCheck = useCallback(() => {
    setHumanCheckFailed(false);
    setError(null);
    void analyzeDescription();
  }, [analyzeDescription]);

  /**
   * Send the original description PLUS the answer as one description, so the
   * analyzer reads the answer in the context of what it was asked about rather
   * than in isolation. clarifyRound goes back so the server can stop asking:
   * a second unhelpful question is worse than an imperfect build they can edit.
   */
  const answerClarify = useCallback(async (answer: string) => {
    trackEvent('onboarding', 'clarify_answered');
    const combined = `${description.trim()}\n\n${clarifyQuestion} ${answer}`;
    // Both halves go back as ONE description so the analyzer reads the answer in
    // the context of the original. Passed explicitly rather than through state:
    // setDescription does not apply until the next render, so analyzing after it
    // would re-send the original text and ask the identical question again.
    setDescription(combined);
    setCurrentStep('describe');
    await analyzeDescription(combined, clarifyRound);
  }, [description, clarifyQuestion, clarifyRound, analyzeDescription]);

  /**
   * Back to the box, with what they wrote still in it.
   *
   * This does NOT build. It cannot: the server reached this screen precisely
   * because it could not place the description, and asking it again with the
   * same text returns the same question. The button used to say "skip, just
   * build something", which promised a build that never happened. Rewriting is
   * the honest escape, and the description is preserved so they edit rather
   * than start from an empty box.
   */
  const skipClarify = useCallback(() => {
    trackEvent('onboarding', 'clarify_skipped');
    setCurrentStep('describe');
  }, []);

  /** Never throws for the caller: the idea is already recorded server-side. */
  const leaveRoadmapEmail = useCallback(async (email: string) => {
    await onboardingApi.leaveRoadmapEmail(email, description);
  }, [description]);

  /** A suggestion chip: seed the box and put them back on describe. */
  const startOver = useCallback((seed: string) => {
    setDescription(seed);
    setFeasibilityReason('');
    setCurrentStep('describe');
  }, []);

  // Why the API keeps no plan, when that is by design: 'not_commercial' for a
  // business that sells nothing online (the forecast step then moves on
  // instead of saying it could not finish one).
  const [planReason, setPlanReason] = useState<string | null>(null);

  // forecast (CFO): idempotent load of the business plan
  const ensureBusinessPlan = useCallback(async () => {
    if (businessPlan) return businessPlan;
    setIsLoadingPlan(true);
    try {
      const { businessPlan: bp, reason } = await onboardingApi.forecast();
      setBusinessPlan(bp);
      setPlanReason(bp ? null : reason ?? null);
      // Made: a limit the plan met before (a plan started since) no longer
      // stands. Another step's limit still does.
      if (limitStepRef.current === 'plan') setBuildLimit(null);
      return bp;
    } catch (e) {
      // The draft's build is used up (or a plan limit): the card with the way on.
      if (isBuildLimitError(e)) {
        setBuildLimit(e.limit);
        limitStepRef.current = 'plan';
        trackEvent('onboarding', 'build_limit_shown', e.limit.status);
        return null;
      }
      setError(onboardingErrorText(e, CONTEXT_COPY.forecastFailed));
      return null;
    } finally {
      setIsLoadingPlan(false);
    }
  }, [businessPlan]);

  // Which of the three lines the owner settled on. Held here, not in the
  // step, because the step remounts on every navigation and because this is
  // the value that has to leave the browser.
  const [forecastScenario, setForecastScenarioState] = useState<string>(() => planReturn?.forecastScenario ?? 'expected');
  const setForecastScenario = useCallback((sc: string) => setForecastScenarioState(sc), []);
  // The forecast step reveals its sections one Continue at a time; the shell's
  // footer sign-up CTA stays hidden until the owner has walked through them
  // all (set true by the last reveal, reset on re-entry).
  const [forecastRevealDone, setForecastRevealDone] = useState(false);

  /**
   * Saving the plan: "Looks good" on the forecast step, "Confirm products"
   * on the products card, and both steps' debounced autosave.
   *
   * It used to send only the accepted scenario, so the owner's own edits
   * (the lineup's names, prices and ticks, the forecast's numbers) died in
   * the browser and the store was built with the original lineup.
   * Now every edit (editBusinessPlan) bumps a version, and a save
   * sends the plan on the screen whenever it is newer than the last one
   * saved, with the scenario, on the session's own business-plan request
   * (anonymous-friendly; the API sanitizes it like the signed-in edit). The
   * plan and the scenario are read when the write leaves the queue, so the
   * newest edit always goes out, and nothing unchanged is sent twice. The
   * answer (the plan as saved) replaces the one on screen only on a final
   * save (the card or the step closing) with no newer edit since: never
   * under the owner's typing. A failure leaves the marks, so the next save
   * retries. It never throws: a save must not be able to block the funnel.
   */
  const sentScenarioRef = useRef<string | null>(null);
  const forecastScenarioRef = useRef(forecastScenario);
  forecastScenarioRef.current = forecastScenario;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const businessPlanRef = useRef<any>(businessPlan);
  businessPlanRef.current = businessPlan;
  const planVersionRef = useRef(0);
  const savedPlanVersionRef = useRef(0);
  /** An edit by the owner (the lineup, the forecast): what the next save sends. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editBusinessPlan = useCallback((next: any) => {
    planVersionRef.current += 1;
    businessPlanRef.current = next;
    setBusinessPlan(next);
  }, []);

  /*
   * Writes to the session's plan go one at a time: the accepted scenario
   * below and the store currency change further down. The API saves a
   * scenario by writing back the whole plan as it read it, so a scenario save
   * that overlapped a currency change could put the old currency's prices
   * back under the new currency (a lineup approved at EUR 29.00 would then
   * sell at JPY 29). Each write starts once the one before it has landed,
   * and the site build starts after the last (startGeneration).
   */
  const planWritesRef = useRef<Promise<unknown>>(Promise.resolve());
  const queuePlanWrite = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const run = planWritesRef.current.then(work);
    planWritesRef.current = run.catch(() => undefined);
    return run;
  }, []);

  const saveBusinessPlan = useCallback(async (opts?: { final?: boolean }) => {
    try {
      await queuePlanWrite(async () => {
        const scenario = forecastScenarioRef.current;
        const version = planVersionRef.current;
        const plan = businessPlanRef.current;
        // A business that sells nothing online has no plan to save a scenario on.
        if (!plan && !isCommercialRef.current) return;
        const planChanged = !!plan && version !== savedPlanVersionRef.current;
        if (!planChanged && sentScenarioRef.current === scenario) return;
        try {
          const r = await onboardingApi.forecast(scenario, planChanged ? plan : undefined);
          sentScenarioRef.current = scenario;
          if (!planChanged) return;
          savedPlanVersionRef.current = version;
          if (opts?.final && r?.businessPlan && planVersionRef.current === version) {
            businessPlanRef.current = r.businessPlan;
            setBusinessPlan(r.businessPlan);
          }
        } catch (e) {
          if (planChanged && storeCurrencyRefusalOf(e, '').code === 'BUILD_STARTED') {
            // The build already has its lineup: the card locks and shows the
            // lineup the store is really built with.
            savedPlanVersionRef.current = version;
            setStoreCurrencyLocked(true);
            const stored = await onboardingApi.forecast().catch(() => null);
            if (stored?.businessPlan && planVersionRef.current === version) {
              businessPlanRef.current = stored.businessPlan;
              setBusinessPlan(stored.businessPlan);
            }
            return;
          }
          throw e;
        }
      });
    } catch {
      // The marks stay: the next save (or the build's own) tries again.
    }
  }, [queuePlanWrite]);

  /*
   * Store currency. The store sells in the
   * currency the owner sees here: the plan's, which comes from their country.
   * The products card says it inline ("Prices in euros (EUR)" with Change);
   * a change converts the plan's prices at today's rate on the API, which
   * answers with the converted plan, and that plan replaces this one, so the
   * lineup, the preview and the forecast all follow. Once the site build
   * started, the build's currency is settled: the line locks and points to
   * the business page, where a live store's currency is changed with Keep or
   * Convert.
   */
  const [storeCurrencyLocked, setStoreCurrencyLocked] = useState(false);
  const storeCurrencyLockedRef = useRef(false);
  storeCurrencyLockedRef.current = storeCurrencyLocked;
  const [storeCurrencyChange, setStoreCurrencyChange] = useState<{ saving: boolean; message: string | null; error: string | null }>(
    { saving: false, message: null, error: null },
  );
  const storeCurrencySavingRef = useRef(false);
  // `force`: the session takes the currency even when the plan is already in
  // it (a WordPress store just moved into it: the session's store currency
  // must say so too).
  const changeStoreCurrency = useCallback(async (code: string, opts?: { force?: boolean }) => {
    const to = normalizeCurrencyCode(code);
    const plan = businessPlanRef.current;
    if (!to || storeCurrencyLockedRef.current || storeCurrencySavingRef.current) return;
    if (!opts?.force && plan && normalizeCurrencyCode(plan.currency) === to) return;
    storeCurrencySavingRef.current = true;
    setStoreCurrencyChange({ saving: true, message: null, error: null });
    try {
      // After any plan write in flight (queuePlanWrite). The plan on screen
      // when it is sent goes along, so the owner's own edits are what get
      // converted, and saved: the converted plan is the saved one.
      const r = await queuePlanWrite(async () => {
        const answer = await storeCurrencyApi.changeOnboarding(to, businessPlanRef.current);
        if (answer.businessPlan) {
          // The converted plan is on the session and on the screen.
          savedPlanVersionRef.current = planVersionRef.current;
          businessPlanRef.current = answer.businessPlan;
          setBusinessPlan(answer.businessPlan);
        }
        return answer;
      });
      const list = await storeCurrencyApi.list();
      setStoreCurrencyChange({
        saving: false,
        // A rate that is not today's says its day (never "today's rate").
        message: r.conversion ? pricesConvertedLine(currencyName(r.conversion.from, list), r.conversion.rateText, r.conversion) : null,
        error: null,
      });
      trackEvent('onboarding', 'store_currency_changed', to);
    } catch (e) {
      const refusal = storeCurrencyRefusalOf(e, STORE_CURRENCY_COPY.confirmFailed);
      if (refusal.code === 'BUILD_STARTED') {
        // The build already has its currency: the line says so and points on.
        setStoreCurrencyLocked(true);
        setStoreCurrencyChange({ saving: false, message: null, error: null });
        return;
      }
      setStoreCurrencyChange({
        saving: false,
        message: null,
        // Only sentences written for this step: the API's words for another
        // refusal ("Access denied") are not what the owner should read here.
        error: refusal.code === 'UNSUPPORTED_CURRENCY' ? STORE_CURRENCY_COPY.unsupported
          : requestProblem(e).kind === 'human_check' ? REQUEST_PROBLEM.humanCheck
            : STORE_CURRENCY_COPY.confirmFailed,
      });
    } finally {
      storeCurrencySavingRef.current = false;
    }
  }, [queuePlanWrite]);

  // style — design directions. `regenerate` is the explicit reroll only:
  // default step (re-)entry must not send it — reuse is free server-side,
  // rerolls are the expensive image calls (capped per session with a 429,
  // and with a plan only: a 402 plan_required).
  // Back from a plan, the direction picked before stays picked once they load.
  const preferredConceptRef = useRef<string | null>(planReturn?.conceptId ?? null);
  // While the wizard is mounted (true from the first render: a step's own
  // effects run before this provider's): a wait for the directions stops
  // once the wizard is gone.
  const wizardAliveRef = useRef(true);
  useEffect(() => {
    wizardAliveRef.current = true;
    return () => { wizardAliveRef.current = false; };
  }, []);
  const fetchDesignConcepts = useCallback(async (regenerate = false): Promise<ConceptsOutcome> => {
    if (!analysis) return 'skipped';
    setIsLoadingConcepts(true);
    setError(null);
    try {
      // A job on the API: the step waits for as long as the
      // server works on the directions (a reload joins the same job), and
      // stops waiting once the wizard is gone.
      const { concepts, rerolls: rerollState } = await onboardingApi.designConcepts(
        description,
        analysis.siteType || 'business',
        analysis.industry,
        { ...(regenerate ? { regenerate: true } : {}), stillWanted: () => wizardAliveRef.current },
      );
      setDesignConcepts(concepts as unknown as DesignConcept[]);
      setRerolls(rerollState);
      // Made: a limit these directions met before (a plan started since) no
      // longer stands. A site build's or a plan's limit still does.
      if (limitStepRef.current === 'concepts') setBuildLimit(null);
      const preferred = preferredConceptRef.current;
      preferredConceptRef.current = null;
      const c = (preferred && concepts.find((x) => x.id === preferred)) || concepts[0];
      if (c) {
        setSelectedDesignSystem({ id: c.id, name: c.name, cssVariables: c.cssVariables, designSystem: c.designSystem, preview: c.preview, directionName: c.directionName, logo: c.logo, image: c.image });
      }
      return 'ok';
    } catch (e) {
      // The wizard went away while it waited: nothing to show.
      if (isAiStepStopped(e)) return 'skipped';
      if (isBuildLimitError(e)) {
        setBuildLimit(e.limit);
        limitStepRef.current = 'concepts';
        trackEvent('onboarding', 'build_limit_shown', e.limit.status);
        return 'limited';
      }
      // Other directions come with a plan: the current ones stay, and the
      // step says so under its button (which then opens the host's sheet).
      const planRequired = regenerate ? rerollPlanRequiredOf(e) : null;
      if (planRequired) {
        setRerolls({ allowed: false, left: 0, firstWeekAvailable: planRequired.firstWeekAvailable });
        trackEvent('onboarding', 'rerolls_plan_required');
        return 'plan_required';
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = (e as any)?.response;
      if (regenerate && res?.status === 429) {
        // The per-session reroll cap: keep the current set and surface the
        // note inline; the step disables further rerolls.
        setRerollNotice(typeof res?.data?.error === 'string' && res.data.error
          ? res.data.error
          : CONTEXT_COPY.rerollsLimited);
      } else {
        setError(onboardingErrorText(e, CONTEXT_COPY.directionsFailed));
      }
      return 'failed';
    } finally {
      setIsLoadingConcepts(false);
    }
  }, [analysis, description]);

  const selectDesignConcept = useCallback((c: DesignConcept) => {
    // `image` (genstudio's full-page mock) rides along so the committed
    // selection drives the preview pane the same way the hover path does.
    setSelectedDesignSystem({ id: c.id, name: c.name, cssVariables: c.cssVariables, designSystem: c.designSystem, preview: c.preview, directionName: c.directionName, logo: c.logo, image: c.image });
    // Persist eagerly — the backend theme build reads the session's selection.
    void onboardingApi.selectStyle(c.id).catch(() => {});
  }, []);

  // Debounced remount of the static preview: rapid back-to-back page
  // completions collapse into one reload ~3s after the last one.
  const schedulePreviewReload = useCallback(() => {
    if (previewReloadTimerRef.current !== null) window.clearTimeout(previewReloadTimerRef.current);
    previewReloadTimerRef.current = window.setTimeout(() => {
      previewReloadTimerRef.current = null;
      setSitePreviewReloadKey((k) => k + 1);
    }, 3000);
  }, []);

  /**
   * Attach to the site-build SSE and drive both the theater and the preview
   * ladder until the terminal event. Same `{type, data}` grammar as the
   * plugin's generate stream — the theater events go through the shared
   * processTheaterEvent; only the flow events are handled here:
   *   preview_ready → the static serving of the real site replaces the mock;
   *   code done     → debounced static-preview remount (fresh pages);
   *   attach.replay → reset code windows so a journal replay can't double them;
   *   reconnect → the API is moving to its updated copy: re-attach at once;
   *   build_interrupted → an update stopped the build: resolve, to start it again;
   *   complete/error → resolve.
   */
  const runSiteBuildStream = useCallback((sessionId: string, firstTicket: string, previewToken: string | null) =>
    new Promise<{ ok: boolean; wpReady?: boolean; error?: string; refused?: boolean; interrupted?: boolean; bundle?: { url: string; sha256: string; bytes: number } }>((resolve) => {
      let finished = false;
      let reconnects = 0;
      const finish = (r: { ok: boolean; wpReady?: boolean; error?: string; refused?: boolean; interrupted?: boolean; bundle?: { url: string; sha256: string; bytes: number } }) => {
        if (finished) return;
        finished = true;
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        resolve(r);
      };
      const lost = () => finish({ ok: false, error: 'Lost the connection to the build. Please try again.' });
      // A fresh ticket (30 s) and the stream again: the run keeps going
      // server-side and the journal replays what was missed.
      const reattach = (failed: () => void) => {
        onboardingApi.ticket()
          .then((t) => {
            if (finished) return;
            if (t?.ticket) open(t.ticket);
            else failed();
          })
          .catch(() => { if (!finished) failed(); });
      };
      // A lost connection: another try after a pause, five at most.
      const retry = () => {
        if (reconnects >= 5) {
          lost();
          return;
        }
        reconnects += 1;
        window.setTimeout(() => {
          if (!finished) reattach(lost);
        }, 1500);
      };
      const open = (ticket: string) => {
        const es = new EventSource(onboardingApi.siteBuildEventsUrl(ticket, sessionId));
        eventSourceRef.current = es;
        es.onmessage = (event) => {
          try {
            const eventData = JSON.parse(event.data);
            if (isTheaterEventType(eventData.type)) {
              const up = processTheaterEvent(eventData, codeFilesRef, lastCodeCreepRef);
              if (up) setTheater(up);
              // A finished page means the static site just gained (or
              // updated) a page — refresh the preview once things settle.
              if (eventData.type === 'code' && eventData.data?.done) schedulePreviewReload();
            } else if (eventData.type === 'preview_ready') {
              // The homepage landed: from here the pane shows the ACTUAL
              // site (multi-page static serving), not the mock picture.
              const path = eventData.data?.url;
              if (typeof path === 'string' && path && previewToken) {
                setSitePreviewUrl(onboardingApi.sitePreviewUrl(path, previewToken));
              }
            } else if (eventData.type === 'attach') {
              // A (re)attach replays the journal, including one consolidated
              // code event per file — clear the windows so replayed content
              // doesn't append onto what an earlier connection already wrote.
              if (eventData.data?.replay) codeFilesRef.current = [];
            } else if (eventData.type === 'reconnect') {
              // The API is moving to its updated copy and ends this stream;
              // the build goes on there (2026-10-19). Re-attach at once: no
              // pause, and not one of the tries a lost connection gets.
              es.onerror = null;
              es.close();
              reattach(retry);
            } else if (eventData.type === 'build_interrupted') {
              // An update stopped the build: the build start begins it again
              // (free for the visitor) and the stream attaches to that run.
              finish({ ok: false, interrupted: true, error: 'the build was stopped by an update' });
            } else if (eventData.type === 'complete') {
              // NOT "ready" yet: the wizard presents completion only when the
              // in-browser WordPress answers (or fails open). Hold just under
              // the top while the Playground applies the compiled site — the
              // readiness effect sets 100 and flips the step.
              setTheater((prev) => ({
                ...prev,
                progress: 97,
                displayProgress: Math.max(prev.displayProgress, 97),
                progressMessage: CONTEXT_COPY.preparingPreview,
              }));
              const b = eventData.data?.bundle;
              // A build into a store that already sells in another currency
              // says so (store currency contract 10.5); the closing screen shows it.
              const note = eventData.data?.recap?.storeCurrencyNote ?? eventData.data?.storeCurrencyNote;
              if (typeof note === 'string' && note.trim()) setStoreCurrencyNote(note.trim());
              finish({
                ok: eventData.data?.success !== false,
                wpReady: !!eventData.data?.wp_ready,
                ...(b && typeof b.url === 'string' && b.url ? { bundle: { url: b.url, sha256: String(b.sha256 || ''), bytes: Number(b.bytes) || 0 } } : {}),
              });
            } else if (eventData.type === 'error') {
              finish({
                ok: false,
                error: eventData.data?.error || eventData.data?.message || CONTEXT_COPY.buildFailedEvent,
                refused: errorEventRefused(eventData.data),
              });
            }
          } catch { /* malformed frame — skip it */ }
        };
        es.onerror = () => {
          // EventSource retries by itself for transient blips, but its URL
          // carries a 30s ticket — once that expires the retry dies with the
          // source CLOSED. The run keeps going server-side and the journal
          // replays what was missed, so re-mint a ticket and re-attach
          // instead of declaring a minutes-long build dead.
          if (finished || es.readyState !== EventSource.CLOSED) return;
          es.close();
          retry();
        };
      };
      open(firstTicket);
    }), [schedulePreviewReload]);

  // style -> generate: the engine builds the picked direction's REAL site.
  // The pane ladder: the concept's mock (instant) → the static serving of the
  // actual site (preview_ready) → in-browser WordPress (complete{wp_ready}).
  const buildDoneRef = useRef(false);
  // The run's build was not started (a limit, or high demand): the wizard is
  // back on the step it came from, and nothing moves it on to the theater or
  // the success screen.
  const stoppedRef = useRef(false);
  const startGeneration = useCallback(async (opts?: { retry?: boolean; resume?: boolean; restarted?: boolean }): Promise<void> => {
    const retry = !!opts?.retry;
    // A reload during the build (or after it) attaches to the session's
    // build: the site-build call answers alreadyBuilt or running and the
    // stream replays its journal. Nothing new is asked for (no style save,
    // no plan save, no second round of the team's drafts), and the WhatsApp
    // interlude is not shown again.
    const resume = !!opts?.resume;
    // The stream said an update stopped the build: this resume begins it
    // again, and the theater says so from the start.
    const restarted = !!opts?.restarted;
    if (!restarted) buildRestartsRef.current = 0;
    setBuildRestarted(restarted);
    // The raw engine error stays in the console; the visitor gets words and
    // a way forward.
    const fail = (detail?: string) => {
      if (detail) console.warn('[onboarding] site build failed:', detail);
      buildFailedRef.current = true;
      setBuildFailed(CONTEXT_COPY.buildFailed);
    };
    buildFailedRef.current = false;
    setBuildFailed(null);
    // A new run: a limit or high demand shown before (a plan started since)
    // is the run's to say again.
    stoppedRef.current = false;
    setBuildLimit(null);
    setHighDemand(null);
    setWpPreviewError(null);
    setWpAttempt((n) => n + 1);
    // The plugin's hidden WhatsApp interlude: the build starts NOW and runs
    // underneath while the user (optionally) leaves their number. A retry
    // goes straight back to the theater.
    buildDoneRef.current = false;
    setBuildDone(false);
    setBuildRefused(false);
    setWpPreview('idle');
    // A build started again stays where the visitor is (the theater, or
    // the WhatsApp interlude in front of it).
    if (!restarted) setCurrentStep(retry || resume ? 'generating' : 'whatsapp');
    setIsGenerating(true);
    // Fresh theater per run.
    codeFilesRef.current = [];
    lastCodeCreepRef.current = 0;
    setTheater(initialTheaterState());
    // Seed the pane with the picked concept's mock — an interim picture while
    // the engine writes the homepage (preview_ready then replaces it).
    if (selectedDesignSystem?.image) setMockPreview(selectedDesignSystem.image);
    try {
      // The build reads the picked concept FROM THE SESSION — make sure the
      // current selection is persisted before generating (covers the default
      // first-concept case where the user never clicked a card).
      if (selectedDesignSystem?.id && !resume) {
        await onboardingApi.selectStyle(selectedDesignSystem.id).catch(() => {});
      }
      // A plan write still in flight (a store currency change, the accepted
      // scenario, the owner's edits) lands first, and an edit not saved yet
      // (a save that failed) gets one more try: the build reads the plan and
      // its currency from the session, and must read the ones on the
      // owner's screen.
      if (!resume) {
        await saveBusinessPlan();
        await planWritesRef.current;
      }
      // Kick the engine build; operate-preview (team/report) runs alongside.
      // A retry keeps the team/report it already has (no second round of
      // operate calls for the same business).
      // A new design of a site that already runs launches nothing: no team drafts.
      const opPromise = retry || resume || redesignWayRef.current ? Promise.resolve(null) : onboardingApi.operatePreview().catch(() => null);
      const build = await onboardingApi.siteBuild({ retry }).catch(() => null);
      // The build was stopped by an update and started again (a reload
      // after it, too): the one line in the theater.
      if (build?.resumed === true) setBuildRestarted(true);
      // A build the API did not start is said at once (the team's drafts are
      // not waited for), and never on the success screen: nothing was built, so nothing is ready or live. The wizard
      // goes back to the step where Generate Site was pressed (the idea, for
      // a run that reattached after a reload), with the card above it, as
      // every other refusal shows its card on its step; the pane keeps the
      // picked style. No Playground is coming.
      const stoppedOn: OnboardingStep = resume ? 'describe' : 'style';
      const limit = buildLimitOf(build);
      if (limit) {
        // A build a limit stopped (a day or a month of this browser, the
        // account's free build, or a failed payment): the card with its way on.
        setBuildLimit(limit);
        limitStepRef.current = 'build';
        trackEvent('onboarding', 'build_limit_shown', limit.status);
        stoppedRef.current = true;
        setIsGenerating(false);
        setCurrentStep(stoppedOn);
        return;
      }
      // Building (or queued on the waiting list): the site is made in the
      // currency the owner confirmed, so the confirm step's line locks.
      if (build) setStoreCurrencyLocked(true);
      // A reload from here on attaches to this build (boot, below).
      if (build && build.status !== 'high_demand') rememberUI({ buildStarted: true });
      if (build?.status === 'high_demand') {
        // The build fences answered instead of building (a business condition,
        // not an error): the email-capture card, above the step it came from
        // (OnboardingShell). The waiting list builds it later.
        setHighDemand({
          message: build.message || HIGH_DEMAND_FALLBACK.text,
        });
        stoppedRef.current = true;
        setIsGenerating(false);
        setCurrentStep(stoppedOn);
        return;
      }
      const op = await opPromise;
      if (op?.growthPlan) setGrowthPlan(op.growthPlan);
      if (op?.launchPost?.text) setLaunchPost(op.launchPost);
      if (op?.marketingTasks?.length) setMarketingTasks(op.marketingTasks);
      if (op?.projectedReport) setProjectedReport(op.projectedReport);
      // A private WordPress site is made for this build (the hosted
      // preview): nothing in-browser starts. Never on the WordPress plugin's
      // own wizard, which ends on the static copy as before.
      const hosted = build?.hosted_preview === true && host.identity.mode !== 'site';
      setHostedPreview(hosted);
      setHostedPreviewUrl(null);
      setHostedPreviewEnded(false);
      // The final instance's predicted plugin set: the pane preboots the
      // Playground with it during generation. Forms ship on effectively
      // every generated site, so the fallback still preboots WPForms.
      if (!hosted) {
        setPredictedPlugins(
          Array.isArray(build?.predicted_plugins) && build.predicted_plugins.length
            ? build.predicted_plugins.map(String)
            : ['wpforms-lite'],
        );
      }
      const sessionId = getSessionId();
      if (!build || !sessionId) {
        fail('could not start the site build');
      } else {
        // Started, alreadyBuilt or an existing run: all mean "open the event
        // stream". The server replays its journal, and an already-built
        // session completes instantly — re-entry costs nothing.
        const t = await onboardingApi.ticket().catch(() => null);
        if (!t?.ticket) {
          fail('could not open the build stream');
        } else {
          // The hosted preview is read with the static preview's token.
          if (hosted && t.previewToken) setHostedPreviewToken(t.previewToken);
          const done = await runSiteBuildStream(sessionId, t.ticket, t.previewToken);
          if (done.interrupted && buildRestartsRef.current < BUILD_RESTARTS_MAX) {
            // An update of the API stopped the build: the build start begins
            // it again through the resume (free for the visitor), and the
            // stream attaches to the new run. A few times in a row at most,
            // then the error with Try Again.
            buildRestartsRef.current += 1;
            return startGeneration({ resume: true, restarted: true });
          }
          if (done.ok && t.previewToken) {
            // The already-built fast path answers `complete` with no
            // preview_ready — the static path is deterministic, so make sure
            // the pane has the actual site either way.
            const tok = t.previewToken;
            setSitePreviewUrl((prev) => prev ?? onboardingApi.sitePreviewUrl(`/onboarding/site-preview/${sessionId}/`, tok));
          }
          if (done.ok && done.wpReady && t.previewToken && playgroundComing && !hosted) {
            // Compile finished: the Playground applier can fetch the WP
            // bundle and assemble the real WordPress behind the static pane.
            // Completion now WAITS on it: the readiness effect flips the
            // step when the front page answers, or the fail-open timer
            // unlocks the static preview instead. A host without the
            // in-browser WordPress never waits: it ends on the static preview.
            if (done.bundle) setWpBundleZip(done.bundle);
            setWpBundleToken(t.previewToken);
            setWpPreview('preparing');
          }
          if (!done.ok) {
            // A refused build (the API will not build it: already built, or
            // retryable:false) is an answer, not a failure: keep whatever the
            // ladder reached and let the shell's error banner say it. Any
            // other error keeps the wizard on this step with a real retry.
            setBuildRefused(!!done.refused);
            if (done.refused) setError(done.error || CONTEXT_COPY.buildProblem);
            else fail(done.error || 'the build stream ended in an error');
          }
        }
      }
      setBuildDone(true);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'unexpected error');
      setBuildDone(true);
    }
  }, [selectedDesignSystem, runSiteBuildStream, saveBusinessPlan]);

  // The hosted preview: asked every few seconds until the real site is ready
  // (the pane frames it), unavailable (the static copy stays) or 40 minutes
  // went by (the fleet may grow for it first). A failed read asks again.
  useEffect(() => {
    if (!hostedPreview || !hostedPreviewToken || hostedPreviewUrl) return;
    let stopped = false;
    let timer: number | undefined;
    const startedAt = Date.now();
    const ask = async () => {
      if (stopped) return;
      const view = await onboardingApi.hostedPreview(hostedPreviewToken).catch(() => null);
      if (stopped) return;
      if (view?.state === 'ready' && view.url) {
        setHostedPreviewUrl(view.url);
        return;
      }
      if (view?.state === 'unavailable' || Date.now() - startedAt > HOSTED_PREVIEW_WAIT_MS) {
        setHostedPreviewEnded(true);
        return;
      }
      timer = window.setTimeout(() => { void ask(); }, HOSTED_PREVIEW_POLL_MS);
    };
    void ask();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [hostedPreview, hostedPreviewToken, hostedPreviewUrl, onboardingApi]);

  // WP-gated completion: the generation presents as finished only when the
  // in-browser WordPress answers ('live'), fails open ('failed'), or was
  // never coming ('idle': errors, high demand, wp_ready-less completes).
  const wpSettled = wpPreview === 'live' || wpPreview === 'failed';
  const generationReady = buildDone && (wpPreview === 'idle' || wpSettled);
  useEffect(() => {
    if (!generationReady) return;
    buildDoneRef.current = true; // waAdvance reads the ref on the WhatsApp interlude
    setIsGenerating(false);
    setTheater((prev) => ({ ...prev, progress: 100, displayProgress: 100, progressMessage: CONTEXT_COPY.siteReady }));
    // Still on the WhatsApp interlude? Stay — waAdvance jumps to success.
    // Anywhere else in the generation flow? Reveal now. A failed build stays
    // on the generating step, where the error card offers the retry.
    setCurrentStep((s) => (s === 'whatsapp' ? s : (buildFailedRef.current ? 'generating' : 'success')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generationReady]);

  // Never the success screen over a build that was not started, whatever
  // led there: back to where it was asked for.
  useEffect(() => {
    if (currentStep === 'success' && (buildLimit || highDemand)) setCurrentStep(analysis ? 'style' : 'describe');
  }, [currentStep, buildLimit, highDemand, analysis]);

  // The in-browser WordPress failed: the wizard stops on the generating
  // step's error card with the reason, never on the static preview. The site
  // itself is built and saved; Try Again (retryWpPreview) only starts the
  // WordPress preview again.
  const failWpPreview = useCallback((error: unknown) => {
    const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    const reason = raw.trim().replace(/\s+/g, ' ').slice(0, 300) || CONTEXT_COPY.wpStopped;
    console.warn('[onboarding] the in-browser WordPress preview failed:', error);
    buildFailedRef.current = true;
    setWpPreviewError(reason);
    setBuildFailed(CONTEXT_COPY.wpPreviewFailed(reason.replace(/[.\s]+$/, '')));
    setWpPreview('failed');
  }, []);
  const retryWpPreview = useCallback(() => {
    buildFailedRef.current = false;
    setBuildFailed(null);
    setWpPreviewError(null);
    setWpAttempt((n) => n + 1);
    setWpPreview('preparing');
  }, []);

  // A Playground that HANGS must never dead-end the wizard, but a Playground
  // that is WORKING may legitimately take minutes (the apply replays
  // media/pages/products through WASM PHP). So the trigger is SILENCE, not
  // total duration: the applier heartbeats on every step, and only 150s
  // without one stops it with an error.
  const wpBeatRef = useRef(0);
  const wpPreviewBeat = useCallback(() => {
    wpBeatRef.current = Date.now();
  }, []);
  useEffect(() => {
    if (!(buildDone && wpPreview === 'preparing')) return;
    wpBeatRef.current = Date.now(); // the wait just began — arm fresh
    const iv = window.setInterval(() => {
      if (Date.now() - wpBeatRef.current > 150_000) {
        failWpPreview(new Error(CONTEXT_COPY.wpSilent));
      }
    }, 10_000);
    return () => window.clearInterval(iv);
  }, [buildDone, wpPreview, failWpPreview]);

  // Leaving the WhatsApp interlude: theater if the build is still running,
  // straight to the reveal when it already finished.
  const waAdvance = useCallback(() => {
    // A build that was not started already put the visitor back (startGeneration).
    if (stoppedRef.current) return;
    setCurrentStep(buildDoneRef.current && !buildFailedRef.current ? 'success' : 'generating');
  }, []);

  // Save the captured number on the session (pre-signup; linking is post-signup),
  // with the picker's country, so a national number keeps its country code.
  const whatsappCapture = useCallback(async (fullNumber: string, country?: string) => {
    await onboardingApi.saveWhatsappIntent(fullNumber, country);
  }, [onboardingApi]);

  // ── Confirm accordion machinery (mirrors the plugin's) ──────────────────
  const confirmCardCount = analysis?.earningModel ? 5 : 4;
  const confirmComplete = confirmMaxConfirmed >= confirmCardCount;
  const confirmAdvance = useCallback(() => {
    setConfirmStage((stage) => {
      const cur = stage ?? 0;
      const newMax = Math.max(confirmMaxConfirmed, cur + 1);
      setConfirmMaxConfirmed(newMax);
      return newMax < confirmCardCount ? newMax : null;
    });
  }, [confirmMaxConfirmed, confirmCardCount]);
  const confirmEditCard = useCallback((index: number) => setConfirmStage(index), []);
  const confirmStepBack = useCallback((): boolean => {
    if (confirmStage === null) { setConfirmStage(confirmCardCount - 1); return true; }
    if (confirmStage > 0) { setConfirmStage(confirmStage - 1); return true; }
    return false;
  }, [confirmStage, confirmCardCount]);

  // Analysis edits from the confirm card (brand name / one-liner).
  const setSiteName = useCallback((name: string) => {
    setAnalysis((prev) => (prev ? { ...prev, siteName: name } : prev));
  }, []);
  const setSiteSummary = useCallback((summary: string) => {
    setAnalysis((prev) => (prev ? { ...prev, siteSummary: summary } : prev));
  }, []);
  // "Site language" on the confirm step: the language the API now holds for
  // the session (transport.setSiteLanguage answered it).
  const setAnalysisLanguage = useCallback((language: string) => {
    setAnalysis((prev) => (prev ? { ...prev, language, languageQuestion: null } : prev));
  }, []);
  // The whole answer of a language choice: the language, and
  // the summary, the pages' titles and the plan the API wrote again in it, so
  // the step never shows the old language's words after a choice or a Change.
  // The owner's own page names and choices (included, renamed) stay.
  const applySiteLanguage = useCallback((answer: SiteLanguageAnswer) => {
    setAnalysis((prev) => (prev ? analysisWithLanguage(prev, answer) : prev));
    setSelectedPages((prev) => pagesWithLanguage(prev, answer));
    if (answer?.businessPlan && typeof answer.businessPlan === 'object') setBusinessPlan(answer.businessPlan);
  }, []);
  // The language question is open while the analysis asks it and this host
  // can answer it (its transport sets the language, the session exists).
  const siteLanguagePending = Array.isArray(analysis?.languageQuestion?.options)
    && (analysis!.languageQuestion!.options.length > 0)
    && typeof host.transport.setSiteLanguage === 'function'
    && !!getSessionId();
  const togglePage = useCallback((type: string) => {
    setSelectedPages((prev) => prev.map((pg) => (pg.type === type ? { ...pg, include: !pg.include } : pg)));
  }, []);
  const updatePageTitle = useCallback((type: string, title: string) => {
    setSelectedPages((prev) => prev.map((pg) => (pg.type === type ? { ...pg, customTitle: title } : pg)));
  }, []);
  const togglePlugin = useCallback((slug: string) => {
    setSelectedPlugins((prev) => prev.map((pl) => (pl.slug === slug ? { ...pl, include: !pl.include } : pl)));
  }, []);

  // Persist the confirmed (possibly edited) analysis so the theme build and the
  // operate layer see the user's edits, then move on: to the CFO's forecast
  // for a business that sells, straight to the style step otherwise.
  const confirmAnalysis = useCallback(async () => {
    try {
      if (analysis) {
        const includedSlugs = new Set(selectedPlugins.filter((pl) => pl.include).map((pl) => pl.slug));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyA = analysis as any;
        await onboardingApi.confirm({
          ...anyA,
          suggestedPlugins: (anyA.suggestedPlugins || []).filter((pl: { slug: string }) => includedSlugs.has(pl.slug)),
        }).catch(() => {});
      }
    } finally {
      setCurrentStep(nextStepOf('confirm', !!analysis?.earningModel));
    }
  }, [analysis, selectedPlugins]);

  const canProceed = useCallback((): boolean => {
    switch (currentStep) {
      case 'describe': return description.trim().length >= 10;
      case 'confirm': return confirmComplete && !siteLanguagePending;
      case 'forecast': return !isLoadingPlan;
      case 'style': return !!selectedDesignSystem && !isLoadingConcepts;
      default: return true;
    }
  }, [currentStep, description, isLoadingPlan, selectedDesignSystem, isLoadingConcepts, confirmComplete, siteLanguagePending]);

  const noop = useCallback(() => {}, []);
  const asyncNoop = useCallback(async () => {}, []);
  // Reload resume: the server session + its cached artifacts survive (theme,
  // images, plan are cached per session), but this context restarts at
  // 'describe' with empty state. Persist the typed description and restore
  // it with the describe phase open, so one click on Analyze re-enters the
  // flow against the warm server cache instead of losing the run.
  const RESUME_KEY = 'wm-onb-resume';
  useEffect(() => {
    try {
      if (description.trim()) {
        storage.set(RESUME_KEY, JSON.stringify({ description }));
      }
    } catch { /* private mode */ }
  }, [description, storage]);
  /**
   * Put the text typed before a reload back in the box, with the describe
   * phase open. `known`: the session is known to be open (a site's, from its
   * setup state); otherwise only a draft that has a session resumes.
   */
  function restoreText(known = false) {
    // An idea written seconds ago on the not-found page beats a draft left
    // behind earlier in the session. Without this, the old description is
    // restored here and the new one is typed over the top of it.
    if (pendingBusinessIdea(storage)) return;
    try {
      const raw = storage.get(RESUME_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { description?: string };
      if (saved.description && !description.trim() && (known || getSessionId())) {
        setDescription(saved.description);
        setDescribePhase('describe');
      }
    } catch { /* ignore bad payloads */ }
  }
  useEffect(() => {
    restoreText();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The success step's final action → the anonymous signup wall. The run is
  // over: its resume text and its per-browser memory go.
  const finish = useCallback(() => {
    try { storage.remove(RESUME_KEY); } catch { /* private mode */ }
    clearStartPlanReturn(storage);
    clearMemory();
    boundSessionRef.current = null;
    onComplete?.();
  }, [onComplete, storage]);

  // ── Starting a plan from the wizard ──────────────────────────────────────
  // Other directions on the style step, and a build a limit stopped, come
  // with a plan: the host's "Start for $1" sheet (host.billing; none in
  // WordPress). What the wizard needs to reopen here is kept first, at once:
  // the sheet may leave for the payment page right after, and the dashboard
  // mounts the wizard again on the way back with host.resumeAction.
  const startPlan = useCallback((reason: 'rerolls' | 'build', firstWeekAvailable: boolean | null): boolean => {
    const billing = host.billing;
    if (!billing) return false;
    const sessionId = getSessionId();
    if (host.identity.mode === 'draft') {
      const limited = reason === 'build' ? limitStepRef.current : null;
      saveStartPlanReturn(storage, {
        v: 1,
        reason,
        sessionId,
        at: Date.now(),
        limited,
        step: returnStepOf(reason, limited, currentStep),
        description,
        analysis,
        selectedPages,
        selectedPlugins,
        confirmStage,
        confirmMaxConfirmed,
        businessPlan: businessPlanRef.current,
        forecastScenario: forecastScenarioRef.current,
        conceptId: selectedDesignSystem?.id ?? null,
        // Shown again as they were when the visitor comes back without paying.
        limit: reason === 'build' ? buildLimit : null,
        rerolls: rerollsRef.current,
      });
    }
    trackEvent('onboarding', 'start_plan', reason);
    billing.startPlan({ reason, sessionId, firstWeekAvailable });
    return true;
  }, [host, storage, currentStep, description, analysis, selectedPages, selectedPlugins, confirmStage, confirmMaxConfirmed, selectedDesignSystem, buildLimit, trackEvent]);

  /**
   * "None of these? Show me other directions": a reroll, or, when they come
   * with a plan (the API said so, before or in answer to this click), the
   * host's sheet. Without one (WordPress) the step keeps the button off.
   */
  const requestOtherDirections = useCallback(async () => {
    const known = rerollsRef.current;
    if (known && !known.allowed) {
      startPlan('rerolls', known.firstWeekAvailable);
      return;
    }
    const outcome = await fetchDesignConcepts(true);
    if (outcome === 'plan_required') startPlan('rerolls', rerollsRef.current?.firstWeekAvailable ?? null);
  }, [fetchDesignConcepts, startPlan]);

  // Back from a plan: what it was for runs once, on the step the wizard
  // reopened on, when that step is ready: other directions and the build
  // once the style step's directions are back (reused, free), the reading of
  // the idea at once. The directions and the plan a limit stopped load by
  // themselves on their step. Taken out of storage now, so a reload of the
  // page it came back to opens as usual. StrictMode runs this twice on
  // mount: the ref is emptied before the first run acts.
  const resumeRef = useRef<{ run: ResumeRun; step: OnboardingStep } | null>(pendingResumeOf(planReturn, host.resumeAction));
  const returnTakenRef = useRef(false);
  useEffect(() => {
    if (returnTakenRef.current || host.identity.mode !== 'draft' || !host.resumeAction) return;
    returnTakenRef.current = true;
    clearStartPlanReturn(storage);
    if (planReturn) trackEvent('onboarding', 'plan_return', host.resumeAction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const pending = resumeRef.current;
    if (!pending) return;
    // The visitor went on elsewhere, or the step's own load was refused or
    // failed: nothing runs by itself after that.
    if (currentStep !== pending.step || buildLimit || error) {
      resumeRef.current = null;
      return;
    }
    if (pending.run === 'analyze') {
      resumeRef.current = null;
      void analyzeDescription();
      return;
    }
    if (isLoadingConcepts || designConcepts.length === 0 || !selectedDesignSystem) return;
    resumeRef.current = null;
    if (pending.run === 'reroll') {
      void fetchDesignConcepts(true);
      return;
    }
    // The build the limit stopped, as Generate Site starts it (OnboardingShell).
    trackEvent('onboarding', 'generation_started');
    startGeneration()
      .then(() => trackEvent('onboarding', 'generation_completed'))
      .catch(() => trackEvent('onboarding', 'generation_failed'));
  }, [currentStep, buildLimit, error, isLoadingConcepts, designConcepts.length, selectedDesignSystem, analyzeDescription, fetchDesignConcepts, startGeneration, trackEvent]);

  // ── Publish here (the WordPress plugin) ───────────────────────────────────
  // The success step publishes the business onto the site the wizard runs
  // in, once the owner confirms. The API answers 202 at once and publishes in
  // the background; the wizard reads GET /onboarding/site-session every 5 s
  // while it runs and shows the stored outcome with the panel /welcome uses.
  const [publish, setPublish] = useState<PublishHereState>(PUBLISH_IDLE);

  // "Your site" (a WordPress site that already holds the owner's content):
  // nothing about the site leaves it until the owner presses "Check my site".
  const siteProfile: SiteProfile | null = host.site?.profile ?? null;
  const [siteCheck, setSiteCheck] = useState<SiteCheckState>({ phase: 'idle', error: null });
  const checkSite = useCallback(async () => {
    if (siteCheck.phase === 'running') return;
    setSiteCheck({ phase: 'running', error: null });
    try {
      const { check: result, limit } = await onboardingApi.runSiteCheck();
      // The session exists now (start ran first): the way taken is kept
      // with it, so a reload shows the check again.
      bindMemory(onboardingApi.getSessionId());
      rememberUI({ siteWay: 'site' });
      setSiteCheck({ phase: 'done', error: null, result, limit });
      setCurrentStep('audit');
    } catch (e) {
      setSiteCheck({ phase: 'failed', error: siteCheckError(e) });
    }
  }, [onboardingApi, siteCheck.phase, bindMemory]);
  // "Check again" on a check shown again: a new check, as "Check my site"
  // runs it; the one shown stays until it is done, then gives way to it. A
  // refusal (three an hour) says the api's sentence and when the next opens.
  const checkAgain = useCallback(async () => {
    if (siteCheck.phase !== 'done' || siteCheck.rechecking) return;
    setSiteCheck((prev) => ({ ...prev, rechecking: true, recheckError: null }));
    try {
      const { check: result, limit } = await onboardingApi.runSiteCheck();
      setSiteCheck({ phase: 'done', error: null, result, reopened: true, limit, rechecking: false, recheckError: null });
    } catch (e) {
      const limit = readCheckLimit((e as { data?: { limit?: unknown } } | null)?.data?.limit);
      setSiteCheck((prev) => ({ ...prev, rechecking: false, recheckError: siteCheckError(e), ...(limit ? { limit } : {}) }));
    }
  }, [onboardingApi, siteCheck.phase, siteCheck.rechecking]);
  // "Start over from an idea instead": today's idea flow, kept after a reload.
  const startFromIdea = useCallback(() => {
    rememberUI({ siteWay: 'idea' });
    setCurrentStep('describe');
  }, []);
  // A way on under the check, kept with the session.
  const [siteWay, setSiteWay] = useState<SiteWay | null>(null);
  // "New design, keep my content": the site's pages, products and look,
  // read for the new design (no model call); then the usual style,
  // generating and success steps, where the publish is the switch.
  const [redesign, setRedesign] = useState<RedesignState>({ phase: 'idle', brief: null, error: null });
  redesignWayRef.current = siteWay === 'redesign';
  const startRedesign = useCallback(async () => {
    setCurrentStep('redesign');
    setRedesign((r) => ({ ...r, phase: 'reading', error: null }));
    try {
      const { brief, analysis: read } = await onboardingApi.siteBrief();
      setAnalysis(read as unknown as OnboardingAnalysis);
      setRedesign({ phase: 'ready', brief, error: null });
    } catch (e) {
      setRedesign({ phase: 'failed', brief: null, error: errorMessage(e, CONTEXT_COPY.readSiteFailed) });
    }
  }, [onboardingApi]);
  /** "Continue" on the new design's first step: the owner's choice saved, then the looks. */
  const confirmRedesign = useCallback(async (keepLook: boolean) => {
    setRedesign((r) => ({ ...r, phase: 'confirming', error: null }));
    try {
      await onboardingApi.confirm({ keepLook });
      setRedesign((r) => ({ ...r, phase: 'ready', brief: r.brief ? { ...r.brief, keepLook } : r.brief }));
      setDesignConcepts([]);
      setCurrentStep('style');
    } catch (e) {
      setRedesign((r) => ({ ...r, phase: 'ready', error: errorMessage(e, CONTEXT_COPY.saveChoiceFailed) }));
    }
  }, [onboardingApi]);
  const chooseWay = useCallback((way: SiteWay) => {
    rememberUI({ siteWay: way });
    setSiteWay(way);
    // Keep, and Fix and improve: the business from the site comes first.
    if (way === 'keep' || way === 'fix') setCurrentStep('business');
    // A new design: what the site holds, read for it.
    if (way === 'redesign') void startRedesign();
  }, [startRedesign]);

  // "Your business" (Keep, Fix and improve): the business as the site shows
  // it, saved with no build ("Save my business"); then, for Fix and improve,
  // "What your team fixes" files the ticked findings as Waiting for you items.
  const keepDraft = useMemo(() => keptDefaults(host.site, siteProfile), [host.site, siteProfile]);
  const keptRef = useRef<KeepValues | null>(null);
  const [keepSaving, setKeepSaving] = useState(false);
  const [keepError, setKeepError] = useState<string | null>(null);
  const [keepFields, setKeepFields] = useState<Record<string, string> | null>(null);
  const [keptPlan, setKeptPlan] = useState<boolean | null>(null);
  const [fixOutcome, setFixOutcome] = useState<'waitingPlan' | 'started' | 'saved' | null>(null);
  const keepBody = useCallback((values: KeepValues) => ({
    name: values.name.trim(),
    summary: values.summary.trim(),
    store: values.store,
    siteType: keptSiteType(values, siteProfile),
    phone: values.phone.trim(),
    email: values.email.trim(),
    address: values.address.trim(),
  }), [siteProfile]);
  const saveBusiness = useCallback(async (values: KeepValues) => {
    setKeepSaving(true);
    setKeepError(null);
    setKeepFields(null);
    try {
      // Fix and improve: the fixes come next, and a reload comes back to them until they are chosen.
      const r = await onboardingApi.keepSite({ ...keepBody(values), ...(siteWay === 'fix' ? { fixes: true } : {}) });
      keptRef.current = values;
      setKeptPlan(r.plan);
      setCurrentStep(siteWay === 'fix' ? 'fixes' : 'kept');
    } catch (e) {
      if (e instanceof KeepFieldsError) setKeepFields(e.fields);
      setKeepError(errorMessage(e, CONTEXT_COPY.saveBusinessFailed));
    } finally {
      setKeepSaving(false);
    }
  }, [onboardingApi, keepBody, siteWay]);
  /** "What your team fixes": the ticked findings filed; then the team starts, Plans opens, or the list waits. */
  const fileFixes = useCallback(async (findingIds: string[], then: 'start' | 'plans' | 'later') => {
    const values = keptRef.current ?? keepDraft;
    setKeepSaving(true);
    setKeepError(null);
    try {
      // Sent even with nothing ticked ("Not now"): the choice is made, the wizard stops reopening on it.
      const r = await onboardingApi.keepSite({ ...keepBody(values), findingIds });
      const plan = r.plan ?? keptPlan ?? false;
      setKeptPlan(plan);
      if (then === 'plans' && !plan) {
        host.navigation.openDashboardPath('/billing#plans');
        setFixOutcome('waitingPlan');
      } else setFixOutcome(plan ? 'started' : 'saved');
    } catch (e) {
      setKeepError(errorMessage(e, CONTEXT_COPY.saveListFailed));
    } finally {
      setKeepSaving(false);
    }
  }, [onboardingApi, keepBody, keepDraft, keptPlan, host.navigation]);
  /** Back from Plans: once the plan is on, the team starts on the list already filed. */
  const readPlan = useCallback(async () => {
    const state = await onboardingApi.siteFixesState().catch(() => null);
    if (state?.plan) {
      setKeptPlan(true);
      setFixOutcome('started');
    }
  }, [onboardingApi]);
  /** "Open WPMaven": the site's business opens in WordPress. */
  const finishKept = useCallback(async () => {
    const sessionId = onboardingApi.getSessionId();
    clearMemory();
    await host.navigation.finish({ kind: 'kept', sessionId });
  }, [onboardingApi, host.navigation]);
  // A store that already sells while "Your site" is not open (the api's
  // liveStore): said before the idea, in the launch guard's words.
  const [liveStoreNotice, setLiveStoreNotice] = useState<string | null>(null);
  const publishRef = useRef(publish);
  publishRef.current = publish;
  // The `at` of the outcome the site held before this publish: a different
  // one is this publish's (never compared with this browser's clock).
  const knownOutcomeAtRef = useRef<string | null>(null);
  const quietReadsRef = useRef(0);

  /** "Publish to {site}" (or the preview's claim link): the confirmation first, never the publish itself. */
  const requestPublish = useCallback(() => {
    setPublish((p) => (p.phase === 'idle' || p.phase === 'ended' ? { ...p, phase: 'confirming', error: null } : p));
  }, []);
  const cancelPublish = useCallback(() => {
    setPublish((p) => (p.phase === 'confirming' ? { ...p, phase: p.outcome ? 'ended' : 'idle' } : p));
  }, []);

  /** Publish onto host.site: the confirmation's "Publish now", Publish again, Try again, and a problem's Check again. */
  const runPublish = useCallback(async () => {
    const sid = getSessionId();
    const site = host.site;
    if (!sid || !site) return;
    const before = publishRef.current;
    if (before.phase === 'starting' || before.phase === 'publishing') return;
    if (before.outcome) knownOutcomeAtRef.current = before.outcome.at;
    quietReadsRef.current = 0;
    setPublish((p) => ({ ...p, phase: 'starting', error: null, limit: null }));
    trackEvent('onboarding', 'publish_started');
    const back = (patch: Partial<PublishHereState>) =>
      setPublish((p) => ({ ...p, phase: p.outcome ? 'ended' : 'idle', ...patch }));
    try {
      const r = await onboardingApi.publish(sid, site.instanceId);
      if (r?.outcome && !r.publishing) {
        // An answer that already holds what the publish did.
        knownOutcomeAtRef.current = r.outcome.at;
        setPublish({ phase: 'ended', outcome: r.outcome, error: null, limit: null });
        return;
      }
      setPublish((p) => ({ ...p, phase: 'publishing' }));
    } catch (e) {
      if (isBuildLimitError(e)) {
        back({ limit: e.limit });
        return;
      }
      const code = apiErrorInfo(e).code;
      if (code === 'publish_in_flight' || code === 'deploy_in_flight' || noAnswer(e)) {
        // Already publishing (another tab, or a press before a reload), or
        // no answer in time: it may be running, so it is followed.
        setPublish((p) => ({ ...p, phase: 'publishing' }));
        return;
      }
      back({ error: publishRefusalText(e) });
    }
  }, [host, onboardingApi, trackEvent]);

  // Follow the publish until its outcome is stored.
  useEffect(() => {
    if (publish.phase !== 'publishing') return undefined;
    let alive = true;
    const read = async () => {
      const state = await onboardingApi.siteSession().catch(() => null);
      if (!alive || !state) return;
      const session = state.session;
      if (session?.publishing) {
        quietReadsRef.current = 0;
        return;
      }
      const outcome = session?.publishOutcome ?? null;
      if (outcome && outcome.at !== knownOutcomeAtRef.current) {
        knownOutcomeAtRef.current = outcome.at;
        setPublish({ phase: 'ended', outcome, error: null, limit: null });
        trackEvent('onboarding', 'publish_ended', outcome.status);
        return;
      }
      // Not running and nothing new: a press that never reached the API.
      quietReadsRef.current += 1;
      if (quietReadsRef.current >= 3) {
        setPublish((p) => ({ ...p, phase: p.outcome ? 'ended' : 'idle', error: CONTEXT_COPY.publishNotStarted }));
      }
    };
    const t = setInterval(() => { void read(); }, PUBLISH_FOLLOW_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [publish.phase, onboardingApi, trackEvent]);

  /** "Keep it as it is" on a partial publish: the site as it stands becomes the live business. Throws the refusal (the panel says it). */
  const keepAsIs = useCallback(async () => {
    const sid = getSessionId();
    const site = host.site;
    const outcome = publishRef.current.outcome;
    if (!sid || !site || !outcome) return;
    const r = await onboardingApi.keepAsIs(sid, outcome.instanceId || site.instanceId);
    knownOutcomeAtRef.current = r.outcome.at;
    setPublish((p) => ({ ...p, outcome: r.outcome }));
  }, [host, onboardingApi]);

  /** "Put my old design back" (30 days after the switch): the outcome then says the old design is back. */
  const [restoring, setRestoring] = useState(false);
  const restoreOldDesign = useCallback(async () => {
    setRestoring(true);
    setPublish((p) => ({ ...p, error: null }));
    try {
      const r = await onboardingApi.designRestore();
      knownOutcomeAtRef.current = r.outcome.at;
      setPublish((p) => ({ ...p, phase: 'ended', outcome: r.outcome, error: null }));
      trackEvent('onboarding', 'design_restored', 'ok');
    } catch (e) {
      setPublish((p) => ({ ...p, error: errorMessage(e, CONTEXT_COPY.restoreFailed) }));
    } finally {
      setRestoring(false);
    }
  }, [onboardingApi, trackEvent]);

  /** "Open my dashboard" once the business is live on the site (complete, or partial and kept). */
  const finishPublished = useCallback(() => {
    const sid = getSessionId() ?? '';
    const outcome = publishRef.current.outcome;
    try { storage.remove(RESUME_KEY); } catch { /* private mode */ }
    clearMemory();
    boundSessionRef.current = null;
    void host.navigation.finish({ kind: 'published', sessionId: sid, siteUrl: outcome?.siteUrl ?? host.site?.url ?? null });
  }, [host, storage]);

  /** The static preview of a session's built site, from a fresh preview token (a reload on the success step). */
  const showBuiltPreview = useCallback(async (sid: string) => {
    const t = await onboardingApi.ticket().catch(() => null);
    if (t?.previewToken) setSitePreviewUrl(onboardingApi.sitePreviewUrl(`/onboarding/site-preview/${sid}/`, t.previewToken));
  }, [onboardingApi]);

  // ── Boot: reopen where the session is ─────────────────────────────────────
  // A site reads its setup state: a publish running reopens on it (followed),
  // a stored outcome on the success step with it, a build on the build
  // (attached: the site build answers alreadyBuilt or running and the stream
  // replays its journal); an open session without a build keeps its text. A
  // draft whose build was started from this browser asks the start, which
  // resumes the draft: the same session attaches to its build.
  const resumeSession = useCallback((session: SiteOnboardingSession) => {
    onboardingApi.adoptSession(session.id);
    bindMemory(session.id);
    // A new design of the owner's site: its publish is the switch.
    if (getUIMemory().siteWay === 'redesign' || session.publishOutcome?.designSwitch) setSiteWay('redesign');
    if (session.publishing || session.publishOutcome) {
      knownOutcomeAtRef.current = session.publishOutcome?.at ?? null;
      setPublish(session.publishing
        ? { phase: 'publishing', outcome: null, error: null, limit: null }
        : { phase: 'ended', outcome: session.publishOutcome, error: null, limit: null });
      setBuildDone(true);
      setCurrentStep('success');
      void showBuiltPreview(session.id);
      return;
    }
    if (session.hasBuild) {
      void startGeneration({ resume: true });
      return;
    }
    if (session.status !== 'completed' && session.status !== 'error') restoreText(true);
  }, [onboardingApi, bindMemory, showBuiltPreview, startGeneration]);

  // Once per mount, even where React runs effects twice in development
  // (StrictMode mounts, unmounts and mounts again): the boot's answer is
  // applied while the wizard is mounted.
  const bootedRef = useRef(false);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void (async () => {
      if (host.identity.mode === 'site') {
        const state = await onboardingApi.siteSession().catch(() => null);
        if (!mountedRef.current) return;
        const session = state?.session ?? null;
        const built = !!session && (session.hasBuild || session.publishing || !!session.publishOutcome);
        if (session?.id && session.fixesToChoose) {
          // Fix and improve: the business is saved, the fixes are not chosen
          // yet (a reload, another browser): "What your team fixes" again,
          // from the site's last check.
          onboardingApi.adoptSession(session.id);
          bindMemory(session.id);
          rememberUI({ siteWay: 'fix' });
          const [last, fixes] = await Promise.all([
            onboardingApi.lastSiteCheck().catch(() => null),
            onboardingApi.siteFixesState().catch(() => null),
          ]);
          if (!mountedRef.current) return;
          setSiteWay('fix');
          if (last) setSiteCheck({ phase: 'done', error: null, result: last });
          setKeptPlan(fixes?.plan ?? false);
          setCurrentStep('fixes');
        } else if (state?.liveStore?.text && !built && !opensOnSite(host, state)) {
          if (session?.id) onboardingApi.adoptSession(session.id);
          setLiveStoreNotice(state.liveStore.text);
          setCurrentStep('liveStore');
        } else if (session?.id && (built || !opensOnSite(host, state))) resumeSession(session);
        else if (opensOnSite(host, state)) {
          // The way the owner took on this session, from this browser: the
          // idea flow stays the idea flow, a check shows again.
          let way: string | undefined;
          if (session?.id) {
            onboardingApi.adoptSession(session.id);
            bindMemory(session.id);
            way = getUIMemory().siteWay;
          }
          if (way === 'idea' && session) resumeSession(session);
          else if (session?.id) {
            // The site's last check, from this browser or another: its
            // findings again, never an empty check (no new check is made),
            // with the checks left this hour for "Check again".
            const read = await onboardingApi.readSiteCheck().catch(() => null);
            const last = read?.check ?? null;
            if (!mountedRef.current) return;
            if (last) {
              setSiteCheck({ phase: 'done', error: null, result: last, reopened: true, limit: read?.limit ?? null });
              if (way === 'keep' || way === 'fix' || way === 'redesign') setSiteWay(way);
              // Keep, and Fix and improve, reopen on "Your business"; a new
              // design on its first step (the site read again); the check
              // stays a step back.
              if (way === 'redesign') void startRedesign();
              else setCurrentStep(way === 'keep' || way === 'fix' ? 'business' : 'audit');
            } else setCurrentStep('site');
          } else setCurrentStep('site');
        } else if (session?.id) resumeSession(session);
        setBooting(false);
        return;
      }
      const sid = getSessionId();
      // Back from a plan, the wizard reopened where the visitor was (planReturn).
      if (!sid || !getUIMemory().buildStarted || planReturn) return;
      // A draft the account owns (signed in inside the sheet) is its own
      // session: attached as it is, never started again (a new one would open).
      if (ownedDraft()) {
        void startGeneration({ resume: true });
        return;
      }
      const r = await onboardingApi.start().catch(() => null);
      if (!mountedRef.current) return;
      bindMemory(getSessionId());
      if (r?.sessionId === sid) {
        void startGeneration({ resume: true });
        return;
      }
      // That draft is gone (expired, or claimed elsewhere): a fresh start.
      setIsGenerating(false);
      setCurrentStep('describe');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The host's business cap wall, once the owner added a business: the wizard comes back and starts again. */
  const retryAfterCap = useCallback(() => {
    setCapWall(false);
    if (description.trim()) void analyzeDescription();
  }, [description, analyzeDescription]);

  // The Chief of Staff's closing memo was dead (recap hardcoded undefined) —
  // assemble it from state the session already holds.
  const recap = useMemo(() => ({
    siteName: analysis?.siteName || undefined,
    siteType: (analysis as any)?.siteType || (analysis as any)?.businessType || undefined,
    pages: selectedPages.filter((p) => p.include).map((p) => p.customTitle || p.title),
    plugins: selectedPlugins.filter((p) => p.include).map((p) => p.name),
    ...(storeCurrencyNote ? { storeCurrencyNote } : {}),
  }), [analysis, selectedPages, selectedPlugins, storeCurrencyNote]);

  const value = {
    // state
    sessionId: null, currentStep, status: buildFailed ? 'ERROR' : 'DESCRIBING', description, analysis,
    selectedStyle, selectedPages, selectedPlugins, confirmStage, confirmMaxConfirmed,
    isAnalyzing, isGenerating, isLoadingConcepts,
    // The generation theater — real SSE-fed state (shared grammar with the
    // plugin's generate stream), spread flat for the ported components.
    ...theater,
    error, buildRefused, rerollNotice, humanCheckFailed, rateLimitedUntil, turnstileResetKey, designConcepts, selectedDesignSystem, installType: 'fresh' as const,
    // Other directions and a stopped build come with a plan.
    rerolls, requestOtherDirections, startPlan,
    // The feasibility gate's two screens.
    clarifyQuestion, clarifyRound, feasibilityReason,
    answerClarify, skipClarify, leaveRoadmapEmail, startOver,
    describePhase, metAnalyst: pickedSuggestion, pickedSuggestion, businessPlan, isLoadingPlan, planReason,
    operatorsLoaded, previewDesignConcept, capWall, setCapWall, retryAfterCap, booting,
    // "Your site": the plugin's profile of the site, the check's state, the
    // ways on, and the store notice.
    siteProfile, siteCheck, checkSite, checkAgain, startFromIdea, siteWay, chooseWay, liveStoreNotice,
    // New design, keep my content: the site read for it, the owner's choice, the way back.
    redesign, startRedesign, confirmRedesign, restoreOldDesign, restoring,
    // Keep my site, and Fix and improve: "Your business", the fixes, the last word.
    keepDraft, saveBusiness, keepSaving, keepError, keepFields, keptPlan, fileFixes, fixOutcome, readPlan, finishKept,
    // Publish here (the WordPress plugin): its state and actions.
    publishHere: host.slots.finishAction === 'publish-here', publish, requestPublish, cancelPublish,
    confirmPublish: runPublish, publishAgain: runPublish, keepAsIs, finishPublished,
    recap, isCommercial, codeFilesRef, mockPreview, sitePreviewUrl, sitePreviewReloadKey, wpBundleToken, wpBundleZip,
    wpPreview, setWpPreview, wpPreviewBeat, wpPreviewError, wpAttempt, failWpPreview, retryWpPreview, buildDone, buildFailed, buildRestarted, predictedPlugins, hostedPreview, hostedPreviewUrl, hostedPreviewEnded, highDemand, buildLimit, growthPlan,
    launchPost, projectedReport, marketingTasks, waAdvance, whatsappCapture,
    // setters / actions
    setDescription, setSiteName, setSelectedStyle: setSelectedStyle, togglePage, updatePageTitle,
    setSiteSummary, setAnalysisLanguage, applySiteLanguage, siteLanguagePending, togglePlugin, startSession: asyncNoop, analyzeDescription,
    confirmAnalysis, selectStyle: async (s: string) => setSelectedStyle(s), selectPages: asyncNoop,
    startGeneration, goToStep: go, nextStep, prevStep, confirmComplete, confirmAdvance,
    confirmEditCard, confirmStepBack, reset: noop, canProceed, finish,
    fetchDesignConcepts, selectDesignConcept, setInstallType: noop,
    setDescribePhase, setPickedSuggestion, ensureBusinessPlan, setBusinessPlan, editBusinessPlan, saveBusinessPlan,
    changeStoreCurrency, storeCurrencyLocked, storeCurrencyChange,
    forecastScenario, setForecastScenario,
    forecastRevealDone, setForecastRevealDone,
    setTurnstileToken, retryHumanCheck,
    setPreviewDesignConcept,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
