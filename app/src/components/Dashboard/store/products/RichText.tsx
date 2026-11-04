import React, { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';

/**
 * What a product description may hold: text formatting, lists, links,
 * headings, images and simple tables. Scripts, styles, forms, embeds and
 * event handlers go (the site runs wp_kses_post on it too).
 */
const DESCRIPTION_HTML = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'span', 'div', 'img', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan'],
};

export function cleanDescription(html: string | null | undefined): string {
  return typeof html === 'string' && html ? DOMPurify.sanitize(html, DESCRIPTION_HTML) as string : '';
}

const BLOCK = /<(p|div|ul|ol|li|h[1-6]|blockquote|table|br|hr)\b/i;

/** A description WordPress keeps with line breaks only, as the paragraphs the shop shows. */
export function withParagraphs(html: string): string {
  if (!html.trim() || BLOCK.test(html)) return html;
  return html.trim().split(/\n\s*\n/).map((p) => `<p>${p.trim().replace(/\n/g, '<br>')}</p>`).join('');
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A link address the owner typed, made safe: http(s), mailto, tel, a path on the site; a bare domain gets https. */
export function safeHref(input: string): string | null {
  const v = input.trim();
  if (!v || /\s/.test(v)) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(v)) return v;
  if (/^[/#]/.test(v)) return v;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v)) return `https://${v}`;
  return null;
}

function run(command: string, arg?: string): void {
  if (typeof document.execCommand === 'function') document.execCommand(command, false, arg);
}

/**
 * A small rich text field: bold, italic, lists and links. The HTML it gives
 * back is cleaned; it reports a change only when the owner edits, so an
 * untouched description is never rewritten.
 */
export default function RichText({ id, label, value, onChange, testId }: {
  id: string;
  label: string;
  value: string;
  onChange: (html: string) => void;
  testId?: string;
}) {
  const area = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const range = useRef<Range | null>(null);
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (!area.current || value === emitted.current) return;
    area.current.innerHTML = cleanDescription(withParagraphs(value));
  }, [value]);

  const emit = () => {
    if (!area.current) return;
    const html = cleanDescription(area.current.innerHTML);
    emitted.current = html;
    onChange(html);
  };

  const command = (name: string, arg?: string) => {
    area.current?.focus();
    run(name, arg);
    emit();
  };

  const remember = () => {
    const sel = window.getSelection();
    range.current = sel && sel.rangeCount && area.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  };

  const addLink = () => {
    const safe = safeHref(href);
    if (!safe) {
      setLinkError('Enter a web address like https://example.com.');
      return;
    }
    area.current?.focus();
    const sel = window.getSelection();
    if (range.current && sel) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    }
    if (range.current && !range.current.collapsed) run('createLink', safe);
    else run('insertHTML', `<a href="${escapeHtml(safe)}">${escapeHtml(href.trim())}</a>`);
    setLinking(false);
    setHref('');
    setLinkError(null);
    emit();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    e.preventDefault();
    run('insertHTML', html ? cleanDescription(html) : escapeHtml(text).replace(/\n/g, '<br>'));
    emit();
  };

  const tool = (name: string, title: string, glyph: React.ReactNode, onClick: () => void) => (
    <button
      type="button"
      className="wm-store-rte__tool"
      aria-label={title}
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        if (name === 'link') remember();
      }}
      onClick={onClick}
    >
      {glyph}
    </button>
  );

  return (
    <div className="wm-store-field wm-store-rte" data-testid={testId}>
      <span className="wm-store-field__label" id={`${id}-label`}>{label}</span>
      <div className="wm-store-rte__bar" role="toolbar" aria-label={`${label}: formatting`}>
        {tool('bold', 'Bold', <b>B</b>, () => command('bold'))}
        {tool('italic', 'Italic', <i>I</i>, () => command('italic'))}
        {tool('ul', 'Bulleted list', <span aria-hidden="true">&bull; List</span>, () => command('insertUnorderedList'))}
        {tool('ol', 'Numbered list', <span aria-hidden="true">1. List</span>, () => command('insertOrderedList'))}
        {tool('link', 'Link', <span aria-hidden="true">Link</span>, () => {
          if (!range.current) remember();
          setLinking(true);
        })}
      </div>
      {linking && (
        <div className="wm-store-rte__link">
          <label className="wm-store-inline">
            <span>Link address</span>
            <input
              className="wm-store-input"
              value={href}
              autoFocus
              onChange={(e) => setHref(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addLink();
                }
              }}
              aria-invalid={!!linkError}
            />
          </label>
          <button type="button" className="wm-store-link" onClick={addLink}>Add the link</button>
          <button type="button" className="wm-store-link" onClick={() => { setLinking(false); setLinkError(null); }}>Cancel</button>
          {linkError && <span className="wm-store-field__error" role="alert">{linkError}</span>}
        </div>
      )}
      <div
        id={id}
        ref={area}
        className="wm-store-rte__area"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-labelledby={`${id}-label`}
        tabIndex={0}
        onInput={emit}
        onPaste={onPaste}
      />
    </div>
  );
}
