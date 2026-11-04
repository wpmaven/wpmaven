import React from 'react';
import styles from './Avatar.module.css';

export interface AvatarProps {
  size?: 'sm' | 'md' | 'lg';
  bg?: string;
  children: React.ReactNode;
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  size = 'md',
  bg,
  className,
  children,
}) => {
  const cls = [styles.avatar, styles[size], className].filter(Boolean).join(' ');

  const style: React.CSSProperties | undefined = bg
    ? { background: bg }
    : undefined;

  return (
    <div className={cls} style={style}>
      {children}
    </div>
  );
};
