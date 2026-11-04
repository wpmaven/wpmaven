import React, { useEffect, useState } from 'react';
import { Button, Toggle } from '@yotako/webmaven-ui';
import AppLoading from '../AppLoading';
import BrandMark from '../BrandMark';
import { dashboardPhrase, isWpmavenSite, siteBrand } from '../../utils/brand';
import { choicesFor, type Choice, type ChoiceKey } from '../../utils/siteChoices';

/**
 * What the site shares, asked once (utils/siteChoices): once the site is
 * connected, before WPMaven's other screens, for administrators, while a
 * choice the site offers has no answer. The setup screens' own look (the
 * first page, Manage my site) with the switches of Settings, What your site
 * shares: each one starts at what the site does now (GET /choices), so off
 * on a new site and on where WPMaven Agent keeps what a site from before the
 * choices always did; every one saved as an answer on Continue (POST
 * /choices), and changed any time in Settings. An answer from the site that
 * does not come holds nobody.
 */

export const CHOICES_QUESTION_COPY = {
  title: 'What your site shares',
  lead: 'Each of these is off until you turn it on. You can change them any time in Settings.',
  // A site that already does some of it: the switches show what it does today.
  leadCurrent: 'This is what your site does today. Turn off anything you do not want. You can change it any time in Settings.',
  save: 'Continue',
  saving: 'Saving',
  failed: 'Your answers could not be saved. Try again in a minute.',
};

type Answers = Record<ChoiceKey, boolean>;

/** A small picture for each choice, drawn like the first page's. */
const ICONS: Record<ChoiceKey, React.ReactNode> = {
  analytics_enabled: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  contact_sync_enabled: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  badge_enabled: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
};

const row: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 14, alignItems: 'center', padding: '16px 18px',
  borderRadius: 14, background: 'var(--bg-raised, #fff)', border: '1px solid var(--glass-border, #E2E4EA)', cursor: 'pointer', textAlign: 'left',
};
const icon: React.CSSProperties = {
  width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center',
  background: 'var(--bg, #F5F6F8)', border: '1px solid var(--glass-border, #E2E4EA)', color: 'var(--text)',
};

