import React, { useRef, useEffect, useMemo } from 'react';
import { generateQRMatrix, isFinderModule, markedQRMatrix } from '../lib/qr-encoder';
import { WMLogo } from './WMLogo';
import { brand, colors } from '../foundation/tokens';
import s from './QRCode.module.css';

export interface QRCodeProps {
  /** URL or text to encode */
  value: string;
  /** Width/height in px */
  size?: number;
  /** Center logo (default: WMLogo) */
  logo?: React.ReactNode;
  /** Module shape */
  dotStyle?: 'square' | 'rounded' | 'circle';
  /**
   * Ocean-pastel gradient on dots, from the classic drawing. Setting it (true
   * or false) or finderColor keeps the classic drawing: a round hole, no quiet
   * zone, dots and finders in these colours. Left out, the code is drawn in
   * the brand: ink dots, violet finder centres, the mark on a paper tile in a
   * square hole, on white with a quiet zone.
   */
  gradient?: boolean;
  /** Finder pattern color (classic drawing) */
  finderColor?: string;
  /** Background color (default: white in the brand drawing, transparent in the classic one) */
  bgColor?: string;
  className?: string;
}

const OCEAN_GRADIENT_COLORS = [
  colors.cyan,
  colors.blue,
  colors.purple,
  colors.mauve,
  colors.rose,
  colors.peach,
];

/** The quiet zone around the brand drawing, in modules: the 4 the QR spec asks for. */
const QUIET_ZONE = 4;
/** The brand drawing never shrinks a module under this, in CSS px, to free its centre for the mark. */
const MIN_MODULE_PX = 2;
/** The favicon tile's corner radius (15 of its 64 units), used for the tile and the finders. */
const TILE_RADIUS = 15 / 64;
/** Where the favicon tile places the mark: at (2.974, 5.146) of its 64 units, 55.88 wide. */
const TILE_MARK = { x: 2.974 / 64, y: 5.146 / 64, size: 55.88 / 64 };
/** Room between the tile and the hole's edge, in modules: the mark's quiet margin. */
const TILE_MARGIN = 0.5;
/** Dot half-side over the module: a little smaller than the cell, for the gaps. */
const DOT = 0.42;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function lerpRgb(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

function getGradientColor(x: number, y: number, size: number): string {
  // Diagonal gradient: top-left → bottom-right
  const t = (x + y) / (size * 2);
  const segmentCount = OCEAN_GRADIENT_COLORS.length - 1;
  const segment = Math.min(Math.floor(t * segmentCount), segmentCount - 1);
  const localT = (t * segmentCount) - segment;
  const a = hexToRgb(OCEAN_GRADIENT_COLORS[segment]);
  const b = hexToRgb(OCEAN_GRADIENT_COLORS[segment + 1]);
  return lerpRgb(a, b, localT);
}

/** What the canvas draws, settled from the props before any painting. */
export type QRDrawing =
  | {
      look: 'classic';
      matrix: boolean[][];
      size: number;
      dotStyle: NonNullable<QRCodeProps['dotStyle']>;
      gradient: boolean;
      finderColor: string;
      bgColor: string;
    }
  | {
      look: 'brand';
      matrix: boolean[][];
      size: number;
      dotStyle: NonNullable<QRCodeProps['dotStyle']>;
      /** Side of the centred square left for the mark, in modules; 0 for none. */
      hole: number;
      bgColor: string;
    };

export function qrDrawing({
  value,
  size = 200,
  dotStyle = 'rounded',
  gradient,
  finderColor,
  bgColor,
}: QRCodeProps): QRDrawing {
  // The two-step sign-in and any caller written for the classic drawing set
  // its colours; they keep it, unchanged (2026-10-11).
  if (gradient !== undefined || finderColor !== undefined) {
    return {
      look: 'classic',
      matrix: generateQRMatrix(value),
      size,
      dotStyle,
      gradient: gradient ?? true,
      finderColor: finderColor || colors.purple,
      bgColor: bgColor ?? 'transparent',
    };
  }
  const maxVersion = Math.floor((size / MIN_MODULE_PX - 2 * QUIET_ZONE - 17) / 4);
  const { matrix, hole } = markedQRMatrix(value, maxVersion);
  return { look: 'brand', matrix, size, dotStyle, hole, bgColor: bgColor ?? '#ffffff' };
}

/** The first and last row (and column) of a centred hole `hole` modules wide. */
export function holeSpan(moduleCount: number, hole: number): [number, number] {
  const first = (moduleCount - hole) / 2;
  return [first, first + hole - 1];
}

/**
 * The brand drawing's tile and mark, in px (2026-10-11): the favicon's
 * rounded tile, a half module inside the hole, and the mark's box in the
 * tile where the favicon puts it. null when the code has no hole.
 */
export function markTile(d: Extract<QRDrawing, { look: 'brand' }>): {
  tile: number;
  radius: number;
  mark: { left: number; top: number; size: number };
} | null {
  if (d.hole === 0) return null;
  const cell = d.size / (d.matrix.length + 2 * QUIET_ZONE);
  const tile = (d.hole - 2 * TILE_MARGIN) * cell;
  return {
    tile,
    radius: tile * TILE_RADIUS,
    mark: { left: tile * TILE_MARK.x, top: tile * TILE_MARK.y, size: tile * TILE_MARK.size },
  };
}

/**
 * A colour a camera reads as dark on white, or `fallback`: a QR code is read
 * dark on light, so a light theme value (the dark theme's #F4F3F8 ink, its
 * lifted violet) or one that cannot be read never reaches the dots
 * (2026-10-11). Rec. 601 luma, as most readers turn a frame grey.
 */
export function darkOnPaper(css: string, fallback: string): string {
  const value = css.trim();
  let rgb: number[] | null = null;
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const fn = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i);
    if (fn) rgb = [fn[1], fn[2], fn[3]].map(Number);
  }
  if (!rgb) return fallback;
  const luma = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luma <= 0.45 ? value : fallback;
}

