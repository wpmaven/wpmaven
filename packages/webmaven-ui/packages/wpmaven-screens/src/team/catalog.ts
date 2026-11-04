/**
 * The AI team's catalog as Your team draws it: each member's title and the
 * colour of their badge (the API's GET /onboarding/operators, the source of
 * truth both apps read). An app that already holds it passes it to the
 * screen; otherwise the screen reads it once, and until then (or when it
 * cannot) a member reads with the kit's title and a blue badge.
 */
import { operatorTitle, type BadgeColor } from '@yotako/webmaven-ui';
import type { ScreensTransport } from '../host/types';

/** One member of the team: the catalog's id, title and colour. */
export interface TeamMemberMeta {
  id: string;
  title: string;
  color: BadgeColor;
}

/** The catalog by member id. */
export type TeamCatalog = ReadonlyMap<string, TeamMemberMeta>;

const COLORS: readonly BadgeColor[] = ['cyan', 'blue', 'purple', 'mauve', 'rose', 'peach'];

/** The member as the catalog has them, else by the kit's title and the blue badge. */
export function memberMeta(catalog: TeamCatalog | null | undefined, id: string): TeamMemberMeta {
  return catalog?.get(id) ?? { id, title: operatorTitle(id), color: 'blue' };
}

/** The catalog out of the answer (`{ operators }` or the list itself); an empty map for anything else. */
export function readCatalog(body: unknown): Map<string, TeamMemberMeta> {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { operators?: unknown }).operators)
      ? (body as { operators: unknown[] }).operators
      : [];
  const map = new Map<string, TeamMemberMeta>();
  for (const op of list) {
    if (!op || typeof op !== 'object') continue;
    const { id, title, color } = op as { id?: unknown; title?: unknown; color?: unknown };
    if (typeof id !== 'string' || !id) continue;
    map.set(id, {
      id,
      title: typeof title === 'string' && title.trim() ? title.trim() : operatorTitle(id),
      color: COLORS.includes(color as BadgeColor) ? color as BadgeColor : 'blue',
    });
  }
  return map;
}

let cached: Promise<Map<string, TeamMemberMeta>> | null = null;

/**
 * The catalog, read once per page load on the app's transport (it is the
 * same for every account). A failed read is not kept: the next screen asks
 * again, and meanwhile the members read with the kit's titles.
 */
export function loadCatalog(transport: ScreensTransport): Promise<Map<string, TeamMemberMeta>> {
  if (!cached) {
    cached = transport.get<unknown>('/onboarding/operators').then(readCatalog).catch((e) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}

/** For the tests: forget the catalog read before. */
export function forgetCatalog(): void {
  cached = null;
}
