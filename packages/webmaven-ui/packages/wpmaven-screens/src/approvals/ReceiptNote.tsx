import React, { forwardRef } from 'react';
import { Button } from '@yotako/webmaven-ui';
import { OperatorInline, isDashboardPath, type NextStep } from '@yotako/wpmaven-onboarding/shared';
import type { ReceiptTone } from './receipts';
import type { PublishedLink } from './types';
import { CheckCircleIcon, ClockIcon, ExclamationTriangleIcon, InformationCircleIcon } from './icons';
import { useOptionalScreensHost } from '../host/HostContext';
import { isAbsoluteAddress } from '../host/HostLink';
import type { ScreensHost } from '../host/types';
import { TYPE } from './styles';

const TONE_COLOR: Record<ReceiptTone, string> = {
  done: 'var(--cyan)',
  waiting: 'var(--peach)',
  problem: 'var(--rose)',
  neutral: 'var(--text-dim)',
};

const ICON: Record<ReceiptTone, typeof CheckCircleIcon> = {
  done: CheckCircleIcon,
  waiting: ClockIcon,
  problem: ExclamationTriangleIcon,
  neutral: InformationCircleIcon,
};

export interface ReceiptNoteProps {
  message: string;
  tone: ReceiptTone;
  /** A button beside the sentence (e.g. "See it in History"). */
  action?: React.ReactNode;
  /**
   * The one thing to do next (Receipt.nextStep), drawn as the primary button
   * before `action`: a yes held for actions gets "Get more actions". Its
   * button goes through the host (the plugin's opens the dashboard).
   */
  nextStep?: NextStep | null;
  /**
   * What the app draws in the next step's place (the dashboard's pack
   * choice, or its own next step button); null draws nothing there. Given,
   * it wins over `nextStep`.
   */
  next?: React.ReactNode;
  /**
   * The public links of what was published ("View on YouTube"), drawn after
   * the sentence as text links that open the network in a new tab. Nothing
   * is drawn for an empty list.
   */
  links?: PublishedLink[] | null;
  testId?: string;
}

/**
 * The confirmation of what the owner just did, at the place they did it: on
 * the card, and in the spot a card left when it moved under History. Full
 * text color at body size, a tinted edge and an icon, so it reads as the
 * answer to the press rather than as fine print. A live region, so a screen
 * reader hears it too. Focusable (tabIndex -1) so the page can bring the
 * owner's focus to it. The same in both apps; the dashboard adds its pack
 * choice through `next`.
 */
export const ReceiptNote = forwardRef<HTMLDivElement, ReceiptNoteProps>(({
  message, tone, action, nextStep = null, next, links = null, testId = 'receipt',
}, ref) => {
  const Icon = ICON[tone];
  const color = TONE_COLOR[tone];
  return (
    <div
      ref={ref}
      role="status"
      tabIndex={-1}
      data-testid={testId}
      data-tone={tone}
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
        padding: '10px 12px', borderRadius: 10, scrollMarginTop: 16, outline: 'none', boxSizing: 'border-box',
        border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        color: 'var(--text)', fontSize: TYPE.body, lineHeight: TYPE.bodyLeading,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: '1 1 220px', minWidth: 0 }}>
        <span style={{ color, flexShrink: 0, display: 'inline-flex', marginTop: 2 }}>
          <Icon size={20} />
        </span>
        {/* Rendered, not printed: an approval's receipt is often the API's
            summary, which quotes the reason the owner approved, and that
            reason is model text ("What you approved: **Adds** the page"). */}
        <span style={{ minWidth: 0 }}>
          <OperatorInline text={message} style={{ overflowWrap: 'anywhere' }} />
          <PublishedLinks links={links} testId="receipt-link" />
        </span>
      </span>
      {next !== undefined ? next : (nextStep && <NextStepButton step={nextStep} source="receipt" />)}
      {action}
    </div>
  );
});
ReceiptNote.displayName = 'ReceiptNote';

/**
 * Opens one of the dashboard's pages through the host: the dashboard routes
 * it, the plugin opens the dashboard (an absolute address, in a new tab).
 */
export function openPage(host: ScreensHost | null, to: string): void {
  const href = host ? host.link(to) : to;
  if (isAbsoluteAddress(href)) window.open(href, '_blank', 'noopener,noreferrer');
  else if (host) host.navigate(to);
  else window.location.assign(href);
}

/** A button to one of the dashboard's pages (Open billing), through the host. */
export const PageButton: React.FC<{
  to: string;
  /** Analytics category. */
  source: string;
  variant?: 'primary' | 'outline';
  testId?: string;
  children: React.ReactNode;
}> = ({ to, source, variant = 'primary', testId, children }) => {
  const host = useOptionalScreensHost();
  return (
    <Button
      size="sm"
      variant={variant}
      data-testid={testId}
      data-href={to}
      onClick={() => {
        host?.track?.(source, 'open', to);
        openPage(host, to);
      }}
    >
      {children}
    </Button>
  );
};

/**
 * The way to more actions, or to the page that unlocks a held change, as the
 * primary button: through the host, so the dashboard routes it and the
 * plugin opens the dashboard's page. Only a page of the dashboard is ever
 * opened (isDashboardPath).
 */
export const NextStepButton: React.FC<{ step: NextStep; source: string; variant?: 'primary' | 'outline' }> = ({ step, source, variant = 'primary' }) => {
  const host = useOptionalScreensHost();
  if (!isDashboardPath(step.href)) return null;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }} data-testid="held-next-step" data-kind={step.kind}>
      <Button
        size="sm"
        variant={variant}
        data-href={step.href}
        onClick={() => {
          host?.track?.(source, 'next_step', step.kind ?? step.href);
          openPage(host, step.href);
        }}
      >
        {step.label}
      </Button>
    </span>
  );
};

/**
 * The public links of a published post, as text links with the API's words
 * ("View on YouTube"), each opening the network in a new tab. Nothing for an
 * empty list. Also drawn on an executed card under History (Your team).
 */
export function PublishedLinks({ links, testId }: { links?: PublishedLink[] | null; testId: string }) {
  if (!links || links.length === 0) return null;
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 4 }}>
      {links.map((l) => (
        <a
          key={`${l.network}:${l.url}`}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={testId}
          data-network={l.network}
          style={{ color: 'var(--text)', textDecoration: 'underline', textUnderlineOffset: 3, fontWeight: 500 }}
        >
          {l.label}
        </a>
      ))}
    </span>
  );
}

export default ReceiptNote;
