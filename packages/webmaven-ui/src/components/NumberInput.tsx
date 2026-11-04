import React, { useState, useCallback } from 'react';
import s from './NumberInput.module.css';

export interface NumberInputProps {
  value: number | '';
  onChange: (value: number | '') => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  label?: string;
  error?: string;
  helperText?: string;
  size?: 'sm' | 'md';
  className?: string;
  disabled?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}

export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  prefix,
  suffix,
  placeholder,
  label,
  error,
  helperText,
  size = 'md',
  className,
  disabled,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
}) => {
  const [focused, setFocused] = useState(false);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '') { onChange(''); return; }
    const num = parseFloat(raw);
    if (isNaN(num)) return;
    if (min !== undefined && num < min) return;
    if (max !== undefined && num > max) return;
    onChange(num);
  }, [onChange, min, max]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Allow: digits, decimal point, backspace, delete, tab, escape, enter, arrows
    const allowed = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', '.'];
    if (allowed.includes(e.key)) return;
    // Allow Ctrl/Cmd + A, C, V, X
    if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x'].includes(e.key.toLowerCase())) return;
    // Block non-digit keys
    if (!/^\d$/.test(e.key)) e.preventDefault();
  }, []);

  const inputCls = [
    s.input,
    size === 'sm' ? s.sm : '',
    prefix ? s.hasPrefix : '',
    suffix ? s.hasSuffix : '',
    error ? s.error : (focused || value !== '') ? s.focused : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={s.wrapper}>
      {label && <label className={s.label}>{label}</label>}
      <div className={s.inputWrap}>
        {prefix && <span className={s.prefix}>{prefix}</span>}
        <input
          type="number"
          className={inputCls}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { setFocused(true); onFocusProp?.(); }}
          onBlur={() => { setFocused(false); onBlurProp?.(); }}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          disabled={disabled}
        />
        {suffix && <span className={s.suffix}>{suffix}</span>}
      </div>
      {error && <p className={s.errorText}>{error}</p>}
      {!error && helperText && <p className={s.helperText}>{helperText}</p>}
    </div>
  );
};
