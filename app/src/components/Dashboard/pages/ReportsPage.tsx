import React, { useCallback, useEffect, useState } from 'react';
import { ReportView, ReportHistory, Button, PageHeader } from '@yotako/webmaven-ui';
import type { ReportData, ReportListItem } from '@yotako/webmaven-ui';
import { getInstanceId, proxy, ProxyError } from '../../../services/proxyClient';
import { useProxyQuery } from '../../../hooks/useProxyQuery';
import { useSubPath } from '../store/shared/useSubPath';
import { errorSentence } from '../../../utils/apiWords';
import { downloadReportPdf } from '../../../utils/reportPdf';
import { isOwnerTier } from '../../../utils/tier';
import { reportHeading, reportTypeLabel } from '../../../utils/reportWords';
import ScreenState from '../ui/ScreenState';

/**
 * Reports: the list, newest first, each with its recap, for administrators
 * and shop managers; an administrator also makes a new one. A report opens
 * in the address (#/reports/<id>), so the browser's Back returns to the list
 * and a link opens its report. Every failure is said on the page.
 */

const WAIT_POLL_MS = 15_000;
const WAIT_FOR_MS = 3 * 60_000;

/** The history entry the list pushes to open a report carries this, so the report's Back knows the list is one step back. */
const OPENED_HERE = 'wmReportOpenedHere';

/** Whether this history entry was pushed by the list that opened the report. */
export function openedHere(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as Record<string, unknown>)[OPENED_HERE] === true;
}

/** A report id from the address, or null for anything that cannot be one. */
export function reportIdFrom(segment: string | undefined): string | null {
  return segment && /^[A-Za-z0-9_-]{1,64}$/.test(segment) ? segment : null;
}

/**
 * The report the address names, and the way in and out of it. Opening one
 * from the list pushes #/reports/<id>, marked as opened here. Its Back steps
 * back once when the list opened it; after a link (a notification, the
 * chat) there is no list behind it, so the address is replaced and the list
 * shows in its place.
 */
export function useReportInAddress(): { reportId: string | null; open: (id: string) => void; close: () => void } {
  const { parts, go } = useSubPath('reports');
  const reportId = reportIdFrom(parts[0]);
  const open = useCallback((id: string) => {
    go([id]);
    try {
      const prev = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
      window.history.replaceState({ ...prev, [OPENED_HERE]: true }, '');
    } catch { /* the Back below then replaces the address instead */ }
  }, [go]);
  const close = useCallback(() => {
    if (openedHere(window.history.state)) {
      window.history.back();
      return;
    }
    go([], { replace: true });
  }, [go]);
  return { reportId, open, close };
}

