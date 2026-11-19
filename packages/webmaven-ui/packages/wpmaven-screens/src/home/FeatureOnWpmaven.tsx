/**
 * Feature my business on WPMaven's channels (moved from the dashboard's
 * Home, 2026-10-17): the launch card's and Your website's, in both apps. It
 * reads and writes through the app's transport:
 *
 *   GET  /instances/:id/social/x/status   the consent (and X's connection)
 *   POST /instances/:id/social/consent    { consent }
 *   POST /instances/:id/social/x/share    after a yes: the launch post
 *
 * The owner chooses here whether WPMaven announces their new business on
 * WPMaven's own public accounts. Consent starts off and is turned on here,
 * at the moment the owner is looking at their live site; the same control
 * turns it off again later. What is posted is the business name and its
 * public link, nothing else, and that is what the sentence under the box
 * says. A launch post from the owner's own X account waits for their
 * approval like every other public post, and the note links straight to it.
 *
 * Honesty rule for the note: "Posted" is said only for a post the API
 * reports as out. It never claims a post that did not happen.
 *
 * Not drawn under another brand (host.whiteLabel: it would name WPMaven),
 * nor for someone who may not decide it (viewer.featuresBusiness: in
 * WordPress, the owner's own account only); nothing is read then.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { OUR_NAME, productName } from '@yotako/wpmaven-onboarding/shared';
import type { ScreensHost } from '../host/types';
import { HostLink } from '../host/HostLink';
import { ScreensHostProvider } from '../host/HostContext';
import { sectionErrorText } from './SectionState';
import { FEATURE_COPY, FEATURE_COPY_EN } from './featureCopy';

/** The line under the box, in English, for importers; the box reads FEATURE_COPY.explainer when it draws. */
export const FEATURE_ON_WPMAVEN_EXPLAINER = FEATURE_COPY_EN.explainerFor(OUR_NAME);

export interface LaunchShareNote {
  text: string;
  /** The app's address of the waiting approval (through the host), or null. */
  approvalHref: string | null;
}

const WAITING_MODES = ['pending_approval', 'awaiting_approval', 'approval', 'pending'];

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The note under the box after it is ticked, from POST .../social/x/share.
 * `where` says where the approval can be opened: 'dashboard' gets a direct
 * link (the app's host maps it), 'plugin' (the build wizard inside
 * WordPress) names the screen.
 */
export function launchShareNote(result: unknown, where: 'dashboard' | 'plugin' = 'dashboard'): LaunchShareNote {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const approval = r.approval && typeof r.approval === 'object' ? r.approval as Record<string, unknown> : null;
  const approvalId = str(r.approvalId) || str(r.userApprovalId) || str(approval?.id);
  const mode = str(r.mode);
  const waiting = !!approvalId || WAITING_MODES.includes(mode);
  const wpmavenPosted = !!(str(r.appPostId) || str(r.retweetId));
  const ownPosted = !!str(r.userPostId);

  const c = FEATURE_COPY;
  const parts: string[] = [];
  if (wpmavenPosted) parts.push(c.postedFor(productName()));
  else if (waiting || ownPosted) parts.push(c.saved);
  else parts.push(c.savedLaterFor(productName()));

  if (waiting) {
    parts.push(where === 'dashboard'
      ? c.ownWaiting
      : c.ownWaitingPluginFor(productName()));
  } else if (ownPosted) {
    parts.push(c.ownPosted);
  }

  const approvalHref = where === 'dashboard' && waiting
    ? (approvalId ? `/team?tab=approvals&approval=${encodeURIComponent(approvalId)}` : '/team?tab=approvals')
    : null;
  return { text: parts.join(' '), approvalHref };
}

interface Status {
  consent: boolean;
  xEnabled: boolean;
  lastLaunch: { mode?: string; status?: string } | null;
}

export interface FeatureOnWpmavenProps {
  host: ScreensHost;
  instanceId: string;
  /** As ShareYourSite: 'banner' right after launch, 'quiet' afterwards. */
  variant: 'banner' | 'quiet';
}

export const FeatureOnWpmaven: React.FC<FeatureOnWpmavenProps> = (props) => {
  const { host } = props;
  if (host.whiteLabel || host.viewer?.featuresBusiness === false) return null;
  return <FeatureOnWpmavenCard {...props} />;
};

const FeatureOnWpmavenCard: React.FC<FeatureOnWpmavenProps> = ({ host, instanceId, variant }) => {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<LaunchShareNote | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  const base = `/instances/${encodeURIComponent(instanceId)}/social`;

  useEffect(() => {
    let cancelled = false;
    hostRef.current.transport.get<Status | null>(`${base}/x/status`)
      .then((data) => { if (!cancelled && data && typeof data === 'object') setStatus(data); })
      .catch(() => { /* the control simply stays hidden without a status */ });
    return () => { cancelled = true; };
  }, [base]);

  const setConsent = useCallback(async (next: boolean) => {
    const h = hostRef.current;
    setBusy(true);
    setNote(null);
    try {
      await h.transport.post(`${base}/consent`, { consent: next });
      setStatus((s) => (s ? { ...s, consent: next } : s));
      h.track?.('share', next ? 'feature_on_wpmaven_on' : 'feature_on_wpmaven_off', variant);
      if (!next) {
        setNote({ text: FEATURE_COPY.turnedOffFor(productName()), approvalHref: null });
        return;
      }
      const share = await h.transport.post<unknown>(`${base}/x/share`);
      setNote(launchShareNote(share, 'dashboard'));
    } catch (e) {
      setNote({ text: sectionErrorText(h, e, FEATURE_COPY.saveFailed), approvalHref: null });
    } finally {
      setBusy(false);
    }
  }, [base, variant]);

  if (!status) return null;

  const size = variant === 'banner' ? 'var(--text-data)' : 'var(--text-meta)';

  return (
    <div style={{ flexBasis: '100%', minWidth: 0, marginTop: 6 }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: 0, cursor: busy ? 'progress' : 'pointer' }}>
        <input
          type="checkbox"
          checked={status.consent}
          disabled={busy}
          onChange={(e) => void setConsent(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span style={{ fontSize: size, color: 'var(--text)', lineHeight: 'var(--leading-body)' }}>
          {FEATURE_COPY.label}
          <span style={{ display: 'block', color: 'var(--text-dim)' }} data-testid="feature-explainer">
            {FEATURE_COPY.explainer} {FEATURE_COPY.turnOff}
          </span>
        </span>
      </label>
      <ScreensHostProvider host={host}>
        <FeatureNote note={note} size={size} />
      </ScreensHostProvider>
    </div>
  );
};

/**
 * The line under the box: what happened, and, when the owner's own launch
 * post is waiting, a direct link to it, through the host (the dashboard's
 * router; from WordPress, the dashboard).
 */
export const FeatureNote: React.FC<{ note: LaunchShareNote | null; size?: string }> = ({ note, size = 'var(--text-meta)' }) => (
  <p role="status" aria-live="polite" style={{ marginTop: note ? 4 : 0, marginBottom: 0, marginInlineEnd: 0, marginInlineStart: note ? 24 : 0, fontSize: size, color: 'var(--text-dim)' }}>
    {note?.text}
    {note?.approvalHref && (
      <>
        {' '}
        <HostLink to={note.approvalHref} style={{ color: 'inherit', textDecoration: 'underline' }} testId="feature-approval-link">{FEATURE_COPY.reviewNow}</HostLink>
      </>
    )}
  </p>
);

export default FeatureOnWpmaven;
