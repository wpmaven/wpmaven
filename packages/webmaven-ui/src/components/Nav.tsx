import React, { ReactNode } from 'react';
import s from './Nav.module.css';

export interface NavLink {
  key: string;
  label: string;
  href: string;
}

export interface NavProps {
  brandName: string;
  brandLogoSrc?: string;
  links?: NavLink[];
  children?: ReactNode;
}

export const Nav: React.FC<NavProps> = ({
  brandName,
  brandLogoSrc,
  links = [],
  children,
}) => (
  <nav className={s.nav}>
    <a className={s.brand} href="/">
      {brandLogoSrc && (
        <img
          className={s.brandLogo}
          src={brandLogoSrc}
          alt={`${brandName} logo`}
        />
      )}
      <span className={s.brandName}>{brandName}</span>
    </a>

    <div className={s.right}>
      {links.map((link) => (
        <a key={link.key} className={s.link} href={link.href}>
          {link.label}
        </a>
      ))}
      {children}
    </div>
  </nav>
);
