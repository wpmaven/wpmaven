import DOMPurify from 'dompurify';
import { readableText } from './previewData';
import { escapeHtml } from './sitePreview';

/**
 * A draft post's HTML, made safe to draw in the approval preview
 * (SitePostPreview). The API already sanitized it; this is the second pass,
 * in the browser, with the same rules (the API's POST_SANITIZE_CONFIG in
 * services/sitePreviewHtml.ts), so a row from an older API, or one derived
 * from params, is never drawn raw:
 *
 *   kept:    text, headings, lists, links, images, figures, tables, inline
 *            styles and the post's own <style> block;
 *   removed: <script>, <iframe>, <object>, <embed>, forms and their fields,
 *            <link>, <meta>, <base>, every on* handler, javascript: and other
 *            non-web URLs, srcdoc, target, comments.
 *
 * Every link then opens in a new tab with no way back to this page
 * (rel="noopener noreferrer").
 *
 * Where there is no DOM to sanitize with (server rendering, the node tests),
 * it fails closed: the post's words only, escaped, one paragraph per block.
 * The frame it is drawn in runs no script either way.
 */
export const POST_SANITIZE_CONFIG = {
  FORCE_BODY: true,
  FORBID_TAGS: [
    'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal',
    'form', 'input', 'button', 'select', 'textarea', 'option', 'fieldset',
    'link', 'meta', 'base', 'noscript', 'template',
  ],
  FORBID_ATTR: ['srcdoc', 'formaction', 'action', 'target', 'ping', 'autofocus'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

/** The words of the post as escaped paragraphs: what is drawn when nothing can sanitize. */
export function wordsOnlyHtml(html: string): string {
  return readableText(html)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

type Purifier = {
  isSupported?: boolean;
  sanitize?: (html: string, cfg: Record<string, unknown>) => unknown;
};

/** Post HTML, safe to draw. `purifier` is for the tests; the app uses DOMPurify. */
export function sanitizePostHtml(html: string | null | undefined, purifier: Purifier = DOMPurify as unknown as Purifier): string {
  if (typeof html !== 'string' || !html.trim()) return '';
  if (!purifier?.isSupported || typeof purifier.sanitize !== 'function') return wordsOnlyHtml(html);
  try {
    const fragment = purifier.sanitize(html, { ...POST_SANITIZE_CONFIG, RETURN_DOM_FRAGMENT: true }) as DocumentFragment | null;
    if (!fragment || typeof (fragment as DocumentFragment).querySelectorAll !== 'function') return wordsOnlyHtml(html);
    fragment.querySelectorAll('a[href]').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
    const holder = fragment.ownerDocument.createElement('div');
    holder.appendChild(fragment);
    return holder.innerHTML;
  } catch {
    return wordsOnlyHtml(html);
  }
}
