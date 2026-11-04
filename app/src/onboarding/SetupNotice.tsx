import React, { useState } from 'react';
import './setupNotice.css';

/**
 * What someone who is not an administrator reads while the site has no
 * business: the setup wizard is an administrator's, and an administrator
 * can run it here. A bar above the app that never covers it (the app takes
 * the height left under it), dismissed for the browser session.
 */

export const ADMIN_SETUP_NOTICE = 'An administrator of this site can set up the business here.';
export const DISMISS_NOTICE_LABEL = 'Dismiss';
/** The notice was dismissed in this browser session. */
export const SETUP_NOTICE_DISMISSED_KEY = 'webmaven-setup-notice-dismissed';

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(SETUP_NOTICE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export default function SetupNotice({ show, children }: { show: boolean; children: React.ReactNode }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const on = show && !dismissed;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(SETUP_NOTICE_DISMISSED_KEY, '1');
    } catch {
      // Private browsing: this page view only.
    }
    setDismissed(true);
  };

  // The same elements with the notice or without it, so the app below
  // never mounts again when it comes or goes.
  return (
    <div className={on ? 'wm-setup-notice-frame wm-setup-notice-frame--on' : 'wm-setup-notice-frame'}>
      {on && (
        <div className="wm-setup-notice" role="status" data-testid="wm-setup-notice">
          <span className="wm-setup-notice__text">{ADMIN_SETUP_NOTICE}</span>
          <button type="button" className="wm-setup-notice__close" aria-label={DISMISS_NOTICE_LABEL} title={DISMISS_NOTICE_LABEL} onClick={dismiss}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
      <div className="wm-setup-notice-frame__app">{children}</div>
    </div>
  );
}
