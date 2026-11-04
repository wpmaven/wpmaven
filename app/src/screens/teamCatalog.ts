/**
 * The AI team's catalog for Your team in the plugin (1.7.0): each member's
 * title and badge colour, from the API's GET /onboarding/operators.
 *
 * That route is the setup wizard's (the plugin's wizard proxy,
 * webmaven_wp/v1/wizard/..., administrators), not one the REST proxy
 * forwards, so the shared screen is handed the catalog read here and never
 * asks the proxy for it (it would be refused). Until it comes, or when it
 * cannot be read, the screen holds an empty catalog: each member reads with
 * the kit's title.
 */
import { useEffect, useState } from 'react';
import { payloadOf, readCatalog, type TeamCatalog } from '@yotako/wpmaven-screens';
import { createPluginTransport } from '../onboarding/pluginTransport';

/** No member known yet: the kit's titles. Never null, so the screen does not read it itself. */
export const EMPTY_TEAM_CATALOG: TeamCatalog = new Map();

let read: Promise<TeamCatalog> | null = null;

/**
 * The catalog, read once per page load (it is the same for every account).
 * A failed read is not kept: the next screen asks again.
 */
export function loadPluginTeamCatalog(): Promise<TeamCatalog> {
  if (!read) {
    read = createPluginTransport()
      .request<unknown>({ method: 'GET', path: '/onboarding/operators' })
      .then((body) => readCatalog(payloadOf(body)) as TeamCatalog)
      .catch((e) => {
        read = null;
        throw e;
      });
  }
  return read;
}

/** The catalog for a screen: empty until it is read, and when it cannot be. */
export function usePluginTeamCatalog(): TeamCatalog {
  const [catalog, setCatalog] = useState<TeamCatalog>(EMPTY_TEAM_CATALOG);
  useEffect(() => {
    let alive = true;
    loadPluginTeamCatalog()
      .then((c) => { if (alive) setCatalog(c); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return catalog;
}

/** For the tests: forget the catalog read before. */
export function forgetPluginTeamCatalog(): void {
  read = null;
}
