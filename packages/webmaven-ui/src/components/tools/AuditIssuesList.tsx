import React, { useState } from 'react';
import { ToolRenderProps } from './types';
import { Badge, BadgeColor } from '../Badge';

/**
 * Renders audit results from seo_optimizer, accessibility, performance,
 * security, code_quality. Each tool returns a list of issues with a
 * severity / priority. Common shape we look for:
 *   { issues: [{ title, severity, description, recommendation, ... }] }
 */
export const AuditIssuesList: React.FC<ToolRenderProps> = ({ call }) => {
  const [open, setOpen] = useState(false);
  const data = unwrap(call.result);
  const issues: any[] = collectIssues(data);
  const score = data?.score ?? data?.overallScore;

  if (issues.length === 0) {
    return <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>No issues found.</span>;
  }

  const visible = open ? issues : issues.slice(0, 3);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {score !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>
            Score: {score}/100
          </span>
        </div>
      )}
      {visible.map((issue, i) => (
        <IssueRow key={i} issue={issue} />
      ))}
      {issues.length > 3 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'inherit',
            alignSelf: 'flex-start',
          }}
        >
          {open ? '▾ Show fewer' : `▸ Show ${issues.length - 3} more`}
        </button>
      )}
    </div>
  );
};

function IssueRow({ issue }: { issue: any }) {
  const sev = (issue?.severity || issue?.priority || 'medium').toLowerCase();
  const color: BadgeColor = sev === 'critical' || sev === 'high'
    ? 'rose'
    : sev === 'medium'
      ? 'peach'
      : 'cyan';
  const title = issue?.title || issue?.message || issue?.text || 'Issue';
  const desc = issue?.description || issue?.recommendation || '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Badge color={color}>{sev}</Badge>
        <span style={{ color: 'var(--text)', fontSize: 13 }}>{title}</span>
      </div>
      {desc && (
        <span style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.5, paddingLeft: 4 }}>
          {trim(desc, 220)}
        </span>
      )}
    </div>
  );
}

function unwrap(result: any): any {
  if (!result) return null;
  if (typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

function collectIssues(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data?.issues)) return data.issues;
  if (Array.isArray(data?.problems)) return data.problems;
  if (Array.isArray(data?.findings)) return data.findings;
  if (Array.isArray(data?.recommendations)) return data.recommendations;
  if (Array.isArray(data)) return data;
  return [];
}

function trim(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
