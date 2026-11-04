import React from 'react';
import { ToolRenderProps } from './types';

/**
 * Renders web_search and web_fetch results.
 * web_search → list of {title, url, snippet, source}
 * web_fetch → single {url, content / text} — show first 400 chars as a snippet
 */
export const SearchResults: React.FC<ToolRenderProps> = ({ call }) => {
  const data = unwrap(call.result);
  const list: any[] | null = Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data)
      ? data
      : null;

  if (call.name === 'web_fetch') {
    const url = data?.url || call.params?.url;
    const text = (data?.content || data?.text || '').toString();
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" style={linkStyle}>
            {hostname(url)}
          </a>
        )}
        {text && (
          <p style={snippetStyle}>{trim(text, 320)}</p>
        )}
      </div>
    );
  }

  if (!list || list.length === 0) {
    return <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>No results.</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.slice(0, 5).map((r, i) => (
        <ResultRow key={i} result={r} />
      ))}
      {list.length > 5 && (
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          +{list.length - 5} more
        </span>
      )}
    </div>
  );
};

function ResultRow({ result }: { result: any }) {
  const title = result?.title || result?.url || 'Result';
  const url = result?.url;
  const snippet = result?.snippet || result?.description || '';
  const source = result?.source || (url ? hostname(url) : '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" style={titleStyle}>
          {title}
        </a>
      ) : (
        <span style={titleStyle}>{title}</span>
      )}
      {source && (
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{source}</span>
      )}
      {snippet && <p style={snippetStyle}>{trim(snippet, 200)}</p>}
    </div>
  );
}

function unwrap(result: any): any {
  if (!result) return null;
  if (typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

function hostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function trim(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

const titleStyle: React.CSSProperties = {
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'none',
};

const linkStyle: React.CSSProperties = {
  color: 'var(--purple)',
  fontSize: 12,
  textDecoration: 'none',
};

const snippetStyle: React.CSSProperties = {
  color: 'var(--text-dim)',
  fontSize: 12,
  lineHeight: 1.5,
  margin: 0,
};