type Ctx = Pick<
  CanvasRenderingContext2D,
  'scale' | 'clearRect' | 'fillRect' | 'beginPath' | 'moveTo' | 'arcTo' | 'arc' | 'closePath' | 'fill'
> & { fillStyle: CanvasRenderingContext2D['fillStyle'] };

interface Surface {
  width: number;
  height: number;
  style: { width: string; height: string };
}

function drawDot(ctx: Ctx, x: number, y: number, dotRadius: number, dotStyle: QRDrawing['dotStyle']): void {
  if (dotStyle === 'circle') {
    ctx.beginPath();
    ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  } else if (dotStyle === 'rounded') {
    const r = dotRadius * 0.6;
    const half = dotRadius;
    ctx.beginPath();
    ctx.moveTo(x - half + r, y - half);
    ctx.arcTo(x + half, y - half, x + half, y + half, r);
    ctx.arcTo(x + half, y + half, x - half, y + half, r);
    ctx.arcTo(x - half, y + half, x - half, y - half, r);
    ctx.arcTo(x - half, y - half, x + half, y - half, r);
    ctx.closePath();
    ctx.fill();
  } else {
    // Square
    const half = dotRadius;
    ctx.fillRect(x - half, y - half, half * 2, half * 2);
  }
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The drawing as it was before the brand (kept for the callers that set its colours). */
function paintClassic(ctx: Ctx, d: Extract<QRDrawing, { look: 'classic' }>): void {
  const { matrix, size, dotStyle, gradient, finderColor, bgColor } = d;
  const moduleCount = matrix.length;
  const moduleSize = size / moduleCount;
  const dotRadius = moduleSize * DOT;

  if (bgColor !== 'transparent') {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);
  }

  // Logo clear zone (center 25%)
  const logoClearRadius = moduleCount * 0.13;
  const center = moduleCount / 2;

  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (!matrix[row][col]) continue;

      // Skip modules in the logo area
      const dx = col - center;
      const dy = row - center;
      if (Math.sqrt(dx * dx + dy * dy) < logoClearRadius) continue;

      const x = col * moduleSize + moduleSize / 2;
      const y = row * moduleSize + moduleSize / 2;

      if (isFinderModule(row, col, moduleCount)) {
        ctx.fillStyle = finderColor;
      } else if (gradient) {
        ctx.fillStyle = getGradientColor(col, row, moduleCount);
      } else {
        ctx.fillStyle = finderColor;
      }
      drawDot(ctx, x, y, dotRadius, dotStyle);
    }
  }
}

/**
 * The brand drawing (2026-10-11): on white with the spec's quiet zone, dots in
 * the mark's ink, each finder an ink ring around a violet centre with the
 * favicon's rounded corners, and the centred hole left empty for the tile.
 */
