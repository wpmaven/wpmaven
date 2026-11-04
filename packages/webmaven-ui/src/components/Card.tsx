import React from 'react';
import { GlassCard } from './GlassCard';
import s from './Card.module.css';

const paddingMap: Record<string, string | number> = { none: 0, sm: 16, md: 24, lg: 32 };

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  accent?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, className, padding = 'none', accent }) => (
  <GlassCard padding={paddingMap[padding]} accent={accent} className={className}>{children}</GlassCard>
);

export interface CardHeaderProps {
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ children, className, action }) => (
  <div className={`${s.header} ${className || ''}`}>
    <div className={s.headerInner}>
      <div>{children}</div>
      {action && <div>{action}</div>}
    </div>
  </div>
);

export interface CardTitleProps {
  children: React.ReactNode;
  className?: string;
}

export const CardTitle: React.FC<CardTitleProps> = ({ children, className }) => (
  <h3 className={`${s.title} ${className || ''}`}>{children}</h3>
);

export interface CardContentProps {
  children: React.ReactNode;
  className?: string;
}

export const CardContent: React.FC<CardContentProps> = ({ children, className }) => (
  <div className={`${s.content} ${className || ''}`}>{children}</div>
);
