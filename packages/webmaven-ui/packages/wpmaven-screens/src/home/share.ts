import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreensHost, ScreensTransport, SiteShare, SiteShareHook } from '../host/types';
import { useOptionalScreensHost } from '../host/HostContext';

/**
 * Share the business the owner built (moved from the dashboard's Home,
 * 2026-10-17): the message, the referral link that rides along, and the
 * share itself, one copy for every share control of both apps (Your
 * website's Share, the launch card's, the milestones' Share your store).
 *
 * WHAT IS BEING SHARED is the owner's own site, never WPMaven. People want
 * to show the thing they made, so the share is about their thing, and the
 * referral link rides along inside it instead of interrupting the moment to
 * ask for a referral. No popup, one control, one action, nothing modal.
 *
 * HONESTY, which decides most of the copy in this file:
 *  - The referred person's half is credited when they pay their first
 *    full-price invoice, and the owner's half once that person's 14-day
 *    withdrawal window has closed. Never at signup, never on the $1 week.
 *    So the PUBLIC message, the text the owner pastes where other people
 *    read it, claims nothing at all about rewards. It says they built their
 *    business and it links to it.
 *  - What that public message DOES say is that the link is a referral link.
 *    The owner is credited for it, so the person reading it is owed that
 *    much; an unmarked "Built with WPMaven" would present a link the owner
 *    benefits from as a plain product credit.
 *  - The explanation of what the owner gets stays next to the control, and
 *    carries its condition in the same sentence, as the dashboard's referral
 *    panel on Billing does: every figure from the payload, the same "up to"
 *    on both halves, because the engine clamps both against the
 *    prepaid-balance cap and can land none of them.
 *  - When the share address cannot attribute (host.referralLinkAttributes),
 *    or the app is under another brand (host.whiteLabel), no referral link
 *    travels and nothing implies sharing earns anything.
 *
 * DEGRADING TO NOTHING. GET /referrals/me 404s when REFERRALS_ENABLED is off
 * or the account has no paid subscription, and a site's read may be
 * refused (its role, its switch). The share does NOT disappear then:
 * showing people the site you just built is useful on its own and makes no
 * claim, so it simply carries no code and says nothing about rewards.
 *
 * NOT A NAG, ever. No counter, no badge, no "you have not shared yet", no
 * reminder, no second ask.
 */

/**
 * The `gap` the parent row must use, in pixels. The detail line under a
 * share control cancels exactly one row gap when it has nothing to say,
 * which is the state it lives in almost all of the time; both sides read
 * the number from here.
 */
export const SHARE_ROW_GAP = 10;

