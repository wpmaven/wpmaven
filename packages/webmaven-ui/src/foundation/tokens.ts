// ── Design Tokens (Atelier) ─────────────────────────────────────────────────
//
// The canonical source for WPMaven's design language. GlobalStyles emits the
// CSS custom properties; this file is the JS-side mirror for components that
// need the values as data (charts, canvas, SVG).
//
// The `colors` map below is the BRAND palette. It appears in the brand
// gradient, the logo and the operator identity hues — not in product UI, which
// runs on the neutral ramp plus one accent.

export const colors = {
  cyan:    '#47C8D8',
  blue:    '#5B9BD5',
  purple:  '#8E85C2',
  mauve:   '#D08EC8',
  rose:    '#E8919F',
  peach:   '#F2AA84',
  cyanV:   '#05C3DE',
  blueV:   '#047FBF',
  purpleV: '#6A4BFF',
  mauveV:  '#CF4ECF',
  roseV:   '#F26CA7',
  peachV:  '#FF9B71',
} as const;

/** Brand v2 (0.3.0): the logo's three colours. Ink for the team, violet for
 *  the Co-CEO, orange for the piece being handed up (orangeText for small text
 *  on light grounds). */
export const brand = {
  ink: '#15121F',
  violet: '#6A4BFF',
  orange: '#FF6A3D',
  orangeText: '#E2531F',
  paper: '#F4F3F8',
  violetOnDark: '#8C74FF',
  orangeOnDark: '#FF7A50',
} as const;

export const gradients = {
  /** Decorative brand gradient (auth, the completion reveal): violet into orange. */
  brand:  `linear-gradient(135deg, ${brand.violet}, ${brand.violetOnDark} 55%, ${brand.orange})`,
  brandH: `linear-gradient(90deg, ${brand.violet}, ${brand.violetOnDark} 55%, ${brand.orange})`,
  /** The call-to-action border (Button primary): the six pastels, unchanged. */
  cta:  `linear-gradient(135deg, ${colors.cyan}, ${colors.blue}, ${colors.purple}, ${colors.mauve}, ${colors.rose}, ${colors.peach})`,
  ctaH: `linear-gradient(90deg, ${colors.cyan}, ${colors.blue}, ${colors.purple}, ${colors.mauve}, ${colors.rose}, ${colors.peach})`,
} as const;

/** Product UI: the neutral ramp, one accent, and colour that means something. */
export const neutrals = {
  n0: '#FFFFFF', n25: '#FBFBFC', n50: '#F5F6F8', n100: '#EDEEF2',
  n200: '#E2E4EA', n300: '#CDD0DA', n400: '#9BA0AF', n500: '#6E7382',
  n600: '#4A4E5A', n700: '#33363F', n800: '#222429', n900: '#17181C',
} as const;

export const accent = {
  base: '#6A4BFF',
  deep: '#5A3FE0',
  soft: '#EEEBFF',
} as const;

export const semantic = {
  success: '#2E9E63',
  danger:  '#D6455D',
  warning: '#B7791F',
} as const;

/** Operator identity hues: the one colour table for every face, ring and
 *  surface that colours a member of the team, so a portrait and the bubble
 *  around it can never disagree.
 *
 *  Brand v2: the Co-CEO in the logo's violet and the Chief Financial Officer
 *  in its deep shade, every other member in its orange, the piece the team
 *  hands up (the text-safe shade on light grounds). Each hue keeps at least
 *  3:1 against the page in its theme: the light table on --bg and --bg-raised,
 *  the dark table on the dark grounds. Inside a portrait the disc stays paper
 *  in both themes, so the drawing always uses the light table. */
export const operatorAccents: Record<string, string> = {
  chief_of_staff: brand.violet,
  chief_financial_officer: accent.deep,
  web_designer: brand.orangeText,
  web_developer: brand.orangeText,
  webmaster: brand.orangeText,
  content_writer: brand.orangeText,
  seo_specialist: brand.orangeText,
  social_media_manager: brand.orangeText,
  data_analyst: brand.orangeText,
  ecommerce_manager: brand.orangeText,
  customer_support: brand.orangeText,
  growth_concierge: brand.orangeText,
  video_producer: brand.orangeText,
};

