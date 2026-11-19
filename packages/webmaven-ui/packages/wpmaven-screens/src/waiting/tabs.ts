/**
 * Waiting for you, one tab per kind of thing that waits (both apps,
 * 2026-10-16). The page stacked them, so reaching the last one meant
 * scrolling through every card above it. The tab is in the address (the
 * dashboard's ?tab=yes, the plugin's #/approvals/yes): the app keeps it and
 * hands it to the screen, so a link from a notification or the chat opens
 * it, and the browser's Back returns to the one before.
 *
 * The tabs' words are in the page's language (WAITING_TABS_COPY, French in
 * src/i18n/fr.json, namespace 'screensWaitingTabs'), read when the tabs are
 * drawn. Only the kit's language helper at run time, so the node tests load
 * it directly.
 */
import { localized } from '@yotako/webmaven-ui';

export type WaitingTab = 'yes' | 'held' | 'prepared' | 'fix' | 'customers';

export const WAITING_TABS_COPY_EN = {
  /** Tab label on Waiting for you: the work the AI team wants to do that waits for the owner's approval. */
  yes: 'Waiting for your yes',
  /**
   * Tab label: work the owner already approved that waits until the plan's
   * monthly actions (the plan's allowance of work) allow it to go ahead.
   */
  held: 'Waiting for actions',
  /** Tab label: product and blog post changes that a person on the owner's team prepared, for the owner to publish or discard. */
  prepared: 'Changes your team prepared',
  /** Tab label: alerts about the business that are worth acting on. */
  fix: 'Worth fixing',
  /** Tab label: customer conversations that can still be answered. */
  customers: 'Customers to reply to',
  /** Said under a tab whose last item the owner just dealt with. */
  allDone: 'All done here.',
  /** A tab's label with how many items it holds ("Worth fixing (3)"); {0} the label, {1} the count. */
  withCount: (label: string, count: number) => `${label} (${count})`,
};

export const WAITING_TABS_COPY = localized(WAITING_TABS_COPY_EN, 'screensWaitingTabs');

const TAB_ORDER: readonly WaitingTab[] = ['yes', 'held', 'prepared', 'fix', 'customers'];

/**
 * The tabs, in their order: what needs a decision first, then what was said
 * yes to and waits for the plan's actions (the plugin's second tab), then
 * the team's prepared changes, what to fix, and the customers. Each label is
 * read when it is drawn, in the page's language.
 */
export const WAITING_TABS: ReadonlyArray<{ key: WaitingTab; readonly label: string }> = TAB_ORDER.map((key) => ({
  key,
  get label(): string {
    return WAITING_TABS_COPY[key];
  },
}));

export type WaitingCounts = Record<WaitingTab, number>;

/** No tab has anything. */
export const NO_WAITING: WaitingCounts = { yes: 0, held: 0, prepared: 0, fix: 0, customers: 0 };

/** "All done here." in English, for importers; the screen reads WAITING_TABS_COPY.allDone when it draws. */
export const ALL_DONE_TEXT = WAITING_TABS_COPY_EN.allDone;

export function isWaitingTab(v: unknown): v is WaitingTab {
  return typeof v === 'string' && WAITING_TABS.some((t) => t.key === v);
}

/** "Waiting for your yes (15)"; just the name once it is empty. */
export function waitingTabLabel(key: WaitingTab, count: number): string {
  const label = WAITING_TABS.find((t) => t.key === key)?.label ?? key;
  return count > 0 ? WAITING_TABS_COPY.withCount(label, count) : label;
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
