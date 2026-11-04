// Set webpack public path dynamically for lazy-loaded chunks (editor, etc.)
// Must be before any dynamic imports
declare var __webpack_public_path__: string;
const wpData = (window as any).WEBMAVEN_WP_DATA;
if (wpData?.pluginUrl) {
  __webpack_public_path__ = wpData.pluginUrl + 'assets/';
} else {
  // Derive from the current script's URL
  const scripts = document.querySelectorAll('script[src*="dashboard.js"]');
  if (scripts.length > 0) {
    const src = (scripts[0] as HTMLScriptElement).src;
    __webpack_public_path__ = src.substring(0, src.lastIndexOf('/') + 1);
  }
}

import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './contexts';
import { ThemeProvider } from './contexts/ThemeContext';
import { ThemeProvider as WMUIThemeProvider } from '@yotako/webmaven-ui';

// The kit's fonts option (fontsHref, kit 0.11.1 from source): typed here until
// the plugin installs a kit release that declares it.
const KitThemeProvider = WMUIThemeProvider as React.ComponentType<
  React.ComponentProps<typeof WMUIThemeProvider> & { fontsHref?: string | null }
>;

// Use webmaven-ui's ThemeProvider only to inject GlobalStyles + GooeyFilters.
// The plugin's own ThemeContext manages the actual dark/light state.
// Pass storageKey matching the plugin's storage to keep them in sync.
import '@yotako/webmaven-ui/style.css';
import { DashboardLayout } from './components/Dashboard/DashboardLayout';
import AuthGate from './components/Dashboard/AuthGate';
import './styles/dashboard.css';
import './styles/pages.css';

function DashboardApp() {
  return (
    <ThemeProvider>
      <KitThemeProvider storageKey="webmaven-theme" fontsHref={window.WEBMAVEN_WP_DATA?.fontsHref}>
        <AuthProvider>
          {/* The chat keeps its own state (the kit's useCoCeoChat, one per channel). */}
          <AuthGate>
            <DashboardLayout />
          </AuthGate>
        </AuthProvider>
      </KitThemeProvider>
    </ThemeProvider>
  );
}

// Mount the app - try multiple possible root IDs
const rootIds = ['webmaven-dashboard-root', 'webmaven-onboarding-root', 'wpmaven-dashboard-root'];
let container: HTMLElement | null = null;

for (const id of rootIds) {
  container = document.getElementById(id);
  if (container) break;
}

if (container) {
  const root = createRoot(container);
  root.render(<DashboardApp />);
} else {
  console.error('WebMaven: Could not find dashboard root element');
}

export default DashboardApp;
