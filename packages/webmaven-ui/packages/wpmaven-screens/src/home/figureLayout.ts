/**
 * Figure rows on Home: fixed, even columns from the width the card really
 * has (the sidebar and the page's width decide it, never the window), every
 * row full. One copy for the dashboard and the plugin (2026-10-16).
 */

export interface EvenColumnsOptions {
  /** The narrowest a card may be before its content (a button label) no longer fits. */
  minPx: number;
  /** The gap between columns. */
  gapPx: number;
  /** The most columns ever used. */
  max?: number;
  /**
   * Never a partial last row: when no count above one that fits divides the
   * cards (three where only two fit, five where four fit), one column. Without
   * it the fullest last row wins, which still leaves a row part filled.
   */
  fullRowsOnly?: boolean;
}

/** The width `columns` cells of `minPx` take, with the gaps between them. */
const rowWidth = (columns: number, minPx: number, gapPx: number): number =>
  columns * minPx + (columns - 1) * gapPx;

/**
 * How many columns `count` cards get in `width` px: the most that fit at
 * `minPx` each and divide the cards evenly, so every row is full. When no
 * count above one divides them (seven cards), the fullest last row wins, or
 * one column with `fullRowsOnly`.
 * One column when nothing wider fits, and before the width is known.
 */
export function evenColumns(count: number, width: number, opts: EvenColumnsOptions): number {
  if (!(count > 1) || !(width > 0)) return 1;
  const max = Math.max(1, Math.min(Math.floor(opts.max ?? 4), count));
  let widest = 1;
  for (let c = max; c >= 2; c -= 1) {
    if (rowWidth(c, opts.minPx, opts.gapPx) <= width) { widest = c; break; }
  }
  if (widest === 1) return 1;
  for (let c = widest; c >= 2; c -= 1) {
    if (count % c === 0) return c;
  }
  if (opts.fullRowsOnly) return 1;
  let best = widest;
  for (let c = widest; c >= 2; c -= 1) {
    if (c - (count % c) < best - (count % best)) best = c;
  }
  return best;
}

/**
 * Figure rows on Home ("What changed", "What you have built here"): a big
 * number over a short label, in groups (the last 7 days, this week).
 *
 * These wrapped with flex-wrap at a 110 px minimum, so a row broke wherever
 * it ran out of room: five figures in the main column of a laptop were four
 * and one, or three and two, with "$112 REVENUE" alone on the second row. The
 * rule is fixed, even columns, every row full.
 *
 * `counts` is the number of figures in each group, in order. When every
 * figure fits on one row at `minPx` each, they share it: the groups sit side
 * by side, each spanning its own figures, so every figure has the same width.
 * Otherwise each group gets rows of its own, with the most columns that fit
 * and divide it evenly, and one column when none do (three where only two
 * fit). A group is never broken across a partial row.
 */
export interface FigureLayout {
  /** Every figure of every group on one row. */
  oneRow: boolean;
  /** Columns inside each group, in the order of `counts`. */
  columns: number[];
}

export interface FigureLayoutOptions {
  /** The narrowest a figure may be: its value and its longest label word still fit. */
  minPx: number;
  /** The gap between figures, and between groups on a shared row. */
  gapPx: number;
}

export function figureLayout(counts: number[], width: number, opts: FigureLayoutOptions): FigureLayout {
  const sizes = counts.map((n) => Math.max(0, Math.floor(n)));
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total > 0 && width > 0 && rowWidth(total, opts.minPx, opts.gapPx) <= width) {
    return { oneRow: true, columns: sizes.map((n) => Math.max(1, n)) };
  }
  return {
    oneRow: false,
    columns: sizes.map((n) => evenColumns(n, width, { ...opts, max: n, fullRowsOnly: true })),
  };
}
