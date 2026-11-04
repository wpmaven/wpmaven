import React, { useState } from 'react';
import { ToolRenderProps } from './types';
import { Badge } from '../Badge';

/**
 * Renders write_file / batch_write_files results. For one file: shows
 * the path + an expandable diff/content view. For batch: lists the
 * touched files with a count.
 */
export const FileDiff: React.FC<ToolRenderProps> = ({ call }) => {
  const data = unwrap(call.result);

  // Batch shape — { files: [{ path, status, ... }] }
  const files: any[] = Array.isArray(data?.files) ? data.files :
                      Array.isArray(data?.changes) ? data.changes :
                      Array.isArray(data) ? data : [];

  if (files.length > 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          {files.length} file{files.length === 1 ? '' : 's'}
        </span>
        {files.slice(0, 8).map((f, i) => <FileRow key={i} file={f} />)}
        {files.length > 8 && (
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
            +{files.length - 8} more
          </span>
        )}
      </div>
    );
  }

  // Single file shape — { path, content, before?, after? }
  const path = data?.path || data?.filename || call.params?.path;
  const before = data?.before;
  const after = data?.after || data?.content;
  return <SingleFile path={path} before={before} after={after} />;
};

function FileRow({ file }: { file: any }) {
  const path = file?.path || file?.filename || 'unknown';
  const op = file?.operation || file?.status || (file?.created ? 'created' : 'updated');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <Badge color={op === 'created' ? 'cyan' : op === 'deleted' ? 'rose' : 'mauve'}>{op}</Badge>
      <code style={{ color: 'var(--text)', fontSize: 12 }}>{path}</code>
    </div>
  );
}

function SingleFile({ path, before, after }: { path?: string; before?: string; after?: string }) {
  const [open, setOpen] = useState(false);
  if (!path && !after) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {path && <code style={{ color: 'var(--text)', fontSize: 12 }}>{path}</code>}
      {(after || before) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={toggleStyle}
        >
          {open ? '▾ Hide' : '▸ Show contents'}
        </button>
      )}
      {open && (
        <pre style={contentStyle}>
          {(after || before || '').slice(0, 4000)}
        </pre>
      )}
    </div>
  );
}

function unwrap(result: any): any {
  if (!result) return null;
  if (typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

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

const contentStyle: React.CSSProperties = {
  margin: 0,
  padding: '8px 10px',
  background: 'var(--code-bg, var(--glass))',
  border: '1px solid var(--glass-border)',
  borderRadius: 4,
  fontSize: 11,
  color: 'var(--text)',
  fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
  maxHeight: 240,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
};
