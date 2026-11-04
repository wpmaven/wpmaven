import React, { useId } from 'react';
import { Button, Skeleton } from '@yotako/webmaven-ui';
import { useOptionalScreensHost } from '../host/HostContext';
import { openPage } from '../approvals/ReceiptNote';
import { useSectionSiteShare } from './share';
import { VISUALLY_HIDDEN, useHomeSectionStyles } from './styles';
import {
  checklistShows, milestoneLadder,
  type MilestoneAction, type MilestoneIcon, type MilestoneInputs, type RungState,
} from './milestoneLadder';

/**
 * The outline icons of the milestones' buttons (Heroicons v2, MIT), drawn
 * as the dashboard drew them with @heroicons/react, inline so the plugin
 * needs no icon package for them.
 */
function outline(d: string, name: string): React.FC<React.SVGProps<SVGSVGElement>> {
  const Icon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
      data-slot="icon"
      {...props}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
  Icon.displayName = name;
  return Icon;
}

const ChatBubbleLeftEllipsisIcon = outline('M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z', 'ChatBubbleLeftEllipsisIcon');
const CheckIcon = outline('m4.5 12.75 6 6 9-13.5', 'CheckIcon');
const ClipboardDocumentIcon = outline('M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 0 0-9-9Z', 'ClipboardDocumentIcon');
const LinkIcon = outline('M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244', 'LinkIcon');
const MegaphoneIcon = outline('M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46', 'MegaphoneIcon');
const RocketLaunchIcon = outline('M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 0 0-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z', 'RocketLaunchIcon');
const ShareIcon = outline('M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z', 'ShareIcon');

/**
 * The milestones as a checklist, one row per rung (2026-10-11, as in the
 * landing's film): a filled green circle with a check for what is done, an
 * empty circle for the rest, and a bar on the counted goals (10 orders, 100
 * orders) showing how far along they are. The step the business is on has
 * its button(s) at the right end of its own row, on the same line as its
 * name (2026-10-11): a button is always on the step it acts on, never loose
 * in the card. The list measures itself (HOME_SECTIONS_CSS, .wms-milestones):
 * the full label where there is room, a word of it where there is less, and
 * the icon alone where two buttons share a narrow row, so they stay on the
 * line.
 *
 * Self-contained: it takes the milestone inputs and draws everything,
 * placeholder included, so a section can put it beside the growth chart or
 * alone (GrowthCard, when the charts are off).
 */

const LABEL: React.CSSProperties = {
  fontSize: 'var(--text-label)', fontWeight: 700, letterSpacing: '0.6px',
  textTransform: 'uppercase', color: 'var(--text-dim)',
};

const ROW: React.CSSProperties = {
  minWidth: 0, padding: '10px 12px', borderRadius: 12, background: 'var(--fill-soft)',
};

const ICONS: Record<MilestoneIcon, React.FC<React.SVGProps<SVGSVGElement>>> = {
  publish: RocketLaunchIcon,
  connect: LinkIcon,
  approve: CheckIcon,
  ask: ChatBubbleLeftEllipsisIcon,
  share: ShareIcon,
  promotion: MegaphoneIcon,
};

/** What a screen reader hears before each rung's name. */
const SPOKEN: Record<RungState, string> = { done: 'Done: ', current: 'Now: ', next: 'Next: ' };

export interface MilestoneHandlers {
  /** Opens a page of the dashboard (through the host: the plugin opens its own page, or the dashboard). */
  go: (to: string) => void;
  /** Puts a request in the Co-CEO's box, for the owner to send. */
  ask?: (text: string) => void;
  /** Shares the business's site. */
  share?: () => void;
}

/**
 * What pressing a milestone's button does, or null when this screen cannot
 * do it (no Co-CEO box to fill, no site to share): the button is then left
 * out rather than drawn dead.
 */
export function milestoneClick(a: MilestoneAction, h: MilestoneHandlers): (() => void) | null {
  if ('to' in a) return () => h.go(a.to);
  if ('ask' in a) {
    const ask = h.ask;
    return ask ? () => ask(a.ask) : null;
  }
  const share = h.share;
  return share ? () => share() : null;
}

const CheckCircle: React.FC<{ done: boolean }> = ({ done }) => (
  <span
    aria-hidden="true"
    data-check={done ? 'done' : 'open'}
    style={{
      flex: 'none', width: 20, height: 20, borderRadius: 999, boxSizing: 'border-box',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: done ? 'var(--success)' : 'transparent',
      border: done ? 'none' : '1.5px solid var(--text-dim)',
    }}
  >
    {/* The check at 12px: a stroke of 4 in its 24 box is the tick's 2px line. */}
    {done && <CheckIcon width={12} height={12} stroke="var(--bg-raised, #fff)" strokeWidth={4} />}
  </span>
);

