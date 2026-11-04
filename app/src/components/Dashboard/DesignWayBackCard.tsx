import React, { useEffect, useState } from 'react';
import { GlassCard, Button } from '@yotako/webmaven-ui';
import { createPluginTransport } from '../../onboarding/pluginTransport';

/**
 * "New design, keep my content" after the switch, on Overview: the new
 * design is live and "Put my old design back" stays one click away for 30
 * days (the setup's last publish says so: GET /onboarding/site-session). The
 * way back is the setup wizard's own call (POST /onboarding/design-restore),
 * through the same proxy, so it needs an administrator. Nothing shows for a
 * site that never switched, or once the 30 days are over.
 */

export interface DesignSwitch {
  sessionId: string;
  status: 'switched' | 'stopped' | 'restored';
  until: string | null;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The setup session's switch, from the site-session answer, or null. Pure. */
export function readDesignSwitch(body: unknown): DesignSwitch | null {
  if (!isObj(body) || body.success !== true || !isObj(body.data) || !isObj(body.data.session)) return null;
  const s = body.data.session;
  const ds = isObj(s.publishOutcome) && isObj(s.publishOutcome.designSwitch) ? s.publishOutcome.designSwitch : null;
  if (!ds || typeof s.id !== 'string' || !['switched', 'stopped', 'restored'].includes(ds.status)) return null;
  return { sessionId: s.id, status: ds.status, until: typeof ds.until === 'string' ? ds.until : null };
}

/** Whether the way back is still offered. Pure. */
export function wayBackOpen(ds: DesignSwitch | null, now: Date = new Date()): boolean {
  if (!ds || ds.status !== 'switched' || !ds.until) return false;
  const until = new Date(ds.until);
  return !Number.isNaN(until.getTime()) && until.getTime() > now.getTime();
}

export const LIVE_TITLE = 'Your new design is live';
export const LIVE_TEXT = 'Your previous pages are kept as drafts.';
export const RESTORE_LABEL = 'Put my old design back';
export const RESTORED_TEXT = 'Your old design is back, with your pages where they were. Orders and changes made since are kept.';
const FAILED_TEXT = 'We could not put your old design back just now. Try again in a minute.';

/** "You can go back until 9 November." Pure. */
export function untilLine(until: string, locale = 'en-GB'): string {
  return `You can go back until ${new Date(until).toLocaleDateString(locale, { day: 'numeric', month: 'long' })}.`;
}

export default function DesignWayBackCard() {
  const [ds, setDs] = useState<DesignSwitch | null>(null);
  const [phase, setPhase] = useState<'idle' | 'restoring' | 'restored'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    createPluginTransport().request<unknown>({ method: 'GET', path: '/onboarding/site-session' })
      .then((body) => { if (alive) setDs(readDesignSwitch(body)); })
      .catch(() => { /* no card without an answer */ });
    return () => { alive = false; };
  }, []);

  if (phase === 'restored') {
    return (
      <GlassCard>
        <p role="status" data-testid="design-restored" style={{ margin: 0 }}>{RESTORED_TEXT}</p>
      </GlassCard>
    );
  }
  if (!ds || !wayBackOpen(ds)) return null;

  const restore = async () => {
    setPhase('restoring');
    setError(null);
    try {
      await createPluginTransport().request({ method: 'POST', path: `/onboarding/design-restore/${ds.sessionId}`, body: {}, timeoutMs: 125_000 });
      setPhase('restored');
    } catch (e) {
      const data = (e as { data?: unknown } | null)?.data;
      setError(isObj(data) && typeof data.error === 'string' && data.error.trim() ? data.error : FAILED_TEXT);
      setPhase('idle');
    }
  };

  return (
    <GlassCard>
      <div data-testid="design-way-back" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <strong>{LIVE_TITLE}</strong>
        <p style={{ margin: 0 }}>{`${LIVE_TEXT} ${untilLine(ds.until as string)}`}</p>
        {error && <p role="alert" style={{ margin: 0 }}>{error}</p>}
        <div>
          <Button variant="ghost" onClick={() => { void restore(); }} disabled={phase === 'restoring'} data-testid="design-restore">
            {phase === 'restoring' ? 'Putting your old design back...' : RESTORE_LABEL}
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}
