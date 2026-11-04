/**
 * Finance layer: the app's mirror of the API's finance types.
 *
 * Shape returned by GET /instances/:instanceId/finance/summary (the finance
 * read layer). Kept in sync with the API's shared contract; the
 * dashboard widget + Finance page are the only consumers.
 */

export type FinancePeriod = 'today' | 'week' | 'month' | 'quarter' | 'year';

export interface FinancialSummary {
  instanceId: string;
  period: { start: string; end: string; label: string };
  currency: string;
  /** Where the numbers came from. */
  source: 'live' | 'stored' | 'mixed';
  /** ISO timestamp of the freshest data. */
  asOf: string;
  /** false => no WooCommerce; UI shows "no store connected". */
  hasStore: boolean;
  revenueStatement: {
    grossSales: number;
    discounts: number;
    tax: number;
    shipping: number;
    refunds: number;
    /** netRevenue = grossSales - discounts - refunds. */
    netRevenue: number;
    orderCount: number;
    avgOrderValue: number;
  };
  ratios: {
    /** refunds / grossSales * 100 (0 if gross 0). */
    refundRatePct: number;
    /** vs previous period, null if unknown. */
    grossGrowthPct: number | null;
    /** projected monthly from the period. */
    runRateMonthly: number | null;
  };
  margin: {
    available: boolean;
    /** e.g. 'add product costs' when unavailable. */
    reason?: string;
    cogs?: number;
    grossProfit?: number;
    grossMarginPct?: number;
    fees?: { amount: number; estimated: boolean };
    /** grossProfit - fees.amount. */
    netProfit?: number;
  };
  goals: Array<{ id: string; name: string; current: number; target: number | null; progressPct: number }>;
  topSellers: Array<{ productId: number; name: string; quantity: number; revenue: number }>;
  trend: Array<{ date: string; revenue: number; orders: number }>;
}

export interface GetFinancialSummaryOptions {
  period?: FinancePeriod;
  live?: boolean;
}
