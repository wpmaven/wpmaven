import React from 'react';
import { Loader, LogoAnimation, WMLogo } from '@yotako/webmaven-ui';
import { siteBrand, type SiteBrand } from '../utils/brand';

/**
 * The animated mark (1.2.31). The UI library's Loader and LogoAnimation draw
 * the WPMaven mark; under an agency's or a partner's brand they draw the
 * brand's logo instead (a letter on its color when it has none), and a plain
 * sparkle while the brand is unknown. On a WPMaven site nothing changes.
 */

type LogoState = 'idle' | 'absorbing' | 'processing' | 'working';

/** The brand's mark alone, without its name. */
export function BrandLogo({ size, brand }: { size: number; brand?: SiteBrand }) {
  const b = brand ?? siteBrand();
  if (b.mode === 'brand' && b.logoUrl) {
    return (
      <img
        src={b.logoUrl}
        alt=""
        width={size}
        height={size}
        data-testid="wm-brand-logo"
        style={{ width: size, height: size, objectFit: 'contain', borderRadius: Math.round(size * 0.2) }}
      />
    );
  }
  if (b.mode === 'brand') {
    const letter = Array.from(b.name)[0]?.toUpperCase() || '';
    return (
      <div
        aria-hidden="true"
        data-testid="wm-brand-monogram"
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.24),
          background: b.color || '#3f4350',
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
  // Neutral: a sparkle in the text color, naming nobody.
  return (
    <svg data-testid="wm-neutral-mark" aria-hidden="true" viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" />
    </svg>
  );
}

/**
 * Our mark sits off centre in its 64-unit box: its middle is 1.25 units right
 * of the box's middle and 1.25 above it. The kit's loaders move it back by
 * that much, and the still mark does the same, so both sit in one place.
 */
const MARK_CENTRING = 1.25 / 64;

/**
 * The site's mark, still and at the size asked: the WPMaven mark on a WPMaven
 * site, centred in its box as the loaders draw it, the brand's logo otherwise.
 * Home's greeting draws it beside "Welcome back" (2026-10-12): LogoAnimation's
 * idle state drew a bigger stage with dots around the mark.
 */
export function BrandStillMark({ size, brand }: { size: number; brand?: SiteBrand }) {
  const b = brand ?? siteBrand();
  const shift = size * MARK_CENTRING;
  return (
    <span style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {b.mode === 'wpmaven' ? (
        <span style={{ display: 'flex', transform: `translate(${-shift}px, ${shift}px)` }}>
          <WMLogo size={size} />
        </span>
      ) : <BrandLogo size={size} brand={b} />}
    </span>
  );
}

/** LogoAnimation's own logos for this site: none on a WPMaven site, the brand's otherwise. */
export function brandLogoProps(size: number, brand: SiteBrand = siteBrand()): { idleLogo?: React.ReactNode; processingLogo?: React.ReactNode } {
  if (brand.mode === 'wpmaven') return {};
  const node = <BrandLogo size={size} brand={brand} />;
  return { idleLogo: node, processingLogo: node };
}

/** LogoAnimation with the site's mark. */
export function BrandLogoAnimation({ state, size = 40, className }: { state: LogoState; size?: number; className?: string }) {
  return <LogoAnimation state={state} size={size} className={className} {...brandLogoProps(size)} />;
}

/** The library's Loader with the site's mark. */
export default function BrandLoader({ size = 40, className }: { size?: number; className?: string }) {
  const brand = siteBrand();
  if (brand.mode === 'wpmaven') {
    return <Loader size={size} className={className} />;
  }
  return (
    <div className={className}>
      <LogoAnimation state="processing" size={size} {...brandLogoProps(size, brand)} />
    </div>
  );
}
