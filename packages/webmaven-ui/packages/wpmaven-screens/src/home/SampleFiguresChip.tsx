import React from 'react';

/**
 * "Sample figures (development)": on every Home card whose figures came from
 * the API's development sample (DEV_SAMPLE_DATA=true on a development
 * server, never in production; the API marks them `sample`). Without it,
 * invented revenue read as the business's own.
 */
export const SAMPLE_FIGURES_LABEL = 'Sample figures (development)';

const chipStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 'var(--text-meta)',
  fontWeight: 600,
  lineHeight: 1.4,
  color: 'var(--warning)',
  background: 'var(--warning-soft)',
  border: '1px dashed var(--warning)',
  borderRadius: 999,
  padding: '1px 10px',
  whiteSpace: 'nowrap',
};

export const SampleFiguresChip: React.FC<{ show?: boolean | null; style?: React.CSSProperties }> = ({ show = true, style }) => (
  show ? (
    <span
      data-testid="sample-figures-chip"
      title="These figures are a built-in sample shown on a development server. They are not this business's own numbers."
      style={{ ...chipStyle, ...style }}
    >
      {SAMPLE_FIGURES_LABEL}
    </span>
  ) : null
);

export default SampleFiguresChip;
