/**
 * The onboarding generation SSE "theater" grammar — ONE implementation shared
 * by the ported plugin context (_pluginDefs, /onboarding/generate) and the
 * dashboard's anonymous site-build stream (/onboarding/site-build/:id/events).
 * Both streams speak the same `{ type, data }` event dialect; extracting the
 * state transitions here keeps the grammar from forking between them.
 *
 * Flow/transport events (connected / attach / preview_ready / complete /
 * error) are deliberately NOT handled here: they drive stream lifecycle and
 * step routing, which each caller owns.
 */
import type { ChecklistVM, CodeFile } from '../types';

/** The slice of onboarding state the generation theater renders from. */
export interface TheaterState {
  progress: number;
  displayProgress: number;
  phase: string;
  /** Machine-readable engine phase id ('' until the first phase event) — the
   *  wizard keys behavior on it (WordPress-preparing overlay at 'compile',
   *  per-phase narration speaker) while `phase` stays presentation copy. */
  phaseId: string;
  /** The operator (job role) doing the current phase, from the same event. */
  phaseOperator: string;
  progressMessage: string;
  buildChecklist: ChecklistVM[];
  finishChecklist: ChecklistVM[];
  beatsChecklist: ChecklistVM[];
  detailFeed: string[];
  tokensUsed: number;
  tokensIn: number;
  tokensOut: number;
  resourceCounts: Record<string, number>;
}

export const initialTheaterState = (): TheaterState => ({
  progress: 0,
  displayProgress: 0,
  phase: '',
  phaseId: '',
  phaseOperator: '',
  progressMessage: '',
  buildChecklist: [],
  finishChecklist: [],
  beatsChecklist: [],
  detailFeed: [],
  tokensUsed: 0,
  tokensIn: 0,
  tokensOut: 0,
  resourceCounts: {},
});

/**
 * Advance the displayed % toward `serverProgress + 7` (capped at 99). Each
 * activity event moves it a little; the increment shrinks as it nears the cap
 * so it decelerates instead of overshooting the next real anchor.
 */
export function creepToward(displayProgress: number, serverProgress: number): number {
  const cap = Math.min(serverProgress + 7, 99);
  if (displayProgress >= cap) return displayProgress;
  return Math.min(cap, displayProgress + Math.max(0.2, (cap - displayProgress) * 0.08));
}

const THEATER_TYPES = new Set(['progress', 'phase', 'step', 'detail', 'tokens', 'resource', 'code']);

