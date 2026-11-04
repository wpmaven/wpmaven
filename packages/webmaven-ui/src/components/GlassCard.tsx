import React from 'react';
import styles from './GlassCard.module.css';

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  accent?: boolean;
  active?: boolean;
  padding?: string | number;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  accent,
  active,
  padding,
  className,
  style,
  children,
  ...rest
}) => {
  const cls = [
    styles.card,
    accent && styles.accent,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const merged: React.CSSProperties = {
    ...style,
    ...(padding !== undefined
      ? { padding: typeof padding === 'number' ? `${padding}px` : padding }
      : undefined),
  };

  const card = (
    <div className={cls} style={merged} {...rest}>
      {children}
    </div>
  );

  if (active) {
    return <div className={styles.glowWrap} style={style}>{card}</div>;
  }

  return card;
};
