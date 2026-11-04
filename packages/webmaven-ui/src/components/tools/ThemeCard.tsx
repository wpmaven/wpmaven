import React from 'react';
import { ToolRenderProps } from './types';
import { Badge } from '../Badge';

/**
 * Renders results from theme-related tools:
 *   - theme_search → list of themes
 *   - install_theme / activate_theme → single theme status
 */
export const ThemeCard: React.FC<ToolRenderProps> = ({ call }) => {
  const data = unwrap(call.result);

  const list: any[] | null = Array.isArray(data?.themes)
    ? data.themes
    : Array.isArray(data?.results)
      ? data.results
      : null;

  if (list && list.length > 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {list.slice(0, 5).map((t, i) => (
          <ThemeRow key={i} theme={t} />
        ))}
        {list.length > 5 && (
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
            +{list.length - 5} more
          </span>
        )}
      </div>
    );
  }

  const slug = data?.slug || call.params?.slug || call.params?.theme_slug;
  const name = data?.name || slug || 'theme';
  const verb = call.name === 'install_theme' ? 'Installed' :
               call.name === 'activate_theme' ? 'Activated' : 'Theme';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <Badge color="purple">{verb}</Badge>
      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{name}</span>
      {slug && <code style={codeStyle}>{slug}</code>}
    </div>
  );
};

function ThemeRow({ theme }: { theme: any }) {
  const name = theme?.name || theme?.title || theme?.slug || 'unknown';
  const slug = theme?.slug;
  const desc = theme?.short_description || theme?.description;
  const preview = theme?.preview_url || theme?.screenshot_url;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      {preview && (
        // Preview image is small; cropped 1:1.
        <img
          src={preview}
          alt={name}
          loading="lazy"
          style={{
            width: 48,
            height: 48,
            objectFit: 'cover',
            borderRadius: 4,
            flexShrink: 0,
            border: '1px solid var(--glass-border)',
          }}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
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
    </div>
  );
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
