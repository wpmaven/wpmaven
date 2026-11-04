import React, { useEffect, useRef, useState } from 'react';
import s from './Scrollbar.module.css';

export interface ScrollbarProps {
  /** Element whose scroll position this scrollbar mirrors and controls. */
  targetRef: React.RefObject<HTMLElement | null>;
  /** Vertical (default) or horizontal. */
  orientation?: 'vertical' | 'horizontal';
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Decoupled custom scrollbar.
 *
 * Renders a thin themed track + thumb that mirrors the scroll position
 * of an external target element (passed via `targetRef`). The target
 * itself should hide its native scrollbar (`scrollbar-width: none` /
 * `::-webkit-scrollbar { display: none }`).
 *
 * Default position is `absolute` filling the right edge of its parent
 * — wrap consumers in a `position: relative` container, or override
 * via `className` / `style`.
 *
 * Styled with design-system tokens (`--glass-border`, `--glass-border-hover`).
 */
/** Idle delay before the scrollbar fades out after the last scroll. */
const FADE_AFTER_MS = 800;

export const Scrollbar: React.FC<ScrollbarProps> = ({
  targetRef,
  orientation = 'vertical',
  className,
  style,
}) => {
  const [thumbSize, setThumbSize] = useState(0);
  const [thumbPos, setThumbPos] = useState(0);
  const [hasScroll, setHasScroll] = useState(false);
  const [active, setActive] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startCoord: number; startScroll: number } | null>(null);
  const fadeTimer = useRef<number | null>(null);
  const isDragging = useRef(false);

  /** Show now; restart the fade-out timer (unless mid-drag — drag keeps
   *  the scrollbar pinned, fade is restarted on drag end). */
  const poke = () => {
    setActive(true);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    if (isDragging.current) return;
    fadeTimer.current = window.setTimeout(() => setActive(false), FADE_AFTER_MS);
  };

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    const update = () => {
      const track = trackRef.current;
      if (!track) return;
      const scroll = orientation === 'vertical' ? el.scrollTop : el.scrollLeft;
      const total = orientation === 'vertical' ? el.scrollHeight : el.scrollWidth;
      const visibleSize = orientation === 'vertical' ? el.clientHeight : el.clientWidth;
      if (total <= visibleSize) {
        setHasScroll(false);
        return;
      }
      setHasScroll(true);
      const trackSize = orientation === 'vertical' ? track.clientHeight : track.clientWidth;
      const minThumb = 24;
      const ratio = visibleSize / total;
      const tSize = Math.max(minThumb, Math.round(ratio * trackSize));
      const maxScroll = total - visibleSize;
      const pos = maxScroll > 0
        ? Math.round((scroll / maxScroll) * (trackSize - tSize))
        : 0;
      setThumbSize(tSize);
      setThumbPos(pos);
    };

    const onScroll = () => {
      update();
      poke();
    };

    update();
    poke(); // brief flash on mount so users know the column is scrollable
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Children can change size independently of the container.
    Array.from(el.children).forEach((c) => ro.observe(c));
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, [targetRef, orientation]);

  const onThumbMouseDown = (e: React.MouseEvent) => {
    const el = targetRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    e.preventDefault();
    const startCoord = orientation === 'vertical' ? e.clientY : e.clientX;
    const startScroll = orientation === 'vertical' ? el.scrollTop : el.scrollLeft;
    dragState.current = { startCoord, startScroll };
    isDragging.current = true;
    setActive(true);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = orientation === 'vertical' ? 'ns-resize' : 'ew-resize';

    const onMove = (ev: MouseEvent) => {
      const ds = dragState.current;
      if (!ds) return;
      const coord = orientation === 'vertical' ? ev.clientY : ev.clientX;
      const total = orientation === 'vertical' ? el.scrollHeight : el.scrollWidth;
      const visibleSize = orientation === 'vertical' ? el.clientHeight : el.clientWidth;
      const trackSize = orientation === 'vertical' ? track.clientHeight : track.clientWidth;
      const minThumb = 24;
      const tSize = Math.max(minThumb, (visibleSize / total) * trackSize);
      const trackUsable = trackSize - tSize;
      if (trackUsable <= 0) return;
      const delta = coord - ds.startCoord;
      const maxScroll = total - visibleSize;
      const next = ds.startScroll + (delta / trackUsable) * maxScroll;
      if (orientation === 'vertical') el.scrollTop = next;
      else el.scrollLeft = next;
    };
    const onUp = () => {
      dragState.current = null;
      isDragging.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Restart fade-out countdown after drag ends.
      poke();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Click on track (outside thumb) jumps the scroll position
  const onTrackMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = targetRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    if (e.target !== track) return; // only handle bare-track clicks, not thumb
    const rect = track.getBoundingClientRect();
    const total = orientation === 'vertical' ? el.scrollHeight : el.scrollWidth;
    const visibleSize = orientation === 'vertical' ? el.clientHeight : el.clientWidth;
    const trackSize = orientation === 'vertical' ? track.clientHeight : track.clientWidth;
    const minThumb = 24;
    const tSize = Math.max(minThumb, (visibleSize / total) * trackSize);
    const click = orientation === 'vertical' ? e.clientY - rect.top : e.clientX - rect.left;
    const target = (click - tSize / 2) / (trackSize - tSize);
    const clamped = Math.max(0, Math.min(1, target));
    const next = clamped * (total - visibleSize);
    if (orientation === 'vertical') el.scrollTop = next;
    else el.scrollLeft = next;
  };

  const isVertical = orientation === 'vertical';
  const visible = hasScroll && active;
  return (
    <div
      ref={trackRef}
      className={`${s.track} ${isVertical ? s.vertical : s.horizontal} ${className || ''}`}
      style={{
        ...style,
        opacity: visible ? undefined : 0,
        pointerEvents: visible ? undefined : 'none',
      }}
      aria-hidden="true"
      onMouseDown={onTrackMouseDown}
    >
      <div
        className={s.thumb}
        style={{
          height: isVertical ? thumbSize : undefined,
          width: !isVertical ? thumbSize : undefined,
          transform: isVertical
            ? `translateY(${thumbPos}px)`
            : `translateX(${thumbPos}px)`,
        }}
        onMouseDown={onThumbMouseDown}
      />
    </div>
  );
};

export default Scrollbar;
