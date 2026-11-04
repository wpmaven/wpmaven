import React, { useId } from 'react';
import type { CSSProperties } from 'react';
import { operatorAccents } from '../../foundation/tokens';

/**
 * The team's portraits (Atelier, "Direction C").
 *
 * The AI team has to read as colleagues a business owner would trust with
 * their money, so these are drawn in the register luxury and finance use:
 * a flat dark hair mass, a monoline contour for face and shoulders, composed
 * expressions, and exactly one accent thread per member (a scarf, a collar
 * line, a lens, a pin). No filled cartoon faces, no smiles, no blush.
 *
 * The whole set is one language with per-member variation, so thirteen people
 * cost thirteen data rows rather than thirteen drawings:
 *   hair   the silhouette that identifies them at 20px
 *   beard  optional jaw mass
 *   extra  glasses, earring, headset or lapel pin, drawn in the accent
 *   accent the member's colour (operatorAccents), used once
 *
 * Presence is not drawn here (see OperatorAvatar): the portrait itself stays
 * still, which is what keeps a row of eight from looking like a cartoon strip.
 */

type Hair =
  | 'lob'        // chin-length, deep side part
  | 'crop'       // short, crisp hairline
  | 'bun'        // pulled back, low knot
  | 'curls'      // rounded volume
  | 'waves'      // shoulder-length, soft
  | 'buzz'       // very short
  | 'tiedback'   // long, gathered
  | 'coils'      // a full halo of tight curls
  | 'beanie'     // a knit cap with a folded band
  | 'pixie'      // short, a fringe swept across the forehead
  | 'quiff'      // short sides, the top swept up
  | 'braids';    // a centre part, a braid down each side

/* Representation inside a monochrome register: the palette stays ink, paper
   and grey, so tone is a VALUE rather than a colour, the same way black and
   white portrait illustration has always shown different skin. Features carry
   what value cannot: the eye line is drawn per face, so an epicanthic fold and
   a deeper-set crease are different strokes, not different fills. */
type Tone = 'paper' | 'light' | 'mid' | 'deep' | 'deepest';

const TONES: Record<Tone, { skin: string; line: string }> = {
  paper:   { skin: '#FBFAFC', line: '#26272E' },
  light:   { skin: '#E6E3E9', line: '#26272E' },
  mid:     { skin: '#B9B5BE', line: '#1E1F25' },
  deep:    { skin: '#6F6B75', line: '#F4F3F6' },
  deepest: { skin: '#494650', line: '#F4F3F6' },
};

/** Eye construction. 'fold' draws a lidded, low-crease eye; 'crease' draws a
 *  deeper-set upper lid. Both are two strokes: the difference is the shape. */
type Eyes = 'crease' | 'fold';

interface Spec {
  hair: Hair;
  tone: Tone;
  eyes: Eyes;
  beard?: boolean;
  extra?: 'glasses' | 'earring' | 'headset' | 'pin';
}

/** The cast. Hues come from operatorAccents, the one colour table. */
const SPECS: Record<string, Spec> = {
  chief_of_staff:          { hair: 'lob',      tone: 'paper',   eyes: 'crease', extra: 'earring' },
  chief_financial_officer: { hair: 'bun',      tone: 'paper',   eyes: 'crease', extra: 'glasses' },
  web_designer:            { hair: 'curls',    tone: 'light',   eyes: 'fold' },
  web_developer:           { hair: 'crop',     tone: 'paper',   eyes: 'crease', beard: true },
  webmaster:               { hair: 'buzz',     tone: 'deepest', eyes: 'crease', beard: true },
  content_writer:          { hair: 'pixie',    tone: 'light',   eyes: 'crease' },
  seo_specialist:          { hair: 'tiedback', tone: 'paper',   eyes: 'fold',   extra: 'glasses' },
  social_media_manager:    { hair: 'braids',   tone: 'deep',    eyes: 'crease', extra: 'earring' },
  data_analyst:            { hair: 'crop',     tone: 'mid',     eyes: 'fold',   extra: 'glasses' },
  ecommerce_manager:       { hair: 'quiff',    tone: 'mid',     eyes: 'crease' },
  customer_support:        { hair: 'waves',    tone: 'deep',    eyes: 'crease', extra: 'headset' },
  // The pin is the Growth Concierge's diamond, worn on the lapel.
  growth_concierge:        { hair: 'coils',    tone: 'deep',    eyes: 'crease', extra: 'pin' },
  video_producer:          { hair: 'beanie',   tone: 'mid',     eyes: 'fold' },
};

/** True when the id has a drawn portrait (an unknown id draws the silhouette). */
export function hasOperatorFace(id: string | null | undefined): boolean {
  return !!id && Object.prototype.hasOwnProperty.call(SPECS, id);
}

