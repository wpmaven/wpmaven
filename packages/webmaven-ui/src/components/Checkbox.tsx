import React from 'react';
import { CheckIcon } from '../icons';
import styles from './Checkbox.module.css';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  label,
  disabled,
}) => {
  const cls = [
    styles.label,
    checked && styles.checked,
    disabled && styles.disabled,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <label className={cls}>
      <input
        type="checkbox"
        className={styles.hidden}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.box}>
        <CheckIcon />
      </span>
      {label}
    </label>
  );
};
