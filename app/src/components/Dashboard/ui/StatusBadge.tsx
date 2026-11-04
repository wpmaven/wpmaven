import React from 'react';
import { Badge, type BadgeColor } from '@yotako/webmaven-ui';

const STATUS_BADGE: Record<string, { color: BadgeColor; label: string }> = {
  publish:  { color: 'cyan',   label: 'Published' },
  active:   { color: 'cyan',   label: 'Active' },
  approved: { color: 'cyan',   label: 'Approved' },
  draft:    { color: 'peach',  label: 'Draft' },
  pending:  { color: 'purple', label: 'Pending' },
  hold:     { color: 'peach',  label: 'On hold' },
  inactive: { color: 'mauve',  label: 'Inactive' },
  private:  { color: 'blue',   label: 'Private' },
  trash:    { color: 'rose',   label: 'Trashed' },
  spam:     { color: 'rose',   label: 'Spam' },
};

interface StatusBadgeProps {
  status: string;
  label?: string;
}

export default function StatusBadge({ status, label }: StatusBadgeProps) {
  const entry = STATUS_BADGE[status];
  const color = entry?.color || 'mauve';
  const displayLabel = label || entry?.label || status.charAt(0).toUpperCase() + status.slice(1);

  return <Badge color={color}>{displayLabel}</Badge>;
}

/** Standalone helpers for places that use Badge directly. */
export function getWpStatusColor(status: string): BadgeColor {
  return STATUS_BADGE[status]?.color || 'mauve';
}

export function getWpStatusLabel(status: string): string {
  return STATUS_BADGE[status]?.label || status.charAt(0).toUpperCase() + status.slice(1);
}