function paintBrand(ctx: Ctx, d: Extract<QRDrawing, { look: 'brand' }>, ink: string, violet: string): void {
  const { matrix, size, dotStyle, hole, bgColor } = d;
  const n = matrix.length;
  const cell = size / (n + 2 * QUIET_ZONE);
  const origin = QUIET_ZONE * cell;
  const dotRadius = cell * DOT;
  const gap = cell / 2 - dotRadius;

  if (bgColor !== 'transparent') {
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    roundedRect(ctx, 0, 0, size, size, 2 * cell);
    ctx.fill();
  }

  const [first, last] = holeSpan(n, hole);
  ctx.fillStyle = ink;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!matrix[row][col] || isFinderModule(row, col, n)) continue;
      if (row >= first && row <= last && col >= first && col <= last) continue;
      drawDot(ctx, origin + col * cell + cell / 2, origin + row * cell + cell / 2, dotRadius, dotStyle);
    }
  }

  // Ring and centre keep a finder's 1:1:3:1:1 for the reader; the ring's
  // inner edge follows its outer one, so it stays one module thick.
  const outer = 7 * cell - 2 * gap;
  const outerRadius = outer * TILE_RADIUS;
  const centre = 3 * cell - 2 * gap;
  for (const [row, col] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    const x = origin + col * cell;
    const y = origin + row * cell;
    ctx.fillStyle = ink;
    ctx.beginPath();
    roundedRect(ctx, x + gap, y + gap, outer, outer, outerRadius);
    roundedRect(ctx, x + cell, y + cell, 5 * cell, 5 * cell, outerRadius - (cell - gap));
    ctx.fill('evenodd');
    ctx.fillStyle = violet;
    ctx.beginPath();
    roundedRect(ctx, x + 2 * cell + gap, y + 2 * cell + gap, centre, centre, centre * TILE_RADIUS);
    ctx.fill();
  }
}

/** Everything the canvas shows, on any 2D context: the effect's, or a test's recorder. */
export function paintQRCode(
  canvas: Surface,
  ctx: Ctx,
  d: QRDrawing,
  dpr: number,
  marks: { ink: string; violet: string } = { ink: brand.ink, violet: brand.violet },
): void {
  // HiDPI
  canvas.width = d.size * dpr;
  canvas.height = d.size * dpr;
  canvas.style.width = `${d.size}px`;
  canvas.style.height = `${d.size}px`;
  ctx.scale(dpr, dpr);

  // Clear
  ctx.clearRect(0, 0, d.size, d.size);
  if (d.look === 'classic') paintClassic(ctx, d);
  else paintBrand(ctx, d, marks.ink, marks.violet);
}

export const QRCode: React.FC<QRCodeProps> = ({
  value,
  size = 200,
  logo,
  dotStyle = 'rounded',
  gradient,
  finderColor,
  bgColor,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drawing = useMemo(
    () => qrDrawing({ value, size, dotStyle, gradient, finderColor, bgColor }),
    [value, size, dotStyle, gradient, finderColor, bgColor],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // A canvas cannot read CSS variables: the mark's colours are read off the
    // box at draw time (the paper island in QRCode.module.css), with the
    // light-ground values when they are missing or too light to scan.
    const css = boxRef.current ? getComputedStyle(boxRef.current) : null;
    const marks = {
      ink: darkOnPaper(css?.getPropertyValue('--wm-mark-ink') ?? '', brand.ink),
      violet: darkOnPaper(css?.getPropertyValue('--wm-mark-violet') ?? '', brand.violet),
    };
    paintQRCode(canvas, ctx, drawing, window.devicePixelRatio || 1, marks);
  }, [drawing]);

  if (drawing.look === 'classic') {
    // Logo size: match the clear zone (26% of QR)
    const logoSize = Math.round(size * 0.26);

    return (
      <div className={`${s.container} ${className || ''}`} data-look="classic" style={{ width: size, height: size }}>
        <canvas ref={canvasRef} />
        <div className={s.logo} style={{ width: logoSize, height: logoSize }}>
          {logo || <WMLogo size={logoSize} />}
        </div>
      </div>
    );
  }

  const tile = markTile(drawing);
  // The favicon's offsets centre the WPMaven mark's own drawing; another logo is centred as a box.
  const mark = tile && (logo
    ? { ...tile.mark, left: (tile.tile - tile.mark.size) / 2, top: (tile.tile - tile.mark.size) / 2 }
    : tile.mark);
  return (
    <div
      ref={boxRef}
      className={`${s.container} ${s.paper} ${className || ''}`}
      data-look="brand"
      style={{ width: size, height: size }}
    >
      <canvas ref={canvasRef} />
      {tile && mark && (
        <div className={s.tile} style={{ width: tile.tile, height: tile.tile, borderRadius: tile.radius }}>
          <div className={s.tileMark} style={{ left: mark.left, top: mark.top, width: mark.size, height: mark.size }}>
            {logo || <WMLogo size={mark.size} />}
          </div>
        </div>
      )}
    </div>
  );
};
