import React, { useEffect, useState } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { WhyDisabled } from './WhyDisabled';
import { errorMessage } from './errorMessage';
import {
  PUBLISH_COPY, PUBLISH_SENTENCES, countsLine, defaultsLine, factsNudge, frontOfferText, frontRestoredText, keepAsIsConfirm,
  leftAloneItem, leftAloneLead, outcomeUnfinished, splitProblems, withoutImageLine,
} from './publishCopy';
import type { FrontPageSwitchResult, PublishOutcome, PublishProblem } from '../api/onboarding';

/**
 * What a publish did, from its outcome (after a press, and from
 * GET /onboarding/mine's lastPublish after a reload), on the dashboard's
 * /welcome and /deploying, and on the wizard's success step in WordPress
 * (from GET /onboarding/site-session's publishOutcome): one panel for both.
 *
 *  - complete: what is on the site now, WordPress's starter content cleared,
 *    the homepage offer on a site the owner already ran (one click, and one
 *    to put the old one back), the contact details left empty with the way
 *    to add them, the owner's pages left alone, the store currency note;
 *  - partial: never called published. What did not finish, "Publish again"
 *    and "Keep it as it is" (with what the business stays live without);
 *  - failed or blocked: why, and "Try again".
 * Parts the business works without are listed under the rest, as smaller
 * things.
 */

const lineStyle: React.CSSProperties = { fontSize: 13.5, lineHeight: 1.5, color: 'var(--n-700)', margin: 0 };
const leadStyle: React.CSSProperties = { fontSize: 14.5, lineHeight: 1.5, color: 'var(--n-900)', margin: 0 };
const boxStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: 12,
  border: '1px solid var(--n-200)', background: 'var(--n-0)',
};

/** How a problem's fix is done where the panel is shown, or null when it has no button there. */
export type PublishFixHandler = (problem: PublishProblem) => (() => void) | null;

