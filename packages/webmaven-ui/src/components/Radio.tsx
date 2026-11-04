import React from 'react';
import styles from './Radio.module.css';

export interface RadioProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  name?: string;
  value?: string;
  disabled?: boolean;
}

export const Radio: React.FC<RadioProps> = ({
  checked,
  onChange,
  label,
  name,
  value,
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
        type="radio"
        className={styles.hidden}
        checked={checked}
        name={name}
        value={value}
        disabled={disabled}
        onChange={() => onChange(true)}
      />
      <span className={styles.dot} />
      {label}
    </label>
  );
};