const INK = '#26272E';
const PAPER = '#F2F1F6';

/** Flat hair masses: the silhouette does the identifying at small sizes. */
const HAIR: Record<Hair, string> = {
  lob: 'M58 16.5 C47 16.5 40.5 25 41 38 C41.5 50 40 60 37 68 C41 70.5 46 69.5 48.5 66.5 C46 58 45.5 48 45.6 40 C49.5 35.5 55.5 31.5 62.5 27.8 C67.5 30.5 72.5 34 74.4 40 C74.5 48 74 58 71.5 66 C74 69.5 79 70.5 83 68 C80 60 79 50 79 38 C79 24 70.5 16.5 58 16.5 Z',
  crop: 'M41.5 38.5 C41 25 50 17.5 60 17.5 C70 17.5 79 25 78.5 38.5 L75 38.5 C74.6 32.5 70.5 28.6 64 28.4 C57 28.2 50.5 29.2 47.4 31.6 C45.9 33.4 45.3 35.6 45.2 38.5 Z',
  bun: 'M41.5 38 C41 25 50 17.5 60 17.5 C70 17.5 79 25 78.5 38 L75 38 C74.5 32 69.5 28.5 60 28.5 C50.5 28.5 45.5 32 45 38 Z M70.5 18.5 a6.5 6.5 0 1 0 13 0 a6.5 6.5 0 1 0 -13 0 Z',
  curls: 'M40 43 C37.5 38 38 31 41.5 26 C42.5 21.5 46.5 17.5 51 16.5 C53.5 14 57 13 60 13 C63 13 66.5 14 69 16.5 C73.5 17.5 77.5 21.5 78.5 26 C82 31 82.5 38 80 43 C78.5 40 76.8 38 75.3 37 C74.5 32 70 28.5 63.5 28.8 C58 27.3 51 28.6 47.5 31.5 C45.8 33 45.2 35 44.7 37 C43 38 41.3 40 40 43 Z',
  waves: 'M60 16 C48 16 40.5 25 41 38 C41.5 50 39 60 37.5 70 C36.8 75.5 38.5 79.5 41.5 80.5 C45 81.5 48.5 79 49.2 75 C47 66 45.6 52 45.6 40 C49 33.5 55 29.8 60 28.8 C65 29.8 71 33.5 74.4 40 C74.4 52 73 66 70.8 75 C71.5 79 75 81.5 78.5 80.5 C81.5 79.5 83.2 75.5 82.5 70 C81 60 78.5 50 79 38 C79.5 25 72 16 60 16 Z',
  buzz: 'M43 38 C43 26 51 19 60 19 C69 19 77 26 77 38 L75 38 C74.8 33 70 30.5 60 30.5 C50 30.5 45.2 33 45 38 Z',
  tiedback: 'M41.5 38 C41 25 50 17.5 60 17.5 C70 17.5 79 25 78.5 38 L75 38 C74.5 31.5 69 27.5 60 27.5 C51 27.5 45.5 31.5 45 38 Z M77.5 33 C83 36.5 85.5 45 84 55 C83.4 59 81.5 61.5 79.8 62 C80.8 55 80.3 46.5 76.6 40 Z',
  // A scalloped halo over the head (one arc per curl), back across a soft hairline.
  coils: 'M 37.7 34.6 A 3.4 3.4 0 0 1 37.4 28.4 A 3.5 3.5 0 0 1 39.4 22.4 A 3.7 3.7 0 0 1 43.5 17.3 A 3.9 3.9 0 0 1 49.4 13.6 A 4.1 4.1 0 0 1 56.3 11.6 A 4.1 4.1 0 0 1 63.7 11.6 A 4.1 4.1 0 0 1 70.6 13.6 A 3.9 3.9 0 0 1 76.5 17.3 A 3.7 3.7 0 0 1 80.6 22.4 A 3.5 3.5 0 0 1 82.6 28.4 A 3.4 3.4 0 0 1 82.3 34.6 C 81.2 38.2 78.4 41.4 76.4 42.6 C 76.4 35.4 72.4 29.4 65.6 27.9 C 62.4 27.2 57.6 27.2 54.4 27.9 C 47.6 29.4 43.6 35.4 43.6 42.6 C 41.6 41.4 38.8 38.2 37.7 34.6 Z',
  pixie: 'M41.5 39 C41 25 50 17.5 60 17.5 C70 17.5 79 25 78.5 38.5 L75 38.5 C74.5 34 72.5 31 69.5 29.5 C63 33 55 37.5 47.5 39.5 C46.5 39.7 45.6 39.6 45.2 39 Z',
  quiff: 'M43 38 C42.5 30 44 24 48 20 C51 14 58 10.5 66 11.5 C72 12.5 77.5 17 77.8 24 C78.2 29 77.5 33.5 77 38 L75 38 C74.5 33 71 29.5 65 29 C58.5 28.5 51.5 29.8 47.5 32.3 C45.8 33.8 45.2 35.8 45 38 Z',
  braids: 'M41.5 38 C41 25 50 17.5 60 17.5 C70 17.5 79 25 78.5 38 L75 38 C74.5 32 69 29 61 28.6 L60 30.5 L59 28.6 C51 29 45.5 32 45 38 Z M37.8 41 a3.2 3.8 0 1 1 6.4 0 a3.2 3.8 0 1 1 -6.4 0 Z M37.8 47 a3.2 3.8 0 1 1 6.4 0 a3.2 3.8 0 1 1 -6.4 0 Z M37.8 53 a3.2 3.8 0 1 1 6.4 0 a3.2 3.8 0 1 1 -6.4 0 Z M37.8 59 a3.2 3.8 0 1 1 6.4 0 a3.2 3.8 0 1 1 -6.4 0 Z M37.8 65 a3.2 3.8 0 1 1 6.4 0 a3.2 3.8 0 1 1 -6.4 0 Z M37.8 71 a3.2 3.8 0 1 1 6.4 0 a3.2 3.8 0 1 1 -6.4 0 Z M39.3 76.2 a1.7 2.6 0 1 1 3.4 0 a1.7 2.6 0 1 1 -3.4 0 Z M75.8 41 a3.2 3.8 0 1 1 6.4 0 a3.2 3.8 0 1 1 -6.4 0 Z M75.8 47 a3.2 3.8 0 1 1 6.4 0 a3.2 3.8 0 1 1 -6.4 0 Z M75.8 53 a3.2 3.8 0 1 1 6.4 0 a3.2 3.8 0 1 1 -6.4 0 Z M75.8 59 a3.2 3.8 0 1 1 6.4 0 a3.2 3.8 0 1 1 -6.4 0 Z M75.8 65 a3.2 3.8 0 1 1 6.4 0 a3.2 3.8 0 1 1 -6.4 0 Z M75.8 71 a3.2 3.8 0 1 1 6.4 0 a3.2 3.8 0 1 1 -6.4 0 Z M77.3 76.2 a1.7 2.6 0 1 1 3.4 0 a1.7 2.6 0 1 1 -3.4 0 Z',
  // The crown, the folded band, and the hair showing under it at the temples.
  beanie: 'M42 31 C41 19.5 49.5 11.5 60 11.5 C70.5 11.5 79 19.5 78 31 Z M43 28 H77 Q80 28 80 31 V35 Q80 38 77 38 H43 Q40 38 40 35 V31 Q40 28 43 28 Z M41.5 37.5 C41.6 40.5 42.6 42.8 44.4 44.2 L45.6 38 Z M78.5 37.5 C78.4 40.5 77.4 42.8 75.6 44.2 L74.4 38 Z',
};

