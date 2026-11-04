import { CORE_ROUTES } from './core.routes';
import { EDITOR_ROUTES } from './editor.routes';
import { ONBOARDING_ROUTES } from './onboarding.routes';
import { PARITY_ROUTES } from './parity.routes';
import { STORE_ROUTES } from './store.routes';
import type { PageRoute, SidebarGroupId } from './types';
import { tierIn, currentTier, type Tier } from '../../../../utils/tier';
import { hasFeature, type SiteState } from '../../../../utils/siteState';

/** Every route of the app, from every workstream's file. */
export const PAGE_ROUTES: readonly PageRoute[] = [
  ...CORE_ROUTES,
  ...EDITOR_ROUTES,
  ...STORE_ROUTES,
  ...PARITY_ROUTES,
  ...ONBOARDING_ROUTES,
];

const BY_ID = new Map(PAGE_ROUTES.map((r) => [r.id, r]));
const BY_HASH = new Map(PAGE_ROUTES.map((r) => [r.hash, r]));

export function routeById(id: string | null | undefined): PageRoute | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function routeForHash(hash: string): PageRoute | undefined {
  return BY_HASH.get(hash);
}

/** The address of a page ('' for Overview and for a page the app does not know). */
export function hashForPage(id: string): string {
  return BY_ID.get(id)?.hash ?? '';
}

/**
 * The addresses a page left when it moved, and where they lead now: a saved
 * link or a bookmark still opens the page. Tasks became Your team (1.7.0),
 * its plan first.
 */
const MOVED: ReadonlyMap<string, string> = new Map([
  ['tasks', 'team/plan'],
]);

/** The address an old one leads to now ('team/plan' for #/tasks), or null for an address that did not move. */
export function movedHash(parts: readonly string[]): string | null {
  return parts.length > 0 ? MOVED.get(parts[0]) ?? null : null;
}

/** Whether the account lets this site show a route: its flag and every other one it needs. */
export function routeFeaturesOn(route: PageRoute | undefined, site: SiteState): boolean {
  if (!route) return false;
  if (route.feature && !hasFeature(site, route.feature)) return false;
  return (route.alsoNeeds ?? []).every((f) => hasFeature(site, f));
}

/** Whether this WordPress user's tier may open a route (no tiers: everyone). */
export function routeAllowsTier(route: PageRoute | undefined, tier: Tier | null = currentTier()): boolean {
  return !route?.tiers || tierIn(route.tiers, tier);
}

/**
 * The sidebar's parts in order. The first two are plain rows (Overview and
 * the Editor, then what an owner acts on); the others fold, under their
 * label.
 */
export const SIDEBAR_GROUPS: ReadonlyArray<{ id: SidebarGroupId; label?: string; folds: boolean }> = [
  { id: 'pages', folds: false },
  { id: 'work', folds: false },
  { id: 'content', label: 'Content', folds: true },
  { id: 'store', label: 'Store', folds: true },
  { id: 'insights', label: 'Insights', folds: true },
];

const GROUP_RANK = new Map(SIDEBAR_GROUPS.map((g, i) => [g.id, i]));

/** Whether a route has an entry: a group, and a place in it. */
const listed = (r: PageRoute): boolean => !!r.group && GROUP_RANK.has(r.group) && typeof r.order === 'number';

/** The sidebar's entries, part by part, each part's in its own order. */
export function sidebarRoutes(): PageRoute[] {
  return PAGE_ROUTES.filter(listed).sort((a, b) =>
    (GROUP_RANK.get(a.group as SidebarGroupId) as number) - (GROUP_RANK.get(b.group as SidebarGroupId) as number)
    || (a.order as number) - (b.order as number));
}

/** One part's entries, in order. */
export function sidebarGroupRoutes(group: SidebarGroupId): PageRoute[] {
  return sidebarRoutes().filter((r) => r.group === group);
}
