import React, { useEffect, useRef, useState, useCallback, CSSProperties } from 'react';

interface BlobsProps {
  /** Element to anchor blobs to. If omitted, uses the parent element. */
  targetRef?: React.RefObject<HTMLElement | null>;
}

interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The two washes, as the background's gradient layers, for a content box in
 * a window of `vw` by `vh` pixels. Pure.
 *
 * Violet sits 8% outside the content's top-right corner, so its brightest
 * part peeks in toward that corner.
 *
 * Orange is an even tint rising from the window's bottom-left corner. It
 * used to sit 8% outside the content's bottom-left corner, and on a short
 * page that corner is mid-height on the left: the orange read as a spot
 * there, with its rings. Its centre now stays outside the window, past its
 * left edge and below the content or the window's bottom, whichever is
 * lower, and its gradient is wide (110% by 90% of the window) and fades out
 * late (70%), so what shows is a broad, even tint.
 */
export function washLayers(rect: Rect, vw: number, vh: number): string[] {
  const violetX = rect.right + vw * 0.08;
  const violetY = rect.top - vh * 0.08;
  const orangeX = -vw * 0.08;
  const orangeY = Math.max(rect.bottom, vh) + vh * 0.08;
  return [
    `radial-gradient(ellipse 80% 70% at ${violetX}px ${violetY}px, var(--wm-blob-1-color, rgba(106, 75, 255, 0.12)) 0%, transparent 60%)`,
    `radial-gradient(ellipse 110% 90% at ${orangeX}px ${orangeY}px, var(--wm-blob-2-color, rgba(255, 106, 61, 0.065)) 0%, transparent 70%)`,
  ];
}

/**
 * Decorative background wash anchored to a content container's corners.
 *
 * Renders a single `position: fixed` element covering the viewport whose
 * `background` is two stacked `radial-gradient`s (washLayers): violet near
 * the target's top-right corner, orange from the window's bottom-left
 * corner. The stacked gradients blend into a continuous wash (no visible
 * circle silhouette) in one DOM element.
 *
 * Per-theme color is supplied via the `--wm-blob-1-color` and
 * `--wm-blob-2-color` CSS custom properties. Each is an rgba color with
 * the theme's alpha baked in (the component uses the value directly as
 * the gradient's inner stop, fading to transparent at the outer stop).
 * The alphas are low, 0.065 to 0.12 (GlobalStyles): a wash behind
 * the content, never a colour field. The fallbacks are the light theme's.
 */
export const Blobs: React.FC<BlobsProps> = ({ targetRef }) => {
  const fallbackRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const update = useCallback(() => {
    const el = targetRef?.current ?? fallbackRef.current?.parentElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, right: r.right, bottom: r.bottom, left: r.left });
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef?.current ?? fallbackRef.current?.parentElement;
    if (!el) return;

    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);

    window.addEventListener('scroll', update, { passive: true, capture: true });
    window.addEventListener('resize', update, { passive: true });

    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [targetRef, update]);

  if (!rect) {
    return <span ref={fallbackRef} style={{ display: 'none' }} />;
  }

  const style: CSSProperties = {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: -1,
    background: washLayers(rect, window.innerWidth, window.innerHeight).join(', '),
  };

  return (
    <>
      <span ref={fallbackRef} style={{ display: 'none' }} />
      {/* className `wm-blobs` is a theming hook: GlobalStyles sets its
          blend there, so a consumer never has to override the component. */}
      <div className="wm-blobs" style={style} aria-hidden />
    </>
  );
};
