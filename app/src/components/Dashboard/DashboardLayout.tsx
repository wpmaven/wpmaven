import React, { useEffect, useRef } from 'react';
import { DashboardProvider, useDashboard } from '../../contexts/DashboardContext';
import { useTheme } from '../../contexts/ThemeContext';
import MinimalTopBar from './MinimalTopBar';
import SlideoverSidebar from './SlideoverSidebar';
import PageRouter from './PageRouter';
import PluginTours from './tours/PluginTours';
import { Blobs } from '@yotako/webmaven-ui';
import '../../styles/dashboard.css';

function DashboardLayoutContent() {
  const { sidebarMobileOpen, toggleMobileSidebar } = useDashboard();
  const { resolvedMode } = useTheme();
  // The washes are anchored to the scroll area, the window's height on every
  // page, never to the page inside it: anchored to a long page (Overview),
  // the orange sat under its end, out of view, while the editor's page, the
  // window's height, had it in the bottom left corner (2026-10-17).
  const mainRef = useRef<HTMLElement>(null);

  // Escape to close mobile sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarMobileOpen) toggleMobileSidebar();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sidebarMobileOpen, toggleMobileSidebar]);

  useEffect(() => {
    document.body.style.overflow = sidebarMobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarMobileOpen]);

  return (
    <div className="wm-dashboard" data-theme={resolvedMode}>
      {/* The guided tours: inside the themed root, so the tour's card takes the theme. */}
      <PluginTours>
        <SlideoverSidebar />
        <div className="wm-dashboard__main">
          <MinimalTopBar scrollRef={mainRef} />
          <main className="wm-main" ref={mainRef}>
            <div className="wm-main__inner">
              <Blobs targetRef={mainRef} />
              <PageRouter />
            </div>
          </main>
        </div>
      </PluginTours>
    </div>
  );
}

export function DashboardLayout() {
  return (
    <DashboardProvider>
      <DashboardLayoutContent />
    </DashboardProvider>
  );
}

export default DashboardLayout;
