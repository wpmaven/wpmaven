import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The width of an element, kept current as it resizes: the screens lay
 * their columns out from the room they really have (the sidebar and the
 * page's own width decide it, never the window), with inline styles only.
 * A callback ref, so an element that mounts late is still measured. Zero
 * before it is measured (and on the server): one column.
 */
export function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number' && w > 0) setWidth(w);
    });
    observer.current.observe(el);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, width];
}