/** The knit of the beanie's band, as paper lines over the ink. */
const BEANIE_RIBS = 'M44 29.5 V36.5 M48 29.5 V36.5 M52 29.5 V36.5 M56 29.5 V36.5 M60 29.5 V36.5 M64 29.5 V36.5 M68 29.5 V36.5 M72 29.5 V36.5 M76 29.5 V36.5';

const BEARD =
  'M44.6 48 C44.6 57 47 63 50.5 66.5 C53.5 70 57 72.5 60 72.5 C63 72.5 66.5 70 69.5 66.5 C73 63 75.4 57 75.4 48 C74 54 71 58.5 66.8 60 C64 59 56 59 53.2 60 C49 58.5 46 54 44.6 48 Z M54.6 64 a5.4 2.6 0 1 1 10.8 0 a5.4 2.6 0 1 1 -10.8 0 Z';

const HEAD = 'M45 38 C44 47 45 56 49 62 C52 67 56.5 70 60 70 C63.5 70 68 67 71 62 C75 56 76 47 75 38 C75 27 68 21 60 21 C52 21 45 27 45 38 Z';
const SHOULDERS = 'M22 112 C28 92 42 85 53 83 L60 93 L67 83 C78 85 92 92 98 112';

export interface OperatorFaceProps {
  /** An API operator id. An unknown id draws a neutral silhouette, never nothing. */
  id: string | null | undefined;
  size?: number;
  /** Accessible name. Without it the drawing is decorative (aria-hidden). */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

/** One portrait on its paper disc, as a self-contained inline SVG. */
export function OperatorFace({ id, size = 40, title, className, style }: OperatorFaceProps) {
  // A clip path id per instance: two faces of the same member on one page
  // must not share one.
  const clipId = `wm-face-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const spec = id ? SPECS[id] : undefined;
  const a11y = title
    ? { role: 'img' as const, 'aria-label': title }
    : { 'aria-hidden': true as const };

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      style={style}
      focusable="false"
      {...a11y}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="60" cy="60" r="60" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="120" height="120" fill={PAPER} />
        {spec ? <Portrait spec={spec} accent={operatorAccents[id as string]} /> : <Silhouette />}
      </g>
    </svg>
  );
}

function Portrait({ spec, accent }: { spec: Spec; accent: string }) {
  const { hair, tone, eyes, beard, extra } = spec;
  const { skin, line } = TONES[tone];
  return (
    <>
      {/* Skin as a grey value, under the linework. */}
      <path d="M53 70 h14 v13 c0 4 -14 4 -14 0 Z" fill={skin} />
      <path d={HEAD} fill={skin} />
      <ellipse cx="44.5" cy="49" rx="2.6" ry="4" fill={skin} />
      <ellipse cx="75.5" cy="49" rx="2.6" ry="4" fill={skin} />
      <g fill="none" stroke={line} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        {/* shoulders and neck: the collar frames the face and carries the accent */}
        <path d={SHOULDERS} stroke={INK} />
        <path d="M53 70 L53 81 M67 70 L67 81" />
        {/* face contour: forehead, cheek, jaw, chin */}
        <path d="M45 38 C44 47 45 56 49 62 C52 67 56.5 70 60 70 C63.5 70 68 67 71 62 C75 56 76 47 75 38" />
        {/* brows, eyes, nose, mouth: single calm strokes, no expression */}
        <path d="M49.5 42.5 Q53.5 40.9 56.5 42.1" />
        <path d="M63.5 42.1 Q66.5 40.9 70.5 42.5" />
        {eyes === 'fold' ? (
          <>
            {/* Lidded eye: a long, low upper line with the fold above it. */}
            <path d="M49.8 47.9 Q53.5 46.4 57 48" />
            <path d="M49.6 45.6 Q53.4 43.9 57.4 45.4" strokeWidth="1.5" />
            <path d="M63 48 Q66.5 46.4 70.2 47.9" />
            <path d="M62.6 45.4 Q66.6 43.9 70.4 45.6" strokeWidth="1.5" />
          </>
        ) : (
          <>
            {/* Deeper-set eye: a rounder upper lid, crease closer to it. */}
            <path d="M50.5 47.6 Q53.5 45.9 56.5 47.6" />
            <path d="M63.5 47.6 Q66.5 45.9 69.5 47.6" />
          </>
        )}
        <path d="M60 50 C60 54 59.4 56.4 58.4 58" />
        <path d="M55.5 63.4 Q60 64.9 64.5 63.4" />
        {extra === 'glasses' && (
          <g stroke={accent} strokeWidth="1.9">
            <rect x="46.5" y="43.5" width="12" height="8.6" rx="4" />
            <rect x="61.5" y="43.5" width="12" height="8.6" rx="4" />
            <path d="M58.5 47.6 L61.5 47.6" />
          </g>
        )}
        {extra === 'headset' && (
          <g stroke={accent} strokeWidth="2.2">
            <path d="M43 47 C42 33 50 25 60 25 C70 25 78 33 77 47" />
            <path d="M43 47 l0 6 M77 47 l0 6" />
            <path d="M77 56 C75 62 70 64 66 64" />
          </g>
        )}
        {extra === 'earring' && <circle cx="44.5" cy="56" r="1.6" fill={accent} stroke="none" />}
        {extra === 'pin' && <path d="M43 92.5 L46.5 96 L43 99.5 L39.5 96 Z" fill={accent} stroke="none" />}
        {/* the single accent thread: a scarf line at the collar */}
        <path d="M56 85 C58 93 62 93 64 85" stroke={accent} strokeWidth="2.4" />
      </g>
      {/* flat masses sit above the linework */}
      <path d={HAIR[hair]} fill={INK} />
      {hair === 'beanie' && (
        <path d={BEANIE_RIBS} fill="none" stroke={PAPER} strokeWidth="1" strokeLinecap="round" opacity=".35" />
      )}
      {beard && <path d={BEARD} fill={INK} opacity=".9" />}
    </>
  );
}

/** Someone the catalog does not know: head and shoulders, no features. */
function Silhouette() {
  return (
    <g fill="#C9C7CF">
      <path d={HEAD} />
      <path d="M53 68 h14 v16 h-14 Z" />
      <path d="M20 120 C26 94 42 85 53 83 L67 83 C78 85 94 94 100 120 Z" />
    </g>
  );
}

export default OperatorFace;
