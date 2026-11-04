import React from 'react';
import type { WizardLinkProps } from '../host/types';
import { useOptionalHost } from '../host/HostContext';

/**
 * What unlocks a disabled button, written beside it (as an owner put it:
 * "the button to post was grayed and it was not obvious what action I needed
 * to do to unlock it").
 *
 * Always on screen while the button is disabled, never only on hover (a
 * phone has no hover, and Firefox never shows the title of a disabled
 * control), at full text color so it is read rather than skimmed past. Pass
 * null when the button can be pressed, or is only busy (its spinner says
 * that): nothing is drawn.
 *
 * Give the button aria-describedby={id} so a screen reader hears the reason
 * with it.
 *
 * The link is drawn with `linkAs` (the dashboard passes react-router's), else
 * with the wizard host's in-app link (slots.Link), else as a plain anchor.
 */
export const WhyDisabled: React.FC<{
  reason: string | null | undefined;
  id?: string;
  /** Centered under a centered button, or right-aligned under a right-aligned one. */
  align?: 'start' | 'center' | 'end';
  className?: string;
  /** The screen that unlocks it, linked directly after the reason. */
  link?: { to: string; label: string } | null;
  /** How the app draws an in-app link. */
  linkAs?: React.ComponentType<WizardLinkProps> | null;
}> = ({ reason, id, align = 'start', className, link, linkAs }) => {
  const host = useOptionalHost();
  if (!reason) return null;
  const LinkTo = linkAs ?? host?.slots.Link ?? null;
  const linkStyle = { color: 'var(--purple, #6962AD)', textDecoration: 'underline' };
  return (
    <p
      role="note"
      id={id}
      data-testid="why-disabled"
      className={className}
      style={{
        margin: '6px 0 0',
        fontSize: 'var(--text-data, 13px)',
        lineHeight: 1.4,
        color: 'var(--text)',
        textAlign: align === 'center' ? 'center' : align === 'end' ? 'right' : undefined,
        flexBasis: '100%',
      }}
    >
      {reason}
      {link ? (
        <>
          {' '}
          {LinkTo
            ? <LinkTo to={link.to} style={linkStyle}>{link.label}</LinkTo>
            : <a href={link.to} style={linkStyle}>{link.label}</a>}
        </>
      ) : null}
    </p>
  );
};

export default WhyDisabled;
