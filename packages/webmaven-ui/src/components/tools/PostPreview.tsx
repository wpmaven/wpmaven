import React, { useState } from 'react';
import DOMPurify from 'dompurify';
import { ToolRenderProps } from './types';
import { Badge } from '../Badge';

/** The most of a draft the preview shows, in characters. */
const DRAFT_PREVIEW_CHARS = 8000;

/**
 * What the draft preview lets through. The draft is markup a model wrote, and
 * a model can be talked into writing markup that runs (a page it read, a
 * comment left on the site), in a window where the owner is signed in. So it
 * never reaches the page as it comes: DOMPurify takes out scripts, event
 * handlers and javascript: links and keeps the formatting. HTML only (no SVG
 * or MathML), no <style> (it would restyle the whole page) and no <form>.
 */
const DRAFT_HTML = { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form'] };

/**
 * Renders post / page creation + content_generation output. Shows the
 * title, status, word count, and a collapsed body preview the user can
 * expand to read the full draft.
 */
export const PostPreview: React.FC<ToolRenderProps> = ({ call }) => {
  const [open, setOpen] = useState(false);
  const data = unwrap(call.result);

  const title = data?.title || data?.post_title || call.params?.title || 'Untitled';
  const status = data?.status || call.params?.status || 'draft';
  const id = data?.id || data?.post_id;
  const permalink = data?.permalink || data?.url || data?.link;
  const content: string =
    data?.content || data?.post_content || data?.body || call.params?.content || '';
  const wordCount = data?.wordCount ?? data?.word_count ?? approxWordCount(content);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text)', fontSize: 14, fontWeight: 600 }}>{title}</span>
        <Badge color={status === 'publish' ? 'cyan' : 'mauve'}>{status}</Badge>
        {wordCount ? (
          <span style={metaStyle}>{wordCount} words</span>
        ) : null}
        {id ? <span style={metaStyle}>#{id}</span> : null}
      </div>

      {permalink && (
        <a href={permalink} target="_blank" rel="noreferrer" style={linkStyle}>
          {permalink}
        </a>
      )}

      {content && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={toggleStyle}
            aria-expanded={open}
          >
            {open ? '▾ Hide draft' : '▸ Show draft'}
          </button>
          {open && (
            <div
              style={{
                padding: 12,
                background: 'var(--glass)',
                borderRadius: 6,
                border: '1px solid var(--glass-border)',
                fontSize: 13,
                lineHeight: 1.55,
                color: 'var(--text)',
                maxHeight: 280,
                overflow: 'auto',
              }}
              // Sanitized on this line, after the cut to length (see DRAFT_HTML).
              // With no DOM to sanitize in (server rendering) nothing is
              // shown, rather than the draft as it came.
              dangerouslySetInnerHTML={{ __html: DOMPurify.isSupported ? DOMPurify.sanitize(content.length > DRAFT_PREVIEW_CHARS ? content.slice(0, DRAFT_PREVIEW_CHARS) + '…' : content, DRAFT_HTML) : '' }}
            />
          )}
        </>
      )}
    </div>
  );
};

function unwrap(result: any): any {
  if (!result) return null;
  if (typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

function approxWordCount(html: string): number {
  if (!html) return 0;
  return html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
}

const metaStyle: React.CSSProperties = {
  color: 'var(--text-dim)',
  fontSize: 11,
  padding: '1px 6px',
  background: 'var(--glass)',
  borderRadius: 3,
};

const linkStyle: React.CSSProperties = {
  color: 'var(--purple)',
  fontSize: 12,
  textDecoration: 'none',
};

const toggleStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--text-dim)',
  fontSize: 11,
  cursor: 'pointer',
  alignSelf: 'flex-start',
  fontFamily: 'inherit',
};
