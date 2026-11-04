import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '../Button';
import { NavIcon } from '../../icons/NavIcon';
import s from './Help.module.css';

export interface HelpMenuItem {
  key: string;
  label: string;
  /** Drawn before the label (a NavIcon, 18px). Decorative: the label says what it is. */
  icon?: React.ReactNode;
  /** What the item does (take a tour). An item has this or an href. */
  onSelect?: () => void;
  /** Where the item goes (the guides). */
  href?: string;
  /** Opens in a new tab, with the arrow after its label. */
  external?: boolean;
  testId?: string;
}

export interface HelpMenuSeparator {
  type: 'separator';
  key?: string;
}

export type HelpMenuEntry = HelpMenuItem | HelpMenuSeparator;

export function isHelpSeparator(entry: HelpMenuEntry): entry is HelpMenuSeparator {
  return 'type' in entry && entry.type === 'separator';
}

export interface HelpButtonProps {
  /** The menu, as the app has it: its tours, its guides, its support. */
  items: readonly HelpMenuEntry[];
  /** The button's name for screen readers and its tooltip (default "Help"). */
  label?: string;
  /** What a screen reader hears after an item that opens a new tab. */
  externalLabel?: string;
  /** The button's data-tour value, so a tour can point at it. */
  tour?: string;
  testId?: string;
  /** The menu's edge under the button (default 'end': it opens to the left). */
  align?: 'start' | 'end';
  /** The icon's size in px (default 18, the top bar's). */
  iconSize?: number;
  /** Told when the menu opens. */
  onOpen?: () => void;
  /** Starts open (a screen rendered on its own). */
  defaultOpen?: boolean;
}

/**
 * The "?" in an app's top bar (0.9.0): the kit's bare icon button with the
 * question-mark icon, and a small menu of the items the app passes: its
 * tours, its guides, its support. A menu button as ARIA has it: the arrow
 * keys move through the items, Escape closes it and gives the focus back to
 * the button, and so does choosing an item.
 */
export const HelpButton: React.FC<HelpButtonProps> = ({
  items, label = 'Help', externalLabel = '(opens in a new tab)', tour, testId, align = 'end', iconSize = 18, onOpen, defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `wm-help-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  // Where the focus goes when the menu opens: the first item, the last one, or nowhere (a click).
  const focusOnOpen = useRef<'first' | 'last' | null>(null);

  const trigger = useCallback(() => wrapRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]') ?? null, []);
  const menuItems = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    [],
  );

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger()?.focus();
  }, [trigger]);

  const openMenu = useCallback((focus: 'first' | 'last' | null) => {
    focusOnOpen.current = focus;
    setOpen(true);
    onOpen?.();
  }, [onOpen]);

  useEffect(() => {
    if (!open) return undefined;
    const list = menuItems();
    if (focusOnOpen.current === 'first') list[0]?.focus();
    else if (focusOnOpen.current === 'last') list[list.length - 1]?.focus();
    focusOnOpen.current = null;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, menuItems]);

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu('last');
    }
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = menuItems();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') { setOpen(false); }
  };

  return (
    <div ref={wrapRef} className={s.help}>
      <Button
        variant="bare"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-tour={tour}
        data-testid={testId}
        onClick={() => (open ? close(false) : openMenu(null))}
        onKeyDown={onTriggerKey}
      >
        <NavIcon name="question-mark-circle" size={iconSize} />
      </Button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={`${s.menu}${align === 'start' ? ` ${s.alignStart}` : ''}`}
          onKeyDown={onMenuKey}
        >
          {items.map((entry, i) => {
            if (isHelpSeparator(entry)) {
              return <div key={entry.key ?? `separator-${i}`} role="separator" className={s.separator} />;
            }
            const inner = (
              <>
                {entry.icon != null && <span className={s.itemIcon} aria-hidden="true">{entry.icon}</span>}
                <span className={s.itemLabel}>{entry.label}</span>
                {entry.external && (
                  <span className={s.itemExternal}>
                    <NavIcon name="arrow-top-right-on-square" size={14} />
                    <span className={s.srOnly}>{externalLabel}</span>
                  </span>
                )}
              </>
            );
            if (entry.href) {
              return (
                <a
                  key={entry.key}
                  role="menuitem"
                  tabIndex={-1}
                  className={s.item}
                  href={entry.href}
                  data-testid={entry.testId}
                  {...(entry.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  onClick={() => { close(true); entry.onSelect?.(); }}
                >
                  {inner}
                </a>
              );
            }
            return (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={s.item}
                data-testid={entry.testId}
                onClick={() => { close(true); entry.onSelect?.(); }}
              >
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default HelpButton;
