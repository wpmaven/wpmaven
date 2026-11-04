import React, { useEffect, useId, useRef, useState } from 'react';
import s from './Help.module.css';

export interface HelpTipProps {
  /** One or two plain sentences. If it needs three, it belongs in the guides. */
  children: React.ReactNode;
  /** Names the control for screen readers: "What does the forecast mean?" */
  label: string;
  /** The one guide page that explains this control in full; no link without it. */
  href?: string;
  /** The link's words (default "Read more"). */
  linkLabel?: string;
  /** The panel opens to the left of the "?" (near the right edge of a card). */
  align?: 'start' | 'end';
  /** Told when the panel opens: which controls people ask about. */
  onOpen?: () => void;
  /** Told when the link is followed. */
  onLinkClick?: () => void;
  testId?: string;
}

/**
 * A "?" next to a control, which explains that control when asked (0.9.0,
 * from the dashboard's own). Pull, not push: it never opens by itself and
 * never covers the screen on arrival. Escape or a click outside closes it.
 */
export const HelpTip: React.FC<HelpTipProps> = ({
  children, label, href, linkLabel = 'Read more', align = 'start', onOpen, onLinkClick, testId,
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = `wm-helptip-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className={s.tip} data-testid={testId}>
      <button
        ref={buttonRef}
        type="button"
        className={s.tipButton}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) onOpen?.();
        }}
      >
        <span aria-hidden="true">?</span>
      </button>

      {open && (
        <span id={panelId} role="dialog" aria-label={label} className={`${s.panel}${align === 'end' ? ` ${s.alignEnd}` : ''}`}>
          <span className={s.tipText}>{children}</span>
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className={s.tipLink} onClick={onLinkClick}>
              {linkLabel}
            </a>
          )}
        </span>
      )}
    </span>
  );
};

export default HelpTip;
