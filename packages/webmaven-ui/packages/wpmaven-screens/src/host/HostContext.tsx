import React, { createContext, useContext, type ReactNode } from 'react';
import type { ScreensHost } from './types';

/** The host of the screen being rendered (exported for the node tests). */
export const ScreensHostContext = createContext<ScreensHost | null>(null);

/**
 * Makes the host reachable from every part of a screen (each screen renders
 * it around itself). An app that draws a shared piece outside a screen (the
 * dashboard's Your team draws the approval card) renders it around that
 * piece too.
 */
export function ScreensHostProvider({ host, children }: { host: ScreensHost; children: ReactNode }) {
  return <ScreensHostContext.Provider value={host}>{children}</ScreensHostContext.Provider>;
}

/** The host of the screen being rendered. Throws outside a screen. */
export function useScreensHost(): ScreensHost {
  const host = useContext(ScreensHostContext);
  if (!host) throw new Error('A WPMaven screen needs a host: render it with its host prop, or inside <ScreensHostProvider>.');
  return host;
}

/** The host when there is one: the shared pieces also render without it (the app's own pages). */
export function useOptionalScreensHost(): ScreensHost | null {
  return useContext(ScreensHostContext);
}
