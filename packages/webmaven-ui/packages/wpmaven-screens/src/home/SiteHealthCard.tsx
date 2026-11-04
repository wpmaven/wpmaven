/**
 * Site health, as a Home section (2026-10-16): the kit's HealthSummary on
 * the real numbers of GET /instances/:id/health (uptime over 7 and 30 days,
 * response time, certificate, versions, backups, what needs attention, the
 * last check), and Check now (POST /instances/:id/health/check, 6 an hour
 * per business). The plugin's Overview draws it; the dashboard's Home has no
 * health card (its business page has the Health tab).
 *
 * Check now answers the fresh health, which replaces the card's. Past the
 * hour's checks the API says so (429 HEALTH_CHECK_LIMIT, with how long to
 * wait): the button stays off until then, with the reason under it. Any
 * other failure says what happened under the button. A site never checked
 * (a private address the uptime job cannot reach) is filled by Check now.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HealthSummary, type HealthSummaryLabels } from '@yotako/webmaven-ui';
import type { ScreensHost } from '../host/types';
import { ScreensHostProvider } from '../host/HostContext';
import { teamBusiness } from '../team/reads';
import {
  SITE_HEALTH_COPY, SiteHealthCheckRefused, checkSiteHealth, readSiteHealth, type SiteHealthView,
} from './reads';
import { SectionLoading, SectionProblem, isRefusal, sectionErrorText } from './SectionState';

/** How often the card reads the health again while the page is open. */
export const HEALTH_POLL_MS = 5 * 60_000;

/** How long Check now stays off after the hour's limit when the API did not say. */
export const HEALTH_LIMIT_FALLBACK_MS = 10 * 60_000;

export type SiteHealthStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'refused';

export interface SiteHealthState {
  status: SiteHealthStatus;
  health: SiteHealthView | null;
  /** The read's failure, in words (status 'failed'). */
  error: string | null;
  /** A check is running. */
  checking: boolean;
  /** What the last Check now said when it did not run (not the limit). */
  checkNote: string | null;
  /** Until when Check now is off: the hour's checks are used up (a time in ms), or null. */
  limitedUntil: number | null;
  /** The words under the disabled Check now while it is off, or null. */
  limitReason: string | null;
  retry(): void;
  checkNow(): void;
}

/**
 * The health of one business, read now and every HEALTH_POLL_MS while the
 * page is visible, with Check now. A refusal (the role may not read it)
 * stops the reads for good: the card is left out.
 */
