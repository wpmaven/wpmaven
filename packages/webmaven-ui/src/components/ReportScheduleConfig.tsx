import React from 'react';
import s from './ReportScheduleConfig.module.css';

export interface ReportScheduleConfigProps {
  frequencies: string[];
  onChange: (frequencies: string[]) => void;
  label?: string;
}

const FREQUENCY_OPTIONS = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
];

export const ReportScheduleConfig: React.FC<ReportScheduleConfigProps> = ({
  frequencies, onChange, label = 'Report Frequency',
}) => {
  const toggle = (key: string) => {
    if (frequencies.includes(key)) {
      onChange(frequencies.filter(f => f !== key));
    } else {
      onChange([...frequencies, key]);
    }
  };

  return (
    <div className={s.container}>
      <span className={s.label}>{label}</span>
      <div className={s.toggles}>
        {FREQUENCY_OPTIONS.map(opt => (
          <button
            key={opt.key}
            className={`${s.toggle} ${frequencies.includes(opt.key) ? s.active : ''}`}
            onClick={() => toggle(opt.key)}
            type="button"
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
};
