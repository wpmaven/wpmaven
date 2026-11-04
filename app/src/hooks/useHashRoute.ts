/**
 * Hash routing under the WP admin URL.
 *
 * WP owns the path (`admin.php?page=webmaven-dashboard`), but the hash is
 * ours: `#/finance`, `#/onboarding/style`. Hash changes create history
 * entries (browser back/forward work), survive copy-paste, never reload the
 * page, and WordPress ignores them entirely.
 *
 * Deliberately tiny instead of a router library: the app is a flat page
 * switch plus a linear wizard, and the contexts own navigation logic.
 */
import { useEffect, useState } from 'react';

/** "#/onboarding/style" → ["onboarding", "style"]; "#/" or "" → []. */
export function getHashParts(): string[] {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return raw ? raw.split('/').filter(Boolean).map(decodeURIComponent) : [];
}

export function getHashPath(): string {
  return '/' + getHashParts().join('/');
}

/**
 * Navigate by hash. `replace: true` swaps the current history entry (for
 * internal transitions that shouldn't become back-button stops); default
 * pushes a new entry (user-level navigation).
 */
export function navigateHash(path: string, opts?: { replace?: boolean }): void {
  const normalized = '#/' + path.replace(/^[#/]+/, '');
  if (window.location.hash === normalized) return;
  if (opts?.replace) {
    const url = window.location.pathname + window.location.search + normalized;
    window.history.replaceState(null, '', url);
    // replaceState doesn't fire hashchange — notify listeners manually.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = normalized;
  }
}

export function onHashChange(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

/** React binding: re-renders on hash changes, returns the current parts. */
export function useHashRoute(): string[] {
  const [parts, setParts] = useState<string[]>(getHashParts);
  useEffect(() => onHashChange(() => setParts(getHashParts())), []);
  return parts;
}
