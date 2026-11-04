import React from 'react';
import { GlassCard } from './GlassCard';
import { Button } from './Button';
import { HealthBadge, type HealthStatus } from './HealthBadge';
import { dateText, formatRelativeTime, toDate, whenText } from '../lib/timeWords';
import s from './HealthSummary.module.css';

/** The API's health states (GET /instances/:id/health, HealthView.state). */
export type SiteHealthState = 'up' | 'down' | 'checking' | 'not_checked';

export interface SiteHealthIssue {
  type?: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  /** What to do, in the alert's own words. */
  text?: string;
  since?: string;
}

/** The words the card says, in English; a host overrides any of them (`labels`). */
export interface HealthSummaryLabels {
  title: string;
  up: string;
  down: string;
  downSince: (when: string) => string;
  checking: string;
  notChecked: string;
  issuesWaiting: (count: number) => string;
  lastChecked: (ago: string) => string;
  uptime7: string;
  uptime30: string;
  responseTime: string;
  typicalResponse: (ms: string) => string;
  notMeasured: string;
  notReported: string;
  certificate: string;
  certRenews: string;
  certValidUntil: (date: string) => string;
  certExpiresIn: (days: number, date: string) => string;
  certExpired: (date: string) => string;
  certUnreadable: string;
  versions: string;
  wordpress: string;
  php: string;
  plugin: string;
  backups: string;
  lastBackup: (ago: string) => string;
  backupFailed: (date: string) => string;
  noBackup: string;
  issues: string;
  noIssues: string;
  checkNow: string;
}

export const HEALTH_SUMMARY_LABELS: HealthSummaryLabels = {
  title: 'Site health',
  up: 'Your site is up.',
  down: 'Your site is down.',
  downSince: (when) => `Your site is down since ${when}.`,
  checking: 'The last check did not get an answer. We are checking again.',
  notChecked: 'Not checked yet. The first check runs within 5 minutes of connecting.',
  issuesWaiting: (n) => (n === 1 ? 'One thing needs your attention.' : `${n} things need your attention.`),
  lastChecked: (ago) => `Last checked ${ago}`,
  uptime7: 'Uptime, 7 days',
  uptime30: 'Uptime, 30 days',
  responseTime: 'Response time',
  typicalResponse: (ms) => `Typically ${ms}`,
  notMeasured: 'Not measured yet',
  notReported: 'Not reported yet',
  certificate: 'Secure certificate',
  certRenews: 'Renews automatically',
  certValidUntil: (date) => `Valid until ${date}`,
  certExpiresIn: (days, date) => `Expires in ${days} day${days === 1 ? '' : 's'}, on ${date}. Renew it with your host.`,
  certExpired: (date) => `Expired on ${date}. Renew it with your host so visitors do not see a warning.`,
  certUnreadable: 'The certificate could not be read at the last check.',
  versions: 'Versions',
  wordpress: 'WordPress',
  php: 'PHP',
  plugin: 'WPMaven plugin',
  backups: 'Backups',
  lastBackup: (ago) => `Last backup ${ago}`,
  backupFailed: (date) => `The last backup did not finish (${date}).`,
  noBackup: 'No backup yet.',
  issues: 'What needs your attention',
  noIssues: 'Nothing needs your attention.',
  checkNow: 'Check now',
};

/** A connected site's certificate this close to its end is an issue (the API's CERT_WARN_DAYS). */
const CERT_WARN_DAYS = 14;
const DAY_MS = 86_400_000;

