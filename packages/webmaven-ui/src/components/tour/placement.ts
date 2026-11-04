/**
 * Where the spotlight and the card go, as plain geometry.
 *
 * The card is measured, never guessed, and the rule is simple: the card
 * never covers the spotlight. Order of preference: the step's own side
 * first, then below the element, above it, to its right, to its left. When
 * none fits (an element taller than the room the card leaves), the card
 * takes the bottom of the screen and the spotlight keeps the part of the
 * element above it.
 *
 * No runtime imports: the unit tests call this directly.
 */
import type { TourPlacementSide } from './types';

export interface Rect { top: number; left: number; width: number; height: number }

export interface Viewport {
  width: number;
  height: number;
  /** Bottom of a sticky header: content above this line is hidden behind it. */
  topInset?: number;
  /** A band at the bottom the card keeps clear of (a floating button). */
  bottomInset?: number;
}

export type Side = 'below' | 'above' | 'right' | 'left' | 'clamped' | 'collapsed';

export interface Placement {
  spot: Rect;
  card: { top: number; left: number; width: number };
  side: Side;
}

/** Breathing room between the element and the spotlight's edge. */
export const SPOT_PAD = 6;
/** Between the spotlight and the card. */
export const GAP = 12;
/** Between the card and the edge of the screen. */
export const EDGE = 12;
export const CARD_MAX_WIDTH = 380;
/** The least of an element worth lighting above the card before moving the card up. */
const MIN_LIT = 120;

