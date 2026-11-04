import React from 'react';

/** Status of a tool call as it appears in the timeline. */
export type ToolCallStatus = 'running' | 'completed' | 'error' | 'cancelled';

/** Normalized tool call entry consumed by AgentTimeline + tool widgets. */
export interface ToolCallEntry {
  /** Stable id from the runtime — matches the SSE callId. */
  callId: string;
  /** Tool name as registered in the catalog (e.g. "install_plugin"). */
  name: string;
  /** Pre-rendered summary line emitted with tool_call_start. */
  summary?: string;
  /** Render component key from the tool's uiSpec.resultComponent — drives lookup. */
  resultComponent?: string;
  /** Whether this widget should start collapsed in the timeline. */
  collapseByDefault?: boolean;
  status: ToolCallStatus;
  /** Tool params (the agent's chosen arguments). */
  params?: Record<string, any>;
  /** Tool result payload — opaque, each widget knows its own shape. */
  result?: any;
  /** Error text when status === 'error'. */
  error?: string;
  /** Wall-clock duration when complete. */
  durationMs?: number;
  /** The API operator id of the member who ran this step; the row then shows
   *  their face (working, done, failed) instead of the status dot. */
  operator?: string;
  /** That member's title, from the same payload. */
  operatorTitle?: string;
}

/**
 * Props every tool result widget receives. Keeps the registry uniform
 * — a renderer is just a React.FC<ToolRenderProps>.
 */
export interface ToolRenderProps {
  call: ToolCallEntry;
}

export type ToolRenderer = React.FC<ToolRenderProps>;

/**
 * Map from `uiSpec.resultComponent` key to a React renderer. Each
 * frontend can override defaults with its own components (e.g. an
 * editor-specific "Apply to selection" version of an image grid).
 */
export type ToolRendererMap = Record<string, ToolRenderer>;
