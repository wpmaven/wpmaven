/**
 * The media library as the screens read it: WordPress's wp/v2/media answers
 * as StoreMediaRow (raw texts, the grid's small size, the where-used count
 * the plugin adds), and the site's upload limit in words.
 */

import { decodeHtmlEntities } from '../../../../utils/text';
import type { MediaKind, StoreMediaRow } from '../../../../types/store';

interface WpSize {
  source_url?: string;
}

/** The parts of a wp/v2/media answer the screens read (context=edit gives the raw texts). */
export interface WpMedia {
  id: number;
  date?: string;
  date_gmt?: string | null;
  title?: { raw?: string; rendered?: string };
  caption?: { raw?: string; rendered?: string };
  alt_text?: string;
  mime_type?: string;
  source_url?: string;
  media_details?: { width?: number; height?: number; filesize?: number; file?: string; sizes?: Record<string, WpSize> };
  /** Added by the plugin when wpmaven_uses=1 is asked. */
  wpmaven?: { uses?: number | null };
}

/** What lists ask for (_fields), so a page of files stays small. */
export const MEDIA_FIELDS = 'id,date,date_gmt,title,caption,alt_text,mime_type,source_url,media_details,wpmaven';

export function mediaKind(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('application/') || mime.startsWith('text/')) return 'document';
  return 'other';
}

/** HTML WordPress rendered, as the text it shows. */
export function plainText(html: string | null | undefined): string {
  return decodeHtmlEntities(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** A raw text when WordPress gave it (context=edit), else the rendered one as text. */
export function rawOrText(field: { raw?: string; rendered?: string } | undefined): string {
  return typeof field?.raw === 'string' ? decodeHtmlEntities(field.raw) : plainText(field?.rendered);
}

function fileName(path: string): string {
  const last = path.split('?')[0].split('/').pop() || '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function toMediaRow(m: WpMedia): StoreMediaRow {
  const mime = m.mime_type || '';
  const details = m.media_details ?? {};
  const sizes = details.sizes ?? {};
  const url = m.source_url || '';
  const kind = mediaKind(mime);
  return {
    id: m.id,
    title: rawOrText(m.title),
    filename: fileName(details.file || url),
    url,
    thumbUrl: sizes.medium?.source_url || sizes.thumbnail?.source_url || (kind === 'image' ? url || null : null),
    mime,
    kind,
    width: typeof details.width === 'number' ? details.width : null,
    height: typeof details.height === 'number' ? details.height : null,
    bytes: typeof details.filesize === 'number' ? details.filesize : null,
    alt: m.alt_text ?? '',
    caption: typeof m.caption?.raw === 'string' ? m.caption.raw : plainText(m.caption?.rendered),
    date: m.date_gmt || m.date || '',
    uses: typeof m.wpmaven?.uses === 'number' ? m.wpmaven.uses : null,
  };
}

/** "8 MB", "512 KB": a size as people read it. */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb >= 10 || Number.isInteger(mb) ? Math.round(mb) : mb.toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** Why a file cannot go to the site (larger than its upload limit), or null. */
export function tooLargeSentence(file: { name: string; size: number }, maxBytes: number): string | null {
  if (!(maxBytes > 0) || file.size <= maxBytes) return null;
  return `${file.name} is ${formatBytes(file.size)}. Your site takes files up to ${formatBytes(maxBytes)}.`;
}
