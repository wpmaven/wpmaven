/**
 * Operator text: what an operator or a model wrote, read as the small part of
 * Markdown models actually use, so no surface ever shows the markers.
 *
 * The Co-CEO answered a request on Home with "### Summary of Actions:",
 * "* **Video Source**:" and a URL in backticks, and the bar printed every one
 * of those characters. Models write Markdown whether
 * they are asked to or not, so every surface that shows their words reads
 * them through this one parser and renders the result: React elements in
 * the dashboard; WhatsApp markup, escaped email HTML or plain text in the API.
 *
 * The subset, and nothing more:
 *  - paragraphs (a blank line) and line breaks (a single newline);
 *  - headings (`#` to `######`), rendered as a bold line, never as a title;
 *  - bullet lists (`-`, `*`, `+`, `•`) and numbered lists (`1.` or `1)`);
 *  - **bold** / __bold__, *italic* / _italic_, ~~struck~~, `code`;
 *  - links: `[words](https://...)`, `<https://...>` and bare http(s) URLs.
 *    Any other scheme (javascript:, data:, a relative path) keeps its words
 *    and loses the link;
 *  - fenced code blocks, kept exactly as written;
 *  - tables and quotes lose their pipes and `>`; rules are dropped;
 *  - HTML a model mixed in (only when the text holds a closing tag or a
 *    `<br>`): the tags become the same structure, other known tags are
 *    dropped, and `<script>` or `<style>` go with their contents. Text such
 *    as "add a <div> to the header" is left alone.
 *  - character references (`&bull;`, `&#8211;`) are decoded, once, in the
 *    words; never in code, and never before parsing, so `&ast;` cannot turn
 *    into a marker.
 *
 * Deliberately conservative, because the same parser strips notifications
 * and formats WhatsApp: an underscore or a single star inside a word
 * (site_down_alert, 2*3*4) is never emphasis, a marker needs a non-space next
 * to it, and a marker with no partner is shown as the character it is.
 *
 * Output is a tree, never HTML. The dashboard turns it into React elements
 * (its OperatorText component), so nothing a
 * model writes reaches the DOM as markup; the API formats it per channel
 * (its own formatter), escaping every word.
 *
 * MIRRORED: the dashboard and the API keep the same file. Change every copy,
 * or none.
 */

import { decodeEntities } from './entities';

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'strong'; c: Inline[] }
  /** `d` is the marker the writer used: WhatsApp reads `*x*` as bold. */
  | { t: 'em'; d: '*' | '_'; c: Inline[] }
  | { t: 'del'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; start: number; items: Inline[][] }
  | { t: 'pre'; v: string };

const HTTP_URL = /^https?:\/\/[^\s<>"'`]+$/i;

/** True for an absolute http(s) URL, the only links any surface opens. */
export function isHttpUrl(href: string): boolean {
  return HTTP_URL.test(href);
}

// ── HTML a model mixed in ────────────────────────────────────────────────

const BLOCK_TAGS = 'p|div|section|article|header|footer|blockquote|figure|figcaption|table|thead|tbody|tfoot|nav|main|aside|center|address|details|summary';
const DROP_TAGS = 'span|u|ins|mark|small|sup|sub|abbr|cite|q|label|font|img|del|s|strike|tr|td|th|caption|colgroup|col|picture|source|time|dl|dt|dd|pre|kbd|samp|var|big|tt';
const LOOKS_LIKE_HTML = new RegExp(`<\\/(?:${BLOCK_TAGS}|${DROP_TAGS}|a|b|strong|i|em|code|ul|ol|li|h[1-6])\\s*>|<br\\s*\\/?>`, 'i');

function htmlToText(s: string): string {
  if (!LOOKS_LIKE_HTML.test(s)) return s;
  return s
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\b[^>]*>/gi, '\n\n')
    .replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n\n')
    .replace(/<h[1-6]\b[^>]*>\s*/gi, '\n\n### ')
    .replace(/\s*<\/h[1-6]\s*>/gi, '\n\n')
    .replace(/<li\b[^>]*>\s*/gi, '\n- ')
    .replace(/<\/li\s*>|<\/?(?:ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]\s*>\s*(?=<t[dh]\b)/gi, ' · ')
    .replace(/<\/tr\s*>/gi, '\n')
    .replace(/<(strong|b)\b[^>]*>\s*([\s\S]*?)\s*<\/\1\s*>/gi, (_m, _t, inner: string) => (inner ? `**${inner}**` : ''))
    .replace(/<(em|i)\b[^>]*>\s*([\s\S]*?)\s*<\/\1\s*>/gi, (_m, _t, inner: string) => (inner ? `*${inner}*` : ''))
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, (_m, inner: string) => (inner ? `\`${inner}\`` : ''))
    .replace(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, _q, href: string, words: string) => {
      const url = decodeEntities(href.trim());
      return isHttpUrl(url) ? `[${words}](${url})` : words;
    })
    .replace(new RegExp(`<\\/?(?:${BLOCK_TAGS}|${DROP_TAGS}|a|b|strong|i|em|code|ul|ol|li|h[1-6]|br|hr)\\b[^>]*>`, 'gi'), '');
}

