/**
 * New task, at the top of Your team > Plan, in both apps (2026-10-16): the
 * plugin's Tasks page had it, the dashboard's Plan tab had no way to add a
 * task (the same button on both now).
 *
 * The owner writes the task in their own words, with when it should run
 * ("publish a blog post every Monday at 9am"); the API reads it
 * (POST /scheduled-tasks/parse, AI work on the account's pool); the card
 * says back what it understood, the task and when, in words; the owner
 * creates it or changes it (their words come back in the box), and only
 * then is it made (POST /scheduled-tasks), for this business.
 *
 * The type choice says whether the team should tell (Auto-detect) or the
 * owner says it: the kit's icons beside each (sparkles, arrow-path,
 * calendar), never emojis. The box is the kit's ChatInput, with its own test
 * ids (new-task-input, new-task-send).
 */
import React, { useEffect, useState } from 'react';
import { Button, Card, ChatInput, NavIcon, type NavIconName } from '@yotako/webmaven-ui';
import { errorMessage } from '@yotako/wpmaven-onboarding/shared';
import type { ScreensHost } from '../host/types';
import { NEW_TASK_COPY, scheduleText, type NewTaskType, type ParsedTask } from './tasks';
import { createTask, parseNewTask } from './reads';

const TYPES: ReadonlyArray<{ key: NewTaskType; icon: NavIconName }> = [
  { key: 'auto', icon: 'sparkles' },
  { key: 'recurring', icon: 'arrow-path' },
  { key: 'one_shot', icon: 'calendar' },
];

/** The browser's time zone, the one the owner's "9am" is said in. */
function ownTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const label: React.CSSProperties = {
  margin: 0, fontSize: 'var(--text-label, 11px)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600,
};

export interface NewTaskCardProps {
  host: ScreensHost;
  /** The business the task is for (a site's own, or the one on screen). */
  instanceId: string;
  /** Made: the card closes and the plan is read again. */
  onCreated: (parsed: ParsedTask) => void;
  onCancel: () => void;
}

