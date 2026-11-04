/**
 * The part of the address after a screen's own: #/store/products/31 is the
 * Store screen with ["products", "31"]. Moving inside a screen changes the
 * address (back and forward work, links can be shared) without leaving it.
 */

import { useCallback } from 'react';
import { navigateHash, useHashRoute } from '../../../../hooks/useHashRoute';

export interface SubPath {
  /** The segments after the screen's own ("products", "31"). */
  parts: string[];
  /** Go to a place inside the screen: go(['orders', 1042]); go([]) is the screen's start. */
  go: (parts: Array<string | number>, opts?: { replace?: boolean }) => void;
}

export function useSubPath(base: string): SubPath {
  const all = useHashRoute();
  const parts = all[0] === base ? all.slice(1) : [];
  const go = useCallback((next: Array<string | number>, opts?: { replace?: boolean }) => {
    const path = [base, ...next.map((p) => encodeURIComponent(String(p)))].join('/');
    navigateHash(path, opts);
  }, [base]);
  return { parts, go };
}

/** A positive id from a segment, else null. */
export function idFrom(segment: string | undefined): number | null {
  if (!segment || !/^\d{1,12}$/.test(segment)) return null;
  const n = Number(segment);
  return n > 0 ? n : null;
}