/** HTML outside code: fenced blocks and backtick spans are kept exactly as written. */
function convertHtmlOutsideCode(text: string): string {
  return text
    .split(/(`[^`\n]+`)/g)
    .map((part, i) => (i % 2 === 1 ? part : htmlToText(part)))
    .join('');
}

// ── Blocks ───────────────────────────────────────────────────────────────

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BULLET = /^(\s*)[-*+•][ \t]+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)][ \t]+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const QUOTE = /^\s{0,3}>[ \t]?/;

/** Parse `text` into blocks. Never throws; an empty or non-string input is no blocks. */
export function parseOperatorText(text: unknown): Block[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;
  let blankSinceItem = false;
  let prose: string[] = [];

  const flushPara = () => {
    if (para.length) {
      const c = parseInline(para.join('\n'));
      if (c.length) blocks.push({ t: 'p', c });
    }
    para = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it) => parseInline(it)).filter((c) => c.length > 0);
      if (items.length) {
        blocks.push(list.ordered ? { t: 'ol', start: list.start, items } : { t: 'ul', items });
      }
    }
    list = null;
    blankSinceItem = false;
  };

  // Prose runs (between fences) have their HTML read first, then go line by line.
  const flushProse = () => {
    if (!prose.length) return;
    const converted = convertHtmlOutsideCode(prose.join('\n')).split('\n');
    prose = [];
    for (const raw of converted) {
      const line = raw.replace(QUOTE, '');
      if (!line.trim()) {
        flushPara();
        if (list) blankSinceItem = true;
        continue;
      }
      const h = HEADING.exec(line);
      if (h) {
        flushPara();
        flushList();
        const c = parseInline(h[2]);
        if (c.length) blocks.push({ t: 'h', c });
        continue;
      }
      if (RULE.test(line)) {
        flushPara();
        flushList();
        continue;
      }
      const b = BULLET.exec(line);
      const o = b ? null : ORDERED.exec(line);
      if (b || o) {
        flushPara();
        const ordered = !!o;
        if (!list || list.ordered !== ordered) {
          flushList();
          list = { ordered, start: o ? Number(o[2]) : 1, items: [] };
        }
        list.items.push(b ? b[2] : o![3]);
        blankSinceItem = false;
        continue;
      }
      if (TABLE_ROW.test(line)) {
        if (TABLE_RULE.test(line)) continue;
        flushList();
        const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()).filter(Boolean);
        if (cells.length) para.push(cells.join(' · '));
        continue;
      }
      // A line under a list item belongs to it while nothing separated them,
      // or while it is indented under it after a blank line.
      if (list && (!blankSinceItem || /^\s{2,}/.test(line))) {
        const items: string[] = list.items;
        items[items.length - 1] += `\n${line.trim()}`;
        blankSinceItem = false;
        continue;
      }
      flushList();
      para.push(line);
    }
  };

  let fence: { marker: string; body: string[] } | null = null;
  for (const line of lines) {
    if (fence) {
      const close = FENCE.exec(line);
      if (close && close[1][0] === fence.marker[0] && close[1].length >= fence.marker.length && !line.trim().slice(close[1].length).trim()) {
        blocks.push({ t: 'pre', v: fence.body.join('\n') });
        fence = null;
      } else {
        fence.body.push(line);
      }
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      flushProse();
      flushPara();
      flushList();
      fence = { marker: open[1], body: [] };
      continue;
    }
    prose.push(line);
  }
  flushProse();
  flushPara();
  flushList();
  if (fence) blocks.push({ t: 'pre', v: fence.body.join('\n') });
  return blocks.filter((b) => b.t !== 'pre' || b.v.trim().length > 0);
}

// ── Inline ───────────────────────────────────────────────────────────────

const WORD = /[A-Za-z0-9]/;
const SPACE = /\s/;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~|>]/;
const BARE_URL = /^https?:\/\/[^\s<>"'`]+/i;

/** Text as leaves: references decoded, newlines as line breaks. */
function textLeaves(raw: string): Inline[] {
  const out: Inline[] = [];
  const parts = decodeEntities(raw).split('\n');
  parts.forEach((part, i) => {
    if (i > 0) out.push({ t: 'br' });
    if (part) out.push({ t: 'text', v: part });
  });
  return out;
}

/** A URL without the punctuation that ends the sentence around it. */
function trimUrl(url: string): string {
  let u = url;
  for (;;) {
    const last = u[u.length - 1];
    if (/[.,;:!?'"*_~]/.test(last)) { u = u.slice(0, -1); continue; }
    if (last === ')' && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) { u = u.slice(0, -1); continue; }
    if (last === ']' && !u.includes('[')) { u = u.slice(0, -1); continue; }
    return u;
  }
}

/** `[words](url)` starting at `i`, or null. */
function matchLink(s: string, i: number): { words: string; url: string; end: number } | null {
  let depth = 0;
  let j = i;
  for (; j < s.length; j++) {
    const ch = s[j];
    if (ch === '\\') { j++; continue; }
    if (ch === '\n' && s[j + 1] === '\n') return null;
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) break; }
  }
  if (j >= s.length || s[j + 1] !== '(') return null;
  const words = s.slice(i + 1, j);
  let k = j + 2;
  let parens = 1;
  for (; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\n') return null;
    if (ch === '(') parens++;
    else if (ch === ')') { parens--; if (parens === 0) break; }
  }
  if (k >= s.length) return null;
  let url = s.slice(j + 2, k).trim();
  // An optional title ("...") after the address, and <angle brackets> around it.
  url = url.replace(/\s+(["']).*\1$/, '').replace(/^<(.*)>$/, '$1').trim();
  return { words, url: decodeEntities(url), end: k + 1 };
}

/** Where the code span opened at `i` ends (index after it), or -1. */
function codeSpanEnd(s: string, i: number): number {
  let n = 0;
  while (s[i + n] === '`') n++;
  const fence = '`'.repeat(n);
  let k = s.indexOf(fence, i + n);
  while (k !== -1 && s[k + n] === '`') {
    let m = k;
    while (s[m] === '`') m++;
    k = s.indexOf(fence, m);
  }
  return k === -1 ? -1 : k + n;
}

/** Emphasis opened by the run of `ch` at `i`, or null when it is just the character. */
function matchEmphasis(s: string, i: number): { node: Inline; end: number } | null {
  const ch = s[i];
  let n = 0;
  while (s[i + n] === ch) n++;
  if (ch === '~' ? n !== 2 : n > 3) return null;
  const after = s[i + n];
  const before = i > 0 ? s[i - 1] : '';
  if (!after || SPACE.test(after)) return null;
  // Inside a word, _ and a single * are characters (site_down_alert, 2*3*4).
  const strictWord = ch === '_' || (ch === '*' && n === 1);
  if (strictWord && before && WORD.test(before)) return null;

  let j = i + n;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') {
      const end = codeSpanEnd(s, j);
      j = end === -1 ? j + 1 : end;
      continue;
    }
    if (c === '\n' && s[j + 1] === '\n') return null;
    if (c !== ch) { j++; continue; }
    let m = 0;
    while (s[j + m] === ch) m++;
    const prev = s[j - 1];
    const next = s[j + m];
    const closes = !!prev && !SPACE.test(prev) && !(strictWord && next && WORD.test(next));
    // A run of a different length is nested emphasis, except a run of three,
    // which closes the inner one and this one together (**bold *both***).
    const usable = m === n || (m === 3 && n < 3);
    if (closes && usable) {
      const closeAt = j + (m - n);
      const inner = s.slice(i + n, closeAt);
      if (inner.trim()) {
        const c2 = parseInline(inner);
        const node: Inline = ch === '~'
          ? { t: 'del', c: c2 }
          : n === 1
            ? { t: 'em', d: ch as '*' | '_', c: c2 }
            : n === 2
              ? { t: 'strong', c: c2 }
              : { t: 'strong', c: [{ t: 'em', d: ch as '*' | '_', c: c2 }] };
        return { node, end: closeAt + n };
      }
    }
    j += m;
  }
  return null;
}

/** Parse one run of inline text (it may hold newlines). */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const pushText = () => {
    if (buf) out.push(...textLeaves(buf));
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length && ESCAPABLE.test(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = codeSpanEnd(s, i);
      if (end !== -1) {
        let n = 0;
        while (s[i + n] === '`') n++;
        const v = s.slice(i + n, end - n);
        if (v.trim()) {
          pushText();
          out.push({ t: 'code', v: n > 1 ? v.trim() : v });
          i = end;
          continue;
        }
      }
      let n = 0;
      while (s[i + n] === '`') n++;
      buf += s.slice(i, i + n);
      i += n;
      continue;
    }
    if (ch === '[') {
      const link = matchLink(s, i);
      if (link) {
        pushText();
        const words = parseInline(link.words);
        if (isHttpUrl(link.url)) {
          out.push({ t: 'link', href: link.url, c: words.length ? words : [{ t: 'text', v: link.url }] });
        } else {
          out.push(...words);
        }
        i = link.end;
        continue;
      }
    }
    if (ch === '<') {
      const auto = /^<(https?:\/\/[^\s<>]+)>/i.exec(s.slice(i));
      if (auto) {
        pushText();
        const href = decodeEntities(auto[1]);
        out.push({ t: 'link', href, c: [{ t: 'text', v: href }] });
        i += auto[0].length;
        continue;
      }
    }
    if ((ch === 'h' || ch === 'H') && (i === 0 || !WORD.test(s[i - 1]))) {
      const bare = BARE_URL.exec(s.slice(i));
      if (bare) {
        const raw = trimUrl(bare[0]);
        const href = decodeEntities(raw);
        if (isHttpUrl(href) && /^https?:\/\/[^/?#]+\.[^/?#]/i.test(href)) {
          pushText();
          out.push({ t: 'link', href, c: [{ t: 'text', v: href }] });
          i += raw.length;
          continue;
        }
      }
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      const em = matchEmphasis(s, i);
      if (em) {
        pushText();
        out.push(em.node);
        i = em.end;
        continue;
      }
      let j = i;
      while (s[j] === ch) j++;
      buf += s.slice(i, j);
      i = j;
      continue;
    }
    buf += ch;
    i++;
  }
  pushText();
  return out;
}

// ── Plain text ───────────────────────────────────────────────────────────

/** The words of an inline run, markers gone: a link reads "words (url)" unless the words are the URL. */
export function inlinePlain(c: Inline[]): string {
  return c.map((n) => {
    switch (n.t) {
      case 'text': return n.v;
      case 'br': return '\n';
      case 'code': return n.v;
      case 'link': {
        const words = inlinePlain(n.c);
        return words === n.href ? n.href : `${words} (${n.href})`;
      }
      default: return inlinePlain(n.c);
    }
  }).join('');
}

/**
 * Operator text as plain text: no markers, no tags, references decoded.
 * Paragraphs are separated by a blank line, list items are "- " lines, a
 * heading is its own line. For places that can only hold a string (a
 * notification, a report field, a title, an email's text part).
 */
export function toPlainText(text: unknown): string {
  return parseOperatorText(text).map((b) => {
    switch (b.t) {
      case 'p':
      case 'h':
        return inlinePlain(b.c);
      case 'ul':
        return b.items.map((it) => `- ${inlinePlain(it)}`).join('\n');
      case 'ol':
        return b.items.map((it, k) => `${b.start + k}. ${inlinePlain(it)}`).join('\n');
      case 'pre':
        return b.v;
    }
  }).join('\n\n').replace(/[ \t]+$/gm, '');
}

/** Plain text on one line: for a title, a subject, or a string that sits inside a sentence. */
export function toPlainLine(text: unknown): string {
  return toPlainText(text).replace(/\s*\n+\s*/g, ' ').trim();
}
