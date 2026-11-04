/**
 * Home's greeting (2026-10-17), one for the dashboard's Home and the plugin's
 * Overview: the product's mark beside two lines, "Welcome back, Ana" in the
 * title face and what the page is about under it. The first time someone
 * opens Home it says "Welcome, Ana".
 *
 * Each app passes its own mark (the WPMaven mark, a brand's logo) and its
 * own line: the plugin's is about the site, the dashboard's about the
 * business or the businesses. The dashboard's portfolio controls sit at the
 * row's end (actions), where its "Your businesses" title was.
 */
import React, { useEffect, useState } from 'react';
import { WMLogo } from '@yotako/webmaven-ui';

/**
 * The two lines, from the top of the title's tallest letters to the
 * baseline of the line under it, in px: the title's ascenders start 6px
 * into its 36px line, the line under it starts 4px below and sits on its
 * baseline 15.6px into its 21px line, 55.6px down.
 */
export const WELCOME_LINES_PX = 49.6;

/** The WPMaven mark is 50.275 units of its 64-unit box tall (WMLogo). */
const MARK_IN_BOX = 50.275 / 64;

/**
 * Our mark sits off centre in its 64-unit box: its middle is 1.25 units right
 * of the box's middle and 1.25 above it. The kit's loaders move it back by
 * that much, and the still mark does the same, so both sit in one place.
 */
const MARK_CENTRING = 1.25 / 64;

/**
 * The box of the mark beside the greeting, for the mark to be exactly as
 * tall as the two lines: the WPMaven mark's box is a little taller than the
 * mark, a brand's logo fills its own.
 */
export function welcomeMarkSize(ours: boolean): number {
  return Math.round(ours ? WELCOME_LINES_PX / MARK_IN_BOX : WELCOME_LINES_PX);
}

/** The WPMaven mark, still, centred in its box as the loaders draw it. */
export function OurStillMark({ size }: { size: number }) {
  const shift = size * MARK_CENTRING;
  return (
    <span style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <span style={{ display: 'flex', transform: `translate(${-shift}px, ${shift}px)` }}>
        <WMLogo size={size} />
      </span>
    </span>
  );
}

/** "Welcome back, Ana", or "Welcome, Ana" the first time; without a name, the words alone. */
export function welcomeTitle(name: string | null | undefined, firstTime: boolean): string {
  const words = firstTime ? 'Welcome' : 'Welcome back';
  const own = (name ?? '').trim();
  return own ? `${words}, ${own}` : words;
}

type KeyStore = Pick<Storage, 'getItem' | 'setItem'>;

/** Where a browser remembers that this person was greeted, per person. */
export const welcomedKeyFor = (person: string) => `wpm_welcomed:${person}`;

function browserStorage(): KeyStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Whether this browser already greeted this person. A storage that cannot be read counts as yes: never a wrong first Welcome. */
export function wasWelcomed(person: string, storage: KeyStore | null = browserStorage()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(welcomedKeyFor(person)) !== null;
  } catch {
    return true;
  }
}

export function markWelcomed(person: string, storage: KeyStore | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(welcomedKeyFor(person), new Date().toISOString());
  } catch {
    // Private mode: this visit only.
  }
}

/**
 * Whether this is the first time this person opens Home: true for the
 * whole of that visit, then never again in this browser (kept per person,
 * as the WhatsApp card's "Not now" is). Before the person is known
 * (person null), not the first time.
 */
export function useFirstWelcome(person: string | null | undefined, storage?: KeyStore | null): boolean {
  const [seen, setSeen] = useState(() => ({ person, first: !!person && !wasWelcomed(person, storage) }));
  // Someone else signed in: their own first time, read again.
  const current = seen.person === person ? seen : { person, first: !!person && !wasWelcomed(person, storage) };
  if (current !== seen) setSeen(current);
  useEffect(() => {
    if (person && current.first) markWelcomed(person, storage);
  }, [person, current.first, storage]);
  return current.first;
}

export interface WelcomeHeaderProps {
  /** The mark, exactly as tall as the two lines (welcomeMarkSize). */
  mark: React.ReactNode;
  /** welcomeTitle's words. */
  title: string;
  /** The line under it; null keeps its room while it is not known yet. */
  subtitle: string | null;
  /** At the row's end, beside the lines (the dashboard's portfolio controls). */
  actions?: React.ReactNode;
  className?: string;
  'data-tour'?: string;
  'data-testid'?: string;
}

/**
 * The mark and the two lines, centred on each other, the title in the
 * title face at the dashboard's sign-in size (30px). Its sizes are set
 * here, in px, so wp-admin's own h1 and p rules never reach them.
 */
export function WelcomeHeader({ mark, title, subtitle, actions, className, ...data }: WelcomeHeaderProps) {
  return (
    <div className={className} {...data} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '16px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, minWidth: 0, flex: '1 1 auto' }}>
        {mark}
        <div style={{ minWidth: 0 }}>
          <h1 style={{
            fontFamily: 'var(--font-title)', fontSize: 30, fontWeight: 400, letterSpacing: '-0.015em',
            lineHeight: 1.2, color: 'var(--text)', margin: 0, padding: 0,
          }}>
            {title}
          </h1>
          <p
            aria-hidden={subtitle === null ? true : undefined}
            style={{
              fontSize: 14, lineHeight: 1.5, color: 'var(--text-dim)', margin: '4px 0 0', padding: 0,
              visibility: subtitle === null ? 'hidden' : undefined,
            }}
          >
            {subtitle ?? 'Here is what is happening'}
          </p>
        </div>
      </div>
      {actions}
    </div>
  );
}
