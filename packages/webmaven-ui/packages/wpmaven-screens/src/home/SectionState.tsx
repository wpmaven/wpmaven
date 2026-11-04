import React from 'react';
import { Button, GlassCard, Skeleton } from '@yotako/webmaven-ui';
import { errorMessage } from '@yotako/wpmaven-onboarding/shared';
import type { ScreensHost } from '../host/types';
import { SECTION_LABEL } from './styles';

/** A section's failure in the reader's words: the host's rule, else the shared one. */
export function sectionErrorText(host: ScreensHost, error: unknown, fallback: string): string {
  return host.errorText ? host.errorText(error, fallback) : errorMessage(error, fallback);
}

/** A refusal (the role, a switch, the plugin's version said no): the section is left out, never retried. */
export function isRefusal(error: unknown): boolean {
  const status = (error as { response?: { status?: unknown }; status?: unknown } | null)?.response?.status
    ?? (error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
}

/** A section's card while its first answer is on its way: its title and placeholder lines, at about its height. */
export const SectionLoading: React.FC<{ title: React.ReactNode; label: string; lines?: number; testId?: string }> = ({
  title, label, lines = 3, testId,
}) => (
  <GlassCard padding="20px 24px" data-testid={testId}>
    <div style={{ ...SECTION_LABEL, marginBottom: 12 }}>{title}</div>
    <div role="status" aria-label={label} aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} height={14} width={i === 0 ? '60%' : '85%'} rounded="sm" />)}
    </div>
  </GlassCard>
);

/** A section's card when its read failed: what happened, in words, and Retry. */
export const SectionProblem: React.FC<{ title: React.ReactNode; text: string; onRetry: () => void; testId?: string }> = ({
  title, text, onRetry, testId,
}) => (
  <GlassCard padding="20px 24px" data-testid={testId}>
    <div style={{ ...SECTION_LABEL, marginBottom: 12 }}>{title}</div>
    <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 'var(--text-body, 14px)', color: 'var(--text)' }}>{text}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
    </div>
  </GlassCard>
);
