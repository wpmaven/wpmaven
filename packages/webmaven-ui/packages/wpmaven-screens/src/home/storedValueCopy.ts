/**
 * What you have built here, a Home section (StoredValue.tsx, the dashboard's
 * Home and the WordPress plugin's Overview): what the owner has put into the
 * account so far, read back as plain facts (the decisions they made on the
 * AI team's drafts, the corrections they wrote in their own words, the
 * channels they connected, what the team published and where, the weeks of
 * history). Statements of fact only: never a reward, a streak or a claim
 * that the team learned from them.
 *
 * English is the source; the French is written by hand (src/i18n/fr.json,
 * namespace screensStoredValue), the other languages by the dashboard's
 * translation script. Numbers and
 * dates come formatted in the page's language.
 */
import { localized } from '@yotako/webmaven-ui';

export const STORED_VALUE_COPY_EN = {
  /** The section's title (small capitals). */
  title: 'What you have built here',
  /** Beside the title: how long the owner has had the team; {0} the days (a count). */
  daysWithTeam: (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'day' : 'days'} with your team`,
  /** When nothing has built up yet (the second day). */
  nothingYet: 'Nothing has built up here yet. This fills as you go: every draft you approve or reject, every change you ask for in your own words, each channel you connect, and everything your team publishes.',
  /** The decisions the owner made on the team's drafts; {0} how many (a count). */
  decisions: (n: number) => `You have made ${n.toLocaleString('en-US')} ${n === 1 ? 'decision' : 'decisions'} on your team's work.`,
  /** The same with the day of the first; {0} how many (a count), {1} the day ("Oct 2"). */
  decisionsSince: (n: number, date: string) => `You have made ${n.toLocaleString('en-US')} ${n === 1 ? 'decision' : 'decisions'} on your team's work since ${date}.`,
  /** Part of the decisions' split ("12 approved, 3 you asked to change and 1 rejected"); {0} how many (a count). */
  approved: (n: number) => `${n.toLocaleString('en-US')} approved`,
  /** Part of the decisions' split: drafts the owner asked to change; {0} how many (a count). */
  askedToChange: (n: number) => `${n.toLocaleString('en-US')} you asked to change`,
  /** Part of the decisions' split; {0} how many (a count). */
  rejected: (n: number) => `${n.toLocaleString('en-US')} rejected`,
  /** A line made of a list, as a sentence; {0} the list ("12 approved and 1 rejected"). */
  listLine: (list: string) => `${list}.`,
  /** Under a number: corrections the owner wrote in their own words (short: the column is narrow). */
  corrections: 'Corrections in your words',
  /** Under a number: channels (social networks) the owner connected. */
  channels: 'Channels you connected',
  /** Under a number: everything the team published, of every kind (not only posts). */
  publishedByTeam: 'Published by your team',
  /** Under a number: weeks of the business's own history the plan works from. */
  weeksOfHistory: 'Weeks of your history',
  /** Part of where the publications went ("12 on Facebook Page"); {0} how many (a count), {1} the channel ("Instagram", "your site"). */
  onChannel: (n: number, channel: string) => `${n.toLocaleString('en-US')} on ${channel}`,
  /** One kind on one channel ("21 social posts on Instagram"); {0} the kind with its count, {1} the channel. */
  kindOn: (what: string, channel: string) => `${what} on ${channel}`,
  /** The kinds, then where they went; {0} the kinds ("21 social posts and 2 pages"), {1} the channels. */
  kindsByChannel: (kinds: string, channels: string) => `${kinds}: ${channels}`,
  /** What went out, then the day the first went out; {0} what went out, {1} the day ("Sep 12"). */
  firstWentOut: (what: string, date: string) => `${what}. The first one went out ${date}.`,
  /** The kinds of things the team published, each with its count. */
  kinds: {
    /** Posts on social networks; {0} how many (a count). */
    social_post: (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'social post' : 'social posts'}`,
    /** Articles on the owner's site; {0} how many (a count). */
    post: (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'site post' : 'site posts'}`,
    /** Pages of the site; {0} how many (a count). */
    page: (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'page' : 'pages'}`,
    /** Products for sale; {0} how many (a count). */
    product: (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'product' : 'products'}`,
    /** Translations of pages; {0} how many (a count). */
    translation: (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'translation' : 'translations'}`,
    /** Email campaigns sent; {0} how many (a count). */
    email_campaign: (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'email campaign' : 'email campaigns'}`,
    /** Gift card setups; {0} how many (a count). */
    gift_card_setup: (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'gift card setup' : 'gift card setups'}`,
  },
  /** A channel that is the owner's own site (it publishes there). */
  yourSite: 'your site',
  /** A channel that is email (campaigns). */
  email: 'email',
  /** On a channel's chip, after its name and " · "; {0} the day it was connected ("Sep 3"). */
  since: (date: string) => `since ${date}`,
  /** The weeks of history the team measured; {0} how many (a count). */
  history: (n: number) => `Your team has measured ${n.toLocaleString('en-US')} ${n === 1 ? 'week' : 'weeks'} of your own history.`,
  /** The same with the first week; {0} how many (a count), {1} the first week's day ("Sep 1"). */
  historyFrom: (n: number, date: string) => `Your team has measured ${n.toLocaleString('en-US')} ${n === 1 ? 'week' : 'weeks'} of your own history, starting the week of ${date}.`,
  /** The label above the owner's latest corrections, quoted (small capitals). */
  ownWords: 'In your own words',
};

export const STORED_VALUE_COPY = localized(STORED_VALUE_COPY_EN, 'screensStoredValue');
