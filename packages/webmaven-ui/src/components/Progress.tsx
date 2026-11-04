import React from 'react';
import styles from './Progress.module.css';

export interface ProgressProps {
  value: number;
  className?: string;
}

export const Progress: React.FC<ProgressProps> = ({ value, className }) => {
  const clamped = Math.max(0, Math.min(100, value));
  const total = clamped > 0 ? `${(100 / clamped) * 100}%` : '100%';

  const cls = [styles.track, className].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <div
        className={styles.fill}
        style={
          {
            width: `${clamped}%`,
            '--progress-total': total,
          } as React.CSSProperties
        }
      />
    </div>
  );
};