const ReportsPage: React.FC = () => {
  const instanceId = getInstanceId() || '';
  const owner = isOwnerTier();
  const list = useProxyQuery<{ reports: ReportListItem[] }>(instanceId ? `reports/${instanceId}` : null, { limit: 20 });
  const reports = Array.isArray(list.data?.reports) ? list.data!.reports : [];
  const { reportId, open, close } = useReportInAddress();
  const detail = useProxyQuery<ReportData>(reportId ? `reports/detail/${reportId}` : null);
  const [generating, setGenerating] = useState(false);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  // A report still being made when the request gave up: look again for a while.
  useEffect(() => {
    if (waitingSince === null) return undefined;
    const t = setInterval(() => {
      if (Date.now() - waitingSince > WAIT_FOR_MS) {
        setWaitingSince(null);
        setNotice({ kind: 'info', text: 'Your report is taking longer than usual. It shows here once it is ready.' });
        return;
      }
      if (document.visibilityState !== 'hidden') void list.refetch();
    }, WAIT_POLL_MS);
    return () => clearInterval(t);
  }, [waitingSince, list]);

  useEffect(() => {
    if (waitingSince !== null && reports[0] && new Date(reports[0].createdAt).getTime() >= waitingSince - 60_000) {
      setWaitingSince(null);
      setNotice(null);
    }
  }, [reports, waitingSince]);

  const generate = async () => {
    setGenerating(true);
    setNotice(null);
    const started = Date.now();
    try {
      await proxy.post(`reports/${instanceId}/generate`, { type: 'weekly' });
      await list.refetch();
    } catch (err) {
      if (err instanceof ProxyError && (err.status === 0 || err.status === 502 || err.status === 504)) {
        setWaitingSince(started);
        setNotice({ kind: 'info', text: 'Your report is still being made. It shows here when it is ready.' });
      } else {
        setNotice({ kind: 'error', text: errorSentence(err, 'The report could not be made just now. Try again in a few minutes.') });
      }
    } finally {
      setGenerating(false);
    }
  };

  const pdf = async (reportId: string) => {
    setNotice(null);
    try {
      await downloadReportPdf(reportId);
    } catch (err) {
      setNotice({ kind: 'error', text: errorSentence(err, 'The PDF could not be downloaded. Try again in a minute.') });
    }
  };

  const busy = generating || waitingSince !== null;
  const generateButton = owner ? (
    <Button onClick={generate} disabled={busy}>{busy ? 'Making your report' : 'Create a report'}</Button>
  ) : null;

  const shell = (children: React.ReactNode, actions: React.ReactNode = null) => (
    <div className="wm-main__inner" style={{ padding: '24px', maxWidth: 800, margin: '0 auto' }}>
      <PageHeader title="Reports" actions={actions} style={{ marginBottom: 20 }} />
      {busy && (
        <p role="status" style={{ fontSize: 13, color: 'var(--text-dim)', margin: '0 0 16px' }}>
          Making your report. This takes about a minute.
        </p>
      )}
      {notice && (
        <p role={notice.kind === 'error' ? 'alert' : 'status'} style={{ fontSize: 13, color: notice.kind === 'error' ? 'var(--rose)' : 'var(--text)', margin: '0 0 16px' }}>
          {notice.text}
        </p>
      )}
      {children}
    </div>
  );

  // The report the address names, whatever the list holds: a link opens it too.
  if (reportId) {
    const backToList = (
      <Button variant="ghost" onClick={close} data-testid="wm-report-back">Back to your reports</Button>
    );
    return shell(
      <div data-testid="wm-report-open" data-report-id={reportId}>
        {(detail.status === 'loading' || detail.status === 'idle') && <ScreenState state="loading" label="Loading the report" />}
        {detail.status === 'refused' && <><ScreenState state="refused" error={detail.error} />{backToList}</>}
        {detail.status === 'failed' && (
          <>
            <ScreenState state="failed" error={detail.error} fallback="This report could not be loaded. Try again in a minute." onRetry={detail.refetch} />
            {backToList}
          </>
        )}
        {detail.status === 'ready' && detail.data && (
          // The kit heads the report with its stored type and period
          // ("Plan_progress report, 2026-W42"); ours says them in words, and
          // the kit's badge gets the type in words (pages.css hides the kit's
          // heading and its capitalize).
          <div className="wm-report-words">
            <h2 className="wm-report-heading" data-testid="wm-report-heading">{reportHeading(detail.data)}</h2>
            <ReportView
              report={{ ...detail.data, type: reportTypeLabel(detail.data.type) || detail.data.type }}
              onDownloadPdf={() => pdf(detail.data!.id)}
              onBack={close}
            />
          </div>
        )}
      </div>,
    );
  }

  if (list.status === 'loading' || list.status === 'idle') return shell(<ScreenState state="loading" label="Loading your reports" />);
  if (list.status === 'refused') return shell(<ScreenState state="refused" error={list.error} />);
  if (list.status === 'failed') {
    return shell(<ScreenState state="failed" error={list.error} fallback="Your reports could not be loaded. Try again in a minute." onRetry={list.refetch} />);
  }
  if (reports.length === 0) {
    return shell(
      <ScreenState state="empty" title={owner ? 'No report yet. Create your first one now.' : 'No report yet.'}>
        {owner && <div style={{ marginTop: 8 }}>{generateButton}</div>}
      </ScreenState>,
    );
  }

  // The list, newest first: each recap says what is in the report.
  return shell(
    <div data-testid="wm-report-list">
      <ReportHistory reports={reports} onDownloadPdf={pdf} onViewReport={open} title="" />
    </div>,
    generateButton,
  );
};

export default ReportsPage;
