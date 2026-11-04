import React from 'react';
import { Badge } from './Badge';
import { Button } from './Button';
import { Chart } from './Chart';
import { GlassCard } from './GlassCard';
import { reportCurrency, reportMetricWords } from '../lib/reportMetrics';
import s from './ReportView.module.css';

export interface ReportChartConfig {
  type: string;
  data: { labels: string[]; datasets: Array<{ label: string; data: number[]; color?: string }> };
  title: string;
  options?: Record<string, any>;
}

export interface ReportData {
  id: string;
  type: string;
  period: string;
  summary: string;
  content: {
    executiveSummary?: string;
    highlights?: Array<{ type: string; text: string }>;
    sections?: Array<{
      id: string;
      title: string;
      content: string;
      metrics?: Record<string, any>;
      chartId?: string;
    }>;
    recommendations?: Array<{ priority: string; text: string }>;
    charts?: Record<string, ReportChartConfig>;
  };
  chartUrls?: Record<string, string> | null;
  createdAt: string;
  /**
   * The report's currency (ISO code, "EUR"), for its money metrics. When it
   * is absent, the one in `data` is used: the figures the API wrote the
   * report from, as its detail endpoint sends them.
   */
  currency?: string | null;
  data?: Record<string, any> | null;
}

export interface ReportViewProps {
  report: ReportData;
  onDownloadPdf?: () => void;
  onBack?: () => void;
  loading?: boolean;
}

const HIGHLIGHT_ICONS: Record<string, string> = {
  win: '\u2714',        // ✔
  concern: '\u26A0',    // ⚠
  recommendation: '\u{1F4A1}', // 💡
};

const HIGHLIGHT_COLORS: Record<string, 'cyan' | 'peach' | 'purple'> = {
  win: 'cyan',
  concern: 'peach',
  recommendation: 'purple',
};

const PRIORITY_COLORS: Record<string, 'rose' | 'peach' | 'blue'> = {
  high: 'rose',
  medium: 'peach',
  low: 'blue',
};

const SECTION_CHART_MAP: Record<string, string> = {
  traffic: 'traffic_trend',
  ecommerce: 'revenue_trend',
};

const SECTION_ICONS: Record<string, string> = {
  traffic: '\u{1F4CA}',     // 📊
  ecommerce: '\u{1F6D2}',   // 🛒
  forms: '\u{1F4DD}',       // 📝
  bookings: '\u{1F4C5}',    // 📅
  content: '\u{270F}',      // ✏
  health: '\u{1F6E1}',      // 🛡
};

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return dateStr; }
}

export const ReportView: React.FC<ReportViewProps> = ({ report, onDownloadPdf, onBack }) => {
  const { content } = report;
  const typeLabel = report.type.charAt(0).toUpperCase() + report.type.slice(1);
  const currency = reportCurrency(report);

  return (
    <div className={s.report}>
      {/* Header */}
      <div className={s.header}>
        <div className={s.headerInfo}>
          <h2 className={s.title}>{typeLabel} report, {report.period}</h2>
          <div className={s.meta}>
            <Badge color="purple"><span className={s.typeBadge}>{report.type}</span></Badge>
            <span>Generated {formatDate(report.createdAt)}</span>
          </div>
        </div>
        <div className={s.actions}>
          {onBack && <Button variant="bare" onClick={onBack}>Back</Button>}
          {onDownloadPdf && (
            <Button variant="icon" onClick={onDownloadPdf} title="Download PDF">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </Button>
          )}
        </div>
      </div>

      {/* Executive Summary */}
      {content.executiveSummary && (
        <div className={s.summaryWrap}>
          <GlassCard accent padding={20}>
            <div className={s.summaryText}>{content.executiveSummary}</div>
          </GlassCard>
        </div>
      )}

      {/* Highlights */}
      {content.highlights && content.highlights.length > 0 && (
        <div className={s.highlights}>
          {content.highlights.map((h, i) => (
            <div key={i} className={s.highlight}>
              <span className={s.highlightIcon}>{HIGHLIGHT_ICONS[h.type] || '\u2022'}</span>
              <Badge color={HIGHLIGHT_COLORS[h.type] || 'purple'}>
                {h.type.toUpperCase()}
              </Badge>
              <span className={s.highlightText}>{h.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Sections */}
      {content.sections && content.sections.map((section) => (
        <div key={section.id} className={s.section}>
          <h3 className={s.sectionTitle}>
            <span>{SECTION_ICONS[section.id] || '\u{1F4CB}'}</span>
            {section.title}
          </h3>

          {/* Inline metrics */}
          {section.metrics && (
            <div className={s.sectionMetrics}>
              {Object.entries(section.metrics)
                .filter(([_, v]) => v !== null && v !== undefined)
                .map(([key, value]) => {
                  const words = reportMetricWords(key, value, currency);
                  return (
                    <div key={key} className={s.metric}>
                      <span className={s.metricLabel}>{words.label}</span>
                      <span className={s.metricValue}>{words.value}</span>
                    </div>
                  );
                })}
            </div>
          )}

          {/* Section chart (if available) */}
          {content.charts && content.charts[SECTION_CHART_MAP[section.id]] && (
            <div style={{ margin: '12px 0' }}>
              <Chart
                type={content.charts[SECTION_CHART_MAP[section.id]].type}
                data={content.charts[SECTION_CHART_MAP[section.id]].data}
                title={content.charts[SECTION_CHART_MAP[section.id]].title}
                options={content.charts[SECTION_CHART_MAP[section.id]].options}
              />
            </div>
          )}

          {/* Section content */}
          {section.content && (
            <div className={s.sectionContent}>{section.content}</div>
          )}
        </div>
      ))}

      {/* Standalone charts (traffic sources, devices) */}
      {content.charts && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {content.charts.traffic_sources && (
            <div style={{ flex: '1 1 280px', minWidth: 280 }}>
              <Chart
                type={content.charts.traffic_sources.type}
                data={content.charts.traffic_sources.data}
                title={content.charts.traffic_sources.title}
                options={content.charts.traffic_sources.options}
              />
            </div>
          )}
          {content.charts.devices && (
            <div style={{ flex: '1 1 280px', minWidth: 280 }}>
              <Chart
                type={content.charts.devices.type}
                data={content.charts.devices.data}
                title={content.charts.devices.title}
                options={content.charts.devices.options}
              />
            </div>
          )}
        </div>
      )}

      {/* Recommendations */}
      {content.recommendations && content.recommendations.length > 0 && (
        <div>
          <h3 className={s.sectionTitle}>{'\u{1F3AF}'} Recommendations</h3>
          <div className={s.recommendations}>
            {content.recommendations.map((rec, i) => (
              <div key={i} className={s.recommendation}>
                <Badge color={PRIORITY_COLORS[rec.priority] || 'blue'}>
                  {(rec.priority || 'medium').toUpperCase()}
                </Badge>
                <span className={s.recText}>{rec.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
