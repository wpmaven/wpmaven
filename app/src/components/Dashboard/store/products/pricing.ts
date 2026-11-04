/**
 * The lowest price of a printed product and what the owner earns, for one
 * option, every option at once, or the product: from the account's pricing
 * when it answered, else from the floors the product carries (no earnings).
 */

import { compareDecimal } from '../../../../utils/storeMoney';
import type { Decimal, ProductPricing, StoreVariation } from '../../../../types/store';

export interface FloorLine {
  floor: Decimal;
  price: Decimal | null;
  earnings: Decimal | null;
}

/** 'product': the lowest floor; 'all': one price for every option, so the highest floor; a number: that option. */
export type FloorTarget = 'product' | 'all' | number;

const highest = (a: Decimal, b: Decimal) => (compareDecimal(a, b) >= 0 ? a : b);

export function floorLine(target: FloorTarget, pricing: ProductPricing | null, productFloor: Decimal | null, variations: StoreVariation[]): FloorLine | null {
  const rows = (pricing?.variations ?? []).filter((r) => r && typeof r.floor === 'string' && r.floor);
  if (rows.length) {
    if (typeof target === 'number') {
      const row = rows.find((r) => r.variationId === target);
      if (row) return { floor: row.floor, price: row.price, earnings: row.earnings };
    } else if (target === 'product') {
      const row = rows.reduce((a, b) => (compareDecimal(b.floor, a.floor) < 0 ? b : a));
      return { floor: row.floor, price: row.price, earnings: row.earnings };
    } else {
      const shown = new Set(variations.filter((v) => v.enabled).map((v) => v.variationId));
      const live = rows.filter((r) => r.variationId === null || !shown.size || shown.has(r.variationId));
      const pool = live.length ? live : rows;
      const earning = pool.filter((r) => r.earnings !== null && r.price !== null);
      const least = earning.length ? earning.reduce((a, b) => (compareDecimal(b.earnings, a.earnings) < 0 ? b : a)) : null;
      return { floor: pool.map((r) => r.floor).reduce(highest), price: least?.price ?? null, earnings: least?.earnings ?? null };
    }
  }
  if (typeof target === 'number') {
    const v = variations.find((x) => x.variationId === target);
    return v?.floor ? { floor: v.floor, price: null, earnings: null } : productFloor ? { floor: productFloor, price: null, earnings: null } : null;
  }
  if (target === 'all') {
    const floors = variations.filter((v) => v.enabled && v.floor).map((v) => v.floor as Decimal);
    if (floors.length) return { floor: floors.reduce(highest), price: null, earnings: null };
  }
  return productFloor ? { floor: productFloor, price: null, earnings: null } : null;
}
