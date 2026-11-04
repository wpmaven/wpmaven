import React, { useEffect, useState } from 'react';
import { useDashboard, DashboardPage } from '../../contexts/DashboardContext';
import { Button, NavIcon } from '@yotako/webmaven-ui';
import PageSwitcher from './PageSwitcher';
import AlertBell from './AlertBell';
import HelpMenu from './tours/HelpMenu';
import { dashboardLink, hasFeature, useSiteState } from '../../utils/siteState';
import { siteHomeUrl } from '../../utils/thisSite';
import { siteBrand, dashboardPhrase } from '../../utils/brand';
import { currentTier, tierIn } from '../../utils/tier';

const SWITCHER_PAGES: DashboardPage[] = ['home', 'site-editor'];

export const OPEN_SITE_LABEL = 'Open your site';

/** The site as visitors see it, in a new tab, from any page: in the editor, what it shows (2026-10-19). */
function openSite(viewUrl: string | null): void {
  window.open(viewUrl || siteHomeUrl(), '_blank', 'noopener,noreferrer');
}

/**
 * The top bar. Clear while the page is at its top; once the page under it
 * scrolls (scrollRef, the scroll area), the panel and its line, as the
 * dashboard's header (2026-10-17).
 */
function MinimalTopBar({ scrollRef }: { scrollRef?: React.RefObject<HTMLElement | null> }) {
  const { currentPage, sidebarOpen, toggleSidebar, toggleMobileSidebar, editorViewUrl } = useDashboard();

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return undefined;
    const read = () => setScrolled(el.scrollTop > 0);
    // Read again for a new page too: it may start lower or higher.
    read();
    el.addEventListener('scroll', read, { passive: true });
    return () => el.removeEventListener('scroll', read);
  }, [scrollRef, currentPage]);

  const site = useSiteState();
  const inboxLabel = `Open your inbox in ${dashboardPhrase(siteBrand())}`;

  const handleBurger = () => {
    if (window.innerWidth <= 768) toggleMobileSidebar();
    else toggleSidebar();
  };

  return (
    <header className={scrolled ? 'wm-topbar wm-topbar--scrolled' : 'wm-topbar'}>
      <div className="wm-topbar__left">
        <Button variant="bare" onClick={handleBurger} aria-label="Toggle menu"
          style={sidebarOpen ? { background: 'var(--glass)', color: 'var(--text)' } : undefined}>
          <NavIcon name="bars-3" size={18} strokeWidth={2} />
        </Button>
      </div>

      {SWITCHER_PAGES.includes(currentPage) && <PageSwitcher />}

      <div className="wm-topbar__actions">
        {/* The site in a new tab (2026-10-16), on every page and for every
            role, beside the "?": the kit's bare icon button, as the bell. */}
        <Button variant="bare" onClick={() => openSite(currentPage === 'site-editor' ? editorViewUrl ?? null : null)} aria-label={OPEN_SITE_LABEL} title={OPEN_SITE_LABEL} data-testid="wm-open-site" data-tour="open-site">
          <NavIcon name="arrow-top-right-on-square" size={18} />
        </Button>
        {/* The "?" (1.7.0): the tours again, and the guides, on every page;
            the bell on its right, as in the dashboard's top bar. */}
        <HelpMenu />
        {/* The bell polls notifications only where the account lets this
            site read them, for the roles that may (owners and shop
            managers); otherwise an owner's inbox opens in the dashboard. */}
        {!tierIn(['owner', 'store'], currentTier()) ? null : hasFeature(site, 'notifications') ? (
          <AlertBell />
        ) : currentTier() !== 'owner' ? null : (
          <a href={dashboardLink(site, '/waiting')} target="_blank" rel="noopener noreferrer" aria-label={inboxLabel} title={inboxLabel} data-testid="wm-inbox-link" data-tour="bell" style={{ textDecoration: 'none' }}>
            <Button variant="bare" aria-label={inboxLabel}>
              <NavIcon name="inbox" size={18} strokeWidth={2} />
            </Button>
          </a>
        )}
      </div>
    </header>
  );
}

export default MinimalTopBar;
