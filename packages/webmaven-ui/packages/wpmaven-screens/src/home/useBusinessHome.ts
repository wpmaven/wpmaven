import { useCallback, useEffect, useState } from 'react';
import type { ScreensHost } from '../host/types';
import type { OperatorApproval } from '../approvals/types';
import type { ConnectCenter } from '../team/connectRules';
import type { ProgressSnapshot } from '../team/progress';
import { loadCatalog, type TeamCatalog } from '../team/catalog';
import { readConnectCenter, readTeamProgress, teamBusiness } from '../team/reads';
import { businessLoads } from './businessLoads';
import {
  readHomeApprovals, readHomeFinance, readHomePlan, readHomeTraffic,
  type HomeFinance, type HomePlan, type HomeTraffic,
} from './reads';

/**
 * What one business's Home reads, once, for every section that draws it
 * (2026-10-16): the dashboard's Home and the plugin's Overview hold one of
 * these and hand it to the sections (the growth card, This week, the team
 * and its week, What changed) and to what they draw of their own (the
 * dashboard's chat reads the approvals, its tour the plan's answers).
 */
export interface BusinessHome {
  host: ScreensHost;
  /** The business on screen: a site's own, else the one the app chose. Null while it is chosen. */
  instanceId: string | null;
  plan: HomePlan | null;
  approvals: OperatorApproval[];
  connect: ConnectCenter | null;
  /** This week's money (What changed, the growth chart's running period). */
  finance: HomeFinance | null;
  /** The year's money (the milestones: lifetime progress never resets on Monday). */
  financeYear: HomeFinance | null;
  traffic: HomeTraffic | null;
  progress: ProgressSnapshot[];
  catalog: TeamCatalog | null;
  /**
   * Answered, as opposed to empty. Without these a null plan and an empty
   * approvals list mean both "still loading" and "there is nothing", and a
   * screen that cannot tell them apart either claims facts it does not have
   * yet or shows a placeholder that never leaves.
   */
  planLoaded: boolean;
  approvalsLoaded: boolean;
  connectLoaded: boolean;
  financeLoaded: boolean;
  financeYearLoaded: boolean;
  /** Read every slice again (after a decision): what is on screen stays meanwhile. */
  reload(): void;
  /** The approvals only, without blanking the rest (something new waits for a yes). */
  refreshApprovals(): void;
}

/** How many weekly check-ins the growth chart reads: half a year of weeks. */
export const HOME_PROGRESS_WEEKS = 26;

export interface UseBusinessHomeOptions {
  /**
   * Read everything again when this changes (the dashboard passes its
   * business object, so a refreshed list reads Home again). The business's
   * id changing always does.
   */
  reloadKey?: unknown;
}

/**
 * Eight reads, eight independent pieces of the screen.
 *
 * Each slice lands the moment its own call answers: the finance summary is a
 * live round trip to the customer's own site with a 30-second timeout, and a
 * slow or sleeping site must not keep the plan, the approvals, the graph or
 * the week's work off the screen while none of them needs the money.
 *
 * Switching business, the slices of the business shown before are cleared, so
 * its money, traffic, plan and approvals never stand under the new name while
 * the new calls are on their way, and an answer that arrives for the
 * business shown before is dropped (businessLoads). A reload of the same
 * business keeps what is on screen.
 */
export function useBusinessHome(host: ScreensHost, instanceId?: string | null, opts: UseBusinessHomeOptions = {}): BusinessHome {
  const business = teamBusiness(host.scope, instanceId);
  const { transport } = host;
  const [plan, setPlan] = useState<HomePlan | null>(null);
  const [approvals, setApprovals] = useState<OperatorApproval[]>([]);
  const [catalog, setCatalog] = useState<TeamCatalog | null>(null);
  const [connect, setConnect] = useState<ConnectCenter | null>(null);
  const [finance, setFinance] = useState<HomeFinance | null>(null);
  const [financeYear, setFinanceYear] = useState<HomeFinance | null>(null);
  const [traffic, setTraffic] = useState<HomeTraffic | null>(null);
  const [progress, setProgress] = useState<ProgressSnapshot[]>([]);
  const [planLoaded, setPlanLoaded] = useState(false);
  const [approvalsLoaded, setApprovalsLoaded] = useState(false);
  const [connectLoaded, setConnectLoaded] = useState(false);
  const [financeLoaded, setFinanceLoaded] = useState(false);
  const [financeYearLoaded, setFinanceYearLoaded] = useState(false);
  const [loads] = useState(businessLoads);

  const load = useCallback(async () => {
    if (!business) return;
    const id = business;
    if (loads.begin(id)) {
      setPlan(null); setApprovals([]); setConnect(null);
      setFinance(null); setFinanceYear(null); setTraffic(null); setProgress([]);
    }
    setPlanLoaded(false); setApprovalsLoaded(false); setConnectLoaded(false);
    setFinanceLoaded(false); setFinanceYearLoaded(false);
    const fill = <T,>(p: Promise<T>, apply: (value: T | null) => void) =>
      p.then((v) => { if (loads.isCurrent(id)) apply(v); })
        .catch(() => { if (loads.isCurrent(id)) apply(null); });

    await Promise.all([
      fill(readHomePlan(transport, id), (v) => { setPlan(v ?? null); setPlanLoaded(true); }),
      fill(readHomeApprovals(transport, id), (v) => { setApprovals(v ?? []); setApprovalsLoaded(true); }),
      fill(loadCatalog(transport), (v) => setCatalog(v ?? null)),
      fill(readConnectCenter(transport, id), (v) => { setConnect(v ?? null); setConnectLoaded(true); }),
      fill(readHomeFinance(transport, id, 'week'), (v) => { setFinance(v); setFinanceLoaded(true); }),
      fill(readHomeFinance(transport, id, 'year'), (v) => { setFinanceYear(v); setFinanceYearLoaded(true); }),
      fill(readHomeTraffic(transport, id), (v) => setTraffic(v)),
      fill(readTeamProgress(transport, id, HOME_PROGRESS_WEEKS), (v) => setProgress(v ?? [])),
    ]);
    // The transport may be a new object on each render: read again only for
    // another business, or when the app says so (reloadKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business, loads, opts.reloadKey]);

  useEffect(() => { void load(); }, [load]);

  const refreshApprovals = useCallback(() => {
    if (!business) return;
    const id = business;
    readHomeApprovals(transport, id)
      .then((v) => { if (loads.isCurrent(id)) setApprovals(v); })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business, loads]);

  const reload = useCallback(() => { void load(); }, [load]);

  return {
    host,
    instanceId: business,
    plan,
    approvals,
    connect,
    finance,
    financeYear,
    traffic,
    progress,
    catalog,
    planLoaded,
    approvalsLoaded,
    connectLoaded,
    financeLoaded,
    financeYearLoaded,
    reload,
    refreshApprovals,
  };
}
