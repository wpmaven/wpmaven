import React, { useState, useEffect, useRef } from 'react';
import { Button } from './Button';
import { NotificationList, Notification } from './NotificationList';
import s from './NotificationBell.module.css';

export interface NotificationBellProps {
  notifications: Notification[];
  unreadCount: number;
  onOpen?: () => void;
  onDismiss?: (id: string) => void;
  /** Passed to the list: drawn in place of a notice's severity icon when it returns something (who on the team it is from). */
  leading?: (notification: Notification) => React.ReactNode;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  notifications,
  unreadCount,
  onOpen,
  onDismiss,
  leading,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const handleOpen = () => {
    const wasOpen = open;
    setOpen(!open);
    if (!wasOpen) onOpen?.();
  };

  const active = notifications.filter(n => n.status !== 'DISMISSED');

  return (
    <div ref={ref} className={s.container}>
      <Button variant="bare" onClick={handleOpen} aria-label="Notifications">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </Button>

      {unreadCount > 0 && <div className={s.badge} />}

      {open && (
        <div className={s.dropdown}>
          <div className={s.header}>
            <span className={s.title}>Notifications</span>
            {active.length > 0 && <span className={s.count}>{active.length}</span>}
          </div>
          {active.length === 0 ? (
            <div className={s.empty}>You're all caught up</div>
          ) : (
            <NotificationList notifications={active} onDismiss={onDismiss} leading={leading} />
          )}
        </div>
      )}
    </div>
  );
};