export function ChoicesQuestionView({ list, answers, lead = CHOICES_QUESTION_COPY.lead, onAnswer, saving, failed, onSave }: {
  list: Choice[];
  answers: Answers;
  lead?: string;
  onAnswer: (key: ChoiceKey, on: boolean) => void;
  saving: boolean;
  failed: string | null;
  onSave: () => void;
}) {
  return (
    // Its own scroll (WPMaven's screen in WordPress is a fixed box), centred when it fits, as the first page.
    <div style={{ height: 'var(--wm-app-height, 100vh)', overflowY: 'auto', background: 'var(--bg)' }}>
      <div
        data-testid="wm-choices-question"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%', padding: '48px 24px', boxSizing: 'border-box' }}
      >
        <div style={{ width: '100%', maxWidth: 620 }}>
          <div style={{ textAlign: 'center', marginBottom: 26 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
              <BrandMark size={36} />
            </div>
            <h1 style={{ margin: '0 0 8px', fontFamily: 'var(--font-title)', fontSize: 34, fontWeight: 400, lineHeight: 1.1, color: 'var(--text)' }}>{CHOICES_QUESTION_COPY.title}</h1>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--text-dim)' }}>{lead}</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {list.map((choice) => (
              <label key={choice.key} style={row} data-testid={`wm-choice-question-${choice.key}`}>
                <span aria-hidden style={icon}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[choice.key]}</svg>
                </span>
                <span>
                  <b style={{ display: 'block', fontSize: 14.5, color: 'var(--text)', marginBottom: 3 }}>{choice.title}</b>
                  <span style={{ display: 'block', fontSize: 13, lineHeight: 1.5, color: 'var(--text-dim)' }}>{choice.text}</span>
                </span>
                <Toggle checked={answers[choice.key]} disabled={saving} onChange={(on) => onAnswer(choice.key, on)} />
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 22 }}>
            <Button variant="primary" onClick={onSave} disabled={saving} style={{ minWidth: 220, justifyContent: 'center' }} data-testid="wm-choices-save">
              {saving ? CHOICES_QUESTION_COPY.saving : CHOICES_QUESTION_COPY.save}
            </Button>
            {failed && <p role="alert" style={{ margin: 0, fontSize: 13.5, color: 'var(--danger, #c0392b)' }}>{failed}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Known to be answered in this browser session: no read on the next page. */
const DONE_KEY = 'wm_choices_answered';

export function choicesKnownAnswered(): boolean {
  try { return sessionStorage.getItem(DONE_KEY) === '1'; } catch { return false; }
}

function rememberAnswered(): void {
  try { sessionStorage.setItem(DONE_KEY, '1'); } catch { /* private mode: the next page reads again */ }
}

/** The choices this site offers that have no answer yet, from GET /choices; none when the site does not say. */
export function unanswered(list: Choice[], report: unknown): Choice[] {
  const answered = (report as { answered?: unknown } | null)?.answered;
  if (!Array.isArray(answered)) return [];
  return list.filter((c) => !answered.includes(c.key));
}

/** Where each switch starts: what the site does now, from GET /choices; off when it does not say. */
export function startingAnswers(report: unknown): Answers {
  const now = (report && typeof report === 'object' ? report : {}) as Partial<Record<ChoiceKey, unknown>>;
  return {
    analytics_enabled: now.analytics_enabled === true,
    contact_sync_enabled: now.contact_sync_enabled === true,
    badge_enabled: now.badge_enabled === true,
  };
}

/** The question while it is needed; onDone once every offered choice has an answer, or the site did not say. */
export default function ChoicesQuestion({ onDone }: { onDone: () => void }) {
  const wp = (window as any).WEBMAVEN_WP_DATA || {};
  const rest = wp.restUrl || '/wp-json/webmaven_wp/v1';
  const headers = { 'X-WP-Nonce': wp.nonce || '' };
  const [list, setList] = useState<Choice[] | null>(null);
  const [answers, setAnswers] = useState<Answers>(startingAnswers(null));
  const [startedOn, setStartedOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const finish = () => { if (!cancelled) { cancelled = true; onDone(); } };
    // Never more than a few seconds before the app: an answer that does not come holds nobody.
    const limit = window.setTimeout(finish, 4000);
    const offered = choicesFor({ store: !!wp.store?.active, ours: isWpmavenSite(), dashboard: dashboardPhrase(siteBrand()) });
    fetch(`${rest}/choices`, { headers, credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((report) => {
        if (cancelled) return;
        const open = unanswered(offered, report);
        if (!open.length) { rememberAnswered(); finish(); return; }
        window.clearTimeout(limit);
        const start = startingAnswers(report);
        setAnswers(start);
        setStartedOn(open.some((c) => start[c.key]));
        setList(open);
      })
      .catch(finish);
    return () => { cancelled = true; window.clearTimeout(limit); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!list) return <AppLoading />;

  const save = async () => {
    setSaving(true);
    setFailed(null);
    try {
      const res = await fetch(`${rest}/choices`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        // Every choice shown is an answer, on or off.
        body: JSON.stringify(Object.fromEntries(list.map((c) => [c.key, answers[c.key]]))),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rememberAnswered();
      onDone();
    } catch {
      setFailed(CHOICES_QUESTION_COPY.failed);
      setSaving(false);
    }
  };

  return (
    <ChoicesQuestionView
      list={list}
      answers={answers}
      lead={startedOn ? CHOICES_QUESTION_COPY.leadCurrent : CHOICES_QUESTION_COPY.lead}
      onAnswer={(key, on) => setAnswers((a) => ({ ...a, [key]: on }))}
      saving={saving}
      failed={failed}
      onSave={() => void save()}
    />
  );
}
