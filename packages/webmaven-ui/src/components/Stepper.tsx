import React from 'react';
import { CheckIcon } from '../icons';
import s from './Stepper.module.css';

export interface StepItem {
  key: string;
  label: string;
}

export interface StepperProps {
  steps: StepItem[];
  currentStep: number;
}

export const Stepper: React.FC<StepperProps> = ({ steps, currentStep }) => (
  <div className={s.container}>
    {steps.map((step, i) => {
      const isDone = i < currentStep;
      const isActive = i === currentStep;

      return (
        <React.Fragment key={step.key}>
          <div className={s.step}>
            <div
              className={`${s.dot} ${isDone ? s.done : isActive ? s.active : s.pending}`}
            >
              {isDone ? <CheckIcon size={14} /> : i + 1}
            </div>
            <span
              className={`${s.label}${isDone ? ` ${s.labelDone}` : ''}${isActive ? ` ${s.labelActive}` : ''}`}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`${s.line}${isDone ? ` ${s.lineDone}` : ''}`} />
          )}
        </React.Fragment>
      );
    })}
  </div>
);