/** The same hues for dark grounds (the deep violet would fall under 3:1 there). */
export const operatorAccentsOnDark: Record<string, string> = {
  chief_of_staff: brand.violetOnDark,
  chief_financial_officer: '#7B63F2',
  web_designer: brand.orangeOnDark,
  web_developer: brand.orangeOnDark,
  webmaster: brand.orangeOnDark,
  content_writer: brand.orangeOnDark,
  seo_specialist: brand.orangeOnDark,
  social_media_manager: brand.orangeOnDark,
  data_analyst: brand.orangeOnDark,
  ecommerce_manager: brand.orangeOnDark,
  customer_support: brand.orangeOnDark,
  growth_concierge: brand.orangeOnDark,
  video_producer: brand.orangeOnDark,
};

/** An operator's hue for a theme. An unknown id gets the product accent. */
export function operatorAccent(id: string | null | undefined, theme: 'light' | 'dark' = 'light'): string {
  const table = theme === 'dark' ? operatorAccentsOnDark : operatorAccents;
  return (id && table[id]) || (theme === 'dark' ? brand.violetOnDark : accent.base);
}

/** Chart series: one accent line, neutral companions — never a rainbow. */
export const chartSeries: string[] = [
  accent.base, neutrals.n400, semantic.success, semantic.warning, neutrals.n600,
];

export const shadows = {
  xs: '0 1px 2px rgba(23, 24, 28, .06)',
  sm: '0 2px 8px -2px rgba(23, 24, 28, .10)',
  md: '0 6px 20px -6px rgba(23, 24, 28, .14)',
  lg: '0 16px 40px -12px rgba(23, 24, 28, .22)',
} as const;

export const fonts = {
  ui: "'Gabarito', 'Inter', system-ui, -apple-system, sans-serif",
  display: "'Gabarito', 'Inter', system-ui, -apple-system, sans-serif",
  button: "'Inter', system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  /** Page titles, at 20px and weight 400 (--font-title, --text-title). */
  title: "'Instrument Serif', Georgia, 'Times New Roman', serif",
} as const;

export const radii = {
  sm: 8,
  md: 10,
  lg: 16,
  xl: 20,
} as const;

/** Atelier is flat: blur survives only on floating chrome. */
export const blur = 0;
export const navHeight = 60;

// Palette arrays (loop back to first color for smooth interpolation)
export const ocean: string[] = [
  colors.cyan,
  colors.blue,
  colors.purple,
  colors.mauve,
  colors.rose,
  colors.peach,
  colors.cyan,
];

export const oceanPastel: string[] = [
  colors.cyan,
  colors.blue,
  colors.purple,
  colors.mauve,
  colors.rose,
  colors.peach,
  colors.cyan,
];

// ── Utility ─────────────────────────────────────────────────────────────────

/** Linearly interpolate across an array of hex colors. t is clamped to [0, 1]. */
export function lerpColor(palette: string[], t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const segCount = palette.length - 1;
  const segment = clamped * segCount;
  const i = Math.min(Math.floor(segment), segCount - 1);
  const local = segment - i;

  const parse = (hex: string) => {
    const h = hex.replace('#', '');
    return [
      parseInt(h.substring(0, 2), 16),
      parseInt(h.substring(2, 4), 16),
      parseInt(h.substring(4, 6), 16),
    ];
  };

  const a = parse(palette[i]);
  const b = parse(palette[i + 1]);

  const r = Math.round(a[0] + (b[0] - a[0]) * local);
  const g = Math.round(a[1] + (b[1] - a[1]) * local);
  const bl = Math.round(a[2] + (b[2] - a[2]) * local);

  return `rgb(${r}, ${g}, ${bl})`;
}

// ── Shared Types ────────────────────────────────────────────────────────────

export type BadgeColor = 'cyan' | 'blue' | 'purple' | 'mauve' | 'rose' | 'peach';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export type LogoAnimationState = 'idle' | 'hover' | 'loading' | 'success' | 'error';
