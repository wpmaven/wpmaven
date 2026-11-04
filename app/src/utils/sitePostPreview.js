/**
 * A post, page or product the assistant wants to put on the site, read from
 * the approval the chat shows (2026-09-24).
 *
 * The chat's approval card used to print the call's parameters as JSON, so
 * the owner read a blog post as "content": "<h2>Master Class &bull; ...".
 * This reads the same call the way the dashboard does: what it is, its title and status in plain words,
 * its first words decoded, its featured image, and its HTML made safe to
 * draw in a frame that runs no script (SitePostCard).
 *
 * The browser's own parser does the reading: a document made by DOMParser
 * runs nothing and loads nothing.
 */

const COMMANDS = {
  create_post: 'post',
  create_page: 'page',
  update_post: 'update',
  multilingual_save_translation: 'translation',
  woocommerce_create_product: 'product',
};

export const KIND_LABEL = {
  post: 'New blog post',
  page: 'New page',
  update: 'Change to a page on your site',
  // Not "New": with overwrite it rewrites the translation there now.
  translation: 'Translation',
  product: 'New product',
};

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const str = (v) => (typeof v === 'string' && v.trim() ? v : null);

/** An absolute http(s) address, or null. */
export function httpUrl(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : null;
}

/**
 * A translation saved with overwrite and no status: save_translation
 * (backend/wpmaven/includes/capabilities/multilingual.php) rewrites the one there now
 * and sets its status only when one is given, so a live one stays live; only
 * a new one starts as a draft. Same words as the dashboard and the API.
 */
export const TRANSLATION_KEEPS_STATUS_LABEL = 'Replaces the one there now and keeps its status (a new one starts as a draft)';

/** `overwrite` as save_translation reads it (!empty). Without it an existing translation is never touched. */
export function overwriteSet(v) {
  if (v === undefined || v === null || v === false || v === 0 || v === '' || v === '0') return false;
  return !(Array.isArray(v) && v.length === 0);
}

/** The owner's words for a status. Same sentences as the dashboard. */
export function statusLabelFor(kind, status) {
  switch (status) {
    case 'publish': return 'Will be published';
    case 'future': return 'Scheduled';
    case 'private': return 'Private';
    case 'pending': return 'Draft, waiting for review';
    case 'draft': return 'Draft';
    default:
      return kind === 'update' ? 'Changes what is there now'
        : kind === 'translation' ? TRANSLATION_KEEPS_STATUS_LABEL
          : 'Draft';
  }
}

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'MAIN', 'NAV', 'OL', 'P',
  'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TR', 'UL',
]);
const SILENT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'svg', 'HEAD', 'TITLE', 'IFRAME', 'OBJECT']);

function parse(html) {
  return new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
}

/** The words of post HTML as the site lays them out, every reference decoded once. */
export function htmlToWords(html) {
  if (typeof html !== 'string' || !html) return '';
  if (!/<[a-z!/][^>]*>/i.test(html)) {
    const doc = parse('');
    const t = doc.createElement('textarea');
    t.innerHTML = html;
    return t.value.replace(/ /g, ' ').trim();
  }
  let out = '';
  const walk = (node) => {
    if (node.nodeType === 3) { out += node.nodeValue.replace(/[ \t\r\n\f]+/g, ' '); return; }
    if (node.nodeType !== 1) return;
    const name = node.nodeName.toUpperCase();
    if (SILENT.has(node.nodeName) || SILENT.has(name)) return;
    if (name === 'BR') { out += '\n'; return; }
    if (name === 'LI') out += '\n• ';
    else if (name === 'TD' || name === 'TH') out += ' ';
    else if (BLOCK.has(name)) out += '\n\n';
    node.childNodes.forEach(walk);
    if (BLOCK.has(name)) out += '\n\n';
  };
  parse(html).body.childNodes.forEach(walk);
  return out
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A sentence as plain words on one line, every reference decoded once: the
 * approval card prints its sentence as text, and a title quoted in it can
 * arrive as written ("Master Class &bull; Specialty Brewing").
 */
export function plainLine(text) {
  if (typeof text !== 'string' || !text) return text;
  return htmlToWords(text).replace(/\s+/g, ' ').trim() || text;
}

/** `text` cut to `max` characters at a word, with "..." when it was cut. */
export function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(1, max - 3));
  const atWord = cut.replace(/\s+\S*$/, '');
  return `${(atWord.length >= max * 0.6 ? atWord : cut).trimEnd()}...`;
}

const FORBIDDEN = 'script,iframe,frame,frameset,object,embed,applet,portal,form,input,button,select,textarea,option,fieldset,link,meta,base,noscript,template';
const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background'];

/**
 * Post HTML made safe to draw: the same rules as the API's sanitizer
 * (styles and images kept; scripts, frames, forms, meta, base, handlers,
 * javascript: links, srcdoc and target removed). Drawn in a frame that runs
 * no script besides.
 */
