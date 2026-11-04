/**
 * Operator catalog — frontend ACCESSORS over a runtime cache.
 *
 * The catalog (id → title / sigil / color / intro) is owned by the API,
 * the single source of truth. The
 * plugin fetches it once via GET /onboarding/operators and loads it here with
 * setOperatorCatalog(). There is NO hardcoded operator data in the plugin; the
 * accessors fall back to neutral defaults until the catalog is loaded.
 */

import { isOperatorId, localized, operatorAccent } from '@yotako/webmaven-ui';

/** The words the accessors fall back to before the catalog is loaded. */
export const OPERATORS_COPY_EN = {
  teamMember: 'Team member',
  onYourTeam: "I'm on your team.",
} as const;

/** OPERATORS_COPY_EN in the page's language (French in i18n/fr.json, namespace "operators"). */
export const OPERATORS_COPY = localized(OPERATORS_COPY_EN, 'operators');

export interface OperatorInfo {
  id: string;
  title: string;
  sigil: string;
  /** Ocean-palette key (e.g. 'cyan'); resolved to a CSS var by getOperatorColor. */
  color: string;
  intro: string;
  /** Returning-acquaintance intro variants (only data_analyst sets
   *  them today): shown at the confirm roll-call when the user already met
   *  the operator during the describe step's suggestion flow. */
  introPicked?: string;
  introMet?: string;
}

let catalog: Record<string, OperatorInfo> = {};

/** Load the catalog fetched from the API (single source of truth). */
export function setOperatorCatalog(operators: OperatorInfo[]): void {
  const next: Record<string, OperatorInfo> = {};
  for (const op of operators) {
    if (op && op.id) next[op.id] = op;
  }
  catalog = next;
}

export function getOperatorTitle(id: string | undefined): string {
  return (id && catalog[id]?.title) || OPERATORS_COPY.teamMember;
}

export function getOperatorSigil(id: string | undefined): string {
  return (id && catalog[id]?.sigil) || '○';
}

export function getOperatorColor(id: string | undefined): string {
  // The API returns a colour KEY from the retired six-pastel palette
  // ('cyan', 'rose', ...). Those tokens are now semantic (cyan is success,
  // rose is danger), so identity reads from the library's one colour table,
  // the same one the faces use: a portrait and the bubble around it can never
  // disagree.
  return isOperatorId(id) ? operatorAccent(id) : 'var(--accent)';
}

export function getOperatorIntro(id: string | undefined): string {
  return (id && catalog[id]?.intro) || OPERATORS_COPY.onYourTeam;
}

/**
 * Acquaintance-aware intro: the variant for an operator the user
 * already met during onboarding. `picked` = they took one of his suggestions
 * (shared-credit line); `met` = they only browsed. Falls back to the standard
 * self-intro when no variant applies or the catalog doesn't carry one.
 */
export function getOperatorIntroVariant(
  id: string | undefined,
  flags: { picked?: boolean; met?: boolean },
): string {
  const entry = id ? catalog[id] : undefined;
  if (entry) {
    if (flags.picked && entry.introPicked) return entry.introPicked;
    if (flags.met && entry.introMet) return entry.introMet;
  }
  return getOperatorIntro(id);
}
