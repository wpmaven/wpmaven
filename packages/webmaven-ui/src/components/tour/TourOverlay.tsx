import React from 'react';
import { Button } from '../Button';
import s from './Tour.module.css';
import { CARD_MAX_WIDTH, dimPanels, type Placement } from './placement';
import { TOUR_LABELS, forwardButton, stepWords } from './rules';
import type { TourLabels, TourStep, TourStepAction } from './types';

/**
 * What the tour draws: a dimmed screen with a hole around the element being
 * explained, and a card beside it (0.9.0, from the dashboard's own tour).
 *
 * It moves only when the person says so: Next, Back and Skip tour are the
 * card's buttons, with a step's own actions before Next; Escape ends it,
 * the arrow keys go forward and back.
 *
 * Two kinds of step:
 *   read  the screen is dimmed and nothing behind it takes a click; the card
 *         is modal.
 *   used  the element takes clicks (a step that waits for a click on it, or
 *         an interactive one): the dim is four panels around the hole, so a
 *         click in the hole reaches the element, and the card is not modal.
 *         A step that waits for a click has no Next: the click moves on.
 *         On a phone (`compact`) a used step has no dim at all, only the
 *         ring, and while a field has the focus the card is a slim bar
 *         (`slim`): where you are, the title, and the way on.
 *
 * A `later` step's forward button reads Later until its element is done,
 * then Next with the step's `doneText` said on the card; a primary action
 * ("Set it up now") makes it read Later too.
 *
 * A used step sits under the app's own dialogs (z-index 45 against their
 * 50), so a dialog the element opens comes up above the tour. A read step
 * sits above them.
 *
 * Purely presentational, so it renders on the server for the tests. The
 * provider measures, places and focuses (the forward button carries
 * data-tour-primary for that).
 */

export interface TourOverlayProps {
  step: TourStep;
  index: number;
  total: number;
  phase: 'locating' | 'showing';
  /** Where the spotlight and card go; null until measured (the card is then hidden). */
  placement: Placement | null;
  reducedMotion?: boolean;
  labels?: Partial<TourLabels>;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  /** The last step that waits for a click, closed without it ("Not now"). */
  onNotNow?: () => void;
  cardRef?: React.Ref<HTMLDivElement>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** The overlay's z-index for a read step and for a used one. */
  zIndex?: { read?: number; used?: number };
  /** The step's element says it is done: a `later` step's Later turns to Next, and its `doneText` is said. */
  done?: boolean;
  /** The variant the element reads as: the step's words for it. */
  variant?: string | null;
  /** The step's actions that show now (their `when` said yes). */
  actions?: readonly TourStepAction[];
  onAction?: (action: TourStepAction) => void;
  /** A phone: a used step has no dim, only the ring. */
  compact?: boolean;
  /** A phone with a field focused on a used step: the card is the slim bar. */
  slim?: boolean;
  /** A Show me run: one step on its own, so no "1 of 1" and no Skip tour. */
  single?: boolean;
}

/** Read steps above the app's dialogs; used steps under them (50). */
export const TOUR_Z = { read: 80, used: 45 } as const;

/** Whether the element takes clicks while the step is up. */
export function stepIsUsed(step: Pick<TourStep, 'waitFor' | 'interactive'>): boolean {
  return step.waitFor === 'click' || step.interactive === true;
}

const swallow = (e: React.MouseEvent) => e.preventDefault();