/** The address a person would read out loud: no scheme, no trailing slash. */
export function prettyHost(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

/** What the shared message says without a referral link. */
export function basicShareMessage(siteUrl: string): string {
  return `I built my business. Here it is: ${siteUrl}`;
}

/**
 * The message the owner publishes. One claim, and it is theirs to make:
 * they built their business, and here it is. The second line names the link
 * for what it is, the owner's referral link: a disclosure, not decoration,
 * and the same sentence the video share on Team hands out for the same URL.
 */
export function buildShareMessage(siteUrl: string, referralUrl: string | null): string {
  const mine = basicShareMessage(siteUrl);
  return referralUrl
    ? `${mine}\n\nBuilt with WPMaven. Here is my referral link if you want the same for yours: `
      + referralUrl
    : mine;
}

export const SHARE_COPY = {
  copied: 'Copied. Paste it wherever you want to show people.',
  unavailable: 'Copying is not available in this browser. Select the message below to copy it by hand.',
};

// ── The referral link (GET /referrals/me) ────────────────────────────────

/** The account's referral offer, as a share reads it: every number the engine's own. */
export interface ShareReferral {
  code: string;
  shareUrl: string;
  /** AI actions the referred person gets, at vest time. Always > 0. */
  giveActions: number;
  /** AI actions the referrer gets per converted referral, at vest time. */
  getActions: number;
  /** Conversions that can earn the referrer actions per calendar month (UTC); 0 is real: none earn. */
  monthlyVestCap: number;
  /** Conversions vested this calendar month (UTC). */
  vestedThisMonth: number;
}

/** Why the referrer's half waits: the sentence every referral surface uses. */
export const REFERRAL_WAIT_REASON =
  'Your half waits for their first 14 days, because until then they can still withdraw and be '
  + 'refunded. If they do, that referral adds nothing.';

/**
 * When the monthly cap counter goes back to zero: the first day of the next
 * calendar month, UTC, which is exactly the boundary the API counts from.
 */
export function capResetsAt(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** A number the engine actually sent, not a default standing in for one (an absent dial is stripped, not zero). */
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isPositiveCount = (v: unknown): v is number => isCount(v) && v > 0;

/**
 * The account's referral offer, or null when there is none a share can
 * state honestly: the engine off or the account not paid (404), a refusal,
 * no answer, a dial missing, or a share address that would attribute
 * nothing (`attributes`). Never throws.
 */
export async function readShareReferral(
  transport: ScreensTransport,
  attributes: (shareUrl: string) => boolean,
): Promise<ShareReferral | null> {
  try {
    const p = await transport.get<Partial<ShareReferral> | null>('/referrals/me');
    if (!p || typeof p.code !== 'string' || !p.code) return null;
    if (typeof p.shareUrl !== 'string' || !p.shareUrl || !attributes(p.shareUrl)) return null;
    if (!isPositiveCount(p.giveActions) || !isPositiveCount(p.getActions)) return null;
    if (!isCount(p.monthlyVestCap) || !isCount(p.vestedThisMonth)) return null;
    return {
      code: p.code,
      shareUrl: p.shareUrl,
      giveActions: p.giveActions,
      getActions: p.getActions,
      monthlyVestCap: p.monthlyVestCap,
      vestedThisMonth: p.vestedThisMonth,
    };
  } catch {
    return null;
  }
}

/**
 * What the OWNER is told, next to the control, before they use it. Every
 * number comes from the payload, the vesting condition in the same sentence
 * as the numbers. The three states are the referral panel's on Billing,
 * read from the same two fields.
 */
export function referralNote(r: ShareReferral, now: Date = new Date()): string {
  // A cap of 0 is a real setting: the owner is credited nothing by any
  // referral, while the referred person still gets their give.
  const ownerEarns = r.monthlyVestCap > 0;
  const atCap = r.vestedThisMonth >= r.monthlyVestCap;
  // The API counts the cap from the first of the calendar month in UTC.
  const resetLabel = capResetsAt(now).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', timeZone: 'UTC',
  });
  const lead = 'Your referral link goes with it.';
  // "up to", on BOTH numbers: the engine clamps both against the same
  // prepaid-balance ceiling, and grants none with no subscription row.
  const core = !ownerEarns
    ? `${lead} Someone who starts from that link gets up to ${r.giveActions} AI actions, added only `
      + 'when they pay their first full-price invoice. Nothing is added at signup, and the $1 first '
      + 'week does not count. Referrals are not adding actions to your own balance right now.'
    : atCap
      ? `${lead} Someone who starts from that link gets up to ${r.giveActions} AI actions when they `
        + `pay their first full-price invoice. You have reached this month's limit of `
        + `${r.monthlyVestCap} referrals that earn you actions, so you earn none until the count `
        + `resets on ${resetLabel}.`
      : `${lead} Someone who starts from that link gets up to ${r.giveActions} AI actions when they `
        + `pay their first full-price invoice, and you get up to ${r.getActions} AI actions when `
        + 'their first 14 days as a paying customer are over. Nothing is added at signup, and the $1 '
        + `first week does not count. ${REFERRAL_WAIT_REASON} `
        + 'Referral actions go to your prepaid balance, and actions over that balance\'s cap are '
        + 'not added.';
  return `${core} The message you share names the link as your referral link and says nothing `
    + 'about these actions.';
}

// ── The share ────────────────────────────────────────────────────────────

