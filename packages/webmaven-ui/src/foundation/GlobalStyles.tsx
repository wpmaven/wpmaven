import React from 'react';

/** The kit's fonts from Google Fonts: what GlobalStyles imports unless told otherwise. */
export const APP_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Gabarito:wght@400..900&family=Instrument+Serif:ital@0;1&family=Inter:opsz,wght@14..32,400..750&family=JetBrains+Mono:wght@450;600&display=swap';

const css = `

/* ── Reset ──────────────────────────────────────────────────────────────── */
*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

/* ── Dark theme (default) ───────────────────────────────────────────────── */
:root {
  /* ── ATELIER ────────────────────────────────────────────────────────────
     "Quiet interface, loud work": the product recedes into disciplined
     neutrals so the user's own site is the only thing that glows.

     Light is the ground; dark is a deliberate second theme (brand moments,
     the completion reveal, the viewer's own preference). The six-pastel
     ocean palette is retained ONLY inside the brand gradient — spelled out
     literally, so remapping the semantic tokens can never bleed into it. */

  /* Brand v2 (0.3.0): the interface and the titles speak the logo's face,
     Gabarito. Buttons keep Inter (--font-button), as they keep their
     gradient border. */
  --font-ui:      'Gabarito', 'Inter', system-ui, -apple-system, sans-serif;
  --font-display: 'Gabarito', 'Inter', system-ui, -apple-system, sans-serif;
  --font-button:  'Inter', system-ui, -apple-system, sans-serif;
  --font-mono:    'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
  /* Page titles (2026-10-16): Instrument Serif at 20px and weight 400, as
     the dashboard draws them, so the plugin's titles match. The face is
     loaded regular and italic only: any heavier weight is synthesised and
     smears, so a title never asks for more than 400. PageHeader reads these. */
  --font-title:   'Instrument Serif', Georgia, 'Times New Roman', serif;
  --text-title:   20px;

  /* Neutral ramp — every surface and text colour in the product */
  --n-0:   #FFFFFF; --n-25:  #FBFBFC; --n-50:  #F5F6F8; --n-100: #EDEEF2;
  --n-200: #E2E4EA; --n-300: #CDD0DA; --n-400: #9BA0AF; --n-500: #6E7382;
  --n-600: #4A4E5A; --n-700: #33363F; --n-800: #222429; --n-900: #17181C;

  /* One accent. Colour is spent here and on meaning, nowhere else.
     Brand v2: the logo's violet (was #6962AD). */
  --accent:      #6A4BFF;
  --accent-deep: #5A3FE0;
  --accent-soft: #EEEBFF;
  --accent-ring: rgba(106, 75, 255, 0.22);

  /* The logo's three colours: ink for the team, violet for the Co-CEO,
     orange for the piece being handed up. WMLogo paints with these. */
  --brand-ink:    #15121F;
  --brand-violet: #6A4BFF;
  --brand-orange: #FF6A3D;
  --brand-orange-text: #E2531F;   /* the orange for small text on light grounds */
  --wm-mark-ink:    var(--brand-ink);
  --wm-mark-violet: var(--brand-violet);
  --wm-mark-orange: var(--brand-orange);

  --success: #2E9E63; --success-soft: #E7F5EE;
  --danger:  #D6455D; --danger-soft:  #FBEBEE;
  --warning: #B7791F; --warning-soft: #FCF3E3;

  /* Brand gradient — auth, the completion reveal, decorative accents.
     Brand v2: the logo's violet into its orange. Literal hues on purpose:
     built from var(--cyan) etc. it would inherit the remap below. */
  --grad-brand:   linear-gradient(135deg, #6A4BFF, #8C74FF 55%, #FF6A3D);
  --grad-brand-h: linear-gradient(90deg,  #6A4BFF, #8C74FF 55%, #FF6A3D);
  /* The call-to-action border keeps the six pastels it always had
     (Button: primary and secondary). */
  --grad-cta:     linear-gradient(135deg, #47C8D8, #5B9BD5, #8E85C2, #D08EC8, #E8919F, #F2AA84);
  --grad-cta-h:   linear-gradient(90deg,  #47C8D8, #5B9BD5, #8E85C2, #D08EC8, #E8919F, #F2AA84);
  /* The same six, closed on the first, for the ring that turns around the
     primary button (Button.module.css). */
  --ring-stops:   #47C8D8, #5B9BD5, #8E85C2, #D08EC8, #E8919F, #F2AA84, #47C8D8;

  /* Legacy palette names, kept so existing components keep compiling.
     They now resolve to the accent or to meaning — nothing decorative. */
  --purple: var(--accent);   --purple-v: var(--accent-deep);
  --blue:   var(--accent);   --blue-v:   var(--accent-deep);
  --cyan:   var(--success);  --cyan-v:   var(--success);
  --rose:   var(--danger);   --rose-v:   var(--danger);
  --peach:  var(--warning);  --peach-v:  var(--warning);
  --mauve:  var(--n-500);    --mauve-v:  var(--n-600);
  /* Consumed by components but never defined in 0.1.x, so "done" chips
     rendered colourless. */
  --lime:  var(--success);
  --green: var(--success);

  --bg:          var(--n-50);
  --bg-raised:   var(--n-0);
  --text:        var(--n-900);
  --text-dim:    var(--n-500);
  --text-bright: #000;

  /* "glass" is now matter: solid surfaces, hairline borders, no blur. The
     names survive for compatibility with existing component CSS. */
  --glass:              var(--n-0);
  --glass-hover:        var(--n-25);
  --glass-border:       var(--n-200);
  --glass-border-hover: var(--n-300);
  --glass-shadow:       var(--sh-xs);
  --glass-glow:         none;
  --blur: 0px;

  --sh-xs: 0 1px 2px rgba(23, 24, 28, .06);
  --sh-sm: 0 2px 8px -2px rgba(23, 24, 28, .10);
  --sh-md: 0 6px 20px -6px rgba(23, 24, 28, .14);
  --sh-lg: 0 16px 40px -12px rgba(23, 24, 28, .22);

  --r-chip: 999px;
  --r-btn:  9px;
  --r-field: 10px;
  --r-sm:  8px;
  --r-md:  var(--r-field);
  --r-lg:  16px;
  --r-xl:  20px;
  --r-card: 16px;
  --r-panel: 20px;

  --nav-h: 60px;
}

/* ── Light theme ────────────────────────────────────────────────────────── */
[data-theme="dark"] {
  --bg:          #0E0F13;
  --bg-raised:   #16171C;
  --text:        #E8E9ED;
  --text-dim:    #9BA0AF;
  --text-bright: #FFFFFF;

  --glass:              #16171C;
  --glass-hover:        #1C1E24;
  --glass-border:       #262932;
  --glass-border-hover: #343845;
  --glass-shadow:       0 2px 10px rgba(0, 0, 0, .5);

  /* The accent lifts on a dark ground so it keeps its contrast. */
  --accent:      #8C74FF;
  --accent-deep: #7A5FFF;
  --accent-soft: #221D35;
  --accent-ring: rgba(140, 116, 255, .3);

  --brand-orange: #FF7A50;
  --brand-orange-text: #FF7A50;
  --wm-mark-ink:    #F4F3F8;
  --wm-mark-violet: #8C74FF;
  --wm-mark-orange: #FF7A50;

  --success: #4CB981; --success-soft: #14231C;
  --danger:  #E4677D; --danger-soft:  #2A171B;
  --warning: #D69B3F; --warning-soft: #261E10;
}

/* ── Body ───────────────────────────────────────────────────────────────── */
body {
  font-family: var(--font-ui);
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
  transition: background 0.4s ease, color 0.4s ease;
}

/* The display face is for titles and card hooks only — never controls or
   body copy — and digits that line up in columns actually line up. */
.wm-display { font-family: var(--font-display); font-weight: 400; }
code, kbd, samp, pre { font-family: var(--font-mono); }
.wm-num, .tabular { font-variant-numeric: tabular-nums; }

/* ── Decorative blob colors ─────────────────────────────────────────────── */
/* The background washes behind the content (Blobs). Each var is a single
   rgba colour whose alpha is the wash's strength in that theme. The Blobs
   component composes the radial gradient itself (inner stop = this colour,
   outer stop = transparent): violet from the content's top-right corner,
   orange from the window's bottom-left corner, wide and fading out late.
   With the logo's saturated violet and orange the alphas stay low: a tint
   behind the content, never a colour field. The cards are opaque above it,
   so no text depends on it. Light's orange is the faintest: on the pale
   ground its hue carries further than the violet's. About half again as
   strong as at first (2026-10-17): the washes were too faint to
   notice. */
:root {
  --wm-blob-1-color: rgba(106, 75, 255, 0.12);
  --wm-blob-2-color: rgba(255, 106, 61, 0.065);
}

/* Dark: the dark theme's own mark colours, #8C74FF and #FF7A50. */
[data-theme="dark"] {
  --wm-blob-1-color: rgba(140, 116, 255, 0.11);
  --wm-blob-2-color: rgba(255, 122, 80, 0.08);
}

/* Both themes blend normally: a faint tint needs no "darken" to read. */
.wm-blobs { mix-blend-mode: normal; }

`;


export interface GlobalStylesProps {
  /**
   * Where the fonts come from: a stylesheet address to import, or null when
   * the page already loads them (a WordPress plugin serving its own copy).
   * Google Fonts (APP_FONTS_URL) when left out.
   */
  fontsHref?: string | null;
}

export const GlobalStyles: React.FC<GlobalStylesProps> = ({ fontsHref = APP_FONTS_URL }) => {
  const fonts = fontsHref ? `@import url('${fontsHref.replace(/['\\]/g, '')}');\n` : '';
  return <style dangerouslySetInnerHTML={{ __html: fonts + css }} />;
};
