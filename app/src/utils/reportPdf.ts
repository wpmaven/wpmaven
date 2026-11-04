import { ProxyError } from '../services/proxyClient';

function wpData(): any {
  return (typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA : null) || {};
}

/** The PDF of a report, through the plugin's own route (a file, not JSON); a refusal throws a ProxyError. */
export async function downloadReportPdf(reportId: string): Promise<void> {
  const wp = wpData();
  const res = await fetch(`${wp.restUrl || '/wp-json/webmaven_wp/v1'}/reports/${encodeURIComponent(reportId)}/pdf`, {
    headers: { 'X-WP-Nonce': wp.nonce || '' },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ProxyError(body?.error || `HTTP ${res.status}`, res.status, `reports/${reportId}/pdf`, body?.code ?? null);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report-${reportId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
