import React from 'react';
import { Button } from './Button';
import s from './ReportHistory.module.css';

export interface ReportListItem {
  id: string;
  type: string;
  period: string;
  summary?: string;
  pdfUrl?: string | null;
  createdAt: string;
}

export interface ReportHistoryProps {
  reports: ReportListItem[];
  onDownloadPdf: (reportId: string) => void;
  onViewReport?: (reportId: string) => void;
  title?: string;
}

function formatDate(dateStr: string): string {
  const at = new Date(dateStr);
  if (Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** The Monday of an ISO week, so "2026-W35" can be said as a date. */
function isoWeekStart(year: number, week: number): Date {
  // ISO week 1 is the week containing 4 January.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7);
  return monday;
}

/**
 * Reports are stored under machine period keys. "2026-W35" is not something a
 * customer should have to decode, so each known shape is said in words and
 * anything unrecognised is passed through rather than mangled.
 */
export function formatPeriod(period: string): string {
  if (!period) return '';
  const week = /^(\d{4})-W(\d{1,2})$/.exec(period);
  if (week) {
    const start = isoWeekStart(Number(week[1]), Number(week[2]));
    if (!Number.isNaN(start.getTime())) {
      return `Week of ${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
    }
  }
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) {
    const at = new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1));
    if (!Number.isNaN(at.getTime())) {
      return at.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }
  }
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (day) {
    const at = new Date(`${period}T00:00:00Z`);
    if (!Number.isNaN(at.getTime())) {
      return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    }
  }
  return period;
}

export const ReportHistory: React.FC<ReportHistoryProps> = ({
  reports, onDownloadPdf, onViewReport, title = 'Previous Reports',
}) => {
  if (reports.length === 0) return null;

  return (
    <div>
      {title ? <h3 className={s.title}>{title}</h3> : null}
      <div className={s.list}>
        {reports.map((report) => (
          <div key={report.id} className={s.item}>
            <div className={s.info}>
              <div className={s.period}>{formatPeriod(report.period)}</div>
              {/* The report's own 3 to 5 sentence recap, so the list says what
                  each period held without opening it (2026-10-11). */}
              {report.summary?.trim() ? <p className={s.summary}>{report.summary.trim()}</p> : null}
              <div className={s.date}>{formatDate(report.createdAt)}</div>
            </div>
            <div className={s.actions}>
              {onViewReport && (
                <Button variant="bare" size="sm" onClick={() => onViewReport(report.id)}>
                  View
                </Button>
              )}
              <Button variant="bare" size="sm" onClick={() => onDownloadPdf(report.id)}>
                Download PDF
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
