/**
 * The call behind an approval, for the owner who wants to check exactly what
 * runs: the database statement, the REST call's address and body, the
 * setting's name and value, the command. Closed by default, and the only
 * place any of it appears: the sentence the owner reads says what changes in
 * words (the API's ownerApprovalPolicy), never the code.
 *
 * As labelled lines, never JSON, and never the internal data a call carries
 * (2026-10-16): no id or reference the owner does not know (an instanceId, a
 * conversationId), no token, key or secret. A call whose only parameter is
 * internal has no Action details at all (actionDetailLines, previewData).
 * The same lines in both apps, the plugin's included.
 *
 * Shown whenever the preview does not already show what the call puts out
 * (showsActionDetails): a page is its words, a post is its text.
 *
 * Open from the start on a change approved on its card only (approveOnCard):
 * its plain words cannot say all it does, so the card shows the
 * statement itself before the yes.
 */

import React from 'react';
import type { OperatorApproval } from './types';
import {
  actionDetailLines, carriesEditPreview, showsActionDetails, type ActionDetailLine, type EditMatcher,
} from './previewData';
import { CARD_RADIUS, TYPE, small } from './styles';
import { useOptionalScreensHost } from '../host/HostContext';

export interface ActionDetailsProps {
  approval: Pick<OperatorApproval, 'params'> & Partial<Pick<OperatorApproval, 'toolName' | 'approveOnCard' | 'edit'>>;
  /** Which rows the app's edit preview draws (their call is never shown). Default: the host's, else carriesEditPreview. */
  isEdit?: EditMatcher;
  className?: string;
  style?: React.CSSProperties;
}

/** The lines as a list of names and values; an object's lines indented under its name. */
const DetailLines: React.FC<{ lines: ActionDetailLine[]; nested?: boolean }> = ({ lines, nested = false }) => (
  <dl
    style={nested
      ? { margin: '4px 0 0', paddingLeft: 12, borderLeft: '1px solid var(--glass-border)' }
      : { margin: 0 }}
  >
    {lines.map((line, i) => (
      <div key={`${line.label}-${i}`} style={{ minWidth: 0, marginTop: i === 0 ? 0 : nested ? 4 : 6 }}>
        <dt style={{ fontWeight: 550, color: 'var(--text-dim)' }}>{line.label}</dt>
        <dd
          style={{
            margin: 0, minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
            ...(line.code ? { fontFamily: TYPE.mono } : {}),
          }}
          data-code={line.code ? '' : undefined}
        >
          {typeof line.value === 'string' ? line.value : <DetailLines lines={line.value} nested />}
        </dd>
      </div>
    ))}
  </dl>
);

export const ActionDetails: React.FC<ActionDetailsProps> = ({ approval, isEdit, className, style }) => {
  const host = useOptionalScreensHost();
  const matcher = isEdit ?? host?.renderers?.editPreview?.matches ?? carriesEditPreview;
  if (!showsActionDetails(approval, matcher)) return null;
  const lines = actionDetailLines(approval.params);
  const open = approval.approveOnCard === true;
  return (
    <details
      className={className}
      style={{ ...small, ...(open ? {} : { opacity: 0.7 }), ...style }}
      data-testid="action-details"
      open={open || undefined}
    >
      <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Action details</summary>
      <div
        style={{
          marginTop: 8, maxHeight: 192, overflow: 'auto', boxSizing: 'border-box',
          borderRadius: CARD_RADIUS, background: 'var(--bg)', padding: 12, color: 'var(--text)',
        }}
      >
        <DetailLines lines={lines} />
      </div>
    </details>
  );
};

export default ActionDetails;
