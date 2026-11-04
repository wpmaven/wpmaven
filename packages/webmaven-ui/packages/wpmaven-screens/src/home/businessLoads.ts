/**
 * Which business Home's slices belong to, the same rule
 * for the dashboard's Home and the plugin's Overview.
 *
 * Switching Home from business A to B reset only the "answered" flags, so B's
 * name stood above A's money, traffic, plan and approvals until B's own calls
 * answered: the finance summary is a live round trip to the customer's site
 * and can take half a minute. And an answer for A that arrived after the
 * switch landed on B's screen.
 *
 * A load for another business than the one shown starts by clearing every
 * slice that belongs to a business (begin answers true); a reload of the same
 * business (after a decision) keeps what is on screen. Only answers for the
 * business shown now are applied (isCurrent).
 */
export interface BusinessLoads {
  /** Start a load for this business: true when it is not the business shown (clear its slices first). */
  begin(id: string): boolean;
  /** Whether an answer for this business may still land: it is the business shown. */
  isCurrent(id: string): boolean;
}

export function businessLoads(): BusinessLoads {
  let current: string | null = null;
  return {
    begin(id) {
      const other = current !== id;
      current = id;
      return other;
    },
    isCurrent(id) {
      return current === id;
    },
  };
}
