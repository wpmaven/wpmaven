import React from 'react';
import { ToolRenderProps } from './types';
import { Badge } from '../Badge';

/**
 * Renders results from plugin-related tools:
 *   - plugin_search → list of candidates
 *   - install_plugin / activate_plugin / deactivate_plugin → status of one plugin
 */
export const PluginCard: React.FC<ToolRenderProps> = ({ call }) => {
  const data = unwrap(call.result);

  // plugin_search returns { plugins: [...] }
  const list: any[] | null = Array.isArray(data?.plugins)
    ? data.plugins
    : Array.isArray(data?.results)
      ? data.results
      : null;

  if (list && list.length > 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {list.slice(0, 5).map((p, i) => (
          <PluginRow key={i} plugin={p} />
        ))}
        {list.length > 5 && (
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
            +{list.length - 5} more
          </span>
        )}
      </div>
    );
  }

  // Single plugin op (install/activate/deactivate) — show a compact line.
  const slug = data?.plugin_slug || call.params?.plugin_slug || data?.slug;
  const name = data?.plugin_name || data?.name || slug || 'plugin';
  const verb = inferVerb(call.name);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <Badge color="cyan">{verb}</Badge>
      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{name}</span>
      {slug && <code style={codeStyle}>{slug}</code>}
    </div>
  );
};

function PluginRow({ plugin }: { plugin: any }) {
  const name = plugin?.name || plugin?.title || plugin?.plugin_slug || plugin?.slug || 'unknown';
  const slug = plugin?.slug || plugin?.plugin_slug;
  const desc = plugin?.short_description || plugin?.description;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <span style={{ color: 'var(--text)', fontWeight: 600 }}>{name}</span>
        {slug && <code style={codeStyle}>{slug}</code>}
      </div>
      {desc && (
        <span style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.4 }}>
          {trim(desc, 140)}
        </span>
      )}
    </div>
  );
}

function inferVerb(toolName: string): string {
  if (toolName.startsWith('install')) return 'Installed';
  if (toolName.startsWith('activate')) return 'Activated';
  if (toolName.startsWith('deactivate')) return 'Deactivated';
  if (toolName.startsWith('uninstall')) return 'Uninstalled';
  return 'Plugin';
}

function unwrap(result: any): any {
  if (!result) return null;
  if (typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

function trim(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

const codeStyle: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: 3,
  background: 'var(--glass)',
  fontSize: 11,
  color: 'var(--text-dim)',
};
