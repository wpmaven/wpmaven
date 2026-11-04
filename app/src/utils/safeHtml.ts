// HTML the dashboard draws as markup goes through DOMPurify first. The chat,
// the editor block previews and the onboarding logo show HTML the model wrote
// (or a page it read carried), and wp-admin runs with the admin's session:
// one <img onerror> there is a site takeover. Every profile drops what can run
// script (handlers, javascript: URLs, <script>, iframe srcdoc, object, embed)
// and keeps what its view needs.
import DOMPurify, { type Config } from 'dompurify';

/**
 * The chat shows words: no form to send what is typed, no style to pose as a
 * wp-admin screen, and nothing that fetches on its own besides an image
 * (keepImagesHome vets each one): no srcset, picture, video, audio, poster,
 * SVG image or background.
 */
const CHAT: Config = {
  FORBID_TAGS: ['style', 'form', 'picture', 'source', 'video', 'audio', 'track', 'svg'],
  FORBID_ATTR: ['style', 'srcset', 'sizes', 'poster', 'background'],
};

/** A block preview mirrors the page: inline styles, forms and http(s) embeds stay. */
const BLOCK: Config = {
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'loading', 'referrerpolicy'],
};

/** A logo is SVG and nothing else. */
const SVG: Config = { USE_PROFILES: { svg: true, svgFilters: true } };

const clean = (html: unknown, config: Config): string =>
  typeof html === 'string' && html ? DOMPurify.sanitize(html, config) : '';

/** WPMaven's own media: the public media host, the API's image lane and the public bucket. */
const WPMAVEN_MEDIA: ReadonlyArray<{ host: string; path: string }> = [
  { host: 'media.wpmaven.site', path: '/' },
  { host: 'api.wpmaven.ai', path: '/api/public/images/' },
  { host: 'storage.googleapis.com', path: '/webmaven-public-media/' },
  // The pictures of WordPress's theme directory (the chat shows the themes it found, find_themes).
  { host: 'ts.w.org', path: '/wp-content/themes/' },
  { host: 'i0.wp.com', path: '/themes.svn.wordpress.org/' },
];

/** This site's own hosts: wp-admin's, and its public address (site and home URL). */
function siteHosts(): Set<string> {
  const hosts = new Set<string>();
  const add = (u: unknown) => {
    try {
      if (typeof u === 'string' && u) hosts.add(new URL(u, window.location.href).host);
    } catch {
      // Not a URL: nothing to add.
    }
  };
  add(window.location.href);
  const data = (window as any).WEBMAVEN_WP_DATA;
  add(data?.site?.url);
  add(data?.editor?.siteUrl);
  add(data?.editor?.siteOrigin);
  return hosts;
}

/** Whether a chat image may load: a data: image, or http(s) from this site or WPMaven's media. */
export function chatImageAllowed(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src, window.location.href);
  } catch {
    return false;
  }
  if (url.protocol === 'data:') return /^data:image\//i.test(url.href);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (siteHosts().has(url.host)) return true;
  return WPMAVEN_MEDIA.some((m) => url.host === m.host && url.pathname.startsWith(m.path));
}

/**
 * Chat images load only from this site or WPMaven's media: an image is a
 * request the admin's browser makes by itself, and from anywhere else its
 * address could carry what the AI read to someone else's server. Any other
 * image becomes a link, fetched only when clicked (inside a link, its words).
 * The work happens in an inert template, so nothing is fetched meanwhile.
 */
function keepImagesHome(html: string): string {
  if (!/<(img|input)\b/i.test(html)) return html;
  const t = document.createElement('template');
  t.innerHTML = html;
  const doc = t.content.ownerDocument;
  t.content.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (src && chatImageAllowed(src)) return;
    const alt = (img.getAttribute('alt') || '').trim() || 'Image';
    let url: URL | null = null;
    try {
      url = src ? new URL(src, window.location.href) : null;
    } catch {
      url = null;
    }
    const linkable = url && (url.protocol === 'https:' || url.protocol === 'http:');
    if (!linkable || img.closest('a')) {
      img.replaceWith(doc.createTextNode(alt));
      return;
    }
    const a = doc.createElement('a');
    a.setAttribute('href', url!.href);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.textContent = `${alt} (${url!.host})`;
    img.replaceWith(a);
  });
  // Only an image may name something to fetch (an image input would too).
  t.content.querySelectorAll('[src]:not(img)').forEach((el) => el.removeAttribute('src'));
  return t.innerHTML;
}

/** Assistant chat HTML (marked output). */
export const sanitizeChatHtml = (html: unknown): string => keepImagesHome(clean(html, CHAT));

/** A Gutenberg block's innerHTML, for the editor previews. */
export const sanitizeBlockHtml = (html: unknown): string => clean(html, BLOCK);

/** An inline SVG logo. */
export const sanitizeSvg = (svg: unknown): string => clean(svg, SVG);
