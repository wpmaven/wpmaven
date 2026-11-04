import React, { useState } from 'react';
import { NavIcon } from '../icons/NavIcon';

export interface SiteIconProps {
  /** The site's own icon (the 64px picture the API or WordPress gives); the globe without one. */
  src?: string | null;
  /** Width and height in px (default 20). */
  size?: number;
  /** The icon's name for screen readers. Empty (the default): decorative, for when the site's name is beside it. */
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}

/** The corner radius of an icon drawn at `size`: about 22% of it, like an app icon. */
export const siteIconRadius = (size: number): number => Math.round(size * 0.22 * 10) / 10;

/**
 * A site's own icon beside its name (2026-10-16), as both apps drew their
 * own copy: the picture, rounded like an app icon; with none, or one that
 * does not load, the Heroicons globe in the dim colour, at the same size.
 */
export const SiteIcon: React.FC<SiteIconProps> = ({ src, size = 20, alt = '', className, style }) => {
  // The address that failed, not a flag: a new address (the icon changed)
  // gets its own chance to load.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = typeof src === 'string' ? src.trim() : '';
  const shown = url && url !== failedUrl ? url : null;
  const box: React.CSSProperties = { width: size, height: size, flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style };
  if (shown) {
    return (
      <img
        src={shown}
        alt={alt}
        aria-hidden={alt ? undefined : true}
        loading="lazy"
        decoding="async"
        width={size}
        height={size}
        className={className}
        data-site-icon="image"
        onError={() => setFailedUrl(shown)}
        style={{ ...box, borderRadius: siteIconRadius(size), objectFit: 'cover' }}
      />
    );
  }
  return (
    <NavIcon
      name="globe-alt"
      size={size}
      label={alt || undefined}
      className={className}
      data-site-icon="globe"
      style={{ ...box, color: 'var(--text-dim)' }}
    />
  );
};
