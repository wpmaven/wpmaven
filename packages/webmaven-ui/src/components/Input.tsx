import React, { useState } from 'react';
import s from './Input.module.css';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, leftIcon, rightIcon, className, id, onFocus, onBlur, ...rest }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    const [focused, setFocused] = useState(false);

    const inputCls = [
      s.input,
      leftIcon ? s.hasLeft : '',
      rightIcon ? s.hasRight : '',
      error ? s.error : focused ? s.focused : '',
      className,
    ].filter(Boolean).join(' ');

    return (
      <div className={s.wrapper}>
        {label && <label htmlFor={inputId} className={s.label}>{label}</label>}
        <div className={s.inputWrap}>
          {leftIcon && <div className={s.leftIcon}>{leftIcon}</div>}
          <input
            ref={ref}
            id={inputId}
            className={inputCls}
            onFocus={(e) => { setFocused(true); onFocus?.(e); }}
            onBlur={(e) => { setFocused(false); onBlur?.(e); }}
            {...rest}
          />
          {rightIcon && <div className={s.rightIcon}>{rightIcon}</div>}
        </div>
        {error && <p className={s.errorText}>{error}</p>}
        {!error && helperText && <p className={s.helperText}>{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
