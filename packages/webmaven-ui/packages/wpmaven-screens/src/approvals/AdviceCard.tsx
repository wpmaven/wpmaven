/**
 * An advice item's card (./advice), drawn by ApprovalCard for a row of kind
 * 'advice' in both apps and on both of the dashboard's surfaces: who on the
 * team found it, its title, what to do, the numbered steps in WordPress, the
 * one quiet line that says what would let the team do it, and "Done" or
 * "Not for me". Nothing on it changes the site: no preview, no Action
 * details, no approve of a change. The line about WPMaven Agent and a plan
 * is said here, once per item, and nowhere else on the page.
 */
import React from 'react';
import { Badge, Button, Card, OperatorAvatar, OPERATOR_AVATAR_SIZES, operatorTitle } from '@yotako/webmaven-ui';
import { WhyDisabled } from '@yotako/wpmaven-onboarding/shared';
import type { OperatorApproval } from './types';
import type { ApprovalCardStatus } from './ApprovalCard';
import { ADVICE_COPY, adviceOf, adviceQuietLine } from './advice';
import { approvalByTitle } from './words';
import { TYPE } from './styles';

export interface AdviceCardProps {
  approval: OperatorApproval;
  businessName?: string | null;
  tourAnchor?: boolean;
  deciding: boolean;
  /** No decision here: the API's sentence for a person who may not decide it (a site's view). */
  ownerOnlyText?: string | null;
  onDone: () => void;
  onNotForMe: () => void;
  status?: ApprovalCardStatus | null;
  when?: React.ReactNode;
  confirmation?: React.ReactNode;
  extra?: React.ReactNode;
  decideBlock?: string | null;
  decideError?: string | null;
  frame?: 'card' | 'none';
  heading?: string | null;
  decisionRow?: (buttons: React.ReactNode) => React.ReactNode;
}

export const AdviceCard: React.FC<AdviceCardProps> = ({
  approval: a, businessName = null, tourAnchor = false, deciding, ownerOnlyText = null, onDone, onNotForMe,
  status = null, when, confirmation, extra, decideBlock = null, decideError = null, frame = 'card', heading = null, decisionRow,
}) => {
  const advice = adviceOf(a)!;
  const pending = a.status === 'PENDING';
  const by = approvalByTitle(a, operatorTitle);
  const quiet = adviceQuietLine(advice.reason);
  const whyId = `wadvice-why-${a.id}`;
  const showDecision = pending && !ownerOnlyText;

  const buttons = (
    <>
      <Button
        size="sm"
        variant="primary"
        data-testid="advice-done"
        disabled={deciding || !!decideBlock}
        aria-disabled={deciding || !!decideBlock}
        aria-describedby={decideBlock ? whyId : undefined}
        onClick={onDone}
      >
        {deciding ? 'Working…' : ADVICE_COPY.done}
      </Button>
      <Button
        size="sm"
        variant="outline"
        data-testid="advice-not-for-me"
        disabled={deciding || !!decideBlock}
        aria-disabled={deciding || !!decideBlock}
        aria-describedby={decideBlock ? whyId : undefined}
        onClick={onNotForMe}
      >
        {ADVICE_COPY.notForMe}
      </Button>
      <WhyDisabled id={whyId} reason={deciding ? null : decideBlock} />
    </>
  );

  const body = (
    <div data-testid="waiting-item" data-approval-id={a.id} data-kind="advice" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {frame === 'card' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span data-testid="waiting-by" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-dim)', minWidth: 0 }}>
            <OperatorAvatar id={a.operatorId} title={by} presence={pending ? 'waiting' : 'still'} size={OPERATOR_AVATAR_SIZES.card} decorative />
            <span>Your {by}</span>
            {businessName && (
              <span data-testid="waiting-business" style={{ overflowWrap: 'anywhere' }}>
                <span aria-hidden="true">{'· '}</span>{businessName}
              </span>
            )}
          </span>
          {(status || when) && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {status && <Badge color={status.color}>{status.label}</Badge>}
              {when && <span style={{ fontSize: TYPE.meta, opacity: 0.6 }}>{when}</span>}
            </span>
          )}
        </div>
      )}
      {confirmation}
      {frame === 'card' && (
        <span data-testid="advice-title" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflowWrap: 'anywhere' }}>
          {heading || advice.title}
        </span>
      )}
      {advice.summary && (
        <p data-testid="advice-summary" style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text)', overflowWrap: 'anywhere' }}>
          {advice.summary}
        </p>
      )}
      {advice.steps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>{ADVICE_COPY.stepsLabel}</span>
          <ol data-testid="advice-steps" style={{ margin: 0, paddingInlineStart: 20, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, lineHeight: 1.5, color: 'var(--text)' }}>
            {advice.steps.map((step, i) => (
              <li key={i} style={{ margin: 0, overflowWrap: 'anywhere' }}>{step}</li>
            ))}
          </ol>
        </div>
      )}
      {quiet && (
        <p data-testid="advice-quiet" style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>{quiet}</p>
      )}
      {extra}
      {pending && ownerOnlyText && (
        <p data-testid="waiting-owner-only" role="note" style={{ margin: 0, fontSize: 13, color: 'var(--text)' }}>{ownerOnlyText}</p>
      )}
      {showDecision && (decisionRow ? decisionRow(buttons) : (
        <div
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
          data-tour={tourAnchor ? 'waiting-decide' : undefined}
        >
          {buttons}
        </div>
      ))}
      {decideError && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger)', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>{decideError}</p>
      )}
    </div>
  );

  return frame === 'card' ? <Card padding="md">{body}</Card> : body;
};

export default AdviceCard;
