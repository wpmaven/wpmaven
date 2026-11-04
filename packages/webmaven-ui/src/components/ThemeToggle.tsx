import React from 'react';
import s from './ThemeToggle.module.css';

export type ThemeToggleMode = 'light' | 'dark' | 'system';

export interface ThemeToggleProps {
  mode: ThemeToggleMode;
  onChange: (mode: ThemeToggleMode) => void;
  className?: string;
  style?: React.CSSProperties;
}

const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="4" />
    <line x1="12" y1="2" x2="12" y2="4" />
    <line x1="12" y1="20" x2="12" y2="22" />
    <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
    <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
    <line x1="2" y1="12" x2="4" y2="12" />
    <line x1="20" y1="12" x2="22" y2="12" />
    <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
    <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
  </svg>
);

const MonitorIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const OPTIONS: Array<{ value: ThemeToggleMode; label: string; icon: React.FC }> = [
  { value: 'light', label: 'Light theme', icon: SunIcon },
  { value: 'system', label: 'Follow system theme', icon: MonitorIcon },
  { value: 'dark', label: 'Dark theme', icon: MoonIcon },
];

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ mode, onChange, className, style }) => {
  const cls = [s.toggle, className].filter(Boolean).join(' ');
  return (
    <div className={cls} style={style} role="radiogroup" aria-label="Theme">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const isActive = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={label}
            title={label}
            className={isActive ? `${s.btn} ${s.active}` : s.btn}
            onClick={() => onChange(value)}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
};
