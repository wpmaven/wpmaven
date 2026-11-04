import React from 'react';
import s from './Lockup.module.css';

export interface LockupProps {
  /** URL for img-based logo */
  logoSrc?: string;
  /** ReactNode for inline SVG logo (takes priority over logoSrc) */
  logo?: React.ReactNode;
  name: string;
  vertical?: boolean;
  logoSize?: number;
  className?: string;
  /** Index where the name's accent starts ("WPMaven" -> 2, so "Maven" is violet, as the logo sets it).
   *  Defaults to 2 for "WPMaven" and to none for any other name; pass null for one colour. */
  accentFrom?: number | null;
}

export const Lockup: React.FC<LockupProps> = ({
  logoSrc,
  logo,
  name,
  vertical = false,
  logoSize,
  className,
  accentFrom,
}) => {
  const from = accentFrom === undefined ? (name === 'WPMaven' ? 2 : null) : accentFrom;
  const size = logoSize ?? (vertical ? 68 : 64);
  const layoutCls = vertical ? s.vertical : s.horizontal;

  return (
    <div className={`${layoutCls}${className ? ` ${className}` : ''}`}>
      {logo ? (
        <div className={s.logo} style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {logo}
        </div>
      ) : logoSrc ? (
        <img className={s.logo} src={logoSrc} alt={`${name} logo`} width={size} height={size} />
      ) : null}
      <span className={s.name}>
        {from == null ? name : (<>{name.slice(0, from)}<span className={s.accent}>{name.slice(from)}</span></>)}
      </span>
    </div>
  );
};
