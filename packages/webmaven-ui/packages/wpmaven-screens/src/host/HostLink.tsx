import React from 'react';
import { useOptionalScreensHost } from './HostContext';

/** An absolute address: it opens in a new tab, outside the app. */
export function isAbsoluteAddress(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/**
 * A link to one of the dashboard's pages, through the host: its href is
 * host.link(to), so a middle click or a copied link goes where the app
 * says; a plain click on an address inside the app goes through
 * host.navigate (the dashboard's router, no reload). An absolute address
 * (the plugin's links to the dashboard) opens in a new tab. Without a host
 * it is a plain link to `to`.
 */
export const HostLink: React.FC<{
  to: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  children: React.ReactNode;
  testId?: string;
}> = ({ to, className, style, onClick, children, testId }) => {
  const host = useOptionalScreensHost();
  const href = host ? host.link(to) : to;
  const external = isAbsoluteAddress(href);
  return (
    <a
      href={href}
      className={className}
      style={style}
      data-testid={testId}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      onClick={(e) => {
        onClick?.();
        if (!host || external || e.defaultPrevented) return;
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        host.navigate(to);
      }}
    >
      {children}
    </a>
  );
};

export default HostLink;
