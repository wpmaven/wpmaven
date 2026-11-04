/**
 * Where the editor window sits beside the selected element: right of the
 * element by default, else left, else below, else above, else inside it at
 * the top; always inside the frame with a small margin. On a narrow frame
 * (tablet, phone) the window takes the frame's width. It keeps clear of the
 * element's tag (the name over its outline) too, so it never covers it.
 */

export const PANEL_MAX_WIDTH = 360;
export const GAP = 12;
export const SAFE = 8;

export interface FrameBox { top: number; left: number; width: number; height: number }
export interface ElementBox { top: number; left: number; width: number; height: number }

export type PlacementSide = 'right' | 'left' | 'bottom' | 'top' | 'inside';

/** The tags' heights: the selection's, and the hovered element's. */
export const SELECTED_TAG_HEIGHT = 24;
export const HOVER_TAG_HEIGHT = 22;

/** Where an outline's tag sits, relative to the outline. */
export interface TagPlacement {
  top: number;
  left: number | undefined;
  right: number | undefined;
  radius: string;
}

/**
 * An outline's tag: over the element when the frame has room above it,
 * else under it; at the element's left edge, or 4px in from its right one
 * for a wide element (over 70% of `wideFrom`, the editor's width).
 */
export function tagPlacement(rect: ElementBox, tagHeight: number, wideFrom: number): TagPlacement {
  const wide = rect.width > wideFrom * 0.7;
  const above = rect.top >= tagHeight;
  return {
    top: above ? -tagHeight : rect.height + 1,
    left: wide ? undefined : -1,
    right: wide ? 4 : undefined,
    radius: above ? '3px 3px 0 0' : '0 0 3px 3px',
  };
}

/** About how wide a selection's tag is: its words at 11px, its padding, and a "live" or "editing" after them. */
export function tagWidth(title: string, suffix = ''): number {
  return Math.ceil(title.length * 6.6 + 20 + (suffix ? 4 + suffix.length * 6 : 0));
}

/** The tag's box, in the same coordinates as the element's `rect`. */
export function tagBox(rect: ElementBox, tagHeight: number, width: number, wideFrom: number): ElementBox {
  const p = tagPlacement(rect, tagHeight, wideFrom);
  const left = p.left !== undefined ? rect.left + p.left : rect.left + rect.width - (p.right ?? 0) - width;
  return { top: rect.top + p.top, left, width, height: tagHeight };
}

export interface WindowPlacement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  side: PlacementSide;
}

/**
 * The window's box, in the editor stage's coordinates.
 * `rect` is the element in the frame's coordinates, `frame` the frame in the
 * stage's, `tag` the element's tag (tagBox) in the frame's coordinates.
 */
export function windowPlacement(rect: ElementBox, frame: FrameBox, panelHeight: number, tag: ElementBox | null = null): WindowPlacement {
  const ifTop = frame.top;
  const ifLeft = frame.left;
  const ifRight = ifLeft + frame.width;
  const ifBottom = ifTop + frame.height;

  // Fit the window to a narrow frame (tablet and phone views).
  const width = Math.min(PANEL_MAX_WIDTH, frame.width - 2 * SAFE);

  // A box's part inside the frame, in the stage's coordinates.
  const visible = (b: ElementBox) => ({
    top: Math.max(ifTop, b.top + ifTop),
    bottom: Math.min(ifBottom, b.top + ifTop + b.height),
    left: Math.max(ifLeft, b.left + ifLeft),
    right: Math.min(ifRight, b.left + ifLeft + b.width),
  });
  // The element, and the element with its tag: the window lines up with
  // the first and keeps clear of the second.
  const el = visible(rect);
  const all = tag ? visible(boxAround(rect, tag)) : el;

  const spaceRight = ifRight - all.right;
  const spaceLeft = all.left - ifLeft;
  const spaceBottom = ifBottom - all.bottom;
  const spaceTop = all.top - ifTop;

  const neededH = width + GAP + SAFE;
  const neededV = panelHeight + GAP + SAFE;

  let left: number;
  let top: number;
  let side: PlacementSide;

  if (spaceRight >= neededH) {
    // Right: most elements.
    left = all.right + GAP;
    top = el.top;
    side = 'right';
  } else if (spaceLeft >= neededH) {
    // Left: an element on the right side.
    left = all.left - width - GAP;
    top = el.top;
    side = 'left';
  } else if (spaceBottom >= neededV) {
    // Below: a full-width element near the top.
    left = (el.left + el.right) / 2 - width / 2;
    top = all.bottom + GAP;
    side = 'bottom';
  } else if (spaceTop >= neededV) {
    // Above: a full-width element near the bottom.
    left = (el.left + el.right) / 2 - width / 2;
    top = all.top - panelHeight - GAP;
    side = 'top';
  } else {
    // Inside: the element fills the view; the window floats at its top
    // centre, and ends over a tag that sits under the element.
    left = (el.left + el.right) / 2 - width / 2;
    top = el.top + GAP;
    if (tag && tag.top > rect.top) top = Math.min(top, tag.top + ifTop - panelHeight - GAP);
    side = 'inside';
  }

  // Always inside the frame.
  left = Math.max(ifLeft + SAFE, Math.min(left, ifRight - width - SAFE));
  top = Math.max(ifTop + SAFE, Math.min(top, ifBottom - panelHeight - SAFE));

  return { top, left, width, maxHeight: Math.max(200, ifBottom - ifTop - 2 * SAFE), side };
}

/** The smallest box around two boxes. */
function boxAround(a: ElementBox, b: ElementBox): ElementBox {
  const top = Math.min(a.top, b.top);
  const left = Math.min(a.left, b.left);
  return {
    top,
    left,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  };
}
