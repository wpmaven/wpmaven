/**
 * Operator text on screen: the parsed tree (./parse.ts) as React elements.
 *
 * No HTML string is ever built or injected: every word lands as a text node,
 * and the only attribute taken from the text is a link's href, which the
 * parser has already limited to absolute http(s) URLs. Links open in a new
 * tab with rel="noopener noreferrer".
 *
 * Two forms:
 *  - <OperatorText> for a reply, a reflection, a draft: paragraphs, bold
 *    lines for headings, real lists, code. A block of its own.
 *  - <OperatorInline> for a line that sits inside a sentence, a title or a
 *    span (an approval's reason, an alert's message): the same bold, italic,
 *    code and links, with blocks run together on one line.
 *
 * Styling is inline and uses only the design tokens, so the component reads
 * the same inside a Tailwind card, an inline-styled Home row or a dialog, at
 * the size and color of whatever holds it. Long unbroken strings (a file URL)
 * wrap instead of pushing a phone screen sideways.
 */
import React from 'react';
import { parseOperatorText, type Block, type Inline } from './parse';

const LINK_STYLE: React.CSSProperties = { color: 'inherit', textDecoration: 'underline', overflowWrap: 'anywhere' };
const CODE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: '0.92em',
  background: 'var(--glass, rgba(127,127,127,0.12))',
  borderRadius: 4,
  padding: '0 4px',
  overflowWrap: 'anywhere',
};
const PRE_STYLE: React.CSSProperties = {
  ...CODE_STYLE,
  display: 'block',
  padding: '8px 10px',
  whiteSpace: 'pre-wrap',
  margin: 0,
};
const GAP = '0.6em';

function renderInline(nodes: Inline[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}${i}`;
    switch (n.t) {
      case 'text': return <React.Fragment key={key}>{n.v}</React.Fragment>;
      case 'br': return <br key={key} />;
      case 'strong': return <strong key={key} style={{ fontWeight: 600 }}>{renderInline(n.c, `${key}.`)}</strong>;
      case 'em': return <em key={key}>{renderInline(n.c, `${key}.`)}</em>;
      case 'del': return <s key={key}>{renderInline(n.c, `${key}.`)}</s>;
      case 'code': return <code key={key} style={CODE_STYLE}>{n.v}</code>;
      case 'link':
        return (
          <a key={key} href={n.href} target="_blank" rel="noopener noreferrer" style={LINK_STYLE}>
            {renderInline(n.c, `${key}.`)}
          </a>
        );
    }
  });
}

function renderBlock(b: Block, i: number, last: boolean): React.ReactNode {
  const margin = last ? 0 : GAP;
  switch (b.t) {
    case 'p':
      return <p key={i} style={{ margin: `0 0 ${margin}` }}>{renderInline(b.c, `${i}.`)}</p>;
    case 'h':
      // A heading in a reply is emphasis, not a page title: a bold line at the text's own size.
      return <p key={i} style={{ margin: `0 0 ${margin}`, fontWeight: 600 }}>{renderInline(b.c, `${i}.`)}</p>;
    case 'ul':
      return (
        <ul key={i} style={{ margin: `0 0 ${margin}`, paddingLeft: '1.25em', listStyle: 'disc' }}>
          {b.items.map((it, k) => <li key={k} style={{ margin: '0.15em 0' }}>{renderInline(it, `${i}.${k}.`)}</li>)}
        </ul>
      );
    case 'ol':
      return (
        <ol key={i} start={b.start} style={{ margin: `0 0 ${margin}`, paddingLeft: '1.6em', listStyle: 'decimal' }}>
          {b.items.map((it, k) => <li key={k} style={{ margin: '0.15em 0' }}>{renderInline(it, `${i}.${k}.`)}</li>)}
        </ol>
      );
    case 'pre':
      return <pre key={i} style={{ ...PRE_STYLE, marginBottom: margin }}><code>{b.v}</code></pre>;
  }
}

export interface OperatorTextProps {
  /** What the operator or model wrote. Anything that is not a string renders nothing. */
  text: unknown;
  className?: string;
  style?: React.CSSProperties;
  'data-testid'?: string;
}

/** A reply, a reflection or a draft, as formatted blocks. */
export function OperatorText({ text, className, style, 'data-testid': testId }: OperatorTextProps) {
  const blocks = parseOperatorText(text);
  if (blocks.length === 0) return null;
  return (
    <div className={className} style={{ overflowWrap: 'anywhere', ...style }} data-testid={testId}>
      {blocks.map((b, i) => renderBlock(b, i, i === blocks.length - 1))}
    </div>
  );
}

/** Line breaks as spaces: an inline run has no lines. */
function oneLine(c: Inline[]): Inline[] {
  return c.map((n): Inline => {
    if (n.t === 'br') return { t: 'text', v: ' ' };
    if (n.t === 'strong' || n.t === 'em' || n.t === 'del' || n.t === 'link') return { ...n, c: oneLine(n.c) };
    return n;
  });
}

/**
 * The same text on one line, for a span or a sentence: paragraphs run on with
 * a space, list items are separated by " · ".
 */
export function OperatorInline({ text, className, style, 'data-testid': testId }: OperatorTextProps) {
  const blocks = parseOperatorText(text);
  if (blocks.length === 0) return null;
  const runs: Array<{ sep: string; c: Inline[] }> = [];
  for (const b of blocks) {
    const first = runs.length === 0 ? '' : ' ';
    if (b.t === 'p' || b.t === 'h') runs.push({ sep: first, c: oneLine(b.c) });
    else if (b.t === 'ul' || b.t === 'ol') b.items.forEach((it, k) => runs.push({ sep: k === 0 ? first : ' · ', c: oneLine(it) }));
    else runs.push({ sep: first, c: [{ t: 'code', v: b.v }] });
  }
  return (
    <span className={className} style={{ overflowWrap: 'anywhere', ...style }} data-testid={testId}>
      {runs.map((r, i) => (
        <React.Fragment key={i}>
          {r.sep}
          {renderInline(r.c, `${i}.`)}
        </React.Fragment>
      ))}
    </span>
  );
}

export default OperatorText;
