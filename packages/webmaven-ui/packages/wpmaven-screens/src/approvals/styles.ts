import type { CSSProperties } from 'react';

/**
 * The few looks the screens repeat, as inline styles on the kit's tokens
 * (2026-10-16). The dashboard drew these with its Tailwind classes, which
 * the plugin does not have; inline, with each token's dashboard value as
 * the fallback, a card reads the same in both. Every margin is set, never
 * left to a reset: wp-admin gives a bare <p> or <ul> its own.
 */

/** The dashboard's type scale (its atelier tokens), with their values for a host without them. */
export const TYPE = {
  /** Labels and meta lines (12.5). */
  meta: 'var(--text-meta, 12.5px)',
  /** Data lines in a card (13.5). */
  data: 'var(--text-data, 13.5px)',
  /** Body copy (15). */
  body: 'var(--text-body, 15px)',
  bodyLeading: 'var(--leading-body, 1.55)',
  /** Uppercase section labels. */
  label: 'var(--text-label, 11px)',
  mono: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
} as const;

/** A card's radius (the dashboard's rounded-lg). */
export const CARD_RADIUS = 'var(--r-card, 16px)';

/** Small copy: a label, a caption, a link under a block. */
export const small: CSSProperties = { margin: 0, fontSize: TYPE.meta, lineHeight: 1.45 };

/** Body copy. */
export const body: CSSProperties = { margin: 0, fontSize: TYPE.body, lineHeight: TYPE.bodyLeading };

/** A recessed block inside a card: the post, the reply, the coupon. */
export const recessed: CSSProperties = {
  boxSizing: 'border-box',
  borderRadius: CARD_RADIUS,
  border: '1px solid var(--glass-border)',
  background: 'var(--bg)',
  padding: 12,
  minWidth: 0,
};

/** A list with no bullets and no indent. */
export const bareList: CSSProperties = { listStyle: 'none', margin: 0, padding: 0 };

/** A text link in the card's own colour. */
export const textLink: CSSProperties = { color: 'inherit', textDecoration: 'underline' };

/** Words that may break anywhere (an address, a long code). */
export const wrapAnywhere: CSSProperties = { overflowWrap: 'anywhere' };
