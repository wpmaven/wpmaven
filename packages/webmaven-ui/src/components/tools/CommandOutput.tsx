import React, { useState } from 'react';
import { ToolRenderProps } from './types';

/**
 * Renders execute_command / wp_cli output. Shows the command head + a
 * collapsed terminal-style output block.
 */
export const CommandOutput: React.FC<ToolRenderProps> = ({ call }) => {
  const [open, setOpen] = useState(false);
  const data = unwrap(call.result);
  const cmd = call.params?.command || data?.command;
  const stdout = (data?.stdout || data?.output || '').toString();
  const stderr = (data?.stderr || data?.error || '').toString();
  const exitCode = data?.exit_code ?? data?.exitCode;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {cmd && (
        <code style={cmdStyle}>$ {String(cmd).slice(0, 160)}</code>
      )}
      {(stdout || stderr) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={toggleStyle}
          aria-expanded={open}
        >
          {open ? '▾ Hide output' : `▸ Show output${exitCode != null ? ` (exit ${exitCode})` : ''}`}
        </button>
      )}
      {open && (stdout || stderr) && (
        <pre style={termStyle}>
          {stdout ? trim(stdout, 4000) : ''}
          {stderr ? `\n[stderr]\n${trim(stderr, 2000)}` : ''}
        </pre>
      )}
    </div>
  );
};

function unwrap(result: any): any {
  if (!result) return null;
  if (typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

function trim(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

const cmdStyle: React.CSSProperties = {
  display: 'block',
  padding: '6px 10px',
  background: 'var(--code-bg, var(--glass))',
  border: '1px solid var(--glass-border)',
  borderRadius: 4,
  fontSize: 12,
  color: 'var(--text)',
  fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
};

const termStyle: React.CSSProperties = {
  margin: 0,
  padding: '8px 10px',
  background: 'var(--code-bg, var(--glass))',
  border: '1px solid var(--glass-border)',
  borderRadius: 4,
  fontSize: 11,
  color: 'var(--text-dim)',
  fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
  maxHeight: 240,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
};

const toggleStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--text-dim)',
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: 'inherit',
  alignSelf: 'flex-start',
};