export const MilestoneChecklist: React.FC<{
  inputs: MilestoneInputs;
  /** True while the sources behind `inputs` have not answered yet. */
  loading?: boolean;
  /** The business's site, for "Share your store"; that button is left out without one. */
  site?: { url: string; name?: string | null } | null;
  /** Fills the Co-CEO's box with a request (never sends it); the ask buttons are left out without it. */
  onAsk?: (text: string) => void;
}> = ({ inputs, loading = false, site = null, onAsk }) => {
  useHomeSectionStyles();
  const host = useOptionalScreensHost();
  const labelId = useId();
  const { rungs } = milestoneLadder(inputs);
  const sharing = !loading && !!site?.url && rungs.some((r) => (r.actions ?? []).some((a) => 'share' in a));
  // The share reads the referral only when a share button is on screen.
  const shared = useSectionSiteShare(sharing && site ? site.url : '', site?.name, 'milestone');

  /*
   * A milestone is a claim about the business, and every input arrives null.
   * Read before the sources answer, those nulls would tick or hide steps the
   * screen had not been told about. The rows wait, at their own height so
   * nothing moves when the real ones land.
   */
  if (loading) {
    return (
      <div aria-busy="true" data-testid="milestone-checklist">
        <div style={LABEL}>Milestones</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={40} rounded="md" />)}
        </div>
      </div>
    );
  }
  if (!checklistShows(inputs, false)) return null;

  const handlers: MilestoneHandlers = {
    go: (to) => openPage(host, to),
    ask: onAsk,
    share: sharing ? () => void shared.share() : undefined,
  };
  /** The button's words, full and short. The share says what it does: a
   *  share sheet where the browser has one, a copy where it does not
   *  (ShareYourSite's rule). */
  const wordsOf = (a: MilestoneAction): { full: string; short: string } => {
    if (!('share' in a)) return { full: a.label, short: a.short };
    if (shared.state === 'copied') return { full: 'Copied', short: 'Copied' };
    return shared.canNative ? { full: a.label, short: a.short } : { full: a.copyLabel, short: a.copyShort };
  };
  const iconOf = (a: MilestoneAction) => ('share' in a && !shared.canNative ? ClipboardDocumentIcon : ICONS[a.icon]);
  /** A rung's buttons this screen can carry out, the first the main one. */
  const buttonsOf = (actions: MilestoneAction[] = []) => actions
    .map((a, i) => ({ a, variant: (i === 0 ? 'primary' : 'secondary') as 'primary' | 'secondary', onClick: milestoneClick(a, handlers) }))
    .filter((b): b is { a: MilestoneAction; variant: 'primary' | 'secondary'; onClick: () => void } => !!b.onClick);

  return (
    <div data-testid="milestone-checklist" className="wms-milestones">
      <div id={labelId} style={LABEL}>Milestones</div>
      <ol aria-labelledby={labelId} style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rungs.map((r) => {
          const pct = r.count ? Math.round((r.count.value / r.count.target) * 100) : 0;
          const buttons = buttonsOf(r.actions);
          const shareHere = sharing && (r.actions ?? []).some((a) => 'share' in a);
          return (
            <li
              key={r.key}
              data-step={r.key}
              data-state={r.state}
              aria-current={r.state === 'current' ? 'step' : undefined}
              className={buttons.length > 1 ? 'wms-ms-row wms-ms-row--two' : 'wms-ms-row'}
              style={ROW}
            >
              <CheckCircle done={r.state === 'done'} />
              <div className="wms-ms-main">
                <span className="wms-ms-name" style={{ fontSize: 'var(--text-data)', fontWeight: 600, color: 'var(--text)' }}>
                  <span style={VISUALLY_HIDDEN}>{SPOKEN[r.state]}</span>
                  {r.label}
                </span>
                {r.count && (
                  <span className="wms-ms-progress">
                    {r.state === 'current' && (
                      <span aria-hidden="true" style={{ fontSize: 'var(--text-meta)', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                        {r.count.value}/{r.count.target}
                      </span>
                    )}
                    <span
                      role="progressbar"
                      aria-label={`${r.label}: ${r.count.value} of ${r.count.target}`}
                      aria-valuemin={0}
                      aria-valuemax={r.count.target}
                      aria-valuenow={r.count.value}
                      style={{ display: 'block', width: 48, height: 6, borderRadius: 3, background: 'var(--glass-border-hover)', overflow: 'hidden' }}
                    >
                      <span style={{ display: 'block', width: `${pct}%`, height: '100%', borderRadius: 3, background: 'var(--success)' }} />
                    </span>
                  </span>
                )}
              </div>
              {buttons.length > 0 && (
                // At the right end of the step's line, the main one first.
                <div className="wms-ms-actions">
                  {buttons.map(({ a, variant, onClick }) => {
                    const words = wordsOf(a);
                    const Icon = iconOf(a);
                    return (
                      <Button
                        key={a.label}
                        variant={variant}
                        size="sm"
                        className="wms-ms-btn"
                        onClick={onClick}
                        leftIcon={<Icon aria-hidden="true" style={{ width: 16, height: 16 }} />}
                        aria-label={words.full}
                        title={words.full}
                        data-action={'to' in a ? a.to : 'ask' in a ? 'ask' : 'share'}
                      >
                        <span className="wms-ms-btn-full">{words.full}</span>
                        <span className="wms-ms-btn-short" aria-hidden="true">{words.short}</span>
                      </Button>
                    );
                  })}
                </div>
              )}
              {shareHere && (
                // The share's confirmation, on the row of the button that
                // shares, mounted from the start so a screen reader hears it
                // when it changes (ShareYourSite does the same). A line of
                // its own in the row; with nothing to say it takes no room.
                <div className="wms-ms-share-note" style={{ marginTop: shared.status || shared.note || shared.state === 'unavailable' ? 0 : -8 }}>
                  <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 'var(--text-meta)', color: 'var(--text-dim)', lineHeight: 'var(--leading-body)' }}>
                    {shared.status}
                  </p>
                  {shared.note && (
                    <p style={{ margin: shared.status ? '4px 0 0' : 0, fontSize: 'var(--text-meta)', color: 'var(--text-dim)', lineHeight: 'var(--leading-body)' }}>
                      {shared.note}
                    </p>
                  )}
                  {shared.state === 'unavailable' && (
                    <code style={{
                      display: 'block', marginTop: 6, padding: '8px 10px', borderRadius: 8,
                      background: 'var(--glass)', border: '1px solid var(--glass-border)',
                      color: 'var(--text)', fontSize: 'var(--text-meta)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {shared.message}
                    </code>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default MilestoneChecklist;
