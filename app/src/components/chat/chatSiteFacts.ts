import type { ChatSiteFacts } from '@yotako/webmaven-ui';
import type { SiteState } from '../../utils/siteState';

/** What the site's theme lets the chat change (WEBMAVEN_WP_DATA.theme): a classic theme without theme.json keeps its colours in the Customizer. */
export function themeJsonOf(): boolean {
  const data = typeof window !== 'undefined' ? (window as any).WEBMAVEN_WP_DATA : null;
  return data?.theme?.themeJson !== false;
}

/**
 * The site as the kit's chat suggestions read it ("Try asking me to…"): the
 * kind of site (designed by WPMaven, made of blocks the edit tools change,
 * the api's 'wordpress' engine, or neither), a store or not, its theme, and
 * the account's flags for the actions behind some chips. Until the account
 * answered, nothing is known and only the chips with no condition show.
 */
export function chatSiteFactsOf(state: SiteState, themeJson: boolean = themeJsonOf()): ChatSiteFacts {
  const kind = state.business?.engine === 'genstudio' ? 'genstudio' : state.features.edits ? 'blocks' : 'legacy';
  return {
    known: state.known,
    kind,
    store: state.business?.store ?? false,
    themeJson,
    abilities: {
      campaigns: state.features.campaigns,
      seoAudit: state.features.seoAudit,
      altText: state.features.altText,
      pageRedesign: state.features.pageRedesign,
    },
  };
}