export interface HealthSummaryProps {
  /** The fields of the API's HealthView, as it sends them; spread it in. */
  state: SiteHealthState;
  since?: string | null;
  lastCheckAt?: string | null;
  uptime?: { days7: number | null; days30: number | null } | null;
  responseMs?: { last: number | null; median7d: number | null } | null;
  certificate?: { expiresAt: string | null; checkedAt?: string | null; renewsAutomatically?: boolean } | null;
  versions?: { wordpress: string | null; php: string | null; plugin: string | null } | null;
  /** Null for a site WPMaven does not back up: the row is left out. */
  backups?: { lastOkAt: string | null; lastFailedAt: string | null } | null;
  issues?: ReadonlyArray<SiteHealthIssue>;
  /** The most issues listed (default: all). */
  maxIssues?: number;
  /** Runs a check; without it there is no Check now button. */
  onCheckNow?: () => void;
  /** A check is running: the button spins. */
  checking?: boolean;
  /** Why Check now cannot run now: the button is disabled and this is said under it. */
  checkNowDisabledReason?: React.ReactNode;
  /** What the last Check now said (a refusal, a limit), under the button. */
  checkNote?: React.ReactNode;
  labels?: Partial<HealthSummaryLabels>;
  /** The "now" the times are read against (tests, a page's own clock). */
  now?: Date;
  className?: string;
  testId?: string;
}

/** The kit's HealthBadge for a state: none before the first check. */
export function healthBadgeStatus(state: SiteHealthState, issues: number): HealthStatus | null {
  if (state === 'down') return 'issues';
  if (state === 'checking') return 'attention';
  if (state === 'up') return issues > 0 ? 'attention' : 'healthy';
  return null;
}

const STATE_COLOR: Record<SiteHealthState, string> = {
  up: 'var(--success)',
  down: 'var(--danger)',
  checking: 'var(--warning)',
  not_checked: 'var(--text-dim)',
};

/**
 * A site's health in one card (2026-10-16), from WPMaven's own monitors: the
 * state in words, uptime over 7 and 30 days, the response time, the
 * certificate, the versions, the backups and what needs attention, with
 * Check now. The props are the API's HealthView fields, so a host spreads
 * the answer in (`<HealthSummary {...health} onCheckNow={...} />`).
 * Nothing is a figure the API did not send: what it does not have reads as
 * "Not measured yet" (or is left out).
 */
