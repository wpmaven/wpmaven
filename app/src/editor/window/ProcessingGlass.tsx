import React, { useEffect, useRef, useState } from 'react';
import { BrandLogoAnimation } from '../../components/BrandLoader';
import { stageBox, type IframeOffset } from '../components/SiteIframe';
import type { ElementLook, ElementRect } from './elementEdit';

/**
 * The glass over the part WPMaven works on (2026-10-19), from the window's
 * change asked to its preview: frosted glass over the part, WPMaven's rainbow
 * (the six pastels of the primary button's ring) as two lights turning along
 * its edge, and what is being done in a pill in the middle, with the mark at
 * work. When the preview is ready the light closes into the full ring,
 * brightens and fades; a change that fails or is dropped only fades.
 *
 * Drawn over the frame like the selection's outline, which it replaces while
 * it shows. Its corners and its tint follow the part as the frame read it
 * (look): its radius, and the light or dark site behind it. One per change
 * of the window: each stays on its part while the owner works elsewhere.
 */

/** The glass's styles: drawn once by the layer that holds the glasses. */
export const GLASS_CSS = `
@property --wme-pe-angle{syntax:'<angle>';initial-value:0deg;inherits:true}
@keyframes wme-pe-turn{to{--wme-pe-angle:360deg}}
@keyframes wme-pe-in{from{opacity:0;transform:scale(.985)}}
@keyframes wme-pe-flash{0%{filter:none}35%{filter:brightness(1.6)}100%{filter:brightness(1)}}
.wme-pe{--r1:#47C8D8;--r2:#5B9BD5;--r3:#8E85C2;--r4:#D08EC8;--r5:#E8919F;--r6:#F2AA84;--edge:1.5px;--inner:12px;--inner-blur:10px;--inner-strength:.95;--halo-strength:.5;--halo-blur:22px;
  position:absolute;border-radius:var(--rad);pointer-events:none;transition:opacity .3s ease;
  animation:wme-pe-turn 4s linear infinite,wme-pe-in .45s cubic-bezier(.2,.8,.2,1);
  --lights:conic-gradient(from var(--wme-pe-angle),transparent 0deg,var(--r1) 22deg,var(--r2) 44deg,var(--r3) 66deg,var(--r4) 88deg,var(--r5) 110deg,var(--r6) 130deg,transparent 156deg,transparent 180deg,var(--r6) 202deg,var(--r5) 224deg,var(--r4) 246deg,var(--r3) 268deg,var(--r2) 290deg,var(--r1) 310deg,transparent 336deg)}
.wme-pe[data-tone="dark"]{--glass-tint:rgba(12,12,16,.55);--glass-sheen:rgba(255,255,255,.06);--site-ink:#ececf0;--site-bg:#121216;--wm-mark-ink:#F3F3F5;--wm-mark-violet:#8B73FF;--wm-mark-orange:#FF6A3D}
.wme-pe[data-tone="light"]{--glass-tint:rgba(255,255,255,.34);--glass-sheen:rgba(255,255,255,.4);--site-ink:#17181c;--site-bg:#f6f4ef;--wm-mark-ink:#15121F;--wm-mark-violet:#6A4BFF;--wm-mark-orange:#FF6A3D;--inner:9px;--inner-blur:8px;--inner-strength:.6;--halo-strength:.32}
.wme-pe[data-size="small"]{--edge:1.25px;--inner:8px;--inner-blur:7px;--halo-blur:12px}
.wme-pe-glass{position:absolute;inset:0;border-radius:inherit;background:linear-gradient(160deg,var(--glass-sheen),transparent 45%),var(--glass-tint);-webkit-backdrop-filter:blur(2px) saturate(1.25);backdrop-filter:blur(2px) saturate(1.25)}
.wme-pe-ring{position:absolute;inset:0;border-radius:var(--rad);border:var(--w) solid transparent;background:var(--lights) border-box;-webkit-mask:linear-gradient(#000 0 0) padding-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) padding-box exclude,linear-gradient(#000 0 0)}
.wme-pe-inner{position:absolute;inset:0;border-radius:inherit;overflow:hidden;opacity:var(--inner-strength)}
.wme-pe-inner>div{position:absolute;inset:0;filter:blur(var(--inner-blur))}
.wme-pe-inner .wme-pe-ring{--w:var(--inner)}
.wme-pe-halo{position:absolute;inset:-3px;opacity:var(--halo-strength);filter:blur(var(--halo-blur))}
.wme-pe-halo .wme-pe-ring{--w:5px;--rad:calc(var(--rad) + 3px)}
.wme-pe-edge,.wme-pe-core{position:absolute;inset:0}
.wme-pe-edge .wme-pe-ring{--w:var(--edge)}
.wme-pe-core{opacity:.9}
.wme-pe-core .wme-pe-ring{--w:1px;filter:brightness(2) saturate(.5)}
.wme-pe[data-tone="light"] .wme-pe-core{opacity:.85}
.wme-pe[data-tone="light"] .wme-pe-core .wme-pe-ring{filter:brightness(1.15) saturate(1.2)}
.wme-pe[data-tone="light"] .wme-pe-edge .wme-pe-ring{--w:2px;filter:saturate(1.5)}
.wme-pe-status{position:absolute;left:50%;transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:9px;max-width:calc(100% - 16px);white-space:nowrap;padding:8px 14px;border-radius:999px;font:560 13px/1.2 "DM Sans",sans-serif;color:var(--site-ink);background:color-mix(in srgb,var(--site-bg) 55%,transparent);border:1px solid color-mix(in srgb,var(--site-ink) 12%,transparent);transition:opacity .2s}
.wme-pe-status>span:last-child{overflow:hidden;text-overflow:ellipsis}
.wme-pe[data-size="small"] .wme-pe-status{display:none}
.wme-pe[data-end="done"]{--lights:conic-gradient(from var(--wme-pe-angle),var(--r1),var(--r2),var(--r3),var(--r4),var(--r5),var(--r6),var(--r1));opacity:0;transition:opacity .7s ease .45s}
.wme-pe[data-end="done"] .wme-pe-glass{opacity:0;transition:opacity .5s ease .2s}
.wme-pe[data-end="done"] .wme-pe-edge,.wme-pe[data-end="done"] .wme-pe-halo{animation:wme-pe-flash .9s ease forwards}
.wme-pe[data-end] .wme-pe-status{opacity:0}
.wme-pe[data-end="off"]{opacity:0}
@media (prefers-reduced-motion:reduce){.wme-pe{animation-duration:16s,.45s}.wme-pe[data-end="done"] .wme-pe-edge,.wme-pe[data-end="done"] .wme-pe-halo{animation:none}}
`;

