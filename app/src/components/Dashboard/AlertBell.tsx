import React, { useState } from 'react';
import { TeamFace, type TeamPresence } from '../team/TeamFace';
import { operatorRefOf } from '../../utils/team';
import { NotificationBell } from '@yotako/webmaven-ui';
import type { Notification } from '@yotako/webmaven-ui';
import { getInstanceId, proxy } from '../../services/proxyClient';
import { useProxyQuery } from '../../hooks/useProxyQuery';
import { errorSentence } from '../../utils/apiWords';

interface Inbox {
  notifications: Notification[];
  unreadCount: number;
}

/**
 * The bell (1.3.0): this business's notices, read through the proxy every
 * minute while the tab is in view. Nothing is marked read or dismissed on
 * screen unless the API said so; a refusal hides the bell and stops asking.
 */
/** The state a team notice wears on the face. */
const NOTICE_PRESENCE: Record<string, TeamPresence> = { SUCCESS: 'done', CRITICAL: 'failed', WARNING: 'waiting', INFO: 'still' };

export default function AlertBellWrapper() {
  const instanceId = getInstanceId() || '';
  const q = useProxyQuery<Inbox>('notifications', { instanceId, limit: 20 }, { pollMs: 60_000 });
  const [error, setError] = useState<string | null>(null);

  if (q.status === 'refused' || q.status === 'idle') return null;
  const notifications = Array.isArray(q.data?.notifications) ? q.data!.notifications : [];
  const unreadCount = Number(q.data?.unreadCount) || 0;

  const handleOpen = async () => {
    if (unreadCount <= 0) return;
    try {
      await proxy.post('notifications/mark-all-read', { instanceId });
      setError(null);
      q.setData((prev) => (prev ? {
        unreadCount: 0,
        notifications: prev.notifications.map((n) => (n.status === 'UNREAD' ? { ...n, status: 'READ' } : n)),
      } : prev));
    } catch (err) {
      setError(errorSentence(err, 'Your notifications could not be marked as read.'));
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      await proxy.patch(`notifications/${id}`, { status: 'DISMISSED' });
      setError(null);
      q.setData((prev) => (prev ? { ...prev, notifications: prev.notifications.filter((n) => n.id !== id) } : prev));
    } catch (err) {
      setError(errorSentence(err, 'This notification could not be dismissed.'));
    }
  };

  return (
    <span data-testid="wm-bell" data-tour="bell" title={error ?? undefined} style={{ display: 'inline-flex', position: 'relative' }}>
      <NotificationBell
        notifications={notifications}
        unreadCount={unreadCount}
        onOpen={handleOpen}
        onDismiss={handleDismiss}
        // A team notice shows who it is from, with its state on the face; the
        // product's own notices keep their icon.
        leading={(n) => {
          const who = operatorRefOf((n as { operator?: unknown }).operator);
          return who ? <TeamFace id={who.id} title={who.title} presence={NOTICE_PRESENCE[n.severity] ?? 'still'} size="card" /> : null;
        }}
      />
      {error && <span role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{error}</span>}
    </span>
  );
}
