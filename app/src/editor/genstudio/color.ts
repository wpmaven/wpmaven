/** Colors and fonts for the Design panel: hex values, contrast, font links. */

/** "#1D4E89", "1d4e89" or "#abc" as "#1d4e89"; null when it is not a color. */
export function normalizeHex(value: string): string | null {
  const v = String(value ?? '').trim().replace(/^#?/, '#').toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return null;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a hex color. */
export function luminance(hex: string): number | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio of two colors (1 to 21), or null. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The faces the site generator knows well (Google Fonts, then Fontshare). */
export const FONT_SHORTLIST: readonly string[] = [
  'Archivo Black', 'Anton', 'Bricolage Grotesque', 'Clash Display',
  'Space Grotesk', 'Sora', 'Outfit', 'General Sans',
  'Instrument Sans', 'Albert Sans', 'Work Sans',
  'Oswald', 'Barlow Condensed', 'Archivo Narrow',
  'Zilla Slab', 'Arvo', 'Bitter',
  'Playfair Display', 'DM Serif Display', 'Bodoni Moda',
  'Source Serif 4', 'Lora', 'EB Garamond',
  'Special Elite', 'Space Mono', 'IBM Plex Mono',
  'Pacifico', 'Lobster', 'Caveat',
];

const FONTSHARE = new Set(['clash display', 'general sans', 'satoshi', 'zodiak', 'sentient', 'cabinet grotesk', 'switzer', 'chillax', 'boska', 'gambetta', 'erode', 'supreme']);

/** A family name WPMaven accepts (the API's own rule). */
export function validFontName(name: string): boolean {
  const n = String(name ?? '').trim();
  return n.length >= 1 && n.length <= 60 && /^[\w .'-]+$/.test(n);
}

/** The stylesheet that loads a family for a live look. */
export function fontHref(name: string): string {
  const n = String(name).trim();
  if (FONTSHARE.has(n.toLowerCase())) {
    return `https://api.fontshare.com/v2/css?f[]=${n.toLowerCase().replace(/\s+/g, '-')}@400,500,600,700&display=swap`;
  }
  return `https://fonts.googleapis.com/css2?family=${n.replace(/\s+/g, '+')}:wght@400;500;600;700&display=swap`;
}
