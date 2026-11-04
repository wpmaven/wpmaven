import React, {
  ReactNode,
  useState,
  useEffect,
  useRef,
  useLayoutEffect,
} from 'react';
import s from './RollingTabs.module.css';

export interface RollingTabItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  content: ReactNode;
}

export interface RollingTabsProps {
  items: RollingTabItem[];

  /** Controlled active key. If omitted, the component manages its own state. */
  activeKey?: string;
  /** Initial active key when uncontrolled. Defaults to the first item. */
  defaultActiveKey?: string;
  /** Called whenever the active item changes. */
  onChange?: (key: string) => void;

  /** Roll duration in ms. Default 650. */
  duration?: number;
  /** Minimum viewport height in px. Default 220. */
  minHeight?: number;
  /** Perspective depth in px. Higher = flatter, lower = more dramatic 3D. Default 1400. */
  perspective?: number;

  /**
   * Auto-rotate to the next tab every N ms. Disabled when omitted or
   * <= 0. The cycle pauses while the mouse hovers the active panel and
   * resets whenever the user clicks a tab manually.
   */
  autoRotateMs?: number;

  /**
   * When true, each face's content is stretched to fill the wrapper's
   * height (which is the max of all face heights). Use when consumers
   * want every panel to look the same size — pair with internal scroll
   * inside short panels so content overflow stays contained.
   *
   * Default: false (faces render at their natural height).
   */
  equalHeight?: boolean;

  className?: string;
}

/**
 * 3D "rolling cylinder" tabs. The N tab panels are arranged as faces of
 * a regular N-sided prism rotating around its horizontal axis. Clicking
 * a tab rolls the cylinder so the chosen face lands at the front, taking
 * the shortest path. Honors `prefers-reduced-motion`. Auto-locks the
 * viewport to the tallest panel's height so rotation stays clean.
 *
 * Visually best for 2–6 items. Larger N still works but each click only
 * rotates a small angle, so the rolling feels subtle.
 */
