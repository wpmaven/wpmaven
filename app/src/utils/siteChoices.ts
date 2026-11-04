/**
 * What a site shares, the owner's to choose (administrators): visitor
 * statistics, the copy of the store's customers for email campaigns, and the
 * "Built with WPMaven" link in the footer. The plugin's /choices holds the
 * answers. Asked once, before WPMaven's other screens (ChoicesQuestion), and
 * changed any time in Settings (ChoicesCard), in the same words.
 */

export type ChoiceKey = 'analytics_enabled' | 'contact_sync_enabled' | 'badge_enabled';

export interface Choice {
  key: ChoiceKey;
  title: string;
  text: string;
}

/** The choices this site offers, in the owner's words: the customers' copy with a store, the footer link on a WPMaven site. */
export function choicesFor(opts: { store: boolean; ours: boolean; dashboard: string }): Choice[] {
  const list: Choice[] = [{
    key: 'analytics_enabled',
    title: 'Visitor statistics',
    text: 'Counts the visits to your site for your reports. Each visitor\'s browser sends the page address, the page they came from and their screen size. No cookies.',
  }];
  if (opts.store) {
    list.push({
      key: 'contact_sync_enabled',
      title: 'Your customers, for email campaigns',
      text: `Copies the email address of each of your store's customers, and whether they agreed to marketing emails, to ${opts.dashboard}, so your team can send them campaigns. Someone who unsubscribes is marked so.`,
    });
  }
  if (opts.ours) {
    list.push({
      key: 'badge_enabled',
      title: '"Built with WPMaven" in your footer',
      text: 'A small link to WPMaven at the bottom of your site\'s pages.',
    });
  }
  return list;
}
