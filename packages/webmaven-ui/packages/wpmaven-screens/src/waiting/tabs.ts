/**
 * Waiting for you, one tab per kind of thing that waits (both apps,
 * 2026-10-16). The page stacked them, so reaching the last one meant
 * scrolling through every card above it. The tab is in the address (the
 * dashboard's ?tab=yes, the plugin's #/approvals/yes): the app keeps it and
 * hands it to the screen, so a link from a notification or the chat opens
 * it, and the browser's Back returns to the one before.
 *
 * No runtime imports, so the node tests load it directly.
 */

export type WaitingTab = 'yes' | 'held' | 'prepared' | 'fix' | 'customers';

/**
 * The tabs, in their order: what needs a decision first, then what was said
 * yes to and waits for the plan's actions (the plugin's second tab), then
 * the team's prepared changes, what to fix, and the customers.
 */
export const WAITING_TABS: ReadonlyArray<{ key: WaitingTab; label: string }> = [
  { key: 'yes', label: 'Waiting for your yes' },
  { key: 'held', label: 'Waiting for actions' },
  { key: 'prepared', label: 'Changes your team prepared' },
  { key: 'fix', label: 'Worth fixing' },
  { key: 'customers', label: 'Customers to reply to' },
];

export type WaitingCounts = Record<WaitingTab, number>;

/** No tab has anything. */
export const NO_WAITING: WaitingCounts = { yes: 0, held: 0, prepared: 0, fix: 0, customers: 0 };

export const ALL_DONE_TEXT = 'All done here.';

export function isWaitingTab(v: unknown): v is WaitingTab {
  return typeof v === 'string' && WAITING_TABS.some((t) => t.key === v);
}

/** "Waiting for your yes (15)"; just the name once it is empty. */
export function waitingTabLabel(key: WaitingTab, count: number): string {
  const label = WAITING_TABS.find((t) => t.key === key)?.label ?? key;
  return count > 0 ? `${label} (${count})` : label;
}

/**
 * The tabs that show: those with something, and those that had something
 * earlier in this visit. An empty tab would be a click that leads nowhere,
 * but a tab the owner just emptied stays, with its receipt and "All done
 * here", so nothing moves while they read it.
 */
export function shownTabs(counts: Partial<WaitingCounts>, had: readonly WaitingTab[]): WaitingTab[] {
  return WAITING_TABS.map((t) => t.key).filter((k) => (counts[k] ?? 0) > 0 || had.includes(k));
}

/**
 * The tab on screen: the one the address names when it shows; else the one
 * the page opened on, so a count that arrives later never moves the page;
 * else the first that shows (an unknown, empty or emptied tab in a link opens
 * the first one with something). Null when nothing shows.
 */
export function activeWaitingTab(named: string | null | undefined, shown: readonly WaitingTab[], landing: WaitingTab | null = null): WaitingTab | null {
  const fromAddress = shown.find((k) => k === named);
  if (fromAddress) return fromAddress;
  if (landing && shown.includes(landing)) return landing;
  return shown[0] ?? null;
}

/** The next tab with something after `current`, going round to the first ones; null when none. */
export function nextWaitingTab(current: WaitingTab, shown: readonly WaitingTab[], counts: Partial<WaitingCounts>): WaitingTab | null {
  const at = shown.indexOf(current);
  const order = [...shown.slice(at + 1), ...shown.slice(0, Math.max(at, 0))];
  return order.find((k) => k !== current && (counts[k] ?? 0) > 0) ?? null;
}

/**
 * The number beside Waiting for you in each app's menu: what needs the
 * owner, the same sum in both. The approvals waiting for a yes, the changes
 * the team prepared, what is worth fixing and the customers who can still be
 * answered. What waits for the plan's actions is never counted: there is
 * nothing to decide on it.
 */
export function waitingBadgeCount(counts: Partial<WaitingCounts>): number {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return n(counts.yes) + n(counts.prepared) + n(counts.fix) + n(counts.customers);
}