export const RollingTabs: React.FC<RollingTabsProps> = ({
  items,
  activeKey: controlledKey,
  defaultActiveKey,
  onChange,
  duration = 650,
  minHeight = 220,
  perspective = 1400,
  autoRotateMs,
  equalHeight = false,
  className,
}) => {
  const isControlled = controlledKey !== undefined;
  const [internalKey, setInternalKey] = useState<string>(
    () => defaultActiveKey ?? items[0]?.key ?? '',
  );
  const activeKey = isControlled ? controlledKey! : internalKey;
  const activeIdx = Math.max(0, items.findIndex((i) => i.key === activeKey));

  // Cumulative rotation — never resets, always picks shortest delta.
  const [rotation, setRotation] = useState(0);
  // Per-face natural height. The wrapper resizes to the active face;
  // the cylinder geometry uses the tallest so rotations stay smooth.
  const [faceHeights, setFaceHeights] = useState<number[]>(() => items.map(() => minHeight));
  const [reducedMotion, setReducedMotion] = useState(false);
  const [rolling, setRolling] = useState(false);
  const rollingTimer = useRef<number | undefined>(undefined);
  const innerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const prevIdx = useRef(activeIdx);
  // Bumped on every cycle reset (manual click OR auto-advance) — used
  // as a React key on the progress fill so the CSS animation restarts.
  const [cycleId, setCycleId] = useState(0);
  const [paused, setPaused] = useState(false);

  // Honor OS-level reduced-motion preference.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  // Measure each face's INNER wrapper — wrapper resizes to the active
  // one, cylinder geometry uses the tallest. The face itself is
  // `position: absolute; inset: 0` so its own size is locked to the
  // wrapper; we measure the always-present inner div whose height
  // reflects the user's content (even when content starts as null).
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const heights = innerRefs.current
        .slice(0, items.length)
        .map((inner) => Math.max(minHeight, inner?.offsetHeight ?? 0));
      setFaceHeights((prev) => {
        // Skip update if nothing changed (avoid render thrash).
        if (prev.length === heights.length && prev.every((h, i) => h === heights[i])) return prev;
        return heights;
      });
    };
    const ro = new ResizeObserver(measure);
    innerRefs.current.forEach((inner) => inner && ro.observe(inner));
    measure();
    return () => ro.disconnect();
  }, [items.length, minHeight]);

  // Drive the roll from activeIdx changes. useLayoutEffect (not useEffect)
  // runs synchronously before paint — the old face never flickers to
  // opacity 0 between the activeIdx update and the rolling=true update.
  useLayoutEffect(() => {
    const fromIdx = prevIdx.current;
    const toIdx = activeIdx;
    if (toIdx === fromIdx || items.length < 2) {
      prevIdx.current = toIdx;
      return;
    }
    const n = items.length;
    // Shortest-path delta around the cylinder (e.g. 0→2 of 3 picks -1, not +2).
    const candidates = [toIdx - fromIdx, toIdx - fromIdx + n, toIdx - fromIdx - n];
    const shortest = candidates.reduce(
      (min, c) => (Math.abs(c) < Math.abs(min) ? c : min),
    );
    const faceAngle = 360 / n;
    setRotation((r) => r - shortest * faceAngle);
    setRolling(true);
    if (rollingTimer.current) clearTimeout(rollingTimer.current);
    rollingTimer.current = window.setTimeout(() => setRolling(false), duration + 50);
    prevIdx.current = toIdx;
  }, [activeIdx, items.length, duration]);

  // Cleanup on unmount.
  useEffect(() => () => {
    if (rollingTimer.current) clearTimeout(rollingTimer.current);
  }, []);

  // Reset the auto-rotation cycle on every active-tab change (manual or auto).
  useEffect(() => {
    setCycleId((c) => c + 1);
  }, [activeIdx]);

  // Schedule the next auto-advance. Reset whenever the cycle restarts
  // or pause toggles. Pausing clears the timer; resuming starts a new
  // full cycle (we don't try to preserve "remaining time" across pauses
  // — restarting the bar from 0 keeps the visual honest).
  useEffect(() => {
    if (!autoRotateMs || autoRotateMs <= 0 || items.length < 2 || paused) return;
    const t = window.setTimeout(() => {
      const nextIdx = (activeIdx + 1) % items.length;
      if (!isControlled) setInternalKey(items[nextIdx].key);
      onChange?.(items[nextIdx].key);
    }, autoRotateMs);
    return () => clearTimeout(t);
  }, [cycleId, paused, autoRotateMs, items, activeIdx, isControlled, onChange]);

  const handleClick = (idx: number) => {
    if (idx === activeIdx) return;
    // Pre-flip rolling so the in-flight render that updates activeIdx
    // already sees rolling=true — no blink waiting for the layout effect.
    setRolling(true);
    if (rollingTimer.current) clearTimeout(rollingTimer.current);
    rollingTimer.current = window.setTimeout(() => setRolling(false), duration + 50);
    if (!isControlled) setInternalKey(items[idx].key);
    onChange?.(items[idx].key);
  };

  // Cylinder geometry: regular N-gon, R = (h/2) / tan(π/N).
  // Lock the wrapper to the TALLEST face so the page layout below
  // doesn't shift every time the user (or auto-rotate) switches tabs.
  // For N=1 there's no rotation to do; for N=2 tan(π/2) is infinite,
  // so fall back to a sensible radius (h/2).
  const wrapperH = Math.max(minHeight, ...faceHeights);
  const radius = items.length < 2
    ? 0
    : items.length === 2
      ? wrapperH / 2
      : wrapperH / 2 / Math.tan(Math.PI / items.length);

  // N=1: render the panel directly, no cylinder needed.
  if (items.length === 0) return null;
  if (items.length === 1) {
    return (
      <div className={className}>
        {items[0].icon || items[0].label ? (
          <div className={s.tabRow}>
            <button type="button" className={`${s.tab} ${s.tabActive}`}>
              {items[0].icon}
              {items[0].label}
            </button>
          </div>
        ) : null}
        <div>{items[0].content}</div>
      </div>
    );
  }

  const faceAngle = 360 / items.length;

  return (
    <div className={className}>
      <div className={s.tabRow} role="tablist">
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={i === activeIdx}
            className={`${s.tab} ${i === activeIdx ? s.tabActive : ''}`}
            onClick={() => handleClick(i)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
        {autoRotateMs && autoRotateMs > 0 && items.length > 1 && (
          <div className={s.progressTrack} aria-hidden="true">
            <div
              key={cycleId}
              className={s.progressFill}
              style={{
                animationDuration: `${autoRotateMs}ms`,
                animationPlayState: paused || reducedMotion ? 'paused' : 'running',
              }}
            />
          </div>
        )}
      </div>

      <div
        className={s.wrapper}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        style={{
          height: wrapperH,
          // Exposed as a CSS variable so equalHeight faces (and any
          // consumer that wants to align to the cylinder) can read it.
          ['--rt-face-height' as any]: `${wrapperH}px`,
        }}
      >
        <div
          className={s.viewport}
          style={{ perspective: `${perspective}px` }}
        >
          <div
            className={s.cylinder}
            style={{
              transition: reducedMotion
                ? 'none'
                : `transform ${duration}ms cubic-bezier(0.7, 0.0, 0.2, 1)`,
              transform: `translateZ(-${radius}px) rotateX(${rotation}deg)`,
            }}
          >
          {items.map((item, i) => {
            const isActive = i === activeIdx;
            return (
              <div
                key={item.key}
                role="tabpanel"
                aria-hidden={!isActive}
                className={s.face}
                style={{
                  transform: `rotateX(${i * faceAngle}deg) translateZ(${radius}px)`,
                  pointerEvents: isActive ? 'auto' : 'none',
                  // Stay opaque while rolling so all faces are visible
                  // mid-transition; snap inactive ones to invisible at
                  // rest (backface-visibility doesn't reliably suppress
                  // backdrop-filter ghosting on nested glass cards).
                  opacity: isActive || rolling ? 1 : 0,
                  transition: reducedMotion ? 'none' : 'opacity 120ms linear',
                }}
              >
                <div
                  ref={(el) => { innerRefs.current[i] = el; }}
                  className={s.faceInner}
                  // `min-height` grows monotonically: short faces stretch
                  // to the tallest, but the tallest is never clipped
                  // (its natural content sets the wrapper height first).
                  style={equalHeight ? { minHeight: `var(--rt-face-height)` } : undefined}
                >
                  {item.content}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
};

export default RollingTabs;
