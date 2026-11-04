import React from 'react';
import { useWidth } from '../team/useWidth';
import { figureLayout, type FigureLayoutOptions } from './figureLayout';

/**
 * Rows of figures on Home: a big number over a short label, in fixed, even
 * columns measured on the card (figureLayout), never flex-wrap.
 * Every row is full at any width, so no figure sits alone on a last row.
 */

export interface Figure {
  value: string;
  label: string;
  /** A second, quieter line under the label (the assistants behind "AI reads"). */
  detail?: string;
}

export interface FigureGroup {
  key: string;
  /** Shown above the group ("Last 7 days"). Groups without one show none. */
  heading?: string;
  figures: Figure[];
}

const headingStyle: React.CSSProperties = {
  fontSize: 'var(--text-meta)', color: 'var(--text-dim)', marginBottom: 4,
};
const valueStyle: React.CSSProperties = {
  fontSize: 'var(--text-hero)', fontWeight: 700, color: 'var(--text)',
};
const labelStyle: React.CSSProperties = {
  fontSize: 'var(--text-label)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px',
  overflowWrap: 'break-word',
};
const detailStyle: React.CSSProperties = {
  fontSize: 'var(--text-meta)', color: 'var(--text-dim)', marginTop: 2, overflowWrap: 'break-word',
};

const repeat = (n: number): string => `repeat(${n}, minmax(0, 1fr))`;

/**
 * The figures laid out for a card content `width` px wide. One shape at every
 * width: an outer grid of the groups, each group a grid of its figures.
 *   - All on one row: the outer grid has a column per figure and each group
 *     spans its own, and a group's grid of n columns inside n outer columns,
 *     with the same gap, gives every figure exactly the same width.
 *   - Otherwise: one group per row, each with its own even columns.
 */
export const FigureGrid: React.FC<{ groups: FigureGroup[]; width: number } & FigureLayoutOptions> = ({
  groups, width, minPx, gapPx,
}) => {
  const shown = groups.filter((g) => g.figures.length > 0);
  if (!shown.length) return null;
  const layout = figureLayout(shown.map((g) => g.figures.length), width, { minPx, gapPx });
  const total = shown.reduce((n, g) => n + g.figures.length, 0);
  return (
    <div
      data-figures={layout.oneRow ? 'one-row' : 'stacked'}
      style={{
        display: 'grid',
        gridTemplateColumns: repeat(layout.oneRow ? total : 1),
        columnGap: gapPx,
        rowGap: 16,
        alignItems: 'start',
      }}
    >
      {shown.map((g, i) => (
        <div
          key={g.key}
          data-figure-group={g.key}
          style={{ gridColumn: layout.oneRow ? `span ${g.figures.length}` : '1 / -1', minWidth: 0 }}
        >
          {g.heading ? <div style={headingStyle}>{g.heading}</div> : null}
          <div
            data-figure-grid=""
            style={{ display: 'grid', gridTemplateColumns: repeat(layout.columns[i]), columnGap: gapPx, rowGap: 16 }}
          >
            {g.figures.map((f) => (
              <div key={f.label} data-figure="" style={{ minWidth: 0 }}>
                <div style={valueStyle}>{f.value}</div>
                <div style={labelStyle}>{f.label}</div>
                {f.detail ? <div style={detailStyle}>{f.detail}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * FigureGrid at the width the card really gives it: the sidebar, the page
 * padding and the right-hand column already taken. One column before the
 * width is known; the callback ref measures it before the first paint.
 */
export const Figures: React.FC<{ groups: FigureGroup[] } & FigureLayoutOptions> = (props) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  return (
    <div ref={ref}>
      <FigureGrid {...props} width={width} />
    </div>
  );
};

export default Figures;
