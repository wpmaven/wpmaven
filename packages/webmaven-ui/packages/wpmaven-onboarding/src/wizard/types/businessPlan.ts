/**
 * Business plan types (the forecast step). Mirrors the API's BusinessPlan
 * shape: all money
 * in minor units (cents), the LLM's plain-language reason strings alongside
 * every number. The API re-clamps everything on save, so the frontend can
 * treat user edits leniently.
 */

export interface PlannedProduct {
  /** Shop-facing product/service name, ≤ 60 chars. */
  name: string;
  /**
   * Price in minor units (cents); null when the item has no price (priceMode
   * 'on_request'): the API keeps such an item, never drops it (2026-11-03).
   */
  priceCents: number | null;
  /** One shop-facing sentence describing the item. */
  shortDescription: string;
  /** Optional WooCommerce category (created during generation). */
  category?: string;
  /** Plain-language why this item/price — rendered muted under the row. */
  reason: string;
  /** false = unchecked at the forecast step: kept in the plan (re-checkable)
   *  but excluded from the store build and the forecast's average seeding. */
  included?: boolean;
  /** Who makes it (decided with the plan): printed to order, or the owner's own
   *  product they make and ship. Absent on plans made before it existed. */
  fulfillment?: 'print_on_demand' | 'own';
  /** The print-on-demand product type, when printed to order. */
  podType?: string;
  /** The catalog product this item is, with the colors and sizes the owner keeps. */
  catalog?: PlannedCatalogChoice;
  /**
   * How the price reads: a set price, a starting price ("From $180"), or none
   * ("Price on request", priceCents null). Absent on plans made before
   * 2026-11-03: a set price.
   */
  priceMode?: PlannedPriceMode;
  /**
   * Who set the price: the owner (the description states it, or they set it
   * on the plan step) or the plan (a suggestion from similar businesses).
   * Absent on plans made before 2026-11-03: suggested.
   */
  priceSource?: PlannedPriceSource;
  /**
   * How long the appointment, session or reservation takes, in minutes
   * (bookable services). Absent: no duration is stated.
   */
  durationMinutes?: number;
}

/** How a planned item's price reads. */
export type PlannedPriceMode = 'fixed' | 'from' | 'on_request';
/** Who set a planned item's price. */
export type PlannedPriceSource = 'owner' | 'suggested';

/** The colors and sizes kept for a catalog product (at least one color). */
export interface PlannedCatalogChoice {
  source: 'printful';
  productId: number;
  colors: string[];
  sizes: string[];
}

/** One acquisition move, assigned to the operator who will run it. */
export interface BusinessPlanMove {
  /** Catalog operator id (see constants/operators.ts). */
  operator: string;
  /** ONE first-person commitment sentence. */
  move: string;
  /** Optional 1-3 word channel label ("Instagram", "Google search"). */
  channel?: string;
}

export interface BusinessPlanStrategy {
  /** 2..4 operator-assigned moves for the first 90 days. */
  moves?: BusinessPlanMove[];
  /** Legacy pre-moves fields (older stored plans). */
  audience?: string;
  channels?: string[];
  firstPush?: string;
}

export interface BusinessPlanAssumptions {
  /** Average money per unit (order/booking/...) in cents. */
  avgUnitValueCents: number;
  /** Units in the first month. */
  unitsMonth1: number;
  /** Units by month 12; the engine interpolates the ramp. */
  unitsMonth12: number;
  /** Variable cost share of each unit (materials, shipping, fees). 0..0.9. */
  variableCostPct: number;
  /** Fixed monthly costs in cents (tools, hosting, marketing). */
  fixedMonthlyCents: number;
  /** Plain-language why per assumption field, keyed by field name
   *  (avgUnitValue, unitsMonth1, unitsMonth12, variableCostPct, fixedMonthly). */
  reasons: Record<string, string>;
}

export interface BusinessPlan {
  /** One of the API's SUPPORTED_MODELS (products, orders, bookings,
   *  services_quotes, events, donations). */
  earningModel: string;
  /** ISO 4217, code-derived from the WP locale — not user-editable. */
  currency: string;
  products: PlannedProduct[];
  strategy: BusinessPlanStrategy;
  assumptions: BusinessPlanAssumptions;
  generatedAt: string;
}
