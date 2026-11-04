import React from 'react';
import s from './Button.module.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** `danger` is the quiet outline used before confirmation; `dangerSolid`
   *  is the filled state for the confirm itself. */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'dangerSolid' | 'icon' | 'bare';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  className,
  disabled,
  children,
  ...rest
}) => {
  // `bare` and `icon` are square by design, sized for a glyph. Given a text
  // label they used to squeeze it into that square, and the label painted
  // over whatever sat next to it (seen live on the Reports list, where View
  // and Download PDF overlapped inside 36px each). When there is text, the
  // button sizes to its content instead, and keeps the square only for a
  // lone glyph.
  const hasText = React.Children.toArray(children).some(
    (child) => typeof child === 'string' || typeof child === 'number',
  );
  const cls = [
    s.btn,
    s[variant],
    size !== 'md' ? s[size] : '',
    hasText && (variant === 'bare' || variant === 'icon') ? s.labeled : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button className={cls} disabled={disabled || isLoading} {...rest}>
      {isLoading && (
        <svg className={s.spinner} width="16" height="16" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.75" />
        </svg>
      )}
      {!isLoading && leftIcon && <span className={s.iconSlot}>{leftIcon}</span>}
      {children}
      {!isLoading && rightIcon && <span className={s.iconSlot}>{rightIcon}</span>}
    </button>
  );
};
