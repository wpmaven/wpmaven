import React, { useRef } from 'react';
import { Button } from './Button';
import s from './SegmentedControl.module.css';

export interface SegmentedControlOption<K extends string = string> {
  key: K;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** The option's data-tour value, so a guided tour can point at it (0.9.0). */
  tour?: string;
}

export interface SegmentedControlProps<K extends string = string> {
  options: ReadonlyArray<SegmentedControlOption<K>>;
  /** The key of the option that is on. */
  value: K;
  onChange: (key: K) => void;
  size?: 'sm' | 'md' | 'lg';
  /** The switch's name for screen readers ("Page"); or ariaLabelledBy. */
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
  testId?: string;
  /** The switch's data-tour value, so a guided tour can point at it (0.9.0). */
  tour?: string;
}

/**
 * A mode switch (2026-10-16): two or three options, one on. The plugin's
 * Overview / Editor switch is the first.
 *
 * Each option is the kit's Button (2026-10-17) inside one track, so it still
 * reads as a switch: the one that is on is the primary, its turning ring
 * included, the others quiet ghost buttons. Fill, ring, hover and focus are
 * Button.module.css's own, inside wp-admin too; the track sets only the
 * options' height and corners, so the whole switch is a button's height.
 *
 * A radio group: one tab stop, the arrow keys move and choose, as the ARIA
 * radio pattern asks.
 */
export function SegmentedControl<K extends string = string>({
  options,
  value,
  onChange,
  size = 'md',
  ariaLabel,
  ariaLabelledBy,
  className,
  testId,
  tour,
}: SegmentedControlProps<K>) {
  const root = useRef<HTMLDivElement>(null);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);

  const move = (from: number, step: 1 | -1) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(from);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    // Button takes no ref: the group's children are the options, in order.
    (root.current?.children[next] as HTMLElement | undefined)?.focus();
    onChange(options[next].key);
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
  };

  // The option that is on takes the tab stop; with none on, the first one that can be chosen.
  const on = options.findIndex((o) => o.key === value && !o.disabled);
  const stop = on >= 0 ? on : (enabled[0] ?? -1);

  return (
    <div
      ref={root}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={[s.root, s[size], className].filter(Boolean).join(' ')}
      data-testid={testId}
      data-tour={tour}
    >
      {options.map((o, i) => {
        const active = o.key === value;
        return (
          <Button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={i === stop ? 0 : -1}
            disabled={o.disabled}
            variant={active ? 'primary' : 'ghost'}
            size={size}
            className={s.option}
            data-tour={o.tour}
            onClick={() => { if (!active) onChange(o.key); }}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.icon && <span className={s.icon} aria-hidden="true">{o.icon}</span>}
            <span className={s.label}>{o.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
