/**
 * Share your site, as a control of the Home sections (moved from the
 * dashboard's Home, 2026-10-17): the launch card's and Your website's, in
 * both apps. The share itself, its message and its referral link are
 * share.ts's (useHostSiteShare).
 *
 * THE MOMENT. A business going live is the one moment its owner actually
 * wants to show somebody. The place the owner lands and STAYS is the launch
 * card on the dashboard's Home, so the control is there ('banner'), and,
 * because that card is consumed on mount, quietly in Your website forever
 * after ('quiet'): a missed moment must not lose the share.
 */
import React from 'react';
import { HiOutlineCheck, HiOutlineClipboardDocument, HiOutlineShare } from 'react-icons/hi2';
import type { ScreensHost } from '../host/types';
import { SHARE_ROW_GAP, useHostSiteShare } from './share';

export type ShareVariant = 'banner' | 'quiet';

export interface ShareYourSiteProps {
  /** The app's host: its referral link, its analytics. Absent: the share alone. */
  host?: ScreensHost | null;
  /** The owner's site. Nothing renders without one. */
  siteUrl: string;
  /** Used as the share sheet's title; falls back to the host. */
  siteName?: string | null;
  variant: ShareVariant;
}

export const ShareYourSite: React.FC<ShareYourSiteProps> = ({ host = null, siteUrl, siteName, variant }) => {
  const { share, state, canNative, status, note, message } = useHostSiteShare(host, siteUrl, siteName, variant);

  if (!siteUrl) return null;

  const isBanner = variant === 'banner';
  const Icon = state === 'copied' ? HiOutlineCheck : canNative ? HiOutlineShare : HiOutlineClipboardDocument;
  // The control says exactly what it does, and what it does differs by
  // browser: a native sheet where there is one, the clipboard where there is
  // not. It never says "share" and then silently copy.
  const label = state === 'copied'
    ? 'Copied'
    : canNative ? 'Share your site' : 'Copy your site link';

  const hasDetail = !!status || !!note || state === 'unavailable';
  const detailSize = isBanner ? 'var(--text-data)' : 'var(--text-meta)';

  return (
    <>
      <button
        type="button"
        onClick={() => void share()}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: isBanner ? 'var(--text-body)' : 'var(--text-meta)',
          fontWeight: 600,
          color: 'var(--purple)',
        }}
      >
        <Icon style={{ width: 14, height: 14, flexShrink: 0 }} aria-hidden="true" />
        {label}
      </button>

      {/*
        * The detail sits on its own line under the control: the parent is a
        * wrapping flex row, so a full-width child (flexBasis 100%) always
        * starts a new line.
        *
        * The negative margin cancels the parent's row gap (SHARE_ROW_GAP) in
        * the state this control spends almost all of its life in: nothing to
        * say. The live region still has to be MOUNTED in that state (a status
        * region inserted with its text is not reliably announced), so it is
        * kept in the tree at zero height instead.
        */}
      <div style={{ flexBasis: '100%', minWidth: 0, marginTop: hasDetail ? 6 : -SHARE_ROW_GAP }}>
        <p
          role="status"
          aria-live="polite"
          style={{ margin: 0, fontSize: detailSize, color: 'var(--text-dim)', lineHeight: 'var(--leading-body)' }}
        >
          {status}
        </p>
        {note && (
          <p style={{
            margin: status ? '4px 0 0' : 0,
            fontSize: detailSize, color: 'var(--text-dim)', lineHeight: 'var(--leading-body)',
          }}>
            {note}
          </p>
        )}
        {state === 'unavailable' && (
          <code style={{
            display: 'block', marginTop: 6, padding: '8px 10px', borderRadius: 8,
            background: 'var(--glass)', border: '1px solid var(--glass-border)',
            color: 'var(--text)', fontSize: 'var(--text-meta)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {message}
          </code>
        )}
      </div>
    </>
  );
};

export default ShareYourSite;
