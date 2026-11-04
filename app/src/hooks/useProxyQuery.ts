import { useCallback, useEffect, useRef, useState } from 'react';
import { pluginRest, proxy, ProxyError, queryString, type ProxyQuery } from '../services/proxyClient';

/**
 * One API read for a screen (1.3.0), with the states a screen shows:
 *   idle      not asked (the account or the tier does not allow it)
 *   loading   the first answer is on its way
 *   ready     data holds the answer
 *   refused   the role, a switch or the plugin version said no: no retry
 *   failed    anything else: the screen offers Retry
 * Polling (pollMs) runs only while the tab is visible, reads again when it
 * comes back, and stops for good after a refusal. A screen never catches
 * an error silently: it shows this state.
 */
export type QueryStatus = 'idle' | 'loading' | 'ready' | 'refused' | 'failed';

export interface ProxyQueryResult<T> {
  status: QueryStatus;
  data: T | null;
  error: ProxyError | null;
  refetch: () => Promise<void>;
  /** Replace the data in place (after a write the screen made). */
  setData: (update: T | null | ((prev: T | null) => T | null)) => void;
}

export interface ProxyQueryOptions {
  enabled?: boolean;
  pollMs?: number;
  /** A route of the plugin itself (webmaven_wp/v1/<path>), not the API. */
  local?: boolean;
}

function visible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function useProxyQuery<T>(path: string | null, query?: ProxyQuery, options: ProxyQueryOptions = {}): ProxyQueryResult<T> {
  const enabled = options.enabled !== false && !!path;
  const key = enabled ? `${path}?${queryString(query)}` : '';
  const [status, setStatus] = useState<QueryStatus>(enabled ? 'loading' : 'idle');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ProxyError | null>(null);
  const refusedRef = useRef(false);
  const keyRef = useRef(key);
  keyRef.current = key;
  const queryRef = useRef(query);
  queryRef.current = query;

  const load = useCallback(async () => {
    if (!enabled || !path) return;
    const asked = key;
    try {
      const answer = await (options.local ? pluginRest : proxy).get<T>(path, queryRef.current);
      if (keyRef.current !== asked) return;
      setData(answer);
      setError(null);
      setStatus('ready');
    } catch (err) {
      if (keyRef.current !== asked) return;
      const e = err instanceof ProxyError ? err : new ProxyError(String((err as Error)?.message ?? err), 0, path, 'network');
      setError(e);
      if (e.refused) {
        refusedRef.current = true;
        setStatus('refused');
      } else {
        setStatus('failed');
      }
    }
  }, [enabled, path, key, options.local]);

  useEffect(() => {
    refusedRef.current = false;
    if (!enabled) {
      setStatus('idle');
      setData(null);
      setError(null);
      return;
    }
    setStatus('loading');
    setData(null);
    setError(null);
    void load();
  }, [enabled, key, load]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onVisible = () => {
      if (visible() && !refusedRef.current) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = options.pollMs
      ? setInterval(() => {
        if (visible() && !refusedRef.current) void load();
      }, options.pollMs)
      : null;
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearInterval(timer);
    };
  }, [enabled, load, options.pollMs]);

  const refetch = useCallback(async () => {
    refusedRef.current = false;
    if (status !== 'ready') setStatus('loading');
    await load();
  }, [load, status]);

  return { status, data, error, refetch, setData };
}