/** Is this event's `type` part of the theater grammar handled here? */
export function isTheaterEventType(type: unknown): boolean {
  return typeof type === 'string' && THEATER_TYPES.has(type);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventEnvelope = { type?: string; data?: any };

/**
 * One SSE theater event → a state updater, or null when no render is needed.
 *
 * `code` events mutate `codeFilesRef` in place at call time — NO setState per
 * delta (one can arrive per token; the GenerationStage reads the ref from its
 * own RAF loop) — and only return an updater for the ≤1/s displayProgress
 * creep (`lastCodeCreepRef` holds the throttle timestamp).
 */
export function processTheaterEvent(
  eventData: EventEnvelope,
  codeFilesRef: { current: CodeFile[] },
  lastCodeCreepRef: { current: number },
): ((prev: TheaterState) => TheaterState) | null {
  const type = eventData.type;

  if (type === 'progress') {
    // The friendly headline now comes from `phase` events; progress events
    // only advance the % bar (their currentTask is the internal/technical
    // label and is intentionally not surfaced).
    const progressData = eventData.data || {};
    return (prev) => {
      const p = progressData.progress ?? prev.progress;
      return { ...prev, progress: p, displayProgress: Math.max(prev.displayProgress, p) };
    };
  }

  if (type === 'phase') {
    // Friendly top-of-screen headline + % (+ the machine-readable phase id
    // and its operator, which drive overlay timing and narration speakers).
    const d = eventData.data || {};
    return (prev) => {
      const p = d.progress ?? prev.progress;
      return {
        ...prev,
        progress: p,
        displayProgress: Math.max(prev.displayProgress, p),
        phase: d.phase || prev.phase,
        phaseId: d.phaseId || prev.phaseId,
        phaseOperator: d.operator || prev.phaseOperator,
        progressMessage: d.phase || prev.progressMessage,
      };
    };
  }

  if (type === 'step') {
    // Upsert one checklist row by id into the build / finish / beats list.
    const d = eventData.data || {};
    const id: string | undefined = d.stepId;
    const status: ChecklistVM['status'] =
      d.status === 'active' || d.status === 'done' ? d.status : 'pending';
    if (id && (d.group === 'build' || d.group === 'finish' || d.group === 'beats')) {
      const operator: string | undefined = d.operator;
      const upsert = (list: ChecklistVM[]): ChecklistVM[] => {
        const idx = list.findIndex(r => r.id === id);
        const label = d.label || (idx >= 0 ? list[idx].label : id);
        // Preserve a previously-seeded operator on status-only updates.
        const op = operator ?? (idx >= 0 ? list[idx].operator : undefined);
        return idx >= 0
          ? list.map((r, i) => (i === idx ? { ...r, label, status, operator: op } : r))
          : [...list, { id, label, status, operator: op }];
      };
      return (prev) => {
        const displayProgress = creepToward(prev.displayProgress, prev.progress);
        return d.group === 'build'
          ? { ...prev, displayProgress, buildChecklist: upsert(prev.buildChecklist) }
          : d.group === 'finish'
            ? { ...prev, displayProgress, finishChecklist: upsert(prev.finishChecklist) }
            : { ...prev, displayProgress, beatsChecklist: upsert(prev.beatsChecklist) };
      };
    }
    return null;
  }

  if (type === 'detail') {
    // Rolling, friendly narration — keep only the last few lines.
    const line = eventData.data?.detail;
    if (!line) return null;
    return (prev) => ({
      ...prev,
      displayProgress: creepToward(prev.displayProgress, prev.progress),
      detailFeed: [...prev.detailFeed, line].slice(-6),
    });
  }

  if (type === 'tokens') {
    const t = eventData.data?.totalTokens;
    const tIn = eventData.data?.promptTokens;
    const tOut = eventData.data?.completionTokens;
    if (typeof t !== 'number') return null;
    return (prev) => ({
      ...prev,
      displayProgress: creepToward(prev.displayProgress, prev.progress),
      tokensUsed: Math.max(prev.tokensUsed, t),
      tokensIn: typeof tIn === 'number' ? Math.max(prev.tokensIn, tIn) : prev.tokensIn,
      tokensOut: typeof tOut === 'number' ? Math.max(prev.tokensOut, tOut) : prev.tokensOut,
    });
  }

  if (type === 'resource') {
    // Running TOTAL (not a delta) of a streamed resource kind (image/form).
    // Store it as-is, keyed by kind.
    const d = eventData.data || {};
    if (!d.kind || typeof d.count !== 'number') return null;
    return (prev) => ({
      ...prev,
      displayProgress: creepToward(prev.displayProgress, prev.progress),
      resourceCounts: { ...prev.resourceCounts, [d.kind]: d.count },
    });
  }

  if (type === 'code') {
    // Stream of generated page content, grouped by fileName. Mutate the ref
    // in place — NO setState per delta (one fires per token).
    const d = eventData.data || {};
    const fileName: string | undefined = d.fileName;
    if (!fileName) return null;
    let entry = codeFilesRef.current.find(f => f.fileName === fileName);
    if (!entry) {
      entry = { fileName, code: '', label: d.label, operator: d.operator, done: false };
      codeFilesRef.current.push(entry);
    }
    // Store the friendly label on first sight; never overwrite a set label
    // with a later delta that omits it.
    if (d.label && !entry.label) entry.label = d.label;
    if (typeof d.code === 'string') entry.code += d.code;
    if (d.done) entry.done = true;
    // The code stream is exactly when the server goes quiet on progress
    // events (the audit's 3-minute freeze) — nudge the visible % off it,
    // at most ~once per second.
    const now = Date.now();
    if (now - lastCodeCreepRef.current > 1000) {
      lastCodeCreepRef.current = now;
      return (prev) => ({ ...prev, displayProgress: creepToward(prev.displayProgress, prev.progress) });
    }
    return null;
  }

  return null;
}
