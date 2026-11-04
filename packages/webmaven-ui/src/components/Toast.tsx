import React from 'react';
import { InfoIcon, SuccessIcon, WarningIcon, ErrorIcon } from '../icons';
import styles from './Toast.module.css';

export interface ToastProps {
  variant: 'info' | 'success' | 'warning' | 'error';
  children: React.ReactNode;
}

const iconMap = {
  info: InfoIcon,
  success: SuccessIcon,
  warning: WarningIcon,
  error: ErrorIcon,
} as const;

export const Toast: React.FC<ToastProps> = ({ variant, children }) => {
  const Icon = iconMap[variant];
  const cls = [styles.toast, styles[variant]].join(' ');

  return (
    <div className={cls} role="alert">
      <Icon className={styles.icon} />
      <div>{children}</div>
    </div>
  );
};
