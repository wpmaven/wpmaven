import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { TeamFace } from '../../components/team/TeamFace';
import { operatorRefOf, type OperatorRef } from '../../utils/team';
import { stageBox, type IframeOffset } from '../components/SiteIframe';
import type { EditFlowState } from '../genstudio/useEditOperation';
import { elementWord, type ElementRect } from './elementEdit';
import { GLASS_CSS, ProcessingGlass } from './ProcessingGlass';
import { JOB_WORDS } from './labels';
import type { JobView, QuickJob } from './useQuickEdit';

/**
 * The window's changes on the frame (2026-10-19): each one's glass on its
 * part while it is prepared; once prepared, a badge by its part with the
 * face of the one on the team who made it, waiting for the owner's
 * approval (or saying it could not be done). The badge opens the window on
 * its part, as if the owner had stayed. A change asked on another page
 * waits in the tray at the stage's bottom left, with its page's name.
 */

const BADGE_CSS = `
.wme-job-badge{position:absolute;display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px 0 8px;border-radius:999px;border:1px solid transparent;
  background:linear-gradient(var(--bg-raised),var(--bg-raised)) padding-box,conic-gradient(from 210deg,#47C8D8,#5B9BD5,#8E85C2,#D08EC8,#E8919F,#F2AA84,#47C8D8) border-box;
  color:var(--text);font:600 12.5px/1 "DM Sans",sans-serif;box-shadow:var(--glass-shadow);cursor:pointer;pointer-events:auto;white-space:nowrap;
  animation:wme-job-in .35s cubic-bezier(.2,.8,.2,1) .75s both;transition:transform .15s}
.wme-job-badge:hover{transform:translateY(-1px)}
.wme-job-badge:focus-visible{outline:2px solid var(--purple);outline-offset:2px}
.wme-job-badge[data-failed]{background:linear-gradient(var(--bg-raised),var(--bg-raised)) padding-box,linear-gradient(var(--rose),var(--rose)) border-box}
.wme-job-badge small{color:var(--text-dim);font-weight:500;max-width:160px;overflow:hidden;text-overflow:ellipsis}
.wme-job-badge>svg{width:14px;height:14px;color:var(--text-dim);flex-shrink:0}
@keyframes wme-job-in{from{opacity:0;transform:translateY(4px) scale(.96)}}
.wme-job-tray{position:absolute;left:12px;bottom:12px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;pointer-events:none}
.wme-job-tray .wme-job-badge{position:static;animation-delay:0s}
@media (prefers-reduced-motion:reduce){.wme-job-badge{animation:none}}
`;

/** The badge's size as placed (its words at 12.5px, the face, the padding). */
const BADGE = { width: 232, height: 36, gap: 8, safe: 8 } as const;

/** Who prepared the change: the API's operator, else the Web Designer (the window's changes are design changes). */
function whoOf(s: EditFlowState): OperatorRef {
  return operatorRefOf(s.preview?.operator ?? s.result?.operator ?? s.progress?.operator) ?? { id: 'web_designer', title: 'Web Designer' };
}

/**
 * The badge by its part: over it, where the selection's tag sits, when the
 * frame has room, else under it, else inside its top; always on the frame,
 * so a part scrolled away keeps its badge at the frame's edge, an arrow
 * pointing to it.
 */
export function badgePlacement(rect: ElementRect, frame: { width: number; height: number }): { top: number; left: number; arrow: 'up' | 'down' | null } {
  const { width: w, height: h, gap, safe } = BADGE;
  const bottom = rect.top + rect.height;
  let top = rect.top - gap - h >= safe ? rect.top - gap - h : bottom + gap + h <= frame.height - safe ? bottom + gap : rect.top + gap;
  let arrow: 'up' | 'down' | null = null;
  if (bottom < safe + h / 2) arrow = 'up';
  else if (rect.top > frame.height - safe - h / 2) arrow = 'down';
  top = Math.max(safe, Math.min(top, frame.height - h - safe));
  const left = Math.max(safe, Math.min(rect.left, frame.width - w - safe));
  return { top, left, arrow };
}

function Badge({ view, onOpen, style, page, arrow }: { view: JobView; onOpen: (job: QuickJob) => void; style?: React.CSSProperties; page?: string; arrow?: 'up' | 'down' | null }) {
  const { job, state } = view;
  const failed = state.phase === 'failed';
  const working = state.phase === 'previewing' || state.phase === 'publishing';
  const who = whoOf(state);
  const words = working ? job.doing : failed ? JOB_WORDS.failed : JOB_WORDS.waiting;
  return (
    <button
      type="button"
      className="wme-job-badge"
      data-testid="editor-job-badge"
      data-failed={failed || undefined}
      style={style}
      onClick={() => onOpen(job)}
      aria-label={JOB_WORDS.open(who.title, elementWord(job.sel.category))}
    >
      <TeamFace id={who.id} title={who.title} presence={working ? 'working' : failed ? 'failed' : 'waiting'} size="row" decorative />
      <span>{words}</span>
      {page && <small>{page}</small>}
      {arrow === 'up' && <ArrowUp aria-hidden="true" />}
      {arrow === 'down' && <ArrowDown aria-hidden="true" />}
    </button>
  );
}

export function JobsLayer({ jobs, where, focusedId, live, iframeOffset, onOpen }: {
  jobs: JobView[];
  /** The page in the frame (placeKey). */
  where: string;
  /** The change the window is on: its glass shows, its badge does not. */
  focusedId: string | null;
  /** The frame shows the live page (a preview shows its own change only). */
  live: boolean;
  iframeOffset: IframeOffset;
  onOpen: (job: QuickJob) => void;
}) {
  if (!jobs.length) return null;
  const scale = iframeOffset.scale ?? 1;
  const here = jobs.filter((v) => v.job.place.where === where && (live || v.job.id === focusedId));
  const elsewhere = jobs.filter((v) => (v.job.place.where !== where || v.job.lost) && v.state.phase !== 'idle');
  return (
    <div style={{ position: 'absolute', top: iframeOffset.top, left: iframeOffset.left, width: iframeOffset.width, height: iframeOffset.height, pointerEvents: 'none', zIndex: 101 }}>
      <style>{GLASS_CSS + BADGE_CSS}</style>
      {here.map(({ job, state }) => {
        const busy = state.phase === 'previewing' || state.phase === 'publishing';
        const glassState = busy ? 'working' : state.phase === 'previewed' || state.phase === 'published' ? 'ready' : 'stopped';
        const part = job.spot ? { rect: job.spot.rect, look: job.spot.look, category: job.sel.category } : null;
        return <ProcessingGlass key={job.id} part={part} state={glassState} words={job.doing} iframeOffset={iframeOffset} />;
      })}
      {/* The badges over every glass: a glass blurs what lies under it. */}
      {here.map((v) => {
        const { job, state } = v;
        const waiting = job.id !== focusedId && (state.phase === 'previewed' || state.phase === 'failed');
        const place = waiting && job.spot ? badgePlacement(stageBox(job.spot.rect, scale), iframeOffset) : null;
        return place && <Badge key={job.id} view={v} onOpen={onOpen} style={{ top: place.top, left: place.left }} arrow={place.arrow} />;
      })}
      {elsewhere.length > 0 && (
        <div className="wme-job-tray" data-testid="editor-job-tray">
          {elsewhere.map((v) => <Badge key={v.job.id} view={v} onOpen={onOpen} page={v.job.place.title} />)}
        </div>
      )}
    </div>
  );
}