export function sanitizeForPreview(html) {
  if (typeof html !== 'string' || !html.trim()) return '';
  const doc = parse(html);
  doc.body.querySelectorAll(FORBIDDEN).forEach((el) => el.remove());
  doc.body.querySelectorAll('svg script, math').forEach((el) => el.remove());
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'target' || name === 'ping') {
        el.removeAttribute(attr.name);
        continue;
      }
      if (URL_ATTRS.includes(name)) {
        const value = attr.value.replace(/[\u0000- ]+/g, '').toLowerCase();
        if (/^(javascript|vbscript|data):/.test(value) && !(name === 'src' && el.nodeName === 'IMG' && value.startsWith('data:image/'))) {
          el.removeAttribute(attr.name);
        }
      }
    }
    if (el.nodeName === 'A' && el.hasAttribute('href')) el.setAttribute('rel', 'noopener noreferrer');
  });
  // Comments (block markup) are not part of the page.
  const walker = doc.createTreeWalker(doc.body, 128);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.remove());
  return doc.body.innerHTML;
}

/** The first http(s) images the HTML shows. */
export function imagesIn(html) {
  if (typeof html !== 'string' || !/<img\b/i.test(html)) return [];
  const out = [];
  parse(html).body.querySelectorAll('img[src]').forEach((img) => {
    const url = httpUrl(img.getAttribute('src'));
    if (url && !out.includes(url)) out.push(url);
  });
  return out;
}

/**
 * The preview of an approval's call, or null when it puts no post, page or
 * product on the site.
 */
export function sitePostFromApproval(action, parameters) {
  const p = asObject(parameters);
  if (!p || !action) return null;
  let command = String(action);
  let args = p;
  if (command === 'execute_command') {
    const call = asObject(p.command) || p;
    command = String(call.command || '').replace(/^wp_/, '');
    args = asObject(call.args) || {};
  }
  const kind = COMMANDS[command];
  if (!kind) return null;
  const rawTitle = kind === 'product' ? str(args.name) : str(args.title);
  const title = rawTitle ? htmlToWords(rawTitle).replace(/\s+/g, ' ').trim() || null : null;
  const body = kind === 'product'
    ? [str(args.short_description), str(args.description)].filter(Boolean).join('\n')
    : str(args.content) || '';
  // An update, and a translation saved with overwrite, keep the status of
  // what is there now.
  const keepsStatus = kind === 'update' || (kind === 'translation' && overwriteSet(args.overwrite));
  const status = str(args.status) || (kind === 'product' ? 'publish' : keepsStatus ? null : 'draft');
  const productImages = kind === 'product' && Array.isArray(args.images) ? args.images.map(httpUrl).filter(Boolean) : [];
  const featuredImageUrl = kind === 'product' ? productImages[0] || null : httpUrl(args.featured_image_url);
  const words = htmlToWords(body).replace(/\s+/g, ' ').trim();
  const images = [];
  [featuredImageUrl, ...productImages, ...imagesIn(body)].forEach((u) => { if (u && !images.includes(u)) images.push(u); });
  return {
    kind,
    title,
    status,
    statusLabel: statusLabelFor(kind, status),
    excerpt: words ? clip(words, 300) : null,
    body,
    featuredImageUrl,
    images,
  };
}

/** The frame's policy: images, styles and fonts from the web, no script, no form. */
export const PREVIEW_CSP = "default-src 'none'; img-src https: data:; media-src https:; style-src 'unsafe-inline' https:; font-src https: data:; form-action 'none'";

/** No allow-scripts and no allow-same-origin: the post runs nothing and reaches nothing. */
export const PREVIEW_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox';

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The document the preview frame shows: policy first, then the post. */
export function previewDocument(post, siteUrl) {
  const base = httpUrl(siteUrl);
  const featured = httpUrl(post.featuredImageUrl);
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${esc(PREVIEW_CSP)}">`,
    '<meta name="referrer" content="no-referrer">',
    base ? `<base href="${esc(base)}" target="_blank">` : '<base target="_blank">',
    '<style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1d2327;background:#fff}',
    '.wm-post{max-width:680px;margin:0 auto;padding:16px 18px 24px}.wm-post h1{font-size:1.7em;line-height:1.25;margin:0 0 .6em}',
    '.wm-post img{max-width:100%;height:auto}.wm-featured{display:block;width:100%;max-height:360px;object-fit:cover;margin:0 0 1em;border-radius:6px}</style>',
    '</head><body><article class="wm-post">',
    post.title ? `<h1>${esc(post.title)}</h1>` : '',
    featured ? `<img class="wm-featured" src="${esc(featured)}" alt="">` : '',
    sanitizeForPreview(post.body),
    '</article></body></html>',
  ].join('');
}
