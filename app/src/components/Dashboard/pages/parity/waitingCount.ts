import { useEffect, useState } from 'react';
import { readWaitingCounts, waitingBadgeCount } from '@yotako/wpmaven-screens';
import { pluginScreensTransport } from '../../../../screens/screensTransport';
import { siteInstanceId } from '../../../../screens/siteScope';
import { useSiteState } from '../../../../utils/siteState';

/**
 * The number beside Waiting for you in the sidebar (1.7.0): what the page's
 * tabs hold that needs the owner, summed by the screens package's one rule
 * (waitingBadgeCount), so the plugin's menu and the dashboard's say the
 * same sum for this site: the team's approvals, the changes a person on the
 * team prepared, what is worth fixing, and the customers who can still be
 * answered. What waits for the plan's actions is never counted: there is
 * nothing to decide on it. Each source may fail on its own and then counts
 * nothing.
 *
 * Read every two minutes while the entry is drawn and the tab is visible,
 * and when the tab is looked at again. The customers take a call to Meta for
 * the channels and another for the conversations: as in the dashboard,
 * they are read at most every ten minutes, and the count keeps their last
 * number between.
 */
export const COUNT_EVERY_MS = 120_000;
export const CUSTOMERS_EVERY_MS = 10 * 60_000;

let customers: { instanceId: string; at: number; open: number } | null = null;

/** Forget the customers' count (a test, or another site). */
export function forgetWaitingCustomers(): void {
  customers = null;
}

/** The count for this site, read once. */
export async function readSiteWaitingCount(instanceId: string, now: number = Date.now()): Promise<number> {
  const fresh = !!customers && customers.instanceId === instanceId && now - customers.at < CUSTOMERS_EVERY_MS;
  const counts = await readWaitingCounts(pluginScreensTransport, { kind: 'site', instanceId }, { customers: !fresh });
  if (!fresh) customers = { instanceId, at: now, open: counts.customers };
  return waitingBadgeCount({ ...counts, customers: customers?.open ?? 0 });
}

function visible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * The count beside "Waiting for you" in the sidebar: the kit's NavItem
 * shows it in its bubble (hidden at 0, "9+" past 9), as the dashboard's
 * sidebar does.
 */
export function useWaitingCount(): number {
  const site = useSiteState();
  const instanceId = siteInstanceId(site);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!instanceId) {
      setCount(0);
      return undefined;
    }
    let alive = true;
    const read = () => {
      void readSiteWaitingCount(instanceId).then((n) => { if (alive) setCount(n); }, () => undefined);
    };
    read();
    const onVisible = () => { if (visible()) read(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => { if (visible()) read(); }, COUNT_EVERY_MS);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [instanceId]);
  return count;
}
