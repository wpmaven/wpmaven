import React from 'react';
import s from './EmptyState.module.css';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action, className }) => (
  <div className={`${s.container} ${className || ''}`}>
    {icon && <div className={s.icon}>{icon}</div>}
    <h3 className={s.title}>{title}</h3>
    {description && <p className={s.description}>{description}</p>}
    {action && <div className={s.action}>{action}</div>}
  </div>
);
