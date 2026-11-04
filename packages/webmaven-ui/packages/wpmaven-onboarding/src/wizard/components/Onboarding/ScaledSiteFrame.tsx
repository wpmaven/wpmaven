import React, { useLayoutEffect, useRef, useState } from 'react';
import s from './ScaledSiteFrame.module.css';
import { PREVIEW_COPY } from './previewCopy';

/**
 * A desktop-rendered site preview that fits any pane. The iframe lays the
 * document out at a fixed desktop width (default 1440px) and is then scaled
 * down with `transform: scale(paneWidth / designWidth)` (origin top-left) so
 * the preview reads as a real desktop site instead of the mobile-ish layout
 * you get from rendering at pane width. The iframe's height is compensated
 * (paneHeight / scale) so the scaled result fills the host exactly; a
 * ResizeObserver recomputes both on every pane resize.
 *
 * The iframe mounts immediately, even before the first measurement — on
 * phones the preview slot can be `display: none` (Build|Preview toggle
 * closed) and the srcdoc must still load so `onLoad` fires the "preview
 * settled" signal the success CTA waits on.
 *
 * Host geometry: fills its parent (flex-fill inside BrowserFrame's viewport
 * slot, or any sized box) with `overflow: hidden` clipping the compensation
 * remainder.
 */
export interface ScaledSiteFrameProps {
  /** Inline document (self-contained preview HTML). Provide srcDoc OR src. */
  srcDoc?: string;
  /** Document URL (e.g. an in-browser WP route). Provide srcDoc OR src. */
  src?: string;
  /** Desktop layout width the document renders at before scaling. */
  designWidth?: number;
  /** iframe sandbox attribute — omitted entirely when undefined. */
  sandbox?: string;
  /** false = display-only: pointer events never reach the document (the
   *  generating ladder's static rung; interaction belongs to the final
   *  WordPress). Default true. */
  interactive?: boolean;
  /** Interaction mode, taking precedence over `interactive`:
   *  - 'interactive': everything works. The api-served static preview ships
   *    with a server-injected lock script, so this mode also posts
   *    `wm:unlock` into the frame to disarm it (claimed-site previews, the
   *    playground-failed fallback).
   *  - 'browse': scrolling stays native, clicks and typing are swallowed by
   *    the in-document lock script, which reports `wm:preview-blocked` to
   *    this window (the pane shows its "still working" notice).
   *  - 'inert': legacy full lock — pointer events never reach the document. */
  mode?: 'interactive' | 'browse' | 'inert';
  title?: string;
  onLoad?: () => void;
  className?: string;
}

/**
 * The scaling shell alone: measures its host, lays its child out at
 * `designWidth` and scales it down to fit. ScaledSiteFrame is this plus an
 * iframe; the Playground rung wraps its own live iframe in it so both rungs
 * share one scaling implementation (the child must fill 100% × 100%).
 */
export function ScaledViewport({
  designWidth = 1440,
  className,
  children,
}: {
  designWidth?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      // Ignore zero-size passes (hidden phone slot): keep the last real
      // geometry so a reopened pane doesn't restart from nothing.
      if (r.width < 1 || r.height < 1) return;
      setBox((prev) => (prev && prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = box ? box.w / designWidth : 1;
  const geometry: React.CSSProperties = box
    ? {
        width: designWidth,
        // Ceil so the scaled height never lands a hair short of the host —
        // the sub-pixel excess is clipped by the host's overflow:hidden.
        height: Math.ceil(box.h / scale),
        transform: `scale(${scale})`,
      }
    : // Unmeasured (first paint, or a display:none phone slot): keep the
      // document loading at desktop width; nothing is visible yet anyway.
      { width: designWidth, height: Math.round(designWidth * 0.75) };

  return (
    <div ref={hostRef} className={className ? `${s.host} ${className}` : s.host}>
      <div className={s.doc} style={geometry}>
        {children}
      </div>
    </div>
  );
}

export default function ScaledSiteFrame({
  srcDoc,
  src,
  designWidth = 1440,
  sandbox,
  interactive = true,
  mode,
  title = PREVIEW_COPY.sitePreview,
  onLoad,
  className,
}: ScaledSiteFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const effectiveMode = mode ?? (interactive ? 'interactive' : 'inert');

  // Interactive over a server-locked document: disarm the lock. The lock
  // script may attach after our first post (scripts at the end of <body>),
  // so the unlock repeats briefly; extra posts are harmless no-ops.
  useLayoutEffect(() => {
    if (effectiveMode !== 'interactive') return;
    const post = () => {
      try {
        frameRef.current?.contentWindow?.postMessage({ type: 'wm:unlock' }, '*'); // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration -- the message carries no data, only { type: 'wm:unlock' }, and the preview frame has no origin to name (a sandboxed srcDoc) or one that changes with the host
      } catch {
        /* cross-origin frames accept postMessage; anything else is moot */
      }
    };
    post();
    const timer = window.setInterval(post, 400);
    const stop = window.setTimeout(() => window.clearInterval(timer), 4000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [effectiveMode, src, srcDoc]);

  return (
    <ScaledViewport designWidth={designWidth} className={className}>
      <iframe
        ref={frameRef}
        style={{ display: 'block', width: '100%', height: '100%', border: 0, pointerEvents: effectiveMode === 'inert' ? 'none' : undefined }}
        sandbox={sandbox}
        srcDoc={srcDoc}
        src={src}
        title={title}
        onLoad={onLoad}
      />
    </ScaledViewport>
  );
}
