import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { applySegmentEdits, postRows, textHash } from './postText';
import { sanitizeBlockHtml } from '../../utils/safeHtml';

/**
 * The words of a post, block by block: each paragraph, heading and list item
 * is an editable field that keeps its links, bold and italics (pasting keeps
 * plain text); pictures and other blocks show as locked rows and change in
 * the WordPress editor. Save hands the whole text back with the hash of the
 * text it started from.
 */
export function PostTextEditor({
  postId, html, busy, onSave, onCancel,
}: {
  postId: number;
  html: string;
  busy: boolean;
  onSave: (content: { html: string; baseHash: string }) => void;
  onCancel: () => void;
}) {
  const rows = useMemo(() => postRows(html), [html]);
  const edits = useRef(new Map<number, string>());
  const [dirty, setDirty] = useState(false);
  useEffect(() => { edits.current.clear(); setDirty(false); }, [html]);

  const save = async () => {
    const segments = rows.flatMap((r) => (r.type === 'text' ? [r.segment] : []));
    const next = applySegmentEdits(html, segments, [...edits.current.entries()].map(([index, inner]) => ({ index, html: inner })));
    if (next === html) { onCancel(); return; }
    onSave({ html: next, baseHash: await textHash(html) });
  };

  return (
    <div data-testid="post-text-editor" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r, i) => (r.type === 'locked'
        ? (
          <div key={`l${i}`} className="wme-gs-note" data-testid="post-text-locked" style={{ fontSize: 12 }}>
            {r.name}
          </div>
        )
        : (
          <div
            key={`t${r.segment.index}`}
            role="textbox"
            aria-multiline="true"
            aria-label={r.segment.kind === 'heading' ? 'Heading' : r.segment.kind === 'list item' ? 'List item' : 'Paragraph'}
            data-testid="post-text-block"
            className="wme-gs-textarea"
            style={{ minHeight: 0, fontWeight: r.segment.kind === 'heading' ? 600 : undefined }}
            contentEditable={!busy}
            suppressContentEditableWarning
            // The block's own words with its inline tags, as the post holds them.
            dangerouslySetInnerHTML={{ __html: sanitizeBlockHtml(r.segment.html) }}
            onInput={(e) => { edits.current.set(r.segment.index, (e.currentTarget as HTMLElement).innerHTML); setDirty(true); }}
            onPaste={(e) => {
              e.preventDefault();
              const plain = e.clipboardData.getData('text/plain');
              document.execCommand?.('insertText', false, plain);
            }}
          />
        )))}
      <p className="wme-gs-hint" style={{ margin: 0 }}>
        <a href={`post.php?post=${postId}&action=edit`} target="_top">Change pictures and other blocks in the WordPress editor.</a>
      </p>
      <div className="wme-gs-actions">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button data-testid="post-text-save" variant="primary" size="sm" className="wme-gs-push" disabled={!dirty || busy} isLoading={busy} onClick={() => { void save(); }}>
          Save the text
        </Button>
      </div>
    </div>
  );
}
