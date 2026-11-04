import React from 'react';
import { ToolRenderProps } from './types';
import { Badge } from '../Badge';

/**
 * Minimal status renderer for tools where the result is essentially a
 * "did it succeed?" — update_option, set_homepage, navigate_admin, etc.
 *
 * Renamed from StatusBadge to StatusLine to avoid clashing with the
 * existing HealthBadge / StatusBadge naming used for site health.
 */
export const StatusLine: React.FC<ToolRenderProps> = ({ call }) => {
  const data = unwrap(call.result);
  const ok = call.status === 'completed' && (data?.success !== false);
  const detail =
    pickDetail(data) ||
    (call.params ? summariseParams(call.params) : '') ||
    (ok ? 'Done.' : 'Failed.');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <Badge color={ok ? 'cyan' : 'rose'}>{ok ? 'Done' : 'Failed'}</Badge>
      <span style={{ color: 'var(--text)' }}>{detail}</span>
    </div>
  );
};

function unwrap(result: any): any {
  if (!result) return null;
  if (typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

function pickDetail(data: any): string | null {
  if (!data) return null;
  if (typeof data === 'string') return data.slice(0, 200);
  for (const k of ['message', 'summary', 'detail', 'page_title', 'permalink']) {
    if (typeof data[k] === 'string') return data[k];
  }
  return null;
}

function summariseParams(params: Record<string, any>): string {
  const entries = Object.entries(params).slice(0, 2);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`).join(' · ');
}