/** How long the ending shows: the light closing then fading, or the fade alone. */
const END_MS = { done: 1300, off: 350 } as const;

/** The part under the glass, on the page shown. */
export interface GlassPart { rect: ElementRect; look?: ElementLook; category: string }

interface Glass { words: string; end: '' | 'done' | 'off'; n: number }

/**
 * state: working (the change is being prepared or published), ready (it
 * came: the light closes), stopped (it failed or was dropped: it fades).
 * part: null while the part is not on the page shown.
 */
export function ProcessingGlass({ part, state, words, iframeOffset }: {
  part: GlassPart | null;
  state: 'working' | 'ready' | 'stopped';
  /** What the pill says ("Shortening"). */
  words: string;
  iframeOffset: IframeOffset;
}) {
  const [glass, setGlass] = useState<Glass | null>(null);
  // The part as last seen: the ending plays where it was.
  const seen = useRef<GlassPart | null>(null);
  if (part) seen.current = part;
  const shown = !!part;

  useEffect(() => {
    if (state === 'working') {
      setGlass((g) => (!shown ? null : g && !g.end ? (g.words === words ? g : { ...g, words }) : { words, end: '', n: (g?.n ?? 0) + 1 }));
      return;
    }
    setGlass((g) => (g && !g.end ? { ...g, end: state === 'ready' ? 'done' : 'off' } : g));
  }, [state, shown, words]);

  useEffect(() => {
    if (!glass?.end) return;
    const t = window.setTimeout(() => setGlass(null), END_MS[glass.end]);
    return () => window.clearTimeout(t);
  }, [glass]);

  const el = seen.current;
  if (!glass || !el) return null;

  const scale = iframeOffset.scale ?? 1;
  const r = stageBox(el.rect, scale);
  // Words sit tight in their box: the glass gives them a little room and soft corners, as a part with its own corners keeps them.
  const text = el.category.startsWith('text-');
  const own = (el.look?.radius ?? 0) * scale;
  const pad = text && !own ? 6 : 0;
  const rad = own ? own + pad : text ? 10 : 0;
  const box = { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
  // A button or a line of words keeps the light only: the pill would cover it (the window says what is being done).
  const small = box.width < 200 || box.height < 48;
  // The pill in the middle of the part's visible stretch, when the part runs past the frame's edges.
  const shownTop = Math.max(box.top, 0);
  const shownBottom = Math.min(box.top + box.height, iframeOffset.height || box.top + box.height);
  const pillAt = shownBottom > shownTop ? (shownTop + shownBottom) / 2 - box.top : box.height / 2;

  return (
    <div
      key={glass.n}
      className="wme-pe"
      data-testid="editor-processing"
      data-tone={el.look?.tone ?? 'light'}
      data-end={glass.end || undefined}
      data-size={small ? 'small' : undefined}
      aria-hidden="true"
      style={{ ...box, '--rad': `${rad}px` } as React.CSSProperties}
    >
      <div className="wme-pe-halo"><div className="wme-pe-ring" /></div>
      <div className="wme-pe-glass" />
      <div className="wme-pe-inner"><div><div className="wme-pe-ring" /></div></div>
      <div className="wme-pe-edge"><div className="wme-pe-ring" /></div>
      <div className="wme-pe-core"><div className="wme-pe-ring" /></div>
      <span className="wme-pe-status" style={{ top: pillAt }}>
        <BrandLogoAnimation state="working" size={18} />
        <span>{glass.words}</span>
      </span>
    </div>
  );
}
