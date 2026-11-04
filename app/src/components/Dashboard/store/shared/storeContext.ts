/**
 * What the Store, Blog, Media and Messages screens know about the site and
 * the signed-in user.
 *
 * The page is drawn with WEBMAVEN_WP_DATA.storeApp (capabilities, the money
 * format, the REST root), so a screen renders at once; GET /store/context
 * then adds the counts and whether changes can reach the account. One read
 * per page load, shared by every screen (refresh() after a change that moves
 * a count).
 */

import { useEffect, useState } from 'react';
import { storeApi } from '../../../../services/storeApi';
import { DEFAULT_MONEY_FORMAT } from '../../../../utils/storeMoney';
import type { StoreAppContext, StoreAppData, StoreCaps, StoreMoneyFormat } from '../../../../types/store';

const NO_CAPS: StoreCaps = {
  products: false, orders: false, orderChanges: false, refunds: false, posts: false,
  media: false, messages: false, messagesSettings: false, spend: false,
};

/** The script data the page was drawn with (defaults when an older plugin page has none). */
export function storeAppData(): StoreAppData {
  const raw = ((typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA?.storeApp : null) || {}) as Partial<StoreAppData>;
  return {
    caps: { ...NO_CAPS, ...(raw.caps ?? {}) },
    wooActive: raw.wooActive === true,
    money: raw.money ?? null,
    paymentsWpmaven: raw.paymentsWpmaven === true,
    wpRestRoot: typeof raw.wpRestRoot === 'string' ? raw.wpRestRoot : '',
    uploads: { maxBytes: Number(raw.uploads?.maxBytes) > 0 ? Number(raw.uploads?.maxBytes) : 2 * 1024 * 1024 },
    units: raw.units ?? null,
    mail: raw.mail === 'relay' ? 'relay' : 'site',
  };
}

export interface StoreContextState {
  /** The full context once read (null before, or when the read failed). */
  context: StoreAppContext | null;
  caps: StoreCaps;
  money: StoreMoneyFormat;
  wooActive: boolean;
  /** Changes to products, posts and images reach the account. Unknown until read: true, so nothing is greyed out for nothing. */
  writesAvailable: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

let cached: StoreAppContext | null = null;
let pending: Promise<StoreAppContext> | null = null;
let failed: string | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function load(force = false): void {
  if (pending || (cached && !force)) return;
  pending = storeApi.context();
  pending.then(
    (ctx) => {
      cached = ctx;
      failed = null;
    },
    (error) => {
      failed = (error as Error)?.message || 'Your site did not answer.';
    },
  ).finally(() => {
    pending = null;
    notify();
  });
}

/** Tests: forget the shared read. */
export function resetStoreContextForTests(ctx: StoreAppContext | null = null): void {
  cached = ctx;
  pending = null;
  failed = null;
}

export function useStoreContext(): StoreContextState {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    load();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const data = storeAppData();
  const ctx = cached;
  return {
    context: ctx,
    caps: ctx?.caps ?? data.caps,
    money: ctx?.money ?? data.money ?? DEFAULT_MONEY_FORMAT,
    wooActive: ctx ? ctx.woocommerce.active : data.wooActive,
    writesAvailable: ctx ? ctx.writes.available : true,
    loading: !ctx && !failed,
    error: failed,
    refresh: () => load(true),
  };
}
