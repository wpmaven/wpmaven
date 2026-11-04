import React from 'react';
import s from './NotificationList.module.css';

export interface Notification {
  id: string;
  scope: 'INSTANCE' | 'ACCOUNT' | 'GLOBAL';
  source: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'SUCCESS';
  title: string;
  message: string;
  status: string;
  createdAt: string;
  instance?: { siteName: string; siteUrl: string } | null;
}

export interface NotificationListProps {
  notifications: Notification[];
  onDismiss?: (id: string) => void;
  emptyText?: string;
  /** Drawn in place of the severity icon when it returns something (the face of
   *  the member a notice is about); null keeps the icon. */
  leading?: (notification: Notification) => React.ReactNode;
}

const severityIcons: Record<string, string> = {
  INFO: '💡',
  WARNING: '⚠️',
  CRITICAL: '🔴',
  SUCCESS: '✅',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const NotificationList: React.FC<NotificationListProps> = ({
  notifications,
  onDismiss,
  emptyText = 'No notifications',
  leading,
}) => {
  if (notifications.length === 0) {
    return <div className={s.empty}>{emptyText}</div>;
  }

  return (
    <div className={s.list}>
      {notifications.map(n => (
        <div key={n.id} className={`${s.item} ${n.status === 'UNREAD' ? s.unread : ''}`}>
          <span className={s.icon}>{leading?.(n) ?? severityIcons[n.severity]}</span>
          <div className={s.content}>
            <div className={s.titleRow}>
              <span className={s.title}>{n.title}</span>
              {n.instance && <span className={s.site}>{n.instance.siteName}</span>}
            </div>
            <p className={s.message}>{n.message}</p>
            <div className={s.footer}>
              <span className={s.time}>{timeAgo(n.createdAt)}</span>
              {onDismiss && (
                <button className={s.dismiss} onClick={() => onDismiss(n.id)}>Dismiss</button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