export function cardWidthFor(viewportWidth: number): number {
  return Math.max(200, Math.min(CARD_MAX_WIDTH, viewportWidth - EDGE * 2));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const bottom = (r: Rect) => r.top + r.height;
const right = (r: Rect) => r.left + r.width;

/** The padded element, cut to what is on screen. */
export function spotFor(target: Rect, vp: Viewport): Rect {
  const top = Math.max(0, target.top - SPOT_PAD);
  const left = Math.max(0, target.left - SPOT_PAD);
  const b = Math.min(vp.height, bottom(target) + SPOT_PAD);
  const r = Math.min(vp.width, right(target) + SPOT_PAD);
  return { top, left, width: Math.max(0, r - left), height: Math.max(0, b - top) };
}

/** The lowest the card's bottom edge may go. */
const cardFloor = (vp: Viewport) => vp.height - EDGE - Math.max(0, vp.bottomInset ?? 0);

type BesideSide = Exclude<Side, 'clamped' | 'collapsed'>;

const ORDER: ReadonlyArray<BesideSide> = ['below', 'above', 'right', 'left'];

/** The sides to try, the preferred one first. */
export function sidesFor(prefer: TourPlacementSide | undefined): ReadonlyArray<BesideSide> {
  if (!prefer || prefer === 'auto') return ORDER;
  return [prefer, ...ORDER.filter((s) => s !== prefer)];
}

export function placeTour(target: Rect, cardHeight: number, vp: Viewport, prefer: TourPlacementSide = 'auto'): Placement {
  const width = cardWidthFor(vp.width);
  const spot = spotFor(target, vp);
  const floor = cardFloor(vp);
  const maxLeft = Math.max(EDGE, vp.width - EDGE - width);
  const alignedLeft = clamp(spot.left, EDGE, maxLeft);
  const sideTop = clamp(spot.top, EDGE, Math.max(EDGE, floor - cardHeight));

  for (const side of sidesFor(prefer)) {
    if (side === 'below') {
      const top = bottom(spot) + GAP;
      if (top + cardHeight <= floor) return { spot, card: { top, left: alignedLeft, width }, side };
    } else if (side === 'above') {
      // Never lower than the floor: an element in the bottom band still gets its card on screen.
      const top = Math.min(spot.top - GAP, floor) - cardHeight;
      if (top >= EDGE) return { spot, card: { top, left: alignedLeft, width }, side };
    } else if (side === 'right') {
      const left = right(spot) + GAP;
      if (left + width <= vp.width - EDGE) return { spot, card: { top: sideTop, left, width }, side };
    } else {
      const left = spot.left - GAP - width;
      if (left >= EDGE) return { spot, card: { top: sideTop, left, width }, side };
    }
  }

  // Nothing fits beside it: the card takes the bottom of the screen and the
  // spotlight keeps what is above it. Only when that leaves a sliver does the
  // card go to the top instead.
  const cardTopAtBottom = Math.max(EDGE, floor - cardHeight);
  const aboveCut = { ...spot, height: Math.max(0, Math.min(bottom(spot), cardTopAtBottom - GAP) - spot.top) };
  const cardBottomAtTop = EDGE + cardHeight;
  const belowStart = Math.max(spot.top, cardBottomAtTop + GAP);
  const belowCut = { ...spot, top: belowStart, height: Math.max(0, bottom(spot) - belowStart) };
  if (aboveCut.height >= Math.min(MIN_LIT, belowCut.height)) {
    return { spot: aboveCut, card: { top: cardTopAtBottom, left: alignedLeft, width }, side: 'clamped' };
  }
  return { spot: belowCut, card: { top: EDGE, left: alignedLeft, width }, side: 'clamped' };
}

/** True when two rectangles share any area. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.left < right(b) && right(a) > b.left && a.top < bottom(b) && bottom(a) > b.top;
}

/** The element and room for the card are on screen: nothing to scroll. */
export function fitsOnScreen(target: Rect, cardHeight: number, vp: Viewport, prefer: TourPlacementSide = 'auto'): boolean {
  const top = (vp.topInset ?? 0) + EDGE;
  const visible = target.top >= top && bottom(target) <= vp.height - EDGE;
  return visible && placeTour(target, cardHeight, vp, prefer).side !== 'clamped';
}

/**
 * How far to scroll (positive: down) so the element and a card beside it
 * both fit, centred together between the top band and the bottom one; or,
 * for an element too tall for that, so its top sits just under the top band.
 * 0 when they already fit: the page is not moved for nothing.
 */
export function scrollDelta(target: Rect, cardHeight: number, vp: Viewport, prefer: TourPlacementSide = 'auto'): number {
  if (fitsOnScreen(target, cardHeight, vp, prefer)) return 0;
  const top = (vp.topInset ?? 0) + EDGE;
  const avail = cardFloor(vp) - top;
  const need = target.height + SPOT_PAD * 2 + GAP + cardHeight;
  const desiredTop = need <= avail ? top + SPOT_PAD + (avail - need) / 2 : top + SPOT_PAD;
  return Math.round(target.top - desiredTop);
}

/** What a phone shows of the page: its visual viewport (the keyboard takes the rest). */
export interface VisibleArea { top: number; height: number; width: number }

/**
 * The card as a slim bar while someone types on a phone: as wide as the
 * screen, at the top of what is visible, so the keyboard never covers it;
 * at the bottom of what is visible, right above the keyboard, when the
 * field being typed in is up there. It never scrolls the page: the browser
 * keeps the field in view.
 */
export function collapsedPlacement(spot: Rect, barHeight: number, area: VisibleArea, field: Rect | null): Placement {
  const width = Math.max(200, area.width - EDGE * 2);
  const atTop = area.top + EDGE;
  const topBand: Rect = { top: atTop, left: EDGE, width, height: barHeight };
  const top = field && overlaps(topBand, field)
    ? Math.max(atTop, area.top + area.height - EDGE - barHeight)
    : atTop;
  return { spot, card: { top, left: EDGE, width }, side: 'collapsed' };
}

/**
 * The dim of a step the person uses, as four panels around the hole instead
 * of one shadow over everything: the hole is empty, so a click in it reaches
 * the element, and a click on a panel is caught there. The right and bottom
 * panels run to the screen's edge.
 */
export interface Panel {
  key: 'top' | 'bottom' | 'left' | 'right';
  top: number;
  left: number;
  /** Absent: to the right edge of the screen. */
  width?: number;
  /** Absent: to the bottom edge of the screen. */
  height?: number;
}

export function dimPanels(spot: Rect): Panel[] {
  return [
    { key: 'top', top: 0, left: 0, height: Math.max(0, spot.top) },
    { key: 'bottom', top: bottom(spot), left: 0 },
    { key: 'left', top: spot.top, left: 0, width: Math.max(0, spot.left), height: spot.height },
    { key: 'right', top: spot.top, left: right(spot), height: spot.height },
  ];
}
