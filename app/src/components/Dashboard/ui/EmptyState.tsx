import React from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="wpm-empty-state">
      <h3 className="wpm-empty-state__title">{title}</h3>
      {description && <p className="wpm-empty-state__description">{description}</p>}
      {action && (
        <button className="wpm-btn wpm-btn--primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
