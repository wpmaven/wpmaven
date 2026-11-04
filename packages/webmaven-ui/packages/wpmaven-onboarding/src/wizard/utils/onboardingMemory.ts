/**
 * Onboarding UI memory: the client-only wizard state that the API
 * has no business storing: played-once typewriter keys, the describe phase,
 * the confirm accordion's progress, acquaintance flags.
 *
 * Backed by the host's per-browser storage (sessionStorage on the
 * dashboard), keyed by onboarding session id, so a reload resumes without
 * replaying every intro (the audit's "reloading replays the whole intro"
 * finding), while a NEW onboarding session starts fresh. OnboardingWizard
 * hands the host's storage in (useOnboardingMemoryStorage); without one the
 * memory lives in this page only.
 */
import type { WizardStorage } from '../../host/types';


export interface OnboardingUIMemory {
  played: string[];
  describePhase?: 'ask' | 'suggest' | 'describe';
  confirmStage?: number | null;
  confirmMaxConfirmed?: number;
  metAnalyst?: boolean;
  pickedSuggestion?: boolean;
  /** Forecast-step scenario toggle: cautious | expected | ambitious. */
  forecastScenario?: string;
  /** The hidden WhatsApp step was shown once (linked or skipped). */
  waStepSeen?: boolean;
  /** The session's site build was started from this browser: a reload attaches to it instead of asking again. */
  buildStarted?: boolean;
  /**
   * A site the owner already runs: the way the owner took. 'site' after the
   * check (a reload shows the check again), 'idea' after "Start over from an
   * idea instead" (a reload keeps the idea flow), or the way chosen under the
   * check.
   */
  siteWay?: 'site' | 'idea' | 'keep' | 'fix' | 'redesign';
}

const KEY_PREFIX = 'wm-onboarding-ui:';
// Until a session exists (detect/describe before startSession) memory lives
// under a neutral key, then migrates to the session key on first save after
// the session id is known.
const PRESESSION_KEY = `${KEY_PREFIX}presession`;

let activeSessionId: string | null = null;
let memoryStorage: WizardStorage | null = null;

/** Where the memory is kept: the host's storage (OnboardingWizard sets it on mount). */
export function setOnboardingMemoryStorage(storage: WizardStorage | null): void {
  memoryStorage = storage;
}

/** The persistent played-once set. Components add keys; adds auto-save. */
class PlayedStore {
  current = new Set<string>();
}

export const playedMemory = new PlayedStore();

// Wrap Set.add so every new key persists without each call site caring.
const originalAdd = playedMemory.current.add.bind(playedMemory.current);
playedMemory.current.add = (value: string) => {
  const result = originalAdd(value);
  scheduleSave();
  return result;
};

let uiState: Omit<OnboardingUIMemory, 'played'> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function storageKey(): string {
  return activeSessionId ? `${KEY_PREFIX}${activeSessionId}` : PRESESSION_KEY;
}

function scheduleSave(): void {
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const payload: OnboardingUIMemory = { ...uiState, played: Array.from(playedMemory.current) };
      memoryStorage?.set(storageKey(), JSON.stringify(payload));
    } catch {
      /* storage full/blocked — memory-only fallback is fine */
    }
  }, 150);
}

function loadInto(key: string): OnboardingUIMemory | null {
  try {
    const raw = memoryStorage?.get(key) ?? null;
    if (!raw) return null;
    return JSON.parse(raw) as OnboardingUIMemory;
  } catch {
    return null;
  }
}

/**
 * Bind the memory to a session id: merges any pre-session memory (the detect
 * and describe intros play before startSession returns) into the session's
 * bucket. Returns the loaded memory so the context can apply the wizard bits.
 */
export function bindSession(sessionId: string): OnboardingUIMemory | null {
  activeSessionId = sessionId;
  const existing = loadInto(`${KEY_PREFIX}${sessionId}`);
  const presession = loadInto(PRESESSION_KEY);
  if (presession) {
    for (const k of presession.played || []) originalAdd(k);
    try { memoryStorage?.remove(PRESESSION_KEY); } catch { /* noop */ }
  }
  if (existing) {
    for (const k of existing.played || []) originalAdd(k);
    uiState = { ...existing, played: undefined } as Omit<OnboardingUIMemory, 'played'>;
  }
  scheduleSave();
  return existing;
}

/** Record a wizard-state bit (describe phase, accordion progress, flags…). */
export function rememberUI(patch: Partial<Omit<OnboardingUIMemory, 'played'>>): void {
  uiState = { ...uiState, ...patch };
  scheduleSave();
}

export function getUIMemory(): Omit<OnboardingUIMemory, 'played'> {
  return uiState;
}

/** Wipe everything for the active session (onboarding finished or reset). */
export function clearMemory(): void {
  try {
    memoryStorage?.remove(storageKey());
    memoryStorage?.remove(PRESESSION_KEY);
  } catch { /* noop */ }
  playedMemory.current.clear();
  uiState = {};
  activeSessionId = null;
}