export const TourOverlay: React.FC<TourOverlayProps> = ({
  step, index, total, phase, placement, reducedMotion = false, labels,
  onNext, onBack, onSkip, onNotNow, cardRef, onKeyDown, zIndex,
  done = false, variant = null, actions = [], onAction, compact = false, slim: slimAsked = false, single = false,
}) => {
  const words: TourLabels = { ...TOUR_LABELS, ...labels };
  const last = index >= total - 1;
  const showing = phase === 'showing';
  const used = stepIsUsed(step);
  const waits = step.waitFor === 'click';
  const safeId = step.id.replace(/[^A-Za-z0-9_-]/g, '-');
  const titleId = `wm-tour-title-${safeId}`;
  const bodyId = `wm-tour-body-${safeId}`;
  const spot = showing ? placement?.spot ?? null : null;
  // The actions belong to the element: only once it is on screen.
  const shownActions = showing ? actions : [];
  const deferred = shownActions.some((a) => a.tone === 'primary');
  const forward = forwardButton(step, last, words, { done, deferred });
  const z = used ? (zIndex?.used ?? TOUR_Z.used) : (zIndex?.read ?? TOUR_Z.read);
  const { title, body } = stepWords(step, variant);
  const status = done && step.doneText ? step.doneText : null;
  const slim = slimAsked && used && showing && !!placement;
  const progress = single ? null : words.progress(index, total);

  const cardPosition: React.CSSProperties = showing
    ? placement
      ? { top: placement.card.top, left: placement.card.left, width: placement.card.width }
      // Drawn once unseen so it can be measured, then placed before paint.
      : { top: 0, left: 0, width: `min(${CARD_MAX_WIDTH}px, calc(100vw - 24px))`, visibility: 'hidden' }
    // On the way to a step: centred, no spotlight yet.
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: `min(${CARD_MAX_WIDTH}px, calc(100vw - 24px))` };

  const spotBox = spot ? { top: spot.top, left: spot.left, width: spot.width, height: spot.height } : null;

  let backdrop: React.ReactNode;
  if (!used) {
    backdrop = spotBox
      ? <div aria-hidden="true" data-testid="tour-spot" className={`${s.spot} ${s.withDim}`} style={spotBox} />
      : <div aria-hidden="true" className={s.dim} />;
  } else if (compact) {
    // A phone: nothing dimmed on a step the person uses, only the ring.
    backdrop = spotBox ? <div aria-hidden="true" data-testid="tour-spot" className={s.spot} style={spotBox} /> : null;
  } else if (spotBox) {
    backdrop = (
      <>
        {dimPanels(spotBox).map((p) => (
          <div
            key={p.key}
            aria-hidden="true"
            data-testid="tour-dim"
            className={s.panel}
            onMouseDown={swallow}
            style={{
              top: p.top,
              left: p.left,
              ...(p.width != null ? { width: p.width } : { right: 0 }),
              ...(p.height != null ? { height: p.height } : { bottom: 0 }),
            }}
          />
        ))}
        <div aria-hidden="true" data-testid="tour-spot" className={s.spot} style={spotBox} />
      </>
    );
  } else {
    // On the way, or not measured yet: nothing to use, nothing to click.
    backdrop = <div aria-hidden="true" className={s.dim} onMouseDown={swallow} style={{ pointerEvents: 'auto' }} />;
  }

  // The kit's Button takes no ref: the provider focuses it by data-tour-primary.
  // In the slim bar a press must not take the focus from the field first: the
  // bar would move under the finger before the click lands.
  const forwardEl = forward && (
    <Button
      size="sm"
      variant={forward.tone === 'primary' ? 'primary' : 'outline'}
      onClick={onNext}
      onMouseDown={slim ? swallow : undefined}
      data-testid="tour-next"
      data-tour-primary=""
    >
      {forward.label}
    </Button>
  );

  return (
    <div
      className={s.root}
      data-testid="tour-overlay"
      data-tour-kind={used ? 'used' : 'read'}
      // A read step swallows every click on the page behind; a used step lets
      // the hole through (the panels catch the rest).
      onMouseDown={used ? undefined : (e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
      style={{ zIndex: z, pointerEvents: used ? 'none' : 'auto' }}
    >
      {backdrop}

      <div
        key={step.id}
        ref={cardRef}
        role="dialog"
        aria-modal={used ? 'false' : 'true'}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid="tour-card"
        data-side={placement?.side ?? ''}
        data-slim={slim ? '' : undefined}
        className={`${s.card}${slim ? ` ${s.slim}` : ''}${reducedMotion ? ` ${s.still}` : ''}`}
        onKeyDown={onKeyDown}
        style={cardPosition}
      >
        {slim ? (
          // The slim bar: where you are, what it is, and the way on.
          <div className={s.slimRow}>
            <div className={s.slimText}>
              {progress && <p className={s.progress}>{progress}</p>}
              <h2 id={titleId} className={s.slimTitle}>{title}</h2>
              {/* Still said to a screen reader, out of the keyboard's way. */}
              <p id={bodyId} className={s.srOnly}>{body}</p>
            </div>
            {status && <span role="status" data-testid="tour-done" className={s.slimDone}>{status}</span>}
            {forwardEl}
          </div>
        ) : (
          <>
            {progress && <p className={s.progress}>{progress}</p>}
            <h2 id={titleId} className={s.title}>{title}</h2>
            {showing ? (
              <p id={bodyId} className={s.body}>{body}</p>
            ) : (
              <p id={bodyId} role="status" className={s.opening}>{words.opening(step.screen ?? null)}</p>
            )}

            {/* What the person did, once the element says so ("Saved"). */}
            {status && showing && (
              <p role="status" data-testid="tour-done" className={s.done}>
                <span aria-hidden="true" className={s.check}>✓ </span>{status}
              </p>
            )}

            {!single && (
              <div aria-hidden="true" className={s.dots}>
                {Array.from({ length: total }, (_, i) => (
                  <span key={i} className={`${s.dot}${i < index ? ` ${s.past}` : ''}${i === index ? ` ${s.here}` : ''}`} />
                ))}
              </div>
            )}

            <div className={s.actions}>
              {index > 0 && !single && (
                <Button size="sm" variant="outline" onClick={onBack} data-testid="tour-back">{words.back}</Button>
              )}
              <div className={s.end}>
                {!last && !single && (
                  <Button size="sm" variant="ghost" onClick={onSkip} data-testid="tour-skip">{words.skip}</Button>
                )}
                {waits && last && (
                  <Button size="sm" variant="outline" onClick={onNotNow ?? onSkip} data-testid="tour-not-now" data-tour-primary="">{words.notNow}</Button>
                )}
                {shownActions.map((a) => (
                  <Button
                    key={a.key}
                    size="sm"
                    variant={a.tone === 'primary' ? 'primary' : 'outline'}
                    onClick={() => onAction?.(a)}
                    data-testid={a.testId ?? `tour-action-${a.key}`}
                  >
                    {a.label}
                  </Button>
                ))}
                {forwardEl}
              </div>
            </div>
          </>
        )}
      </div>

      {/* A step that waits for a click puts the focus on its element: the
          card's words are said here, since the focus is not in the card. */}
      {waits && showing && (
        <div role="status" aria-live="polite" className={s.srOnly}>
          {`${progress ? `${progress}. ` : ''}${title}. ${body}`}
        </div>
      )}
    </div>
  );
};

export default TourOverlay;
