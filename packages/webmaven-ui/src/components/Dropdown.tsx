import React, { useState, useRef, useEffect, useCallback } from 'react';
import s from './Dropdown.module.css';

export interface DropdownItem {
  key: string;
  label: React.ReactNode;
  /**
   * Drawn before the label, in the menu and in the trigger once chosen (a
   * site's own icon beside its name). Decorative: the label says what it is.
   */
  icon?: React.ReactNode;
  /**
   * A second line under the label, in the trigger only once chosen (a site's
   * address under its name, 2026-10-11). The menu keeps one line per option.
   */
  detail?: React.ReactNode;
}

export interface DropdownSeparator {
  type: 'separator';
}

export type DropdownOption = DropdownItem | DropdownSeparator;

function isSeparator(opt: DropdownOption): opt is DropdownSeparator {
  return 'type' in opt && opt.type === 'separator';
}

/**
 * The chevron, boxed to its own ink (2026-10-11). The kit's ChevronDownIcon
 * draws inside a 24-unit box whose edge sits 5 units past the stroke, so at
 * 16px the space right of the arrow read 3.3px wider than the padding said.
 * Here the box is the polyline plus half the stroke (round caps and join),
 * and the drawing keeps the box's 14 by 8 ratio, so the ink touches every
 * edge and the trigger's padding is the space you see on both sides.
 */
const DropdownChevron: React.FC = () => (
  <svg
    width={10.5}
    height={6}
    viewBox="5 8 14 8"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export interface DropdownProps {
  options: DropdownOption[];
  value?: string;
  placeholder?: string;
  onChange?: (key: string) => void;
  className?: string;
}

export const Dropdown: React.FC<DropdownProps> = ({
  options,
  value,
  placeholder = 'Select...',
  onChange,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const handleSelect = useCallback(
    (key: string) => {
      onChange?.(key);
      setOpen(false);
    },
    [onChange],
  );

  const selected = options
    .filter((o): o is DropdownItem => !isSeparator(o))
    .find((o) => o.key === value);
  const selectedLabel = selected?.label;
  // The chosen option's label, with its detail under it when it has one.
  const shown = selected?.detail ? (
    <span className={s.stack}>
      <span className={s.stackLabel}>{selectedLabel}</span>
      <span className={s.detail}>{selected.detail}</span>
    </span>
  ) : selectedLabel;

  return (
    <div
      ref={wrapperRef}
      className={`${s.wrapper}${open ? ' open' : ''}${className ? ` ${className}` : ''}`}
    >
      <button
        type="button"
        className={s.trigger}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selectedLabel && selected?.icon ? (
          <span className={s.value}>
            <span className={s.icon} aria-hidden="true">{selected.icon}</span>
            {shown}
          </span>
        ) : selectedLabel ? (
          <span>{shown}</span>
        ) : (
          <span className={s.placeholder}>{placeholder}</span>
        )}
        <span className={`${s.chevron}${open ? ` ${s.chevronOpen}` : ''}`}>
          <DropdownChevron />
        </span>
      </button>

      <div
        className={`${s.menu}${open ? ` ${s.menuOpen}` : ''}`}
        role="listbox"
      >
        {options.map((opt, i) => {
          if (isSeparator(opt)) {
            return <div key={`sep-${i}`} className={s.separator} />;
          }
          return (
            <button
              key={opt.key}
              type="button"
              role="option"
              aria-selected={opt.key === value}
              className={`${s.item}${opt.key === value ? ` ${s.selected}` : ''}`}
              onClick={() => handleSelect(opt.key)}
            >
              {opt.icon ? <span className={s.icon} aria-hidden="true">{opt.icon}</span> : null}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
