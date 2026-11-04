import React from 'react';
import { Lockup, WPMavenLockup } from '@yotako/webmaven-ui';
import { siteBrand, siteName, type SiteBrand } from '../utils/brand';

/**
 * The mark on top of a WP-admin screen (1.2.31): the WPMaven lockup on a
 * WPMaven site; the brand's logo and name under an agency's or a partner's
 * brand (a letter on the brand's color when it has no logo); the site's own
 * name, with no mark, while the brand is unknown.
 *
 * Ours is the lockup wpmaven.ai shows, drawn by the kit as one piece
 * (2026-10-11): Lockup set "WPMaven" in 16px beside the mark's 64-unit box,
 * so the mark dwarfed the name. It is never bigger than wpmaven.ai's header
 * and the dashboard draw it (a 36px mark, 28px tall): the sidebar asks 42 for
 * a brand's logo, and the sign-in, "Set up in your dashboard", the wizard's
 * header and its cap wall ask 36, side by side as on the dashboard's sign-in
 * (2026-10-12).
 */
const OUR_LOCKUP_MAX = 36;
/** A brand's lockup: styles/dashboard.css keeps its name clear of its logo. */
const BRAND_LOCKUP_CLASS = 'wm-brand-lockup';
interface BrandMarkProps {
  size: number;
  /** For tests; the page's brand otherwise. */
  brand?: SiteBrand;
}

function Monogram({ letter, color, size }: { letter: string; color: string; size: number }) {
  return (
    <div
      aria-hidden="true"
      data-testid="wm-brand-monogram"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        background: color || '#3f4350',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: Math.round(size * 0.46),
        lineHeight: 1,
      }}
    >
      {letter}
    </div>
  );
}

export default function BrandMark({ size, brand }: BrandMarkProps) {
  const b = brand ?? siteBrand();
  if (b.mode === 'wpmaven') {
    return <WPMavenLockup size={Math.min(size, OUR_LOCKUP_MAX)} />;
  }
  if (b.mode === 'brand') {
    if (b.logoUrl) {
      return <Lockup logoSrc={b.logoUrl} name={b.name} logoSize={size} className={BRAND_LOCKUP_CLASS} />;
    }
    const letter = Array.from(b.name)[0]?.toUpperCase() || '';
    return <Lockup logo={<Monogram letter={letter} color={b.color} size={size} />} name={b.name} logoSize={size} className={BRAND_LOCKUP_CLASS} />;
  }
  const own = siteName();
  return own ? <Lockup name={own} logoSize={size} /> : null;
}
