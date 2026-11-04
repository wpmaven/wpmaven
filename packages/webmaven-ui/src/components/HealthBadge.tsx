import React from 'react';
import s from './HealthBadge.module.css';

export type HealthStatus = 'healthy' | 'attention' | 'issues';

export interface HealthBadgeProps {
  status: HealthStatus;
}

const LABELS: Record<HealthStatus, string> = {
  healthy: 'Healthy',
  attention: 'Needs Attention',
  issues: 'Issues',
};

export const HealthBadge: React.FC<HealthBadgeProps> = ({ status }) => (
  <span className={`${s.badge} ${s[status]}`}>
    <span className={s.dot} />
    {LABELS[status]}
  </span>
);