/** Web Share is present: undefined outside a secure context, and on most desktop browsers. */
const nativeShareAvailable = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/**
 * The share, for every control that shares the owner's site, with the
 * host's referral link when it can vouch for one: the browser's share sheet
 * where it has one, else a copy of the message, and when even that is
 * blocked, the message on screen to select by hand. It never says "shared":
 * the sheet closing is the confirmation. `where` names the control in the
 * app's analytics. An empty siteUrl reads nothing.
 */
export function useHostSiteShare(host: ScreensHost | null, siteUrl: string, siteName: string | null | undefined, where: string): SiteShare {
  const [referral, setReferral] = useState<ShareReferral | null>(null);
  const [state, setState] = useState<SiteShare['state']>('idle');
  const hostRef = useRef(host);
  hostRef.current = host;
  // A branded address never carries WPMaven's referral program: the share is the owner's site alone.
  const readsReferral = !!host && !host.whiteLabel && !!host.referralLinkAttributes;

  // Best effort and silent: no referral is no code, never an error.
  useEffect(() => {
    if (!siteUrl || !readsReferral) return undefined;
    const h = hostRef.current!;
    let cancelled = false;
    void readShareReferral(h.transport, (url) => !!h.referralLinkAttributes?.(url))
      .then((mine) => { if (!cancelled) setReferral(mine); });
    return () => { cancelled = true; };
  }, [siteUrl, readsReferral]);

  // The read already refuses an address that cannot attribute; asked again
  // here so the promise ("nothing implies a reward unless one can land")
  // holds on its own.
  const referralUrl = readsReferral && referral && host?.referralLinkAttributes?.(referral.shareUrl) ? referral.shareUrl : null;
  const note = referralUrl && referral ? referralNote(referral) : '';

  const message = buildShareMessage(siteUrl, referralUrl);
  const canNative = nativeShareAvailable();
  const track = (action: string) => hostRef.current?.track?.('home', action, where, referralUrl ? 1 : 0);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message);
      setState('copied');
      track('site_share_copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      // Clipboard blocked or absent. Say so and put the message on screen to
      // select by hand, rather than pretend the copy happened.
      setState('unavailable');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, where, referralUrl]);

  const share = useCallback(async () => {
    if (canNative) {
      // Both links live in `text` on purpose: a target that keeps only `url`
      // would drop the referral, one that keeps only `text` the site itself.
      const payload: ShareData = { title: siteName || prettyHost(siteUrl), text: message };
      try {
        if (typeof navigator.canShare === 'function' && !navigator.canShare(payload)) {
          await copy();
          return;
        }
        await navigator.share(payload);
        track('site_share_native');
        // No confirmation line: the sheet closing is the confirmation.
        return;
      } catch (err) {
        // Dismissing the sheet is a decision, not a failure. Say nothing.
        if ((err as { name?: string } | null)?.name === 'AbortError') return;
        // Anything else (no permission, no target): the clipboard still works.
      }
    }
    await copy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canNative, copy, message, referralUrl, siteName, siteUrl, where]);

  const status = state === 'unavailable' ? SHARE_COPY.unavailable : state === 'copied' ? SHARE_COPY.copied : '';
  return { share, state, canNative, status, note, message };
}

/** The share as a hook of the host in context (the app's own section, or none: no referral link). */
export const useSiteShare: SiteShareHook = (siteUrl, siteName, where) => useHostSiteShare(useOptionalScreensHost(), siteUrl, siteName, where);

/** The share without a referral link: no host to read it through. */
export const useBasicSiteShare: SiteShareHook = (siteUrl, siteName, where) => useHostSiteShare(null, siteUrl, siteName, where);

/**
 * The share a section uses: the host's own when it has one, else the shared
 * one with the host's referral link. The host's hook is one function for the
 * host's life, so the hooks run in the same order on every render.
 */
export function useSectionSiteShare(siteUrl: string, siteName: string | null | undefined, where: string): SiteShare {
  const host = useOptionalScreensHost();
  const hook = host?.siteShare ?? useSiteShare;
  return hook(siteUrl, siteName, where);
}
