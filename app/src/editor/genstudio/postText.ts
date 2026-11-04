/**
 * A post's text in the editor: the same splitting rules as the generation
 * engine. The text of each paragraph, heading and
 * list item is a segment the owner may edit; everything else (pictures,
 * galleries, embeds, the block comments) is locked and rebuilt byte for byte.
 * A shared test vector keeps both sides in step.
 */

export interface PostTextSegment {
  index: number;
  tag: string;
  kind: 'paragraph' | 'heading' | 'list item';
  start: number;
  end: number;
  html: string;
  outer: { start: number; end: number; block: boolean };
  wholeElement: boolean;
}

const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li']);
const INLINE_TAGS = new Set(['a', 'strong', 'em', 'b', 'i', 'br', 'code', 'span', 'mark', 'sub', 'sup', 's', 'u', 'small']);
const WRITE_TAGS = new Set(['a', 'strong', 'em', 'b', 'i', 'br', 'code']);
const VOID_TAGS = new Set(['br', 'img', 'hr', 'input', 'source', 'wbr', 'embed', 'meta', 'link', 'col', 'area', 'param', 'track']);
const TAG_SOURCE = String.raw`<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>`;
const tagRe = () => new RegExp(TAG_SOURCE, 'g');

const kindOf = (tag: string): PostTextSegment['kind'] => (tag === 'li' ? 'list item' : tag === 'p' ? 'paragraph' : 'heading');

function balancedInline(html: string): boolean {
  const depth = new Map<string, number>();
  for (const m of html.matchAll(tagRe())) {
    if (m[0].startsWith('<!--')) continue;
    const tag = (m[1] || '').toLowerCase();
    if (VOID_TAGS.has(tag) || m[0].endsWith('/>')) continue;
    depth.set(tag, (depth.get(tag) ?? 0) + (m[0].startsWith('</') ? -1 : 1));
  }
  return [...depth.values()].every((n) => n === 0);
}

function withBlockComment(src: string, start: number, end: number): { start: number; end: number; block: boolean } {
  const open = /<!--\s*wp:([a-z0-9/-]+)(?:\s[^>]*)?-->\s*$/.exec(src.slice(0, start));
  if (!open) return { start, end, block: false };
  const name = open[1].replace(/[/-]/g, (c) => `\\${c}`);
  const close = new RegExp(`^\\s*<!--\\s*/wp:${name}\\s*-->`).exec(src.slice(end));
  if (!close) return { start, end, block: false };
  return { start: open.index, end: end + close[0].length, block: true };
}

interface Open { tag: string; at: number; innerStart: number; text: boolean; cut: number | null }

/** The text segments of a post's content, in order (the engine's rules). */
export function splitPostText(html: string): PostTextSegment[] {
  const src = String(html ?? '');
  const out: Array<Omit<PostTextSegment, 'index'>> = [];
  const stack: Open[] = [];
  const re = tagRe();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const raw = m[0];
    if (raw.startsWith('<!--')) continue;
    const tag = (m[1] || '').toLowerCase();
    if (!raw.startsWith('</')) {
      if (VOID_TAGS.has(tag) || raw.endsWith('/>')) {
        if (!INLINE_TAGS.has(tag)) for (const o of stack) if (o.text && o.cut === null) o.cut = m.index;
        continue;
      }
      if (!INLINE_TAGS.has(tag)) for (const o of stack) if (o.text && o.cut === null) o.cut = m.index;
      stack.push({ tag, at: m.index, innerStart: m.index + raw.length, text: TEXT_TAGS.has(tag), cut: null });
      continue;
    }
    let k = stack.length - 1;
    while (k >= 0 && stack[k].tag !== tag) k--;
    if (k < 0) continue;
    const open = stack[k];
    stack.length = k;
    if (!open.text) continue;
    const innerEnd = open.cut ?? m.index;
    const inner = src.slice(open.innerStart, innerEnd);
    if (stack.some((s) => s.text)) for (const s of stack) if (s.text && s.cut === null) s.cut = open.at;
    if (!inner.replace(/<[^>]*>/g, '').trim()) continue;
    if (open.cut !== null && !balancedInline(inner)) continue;
    out.push({ tag: open.tag, kind: kindOf(open.tag), start: open.innerStart, end: innerEnd, html: inner, outer: withBlockComment(src, open.at, m.index + raw.length), wholeElement: open.cut === null });
  }
  out.sort((a, b) => a.start - b.start);
  return out.map((s, index) => ({ index, ...s }));
}

