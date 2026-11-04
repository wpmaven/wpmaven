/**
 * A business idea typed somewhere other than the onboarding, carried into it.
 *
 * The not-found page asks for a business idea instead of being a dead end, so
 * the idea has to survive one navigation to /create. It goes in sessionStorage
 * rather than router state: a reload of /create, or a redirect on the way,
 * drops router state and with it whatever the person wrote.
 *
 * Read once per page load and then held in memory, for two reasons. React's
 * StrictMode mounts every component twice in development, so a read that
 * removed the value on the spot would type the idea on the first mount and
 * leave an empty field on the second. And the onboarding needs to know an idea
 * is pending during render (to open on the describe screen rather than the
 * "do you have a business in mind?" question), which happens before any effect
 * could have stashed it.
 *
 * The stored copy is cleared by the onboarding once the idea has been typed in
 * full, so a later visit to /create starts clean. Until then a reload replays
 * the typing rather than losing the idea.
 *
 * Two places hand an idea over: the not-found page, and a link to /create that
 * carries ?idea= (the landing's box, see services/ideaFromUrl.ts). The second
 * also carries where the link was and whether the idea had to be cut to fit,
 * which travels next to the idea as its meta.
 *
 * The storage is the host's (WizardStorage): the dashboard hands its
 * sessionStorage, where its not-found page and its link capture put the idea.
 * The package reads no storage of its own.
 */
import type { WizardStorage } from '../host/types';

const KEY = 'wm_pending_business_idea';
const META_KEY = 'wm_pending_business_idea_meta';

/**
 * The floor the onboarding's describe step enforces (its minRequired).
 * Carrying anything shorter would type an idea into a field that then refuses
 * to continue, and the person who wrote it has no way to know why.
 */
export const MIN_IDEA_LENGTH = 10;

/** Longer than this is not a description of a business, it is a paste. */
export const MAX_IDEA_LENGTH = 2000;

/** Where a carried idea came from, and what happened to it on the way. */
export interface BusinessIdeaMeta {
  /** 'link': it arrived in the address of /create. Absent: the not-found page. */
  via?: 'link';
  /** The link's ?src= (where the link was placed), when it had a usable one. */
  source?: string;
  /** The link's ?hv= (the landing hero variant the visitor saw), when usable. */
  variant?: string;
  /**
   * Its length as the person wrote it, when what arrived is shorter: cut to
   * MAX_IDEA_LENGTH here, or shortened by the landing to fit the address.
   * Always longer than the idea it sits next to.
   */
  cutFrom?: number;
}

/** undefined = the storage not consulted yet this page load. */
let cached: string | null | undefined;
let cachedMeta: BusinessIdeaMeta | null | undefined;

/**
 * The first MAX_IDEA_LENGTH characters. Never ends on the first half of an
 * emoji or any other pair of UTF-16 units: a lone half is not a character,
 * and it would sit at the end of the field as a broken glyph.
 */
export function capIdea(text: string): string {
  if (text.length <= MAX_IDEA_LENGTH) return text;
  const code = text.charCodeAt(MAX_IDEA_LENGTH - 1);
  const splitsAPair = code >= 0xd800 && code <= 0xdbff;
  return text.slice(0, splitsAPair ? MAX_IDEA_LENGTH - 1 : MAX_IDEA_LENGTH);
}

export function stashBusinessIdea(storage: WizardStorage | null, idea: string, meta?: BusinessIdeaMeta): void {
  const text = capIdea(idea.trim()).trimEnd();
  if (!text) return;
  // "Was cut" only ever describes text that really is shorter than it was.
  if (meta?.cutFrom !== undefined && !(meta.cutFrom > text.length)) {
    meta = { ...meta };
    delete meta.cutFrom;
  }
  cached = text;
  // A stash without meta (the not-found page) replaces the meta of an earlier
  // link as well as its idea: the two always describe the same text.
  cachedMeta = meta ?? null;
  try {
    storage?.set(KEY, text);
    if (meta) storage?.set(META_KEY, JSON.stringify(meta));
    else storage?.remove(META_KEY);
  } catch {
    // Private mode, or a full quota. The in-memory copy still carries the idea
    // across the navigation; only a reload would lose it.
  }
}

/**
 * The idea waiting to be typed, or null. Safe to call during render and safe
 * to call repeatedly: the answer does not change until `clearBusinessIdea()`.
 */
export function pendingBusinessIdea(storage: WizardStorage | null): string | null {
  if (cached === undefined) {
    let stored: string | null = null;
    try {
      stored = storage?.get(KEY) ?? null;
    } catch {
      stored = null;
    }
    cached = stored && stored.trim() ? capIdea(stored).trimEnd() : null;
  }
  return cached;
}

/**
 * A stored meta read back, keeping only fields of the right type. A cut is
 * kept only when it is longer than the idea it describes (ideaLength).
 */
export function parseMeta(raw: string | null, ideaLength: number): BusinessIdeaMeta | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== 'object') return null;
    const meta: BusinessIdeaMeta = {};
    if (v.via === 'link') meta.via = 'link';
    if (typeof v.source === 'string' && v.source) meta.source = v.source;
    if (typeof v.variant === 'string' && v.variant) meta.variant = v.variant;
    if (Number.isInteger(v.cutFrom) && (v.cutFrom as number) > ideaLength) meta.cutFrom = v.cutFrom as number;
    return Object.keys(meta).length ? meta : null;
  } catch {
    return null;
  }
}

/**
 * The meta of the idea waiting to be typed, or null (no idea pending, or it
 * came from the not-found page). Held like the idea: stable until cleared.
 */
export function pendingBusinessIdeaMeta(storage: WizardStorage | null): BusinessIdeaMeta | null {
  const idea = pendingBusinessIdea(storage);
  if (idea === null) return null;
  if (cachedMeta === undefined) {
    let stored: string | null = null;
    try {
      stored = storage?.get(META_KEY) ?? null;
    } catch {
      stored = null;
    }
    cachedMeta = parseMeta(stored, idea.length);
  }
  return cachedMeta;
}

/** A pending idea that is shorter than what the person wrote. */
export interface PendingIdeaCut {
  /** How long it was as they wrote it. */
  from: number;
  /** How long it is now: exactly what the field is about to be typed with. */
  kept: number;
}

/**
 * Whether the pending idea was cut on the way, and by how much, or null. Both
 * numbers come from the stash itself, so a sentence built from them always
 * matches the text the field ends up holding (a cut that lands on a space, or
 * on half of an emoji, keeps fewer than MAX_IDEA_LENGTH characters).
 */
export function pendingIdeaCut(storage: WizardStorage | null): PendingIdeaCut | null {
  const idea = pendingBusinessIdea(storage);
  const from = pendingBusinessIdeaMeta(storage)?.cutFrom;
  if (idea === null || from === undefined || from <= idea.length) return null;
  return { from, kept: idea.length };
}

/** Called once the idea has landed in the field, so it is not typed again. */
export function clearBusinessIdea(storage: WizardStorage | null): void {
  cached = null;
  cachedMeta = null;
  try {
    storage?.remove(KEY);
    storage?.remove(META_KEY);
  } catch {
    // Nothing to do: the in-memory copy is already cleared, which is what the
    // rest of this page load reads.
  }
}