export const HealthSummary: React.FC<HealthSummaryProps> = ({
  state,
  since,
  lastCheckAt,
  uptime,
  responseMs,
  certificate,
  versions,
  backups,
  issues = [],
  maxIssues,
  onCheckNow,
  checking = false,
  checkNowDisabledReason,
  checkNote,
  labels: labelsProp,
  now: nowProp,
  className,
  testId,
}) => {
  const L: HealthSummaryLabels = { ...HEALTH_SUMMARY_LABELS, ...labelsProp };
  const now = nowProp ?? new Date();
  const measured = state !== 'not_checked';
  const badge = healthBadgeStatus(state, issues.length);

  const sinceDate = toDate(since);
  const stateLine =
    state === 'up' ? L.up
    : state === 'down' ? (sinceDate ? L.downSince(whenText(sinceDate, now)) : L.down)
    : state === 'checking' ? L.checking
    // "Not checked yet" never sits above an issue: then it says how many wait.
    : issues.length > 0 ? L.issuesWaiting(issues.length) : L.notChecked;

  const lastCheck = toDate(lastCheckAt);
  const uptimeText = (pct: number | null | undefined) => (pct == null ? L.notMeasured : `${Number(pct.toFixed(2))}%`);
  const msText = (ms: number | null | undefined) => (ms == null ? null : `${Math.round(ms)} ms`);

  const certLine = (() => {
    if (!certificate) return null;
    if (certificate.renewsAutomatically) return L.certRenews;
    const ends = toDate(certificate.expiresAt);
    if (!ends) return certificate.checkedAt ? L.certUnreadable : L.notMeasured;
    const days = Math.floor((ends.getTime() - now.getTime()) / DAY_MS);
    const date = dateText(ends);
    if (days < 0) return L.certExpired(date);
    if (days <= CERT_WARN_DAYS) return L.certExpiresIn(days, date);
    return L.certValidUntil(date);
  })();

  const versionLine = versions
    ? [
      `${L.wordpress} ${versions.wordpress ?? L.notReported}`,
      `${L.php} ${versions.php ?? L.notReported}`,
      `${L.plugin} ${versions.plugin ?? L.notReported}`,
    ].join(', ')
    : null;

  const backupLine = (() => {
    if (!backups) return null;
    const ok = toDate(backups.lastOkAt);
    const failed = toDate(backups.lastFailedAt);
    if (failed && (!ok || failed > ok)) return L.backupFailed(dateText(failed));
    return ok ? L.lastBackup(formatRelativeTime(ok, now)) : L.noBackup;
  })();

  const shownIssues = maxIssues != null ? issues.slice(0, Math.max(0, maxIssues)) : issues;
  const typical = msText(responseMs?.median7d);

  return (
    <GlassCard padding="20px 24px" className={[s.root, className].filter(Boolean).join(' ')} data-testid={testId} data-state={state}>
      <div className={s.header}>
        <div className={s.heading}>
          <h3 className={s.title}>{L.title}</h3>
          {badge && <HealthBadge status={badge} />}
        </div>
        {onCheckNow && (
          <div className={s.check}>
            <Button
              variant="outline"
              size="sm"
              onClick={onCheckNow}
              isLoading={checking}
              disabled={checking || !!checkNowDisabledReason}
              data-testid="health-check-now"
            >
              {L.checkNow}
            </Button>
            {checkNowDisabledReason && !checking && <p className={s.note}>{checkNowDisabledReason}</p>}
            {checkNote && <p className={s.note} role="status">{checkNote}</p>}
          </div>
        )}
      </div>

      <p className={s.state}>
        <span className={s.dot} style={{ background: STATE_COLOR[state] }} aria-hidden="true" />
        <span data-testid="health-state">{stateLine}</span>
      </p>
      {measured && lastCheck && (
        <p className={s.lastCheck} data-testid="health-last-check">
          {L.lastChecked(formatRelativeTime(lastCheck, now))}
        </p>
      )}

      {measured && (
        <dl className={s.figures}>
          <div className={s.figure}>
            <dt className={s.figureLabel}>{L.uptime7}</dt>
            <dd className={s.figureValue} data-testid="health-uptime-7">{uptimeText(uptime?.days7)}</dd>
          </div>
          <div className={s.figure}>
            <dt className={s.figureLabel}>{L.uptime30}</dt>
            <dd className={s.figureValue} data-testid="health-uptime-30">{uptimeText(uptime?.days30)}</dd>
          </div>
          <div className={s.figure}>
            <dt className={s.figureLabel}>{L.responseTime}</dt>
            <dd className={s.figureValue}>{msText(responseMs?.last) ?? L.notMeasured}</dd>
            {typical && <dd className={s.figureHint}>{L.typicalResponse(typical)}</dd>}
          </div>
        </dl>
      )}

      {(certLine || versionLine || backupLine) && (
        <dl className={s.details}>
          {certLine && (
            <div className={s.detail}>
              <dt>{L.certificate}</dt>
              <dd data-testid="health-certificate">{certLine}</dd>
            </div>
          )}
          {versionLine && (
            <div className={s.detail}>
              <dt>{L.versions}</dt>
              <dd data-testid="health-versions">{versionLine}</dd>
            </div>
          )}
          {backupLine && (
            <div className={s.detail}>
              <dt>{L.backups}</dt>
              <dd data-testid="health-backups">{backupLine}</dd>
            </div>
          )}
        </dl>
      )}

      <div className={s.issues}>
        <h4 className={s.issuesTitle}>{L.issues}</h4>
        {shownIssues.length === 0 ? (
          <p className={s.noIssues}>{L.noIssues}</p>
        ) : (
          <ul className={s.issueList} data-testid="health-issues">
            {shownIssues.map((issue, i) => (
              <li key={`${issue.type ?? 'issue'}-${i}`} className={s.issue}>
                <span className={`${s.issueTitle} ${s[issue.severity] ?? s.info}`}>{issue.title}</span>
                {issue.text && <span className={s.issueText}>{issue.text}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </GlassCard>
  );
};
