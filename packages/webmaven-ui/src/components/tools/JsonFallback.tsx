import React, { useState } from 'react';
import { ToolRenderProps } from './types';

/**
 * Catch-all renderer for any tool without a dedicated widget. Shows a
 * compact summary + collapsible JSON tree. Critical: this is what makes
 * the runtime work for ANY tool from day one — rich widgets can be
 * added later as patterns emerge in real usage.
 */
export const JsonFallback: React.FC<ToolRenderProps> = ({ call }) => {
  const [open, setOpen] = useState(!call.collapseByDefault);
  const payload = call.result ?? call.params ?? null;

  return (
    <div style={{ fontSize: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          color: 'var(--text-dim)',
          cursor: 'pointer',
          fontSize: 11,
          fontFamily: 'inherit',
        }}
        aria-expanded={open}
      >
        {open ? '▾' : '▸'} {open ? 'Hide' : 'Show'} details
      </button>
      {open && (
        <pre
          style={{
            margin: '6px 0 0',
            padding: '8px 10px',
            background: 'var(--code-bg, var(--glass))',
            border: '1px solid var(--glass-border)',
            borderRadius: 6,
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--text)',
            overflow: 'auto',
            maxHeight: 240,
          }}
        >
          {safeStringify(payload)}
        </pre>
      )}
    </div>
  );
};

function safeStringify(value: any): string {
  if (value === null || value === undefined) return '(no result)';
  if (typeof value === 'string') return value.slice(0, 4000);
  try {
    return JSON.stringify(value, null, 2).slice(0, 4000);
  } catch {
    return String(value).slice(0, 4000);
  }
}