export const NewTaskCard: React.FC<NewTaskCardProps> = ({ host, instanceId, onCreated, onCancel }) => {
  const errorText = host.errorText ?? errorMessage;
  const [type, setType] = useState<NewTaskType>('auto');
  const [step, setStep] = useState<'write' | 'reading' | 'confirm' | 'creating'>('write');
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [parsed, setParsed] = useState<ParsedTask | null>(null);
  // Bumped to give the owner's words back to the box ("Change it", a failure).
  const [seedToken, setSeedToken] = useState(0);
  const busy = step === 'reading' || step === 'creating';

  // Esc closes the card, unless something is being sent.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const backToWords = (problem: string | null) => {
    setError(problem);
    setParsed(null);
    setStep('write');
    setSeedToken((n) => n + 1);
  };

  const read = async (message: string) => {
    const words = message.trim();
    if (!words || busy) return;
    setSaid(words);
    setError(null);
    setStep('reading');
    try {
      const found = await parseNewTask(host.transport, instanceId, words, type, ownTimeZone());
      if (!found) {
        backToWords(NEW_TASK_COPY.noSchedule);
        return;
      }
      host.track?.('tasks', 'new_task_read', type);
      setParsed(found);
      setStep('confirm');
    } catch (e) {
      backToWords(errorText(e, NEW_TASK_COPY.parseFailed));
    }
  };

  const create = async () => {
    if (!parsed || busy) return;
    setError(null);
    setStep('creating');
    try {
      await createTask(host.transport, host.scope, instanceId, parsed);
      host.track?.('tasks', 'action', 'task_created');
      onCreated(parsed);
    } catch (e) {
      setError(errorText(e, NEW_TASK_COPY.createFailed));
      setStep('confirm');
    }
  };

  return (
    <div data-testid="new-task-card">
      <Card padding="md">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <p style={label}>{NEW_TASK_COPY.title}</p>
          <Button variant="bare" aria-label={NEW_TASK_COPY.close} title={NEW_TASK_COPY.close} onClick={onCancel} disabled={busy} data-testid="new-task-close">
            <NavIcon name="x-mark" size={14} strokeWidth={2.5} />
          </Button>
        </div>

        {(step === 'write' || step === 'reading') && (
          <>
            {/* The type: a row of three, the chosen one filled (the design system's rectangles). */}
            <div
              role="radiogroup"
              aria-label={NEW_TASK_COPY.typeLabel}
              style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 2, background: 'var(--bg)', borderRadius: 10, padding: 2, marginBottom: 12 }}
            >
              {TYPES.map((t) => {
                const on = type === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-testid={`new-task-type-${t.key}`}
                    onClick={() => setType(t.key)}
                    disabled={busy}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0,
                      padding: '4px 12px', borderRadius: 8, border: 'none',
                      background: on ? 'color-mix(in srgb, var(--purple) 12%, transparent)' : 'transparent',
                      color: on ? 'var(--purple)' : 'var(--text-dim)',
                      fontSize: 12, fontWeight: on ? 600 : 500, fontFamily: 'inherit', lineHeight: 1.4,
                      cursor: busy ? 'not-allowed' : 'pointer',
                      transition: 'background 0.15s ease, color 0.15s ease',
                    }}
                  >
                    <NavIcon name={t.icon} size={14} />
                    {NEW_TASK_COPY.types[t.key]}
                  </button>
                );
              })}
            </div>

            <ChatInput
              placeholder={NEW_TASK_COPY.placeholders[type]}
              textareaAriaLabel={NEW_TASK_COPY.title}
              onSend={(m) => void read(m)}
              disabled={busy}
              seedText={said}
              seedToken={seedToken}
              inputTestId="new-task-input"
              sendTestId="new-task-send"
            />
            {step === 'reading' && (
              <p role="status" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-dim)' }}>{NEW_TASK_COPY.reading}</p>
            )}
          </>
        )}

        {(step === 'confirm' || step === 'creating') && parsed && (
          <div data-testid="new-task-confirm">
            <p style={{ margin: 0, fontSize: 'var(--text-data, 13.5px)', color: 'var(--text-dim)' }}>{NEW_TASK_COPY.confirmLead}</p>
            <dl style={{ margin: '8px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 12, rowGap: 4 }}>
              <dt style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>{NEW_TASK_COPY.what}</dt>
              <dd style={{ margin: 0, fontSize: 14, color: 'var(--text)', overflowWrap: 'anywhere' }} data-testid="new-task-what">{parsed.prompt}</dd>
              <dt style={{ margin: 0, fontSize: 12, color: 'var(--text-dim)' }}>{NEW_TASK_COPY.when}</dt>
              <dd style={{ margin: 0, fontSize: 14, color: 'var(--text)' }} data-testid="new-task-when">
                {scheduleText(parsed)}
                <span style={{ color: 'var(--text-dim)' }}>{` (${NEW_TASK_COPY.kind[parsed.type]})`}</span>
              </dd>
            </dl>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <Button size="sm" variant="primary" isLoading={step === 'creating'} disabled={step === 'creating'} onClick={() => void create()} data-testid="new-task-create">
                {NEW_TASK_COPY.create}
              </Button>
              <Button size="sm" variant="ghost" disabled={step === 'creating'} onClick={() => backToWords(null)} data-testid="new-task-change">
                {NEW_TASK_COPY.change}
              </Button>
            </div>
            {step === 'creating' && (
              <p role="status" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-dim)' }}>{NEW_TASK_COPY.creating}</p>
            )}
          </div>
        )}

        {error && (
          <p
            role="alert"
            data-testid="new-task-error"
            style={{
              margin: '8px 0 0', padding: '8px 12px', borderRadius: 8,
              background: 'color-mix(in srgb, var(--rose) 12%, transparent)', color: 'var(--rose)', fontSize: 13,
            }}
          >
            {error}
          </p>
        )}
      </Card>
    </div>
  );
};

export default NewTaskCard;
