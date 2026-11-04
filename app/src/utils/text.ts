/**
 * Text WordPress hands over with HTML character references in it: the REST
 * API's `title.rendered` is texturized and entity encoded ("Coffee&#8217;s",
 * "Bean &amp; Batch"), and React prints it as text, references and all.
 * Decoded the way the browser does, with a textarea of an inert document
 * (its content is text, never markup, and nothing in it runs), the approach
 * of utils/sitePostPreview.js.
 */
export function decodeHtmlEntities(text: string | null | undefined): string {
  if (typeof text !== 'string') return '';
  if (text.indexOf('&') === -1 || typeof document === 'undefined') return text;
  const inert = document.implementation.createHTMLDocument('');
  const area = inert.createElement('textarea');
  area.innerHTML = text;
  return area.value;
}
