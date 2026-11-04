import React, { useState } from 'react';
import s from './Textarea.module.css';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

/**
 * Multiline text field — the textarea counterpart to {@link Input}, sharing the
 * same glass field, label, focus ring, and error/helper styling.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, className, id, onFocus, onBlur, ...rest }, ref) => {
    const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-');
    const [focused, setFocused] = useState(false);

    const cls = [
      s.textarea,
      error ? s.error : focused ? s.focused : '',
      className,
    ].filter(Boolean).join(' ');

    return (
      <div className={s.wrapper}>
        {label && <label htmlFor={textareaId} className={s.label}>{label}</label>}
        <textarea
          ref={ref}
          id={textareaId}
          className={cls}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          {...rest}
        />
        {error && <p className={s.errorText}>{error}</p>}
        {!error && helperText && <p className={s.helperText}>{helperText}</p>}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