const hrefsOf = (html: string) => new Set([...String(html ?? '').matchAll(/\shref\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((x) => x[2] ?? x[3] ?? '').filter(Boolean));

/** Only the inline tags a post's text may hold; a link only to an address the post already had. */
export function cleanInline(html: string, knownHrefs: Set<string>): string {
  return String(html ?? '').replace(tagRe(), (raw, name: string | undefined) => {
    if (raw.startsWith('<!--')) return '';
    const tag = String(name || '').toLowerCase();
    if (!WRITE_TAGS.has(tag)) return '';
    if (raw.startsWith('</')) return `</${tag}>`;
    if (tag === 'a') {
      const href = /\shref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(raw);
      const value = href ? (href[2] ?? href[3] ?? '') : '';
      if (!value || !knownHrefs.has(value)) return '<a>';
      return `<a href="${value.replace(/"/g, '&quot;')}">`;
    }
    return tag === 'br' ? '<br>' : `<${tag}>`;
  }).replace(/<a>([\s\S]*?)<\/a>/g, '$1');
}

/** The post with these segments' inner html replaced; every other byte stays. */
export function applySegmentEdits(html: string, segments: PostTextSegment[], edits: Array<{ index: number; html: string }>): string {
  const known = hrefsOf(html);
  const byIndex = new Map(edits.filter((e) => segments[e.index]).map((e) => [e.index, cleanInline(e.html, known).replace(/[\u2014\u2013]/g, ',')]));
  let out = String(html ?? '');
  for (const s of [...segments].sort((a, b) => b.start - a.start)) {
    const next = byIndex.get(s.index);
    if (next !== undefined && next !== s.html) out = out.slice(0, s.start) + next + out.slice(s.end);
  }
  return out;
}

/** What a locked stretch of the post holds, in owner words ("Picture", "Gallery"), or null for nothing visible. */
export function lockedName(fragment: string): string | null {
  const f = String(fragment ?? '');
  if (/wp:gallery|class="[^"]*\bgallery\b/i.test(f)) return 'Gallery';
  if (/wp:embed|<iframe\b/i.test(f)) return 'Embed';
  if (/wp:video|<video\b/i.test(f)) return 'Video';
  if (/wp:image|<img\b/i.test(f)) return 'Picture';
  const visible = f.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?(?:ul|ol|blockquote|div|section|figure)\b[^>]*>/gi, '').replace(/\s+/g, '');
  return visible ? 'Block' : null;
}

/** The post as the panel lists it: text segments to edit and locked rows between them, in order. */
export function postRows(html: string): Array<{ type: 'text'; segment: PostTextSegment } | { type: 'locked'; name: string }> {
  const segments = splitPostText(html);
  const rows: Array<{ type: 'text'; segment: PostTextSegment } | { type: 'locked'; name: string }> = [];
  let at = 0;
  const lockedUntil = (end: number) => {
    const name = lockedName(html.slice(at, end));
    if (name) rows.push({ type: 'locked', name });
  };
  for (const s of segments) {
    lockedUntil(s.outer.start);
    rows.push({ type: 'text', segment: s });
    // What a cut segment leaves in its element (a picture in a paragraph) is locked too.
    at = s.wholeElement ? s.outer.end : s.end;
  }
  lockedUntil(html.length);
  return rows;
}

/** SHA-256 of the post's text as WordPress stores it (the base a content write is checked against). */
export async function textHash(html: string): Promise<string> {
  const data = new TextEncoder().encode(html);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