export function ProblemList({ title, problems, testId, fixFor, fixDisabled = false }: {
  title: string;
  problems: PublishProblem[];
  testId: string;
  /** A button for each problem whose fix the page can do (its label is the API's); none when absent. */
  fixFor?: PublishFixHandler | null;
  fixDisabled?: boolean;
}) {
  if (!problems.length) return null;
  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={{ ...lineStyle, fontWeight: 600, color: 'var(--n-900)' }}>{title}</p>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {problems.map((p, i) => {
          const fix = p.fix && fixFor ? fixFor(p) : null;
          return (
            <li key={`${p.code}-${i}`} style={lineStyle} data-problem={p.code}>
              {p.message}
              {fix && p.fix && (
                <div style={{ marginTop: 6 }}>
                  <Button variant="secondary" size="sm" onClick={fix} disabled={fixDisabled} data-testid={`publish-fix-${p.fix.action}`}>
                    {p.fix.label}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface PublishOutcomePanelProps {
  outcome: PublishOutcome;
  /** The panel's own first line. Off where the page already says it (the live panel's "is live at"). */
  showHeadline?: boolean;
  /** Publish again (partial) or Try again (failed, blocked): the page runs the publish. */
  onPublishAgain?: () => void;
  /** That publish is running. */
  publishingAgain?: boolean;
  /** Why Publish again cannot be pressed yet (the site's check holds it), said beside it. */
  publishAgainBlocked?: string | null;
  /** "Keep it as it is" (partial): resolves once the API kept it, throws its refusal. */
  onKeepAsIs?: () => Promise<void>;
  /** The homepage switch (complete): resolves with the switch's answer, throws its refusal. */
  onFrontPage?: (use: 'designed' | 'previous') => Promise<FrontPageSwitchResult>;
  /**
   * Where the page cannot switch the homepage itself (a WordPress site's
   * token cannot): the same offer, with a link to the dashboard page that
   * holds the switch. Used only without onFrontPage.
   */
  frontPageLink?: { label: string; onOpen: () => void } | null;
  /** A button for each problem whose fix the page can do (WordPress: its updates page, or publish again). */
  fixFor?: PublishFixHandler | null;
  /** The business page's Business details card, for the contact details left empty. */
  detailsHref?: string | null;
  onOpenDetails?: (href: string) => void;
  /** Shown above the actions: the site's check before Publish again. */
  children?: React.ReactNode;
}

export default function PublishOutcomePanel({
  outcome, showHeadline = true, onPublishAgain, publishingAgain = false, publishAgainBlocked = null,
  onKeepAsIs, onFrontPage, frontPageLink = null, fixFor = null, detailsHref, onOpenDetails, children,
}: PublishOutcomePanelProps) {
  const { required, warnings } = splitProblems(outcome.problems);
  const unfinished = outcomeUnfinished(outcome);
  const accepted = outcome.status === 'partial' && !!outcome.acceptedAt;
  const live = outcome.status === 'complete' || accepted;
  const stopped = outcome.status === 'failed' || outcome.status === 'blocked';

  const [confirmKeep, setConfirmKeep] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [keepError, setKeepError] = useState<string | null>(null);

  // The homepage switch: the state the site is in now (from the outcome,
  // then from each switch's answer).
  const [frontState, setFrontState] = useState(outcome.frontPage?.state ?? 'kept');
  const [frontBusy, setFrontBusy] = useState(false);
  const [frontNote, setFrontNote] = useState<string | null>(null);
  const [frontError, setFrontError] = useState<string | null>(null);
  useEffect(() => { setFrontState(outcome.frontPage?.state ?? 'kept'); }, [outcome.frontPage?.state]);

  const switchFront = async (use: 'designed' | 'previous') => {
    if (!onFrontPage) return;
    setFrontBusy(true);
    setFrontError(null);
    setFrontNote(null);
    try {
      const r = await onFrontPage(use);
      if (!r.ok) {
        setFrontError(r.failures?.[0]?.message || PUBLISH_SENTENCES.frontNotChanged);
        return;
      }
      setFrontState(use === 'designed' ? 'switched' : 'offered');
      if (use === 'previous') setFrontNote(frontRestoredText(outcome.frontPage?.previous ?? null));
    } catch (e) {
      setFrontError(errorMessage(e, PUBLISH_SENTENCES.frontNotChanged));
    } finally {
      setFrontBusy(false);
    }
  };

  const keep = async () => {
    if (!onKeepAsIs) return;
    setKeeping(true);
    setKeepError(null);
    try {
      await onKeepAsIs();
      setConfirmKeep(false);
    } catch (e) {
      setKeepError(errorMessage(e, PUBLISH_SENTENCES.notThrough));
    } finally {
      setKeeping(false);
    }
  };

  const counts = countsLine(outcome.counts);
  const noPhoto = withoutImageLine(outcome.counts);
  const cleared = live ? defaultsLine(outcome.defaultsReplaced) : null;
  const facts = live ? factsNudge(outcome.factsLeftEmpty) : null;
  const currencyNote = typeof outcome.storeCurrencyNote === 'string' && outcome.storeCurrencyNote.trim() ? outcome.storeCurrencyNote.trim() : null;
  const leftAlone = Array.isArray(outcome.leftAlone) ? outcome.leftAlone : [];

  return (
    <div data-testid="publish-outcome" data-status={outcome.status} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {showHeadline && (
        <p role="status" style={{ ...leadStyle, color: stopped ? 'var(--danger)' : 'var(--n-900)' }} data-testid="publish-outcome-headline">
          {unfinished
            ? PUBLISH_COPY.partialHeadline
            : outcome.status === 'blocked'
              ? PUBLISH_COPY.blockedHeadline
              : outcome.status === 'failed'
                ? PUBLISH_COPY.failedHeadline
                : accepted
                  ? PUBLISH_COPY.keptAsIs
                  : PUBLISH_COPY.completeHeadline}
        </p>
      )}
      {!showHeadline && accepted && <p style={lineStyle} data-testid="publish-kept-as-is">{PUBLISH_COPY.keptAsIs}</p>}

      {!stopped && counts && <p style={lineStyle} data-testid="publish-counts">{counts}</p>}
      {!stopped && noPhoto && <p style={lineStyle} data-testid="publish-without-image">{noPhoto}</p>}

      <ProblemList
        title={accepted ? PUBLISH_COPY.stillMissing : stopped ? PUBLISH_COPY.whatStopped : PUBLISH_COPY.partialList}
        problems={required}
        testId="publish-problems"
        fixFor={fixFor}
        fixDisabled={publishingAgain}
      />
      <ProblemList title={PUBLISH_COPY.warningsList} problems={warnings} testId="publish-warnings" fixFor={fixFor} fixDisabled={publishingAgain} />

      {cleared && <p style={lineStyle} data-testid="defaults-replaced">{cleared}</p>}

      {/* The homepage, on a site the owner already ran: theirs was kept, ours is one click away. */}
      {live && onFrontPage && (frontState === 'offered' || frontState === 'switched') && (
        <div style={boxStyle} data-testid={frontState === 'switched' ? 'front-switched' : 'front-offer'}>
          <p style={leadStyle}>
            {frontState === 'switched' ? PUBLISH_COPY.frontSwitched : frontNote ?? frontOfferText(outcome.frontPage?.previous ?? null)}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {frontState === 'switched' ? (
              <Button variant="ghost" onClick={() => void switchFront('previous')} isLoading={frontBusy} disabled={frontBusy} data-testid="front-put-back">
                {PUBLISH_COPY.putOldBack}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void switchFront('designed')} isLoading={frontBusy} disabled={frontBusy} data-testid="front-use-new">
                {PUBLISH_COPY.useNewHomepage}
              </Button>
            )}
          </div>
          {frontError && <p role="alert" style={{ ...lineStyle, color: 'var(--danger)' }}>{frontError}</p>}
        </div>
      )}
      {/* The same offer where the switch lives elsewhere (a WordPress site's
          token cannot switch it): the link opens the page that switches it. */}
      {live && !onFrontPage && frontPageLink && frontState === 'offered' && (
        <div style={boxStyle} data-testid="front-offer">
          <p style={leadStyle}>{frontOfferText(outcome.frontPage?.previous ?? null)}</p>
          <div>
            <Button variant="ghost" onClick={frontPageLink.onOpen} data-testid="front-open-dashboard">
              {frontPageLink.label}
            </Button>
          </div>
        </div>
      )}

      {/* Contact details the owner never gave were left out, never made up: the way to add them. */}
      {facts && (
        <div style={boxStyle} data-testid="facts-nudge">
          <p style={lineStyle}>{PUBLISH_COPY.factsLead}</p>
          <p style={leadStyle}>{facts}</p>
          {detailsHref && (
            <div>
              {onOpenDetails ? (
                <Button variant="secondary" onClick={() => onOpenDetails(detailsHref)} data-testid="facts-nudge-open">
                  {PUBLISH_COPY.addDetails}
                </Button>
              ) : (
                <a href={detailsHref} data-testid="facts-nudge-open" style={{ fontWeight: 600, color: 'var(--success)' }}>{PUBLISH_COPY.addDetails}</a>
              )}
            </div>
          )}
        </div>
      )}

      {leftAlone.length > 0 && (
        <div style={lineStyle} data-testid="publish-left-alone">
          {PUBLISH_COPY.ownPagesKept} {leftAloneLead()}
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {leftAlone.map((p) => (
              <li key={p.slug}>{leftAloneItem(p)}</li>
            ))}
          </ul>
        </div>
      )}

      {/* A site that already sold in another currency kept it; the new products were converted into it. Said, never silent. */}
      {currencyNote && (
        <div role="status" data-testid="store-currency-note" style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--n-600)' }}>
          {currencyNote}
        </div>
      )}

      {children}

      {unfinished && (onPublishAgain || onKeepAsIs) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {onPublishAgain && (
              <Button
                variant="primary"
                onClick={onPublishAgain}
                isLoading={publishingAgain}
                disabled={publishingAgain || !!publishAgainBlocked}
                data-testid="publish-again"
              >
                {publishingAgain ? PUBLISH_COPY.publishingAgain : PUBLISH_COPY.publishAgain}
              </Button>
            )}
            {onKeepAsIs && !confirmKeep && (
              <Button variant="ghost" onClick={() => { setConfirmKeep(true); setKeepError(null); }} disabled={publishingAgain} data-testid="keep-as-is">
                {PUBLISH_COPY.keepAsIs}
              </Button>
            )}
            <WhyDisabled reason={publishingAgain ? null : publishAgainBlocked} />
          </div>
          {confirmKeep && onKeepAsIs && (
            <div style={boxStyle} data-testid="keep-as-is-confirm">
              <p style={leadStyle}>{keepAsIsConfirm(outcome.problems)}</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button variant="primary" onClick={() => void keep()} isLoading={keeping} disabled={keeping} data-testid="keep-as-is-yes">
                  {PUBLISH_COPY.keepAsIs}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmKeep(false)} disabled={keeping}>
                  {PUBLISH_COPY.cancel}
                </Button>
              </div>
              {keepError && <p role="alert" style={{ ...lineStyle, color: 'var(--danger)' }}>{keepError}</p>}
            </div>
          )}
        </div>
      )}

      {stopped && onPublishAgain && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button
            variant="primary"
            onClick={onPublishAgain}
            isLoading={publishingAgain}
            disabled={publishingAgain || !!publishAgainBlocked}
            data-testid="publish-try-again"
          >
            {PUBLISH_COPY.tryAgain}
          </Button>
          <WhyDisabled reason={publishingAgain ? null : publishAgainBlocked} />
        </div>
      )}
    </div>
  );
}