export function useSiteHealth(host: ScreensHost, instanceId?: string | null, opts: { pollMs?: number; now?: () => number } = {}): SiteHealthState {
  const business = teamBusiness(host.scope, instanceId);
  const pollMs = opts.pollMs ?? HEALTH_POLL_MS;
  const clock = opts.now ?? Date.now;
  const [status, setStatus] = useState<SiteHealthStatus>(business ? 'loading' : 'idle');
  const [health, setHealth] = useState<SiteHealthView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  // The API's sentence, and whether it said how long to wait (then the card says the minutes).
  const [limit, setLimit] = useState<{ until: number; text: string; timed: boolean } | null>(null);
  const refused = useRef(false);
  const current = useRef(business);
  current.current = business;

  const read = useCallback(async () => {
    if (!business || refused.current) return;
    const asked = business;
    try {
      const h = await readSiteHealth(host.transport, asked);
      if (current.current !== asked) return;
      setHealth(h);
      setError(null);
      setStatus('ready');
    } catch (e) {
      if (current.current !== asked) return;
      if (isRefusal(e)) {
        refused.current = true;
        setStatus('refused');
        return;
      }
      setError(sectionErrorText(host, e, SITE_HEALTH_COPY.loadFailed));
      // A card on screen keeps its numbers when a later read fails.
      setStatus((s) => (s === 'ready' ? s : 'failed'));
    }
    // The transport may be a new object on each render: read again only for another business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business]);

  useEffect(() => {
    refused.current = false;
    setHealth(null);
    setError(null);
    setCheckNote(null);
    setLimit(null);
    setStatus(business ? 'loading' : 'idle');
    if (!business) return undefined;
    void read();
    if (!(pollMs > 0)) return undefined;
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void read();
    }, pollMs);
    return () => clearInterval(timer);
  }, [business, read, pollMs]);

  // The hour's limit ends: Check now comes back by itself.
  useEffect(() => {
    if (!limit) return undefined;
    const left = limit.until - clock();
    if (left <= 0) { setLimit(null); return undefined; }
    const timer = setTimeout(() => setLimit(null), left);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  const checkNow = useCallback(() => {
    if (!business || checking) return;
    const asked = business;
    host.track?.('home', 'health_check_now');
    setChecking(true);
    setCheckNote(null);
    checkSiteHealth(host.transport, asked)
      .then((h) => {
        if (current.current !== asked) return;
        setHealth(h);
        setError(null);
        setStatus('ready');
      })
      .catch((e) => {
        if (current.current !== asked) return;
        if (e instanceof SiteHealthCheckRefused && e.limited) {
          const until = clock() + (e.retryAfterSec != null ? e.retryAfterSec * 1000 : HEALTH_LIMIT_FALLBACK_MS);
          setLimit({ until, text: e.message, timed: e.retryAfterSec != null });
          return;
        }
        setCheckNote(e instanceof SiteHealthCheckRefused ? e.message : sectionErrorText(host, e, SITE_HEALTH_COPY.checkFailed));
      })
      .finally(() => { if (current.current === asked) setChecking(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business, checking]);

  const limitedUntil = limit && limit.until > clock() ? limit.until : null;
  const minutes = limitedUntil ? Math.max(1, Math.ceil((limitedUntil - clock()) / 60_000)) : 0;
  return {
    status,
    health,
    error,
    checking,
    checkNote,
    limitedUntil,
    limitReason: limitedUntil && limit ? (limit.timed ? SITE_HEALTH_COPY.limitedFor(minutes) : limit.text) : null,
    retry: () => { setStatus('loading'); void read(); },
    checkNow,
  };
}

export interface SiteHealthCardProps {
  host: ScreensHost;
  /** The account's scope: the business on screen. A site's scope ignores it: its own instance. */
  instanceId?: string | null;
  /** Check now (6 an hour per business). Default true; false draws no button. */
  canCheck?: boolean;
  /** Read again this often while the page is visible (ms; 0: never). Default 5 minutes. */
  pollMs?: number;
  /** The most issues listed (default: all). */
  maxIssues?: number;
  /** The card's words, in the kit's HealthSummary labels (its English by default). */
  labels?: Partial<HealthSummaryLabels>;
}

export const SiteHealthCard: React.FC<SiteHealthCardProps> = (props) => (
  <ScreensHostProvider host={props.host}>
    <SiteHealthSection {...props} />
  </ScreensHostProvider>
);

const SiteHealthSection: React.FC<SiteHealthCardProps> = ({ host, instanceId, canCheck = true, pollMs, maxIssues, labels }) => {
  const state = useSiteHealth(host, instanceId, { pollMs });
  return <SiteHealthCardView state={state} canCheck={canCheck} maxIssues={maxIssues} labels={labels} />;
};

/** The card for a health state (exported for the tests and an app's own page). */
export const SiteHealthCardView: React.FC<{
  state: SiteHealthState;
  canCheck?: boolean;
  maxIssues?: number;
  labels?: Partial<HealthSummaryLabels>;
  now?: Date;
}> = ({ state, canCheck = true, maxIssues, labels, now }) => {
  const title = labels?.title ?? 'Site health';
  if (state.status === 'idle' || state.status === 'refused') return null;
  if (state.status === 'loading' && !state.health) {
    return <SectionLoading title={title} label={SITE_HEALTH_COPY.loading} testId="site-health-loading" />;
  }
  if (!state.health) {
    return <SectionProblem title={title} text={state.error ?? SITE_HEALTH_COPY.loadFailed} onRetry={state.retry} testId="site-health-failed" />;
  }
  const h = state.health;
  return (
    <HealthSummary
      testId="site-health"
      state={h.state}
      since={h.since}
      lastCheckAt={h.lastCheckAt}
      uptime={h.uptime}
      responseMs={h.responseMs}
      certificate={h.certificate}
      versions={h.versions}
      backups={h.backups}
      issues={h.issues}
      maxIssues={maxIssues}
      onCheckNow={canCheck ? state.checkNow : undefined}
      checking={state.checking}
      checkNowDisabledReason={state.limitReason ?? undefined}
      checkNote={state.checkNote ?? undefined}
      labels={labels}
      now={now}
    />
  );
};

export default SiteHealthCard;
