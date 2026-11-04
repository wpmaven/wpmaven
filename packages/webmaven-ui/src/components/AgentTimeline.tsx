import React from 'react';
import { GlassCard } from './GlassCard';
import {
  ToolCallEntry,
  ToolRendererMap,
  ToolRenderProps,
} from './tools/types';
import { defaultToolRenderers, JsonFallback } from './tools/registry';
import { OperatorAvatar, type OperatorPresence } from './operator';

export interface AgentTimelineProps {
  /** Ordered list of tool calls in this agent run. Each entry's
   *  status drives the row's visual state. */
  calls: ToolCallEntry[];
  /** Per-tool renderer overrides — frontend-specific widgets live here
   *  (e.g. an editor's "Apply to selection" image grid). */
  overrides?: ToolRendererMap;
  /** Show a header row above the list. */
  title?: string;
  /** When true, the list shrinks each row down to summary-only. Useful
   *  for scheduled-task UIs where users don't need full result widgets. */
  compact?: boolean;
}

/**
 * Renders the live timeline of tool calls produced by an agent run.
 * Drop into a chat / editor / dashboard to give users visibility into
 * what the agent is doing and what each step produced.
 */
export const AgentTimeline: React.FC<AgentTimelineProps> = ({
  calls,
  overrides,
  title,
  compact,
}) => {
  if (calls.length === 0) return null;
  const renderers: ToolRendererMap = { ...defaultToolRenderers, ...(overrides || {}) };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {title && (
        <span
          style={{
            color: 'var(--text-dim)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            fontWeight: 600,
          }}
        >
          {title}
        </span>
      )}
      {calls.map((call) => (
        <TimelineRow
          key={call.callId}
          call={call}
          renderer={pickRenderer(renderers, call)}
          compact={compact}
        />
      ))}
    </div>
  );
};

function pickRenderer(
  renderers: ToolRendererMap,
  call: ToolCallEntry,
): React.FC<ToolRenderProps> {
  if (call.resultComponent && renderers[call.resultComponent]) {
    return renderers[call.resultComponent];
  }
  // Some backends pass the raw tool name as a renderer key for
  // convenience — try that too before falling back.
  if (renderers[call.name]) return renderers[call.name];
  return JsonFallback;
}

interface RowProps {
  call: ToolCallEntry;
  renderer: React.FC<ToolRenderProps>;
  compact?: boolean;
}

function TimelineRow({ call, renderer: Renderer, compact }: RowProps) {
  const dotColor =
    call.status === 'completed' ? 'var(--lime)' :
    call.status === 'error' ? 'var(--rose)' :
    call.status === 'cancelled' ? 'var(--text-dim)' :
    'var(--purple)';

  // Detail lines start under the summary, past the dot or the face.
  const indent = call.operator ? 30 : 18;

  return (
    <GlassCard padding="10px 12px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {call.operator ? (
            <OperatorAvatar
              id={call.operator}
              title={call.operatorTitle}
              presence={presenceForStatus(call.status)}
              size={20}
            />
          ) : (
            <span
              aria-hidden="true"
              className={call.status === 'running' ? 'wm-agent-pulse' : undefined}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: dotColor,
                flexShrink: 0,
              }}
            />
          )}
          <style>{`
            @keyframes wmAgentPulse {
              0%   { opacity: 1; transform: scale(1); }
              50%  { opacity: 0.4; transform: scale(0.8); }
              100% { opacity: 1; transform: scale(1); }
            }
            .wm-agent-pulse {
              animation: wmAgentPulse 1.2s ease-in-out infinite;
            }
            @media (prefers-reduced-motion: reduce) {
              .wm-agent-pulse { animation: none; }
            }
          `}</style>
          <span style={{ flex: 1, color: 'var(--text)', fontSize: 13 }}>
            {call.summary || call.name}
          </span>
          {call.durationMs != null && (
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
              {fmtDuration(call.durationMs)}
            </span>
          )}
        </div>

        {call.error && (
          <div style={{ color: 'var(--rose)', fontSize: 12, paddingLeft: indent }}>
            {call.error}
          </div>
        )}

        {!compact && call.status === 'completed' && !call.error && (
          <div style={{ paddingLeft: indent }}>
            <Renderer call={call} />
          </div>
        )}
      </div>
    </GlassCard>
  );
}

/** A step's status worn on the face of the member who ran it. */
function presenceForStatus(status: ToolCallEntry['status']): OperatorPresence {
  if (status === 'running') return 'working';
  if (status === 'completed') return 'done';
  if (status === 'error') return 'failed';
  return 'still';
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
