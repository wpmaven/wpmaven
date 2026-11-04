import React from 'react';
import type { ReactElement, ReactNode } from 'react';
import { CheckIcon, ErrorIcon } from '../icons';
import { Button } from './Button';
import { LogoAnimation } from './LogoAnimation';
import { OperatorAvatar, OPERATOR_AVATAR_SIZES, type OperatorPresence } from './operator';
import s from './PipelineMessage.module.css';

export interface PipelineStep {
  key: string;
  label: string;
  status?: 'pending' | 'executing' | 'completed' | 'failed' | 'requires_approval';
  error?: string;
  subSteps?: Array<{ key: string; label: string; status?: string }>;
  /** Who on the team does this step: their face, with the step's state on it, in place of the dot. */
  operator?: { id: string; title?: string };
}

export interface PipelineMessageProps {
  title?: string;
  description?: string;
  steps: PipelineStep[];
  activeStep: number;
  totalSteps?: number;
  useStepStatus?: boolean;
  onApprove?: (stepKey: string) => void;
  onReject?: (stepKey: string) => void;
  className?: string;
  /**
   * What heads the card in place of the product's animated mark: the face of
   * whoever leads the work (the mark stays the product's, never a spinner for
   * the team's work).
   */
  lead?: ReactNode;
  /** The title once every step is done (default "Complete"). */
  doneTitle?: string;
  /** The line under it once every step is done (default "All steps finished"). */
  doneDescription?: string;
}

const STEP_PRESENCE: Record<'done' | 'active' | 'approval' | 'failed' | 'pending', OperatorPresence> = {
  done: 'done',
  active: 'working',
  approval: 'waiting',
  failed: 'failed',
  pending: 'queued',
};

export const PipelineMessage = ({
  title = 'Working...',
  description,
  steps,
  activeStep,
  totalSteps,
  useStepStatus = false,
  onApprove,
  onReject,
  className = '',
  lead,
  doneTitle = 'Complete',
  doneDescription = 'All steps finished',
}: PipelineMessageProps): ReactElement => {
  const total = totalSteps || steps.length;
  const completedCount = useStepStatus
    ? steps.filter(st => st.status === 'completed').length
    : activeStep;
  const allDone = completedCount >= total && total > 0;
  const progress = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  const activeLabel = useStepStatus
    ? steps.find(st => st.status === 'executing')?.label || description
    : (!allDone && activeStep >= 0 && activeStep < steps.length ? steps[activeStep].label : description);

  function getStepState(step: PipelineStep, i: number): 'done' | 'active' | 'approval' | 'failed' | 'pending' {
    if (useStepStatus) {
      switch (step.status) {
        case 'completed': return 'done';
        case 'executing': return 'active';
        case 'requires_approval': return 'approval';
        case 'failed': return 'failed';
        default: return 'pending';
      }
    }
    if (i < activeStep) return 'done';
    if (i === activeStep) return 'active';
    return 'pending';
  }

  return (
    <div className={`${s.container} ${className}`}>
      <div className={s.top}>
        <div className={s.headerRow}>
          <div className={s.headerAnimation}>
            {lead ?? <LogoAnimation state={allDone ? 'idle' : 'working'} size={46} />}
          </div>
          <div className={s.headerText}>
            <span className={`${s.title} ${allDone ? s.titleDone : ''}`}>
              {allDone ? doneTitle : title}
            </span>
            <span className={s.description}>
              {allDone ? doneDescription : activeLabel || description}
            </span>
          </div>
        </div>

        <div className={s.progressSection}>
          <span className={s.progressCount}>{completedCount}/{total}</span>
          <div className={s.progressTrack}>
            <div
              className={s.progressFill}
              style={{
                width: `${progress}%`,
                '--progress-total': progress > 0 ? `${(100 / progress) * 100}%` : '100%',
              } as React.CSSProperties}
            />
          </div>
        </div>
      </div>

      <div className={s.separator} />

      <div className={s.steps}>
        {steps.map((step, i) => {
          const state = getStepState(step, i);
          const face = step.operator ? (
            <OperatorAvatar
              id={step.operator.id}
              title={step.operator.title}
              presence={STEP_PRESENCE[state]}
              size={OPERATOR_AVATAR_SIZES.row}
            />
          ) : null;

          if (state === 'done') {
            return (
              <div key={step.key} className={`${s.step} ${s.stepDone}`}>
                {face ?? <span className={s.icon}><CheckIcon size={14} /></span>}
                <span>{step.label}</span>
                <span className={s.doneTag}>done</span>
              </div>
            );
          }

          if (state === 'active') {
            return (
              <div key={step.key} className={`${s.step} ${s.stepActive}`}>
                {face ?? <div className={s.stepSpinner} />}
                <span>{step.label}</span>
                <span className={s.activeTag}>working</span>
              </div>
            );
          }

          if (state === 'approval') {
            return (
              <div key={step.key} className={`${s.step} ${s.stepApproval}`} data-step-key={step.key}>
                {face ?? <div className={s.approvalDot} />}
                <div className={s.approvalContent}>
                  <span>{step.label}</span>
                  <div className={s.approvalActions}>
                    {onReject && (
                      <Button variant="ghost" data-testid="pipeline-decline" onClick={() => onReject(step.key)}
                        style={{ fontSize: 11, padding: '4px 12px' }}>
                        Reject
                      </Button>
                    )}
                    {onApprove && (
                      <Button variant="primary" data-testid="pipeline-approve" onClick={() => onApprove(step.key)}
                        style={{ fontSize: 11, padding: '4px 12px' }}>
                        Approve
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          if (state === 'failed') {
            return (
              <div key={step.key} className={`${s.step} ${s.stepFailed}`}>
                {face ?? <span className={s.icon}><ErrorIcon size={14} /></span>}
                <div className={s.failedContent}>
                  <span>{step.label}</span>
                  {step.error && <span className={s.errorText}>{step.error}</span>}
                </div>
                <span className={s.failedTag}>failed</span>
              </div>
            );
          }

          return (
            <div key={step.key} className={`${s.step} ${s.stepPending}`}>
              {face ?? <div className={s.pendingDot} />}
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
