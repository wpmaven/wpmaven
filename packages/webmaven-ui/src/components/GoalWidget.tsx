import React from 'react';
import s from './GoalWidget.module.css';

export interface GoalData {
  id: string;
  name: string;
  currentCount: number;
  targetCount: number | null;
  progress: number | null; // 0-100
  periodType: string | null;
  periodLabel: string;
}

export interface GoalWidgetProps {
  goals: GoalData[];
  /**
   * The empty state's prompt was activated (click, Enter or Space): the host
   * opens its own "new goal" form. Wins over onPromptClick when both are given.
   */
  onCreateGoal?: () => void;
  /** The older name of onCreateGoal, kept so hosts written for 0.2.4 keep working. */
  onPromptClick?: () => void;
}

function getProgressColor(progress: number | null, periodLabel: string): string {
  if (progress === null) return s.green;
  if (progress >= 75) return s.green;
  // Check if behind pace
  if (periodLabel.includes('left')) {
    const match = periodLabel.match(/(\d+)/);
    if (match) {
      const remaining = parseInt(match[1]);
      const total = periodLabel.includes('today') ? 24 : periodLabel.includes('week') ? 7 : 30;
      const elapsed = total - remaining;
      const expectedProgress = (elapsed / total) * 100;
      if (progress < expectedProgress * 0.7) return s.red;
      if (progress < expectedProgress * 0.9) return s.amber;
    }
  }
  if (progress >= 50) return s.amber;
  return s.red;
}

export const GoalWidget: React.FC<GoalWidgetProps> = ({ goals, onCreateGoal, onPromptClick }) => {
  // Empty state: a prompt that opens the host's own goal form. With no
  // handler it is plain text, never a button that does nothing.
  if (goals.length === 0) {
    const onActivate = onCreateGoal ?? onPromptClick;
    const interactive = typeof onActivate === 'function';
    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!onActivate) return;
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        // Space would also scroll the page.
        event.preventDefault();
        onActivate();
      }
    };
    return (
      <div
        className={interactive ? s.prompt : `${s.prompt} ${s.promptStatic}`}
        {...(interactive ? { onClick: onActivate, onKeyDown, role: 'button', tabIndex: 0 } : {})}
      >
        <span className={s.promptIcon} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
          </svg>
        </span>
        <div className={s.promptText}>
          Set a goal to track, for example <span className={s.promptExample}>"100 sales this month"</span>.
        </div>
      </div>
    );
  }

  return (
    <div className={s.container}>
      {goals.map(goal => (
        <div key={goal.id} className={s.goal}>
          <div className={s.goalHeader}>
            <span className={s.goalName}>{goal.name}</span>
            <span className={s.goalCount}>
              {goal.currentCount.toLocaleString()}
              {goal.targetCount && (
                <> / <span className={s.goalTarget}>{goal.targetCount.toLocaleString()}</span></>
              )}
            </span>
          </div>

          {goal.progress !== null && (
            <div className={s.progressBar}>
              <div
                className={`${s.progressFill} ${getProgressColor(goal.progress, goal.periodLabel)}`}
                style={{ width: `${goal.progress}%` }}
              />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className={s.periodLabel}>{goal.periodLabel}</span>
            {goal.progress !== null && (
              <span className={s.periodLabel}>{goal.progress}%</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
