/**
 * The Home sections one business's owner sees, on the dashboard's Home and
 * the WordPress plugin's Overview: the greeting (Welcome.tsx), This week's
 * milestone (ThisWeek.tsx: the week's money against the plan's estimated
 * goal, and the work moving it), What changed (WhatChanged.tsx: verified
 * figures of the last 7 days and of this week), the flags on the plan's
 * chart (GrowthCard.tsx), the side column's site picture (SitePreviewCard.tsx)
 * and Your website (YourWebsite.tsx), and a section that failed to load
 * (SectionState.tsx). In the page's language (French: src/i18n/fr.json, one
 * namespace per section).
 */
import { localized } from '@yotako/webmaven-ui';

/** Home's greeting (namespace 'screensHomeWelcome'). */
export const WELCOME_COPY_EN = {
  /** Home's title, in the title face, the first time a person opens Home, when their name is not known. */
  welcome: 'Welcome',
  /** Home's title on every later visit, when the person's name is not known. */
  welcomeBack: 'Welcome back',
  /** Home's title the first time a person opens Home; {0} their first name. */
  welcomeName: (name: string) => `Welcome, ${name}`,
  /** Home's title on every later visit; {0} the person's first name. */
  welcomeBackName: (name: string) => `Welcome back, ${name}`,
  /** Never seen: holds the room of the line under the title while the real line loads (about as long as that line). */
  subtitleRoom: 'Here is what is happening',
};

export const WELCOME_COPY = localized(WELCOME_COPY_EN, 'screensHomeWelcome');

/** This week's milestone (namespace 'screensThisWeek'). */
export const THIS_WEEK_COPY_EN = {
  /** The section's title (small capitals): the money goal of the week being lived. */
  title: "This week's milestone",
  /** The week's dates; {0} its first day ("Nov 9"), {1} its last day ("Nov 15"). */
  range: (from: string, to: string) => `${from} to ${to}`,
  /** Under the big amount of money that came in this week; {0} the week's estimated goal ("$250"). */
  soFar: (goal: string) => `so far, against an estimated goal of ${goal}`,
  /** Part of the week's funnel line ("3 visitors, 1 converted, 1 bought"), and of what a task brought; {0} the count. */
  visitors: (count: number) => `${count.toLocaleString('en-US')} ${count === 1 ? 'visitor' : 'visitors'}`,
  /** Part of the week's funnel line: visitors who converted (went on to buy or sign up); {0} the count. */
  converted: (count: number) => `${count.toLocaleString('en-US')} converted`,
  /** Part of the week's funnel line: visitors who bought; {0} the count of orders. */
  bought: (count: number) => `${count.toLocaleString('en-US')} bought`,
  /** The week's funnel line; {0} the visitors, {1} the converted, {2} the bought, each already with its number. */
  funnel: (visitors: string, converted: string, bought: string) => `${visitors}, ${converted}, ${bought}`,
  /** Part of what a task brought ("brought 12 visitors and 2 purchases"); {0} the count. */
  purchases: (count: number) => `${count.toLocaleString('en-US')} ${count === 1 ? 'purchase' : 'purchases'}`,
  /** Under a task: what it brought this week; {0} the visitors, the purchases, or both. */
  brought: (what: string) => `brought ${what}`,
  /** Two parts of what a task brought; {0} the visitors, {1} the purchases. */
  and: (first: string, second: string) => `${first} and ${second}`,
  /** A task's state, beside it (small, colored): done. */
  taskDone: '✓ done',
  /** A task's state: running right now. */
  taskActive: 'running now',
  /** A task's state: planned for later this week. */
  taskPlanned: 'planned',
  /** A task's state: paused. */
  taskPaused: 'paused',
  /** Under the tasks; {0} next week's estimated money goal ("$300"). */
  nextGoal: (goal: string) => `Next week's estimated goal: ${goal}.`,
  /** The link that opens last week's line. */
  lastWeek: 'Last week',
  /** The same link once open: it closes the line. */
  hideLastWeek: 'Hide last week',
  /** Last week's line; {0} its dates ("Nov 2 to Nov 8"), {1} the money that came in, {2} its estimated goal. */
  lastWeekLine: (range: string, actual: string, goal: string) => `${range}: ${actual} against an estimated goal of ${goal}.`,
  /** Last week's line with its funnel; {0} its dates, {1} the money that came in, {2} its estimated goal, {3} the funnel line. */
  lastWeekFunnel: (range: string, actual: string, goal: string, funnel: string) => `${range}: ${actual} against an estimated goal of ${goal}. ${funnel}.`,
};

export const THIS_WEEK_COPY = localized(THIS_WEEK_COPY_EN, 'screensThisWeek');

/** What changed (namespace 'screensWhatChanged'): short labels under big numbers, in small capitals. */
export const WHAT_CHANGED_COPY_EN = {
  /** The section's title (small capitals): verified figures only, no estimates. */
  title: 'What changed',
  /** Above the website's figures: the period they cover. */
  last7Days: 'Last 7 days',
  /** Above the sales figures: the period they cover. */
  thisWeek: 'This week',
  /** Under a number: the website's visitors (one word if possible, the column is narrow). */
  visitors: 'Visitors',
  /** Under the visitors' label: how they are counted (the same words as Your team's Progress). */
  visitorsNote: 'Each person counted once a day',
  /** Under a number: pages viewed on the website (short, the column is narrow). */
  pageviews: 'Pageviews',
  /** Under a number: times AI assistants (ChatGPT, Claude and others) read the website (short, the column is narrow). */
  aiReads: 'AI reads',
  /** Under a number: orders this week (one word if possible). */
  orders: 'Orders',
  /** Under an amount of money: the week's net sales (short, the column is narrow). */
  revenue: 'Revenue',
};

export const WHAT_CHANGED_COPY = localized(WHAT_CHANGED_COPY_EN, 'screensWhatChanged');

/** The flags on the plan's chart (namespace 'screensGrowthCard'): very short, in a small chip. */
export const GROWTH_CARD_COPY_EN = {
  /** A flag on the chart's baseline at the day the business's plan started. */
  launched: 'Launched',
  /** A flag at the week the team's first post went out. */
  firstPost: 'First post',
  /** A flag at the week of the first sale. */
  firstSale: 'First sale',
};

export const GROWTH_CARD_COPY = localized(GROWTH_CARD_COPY_EN, 'screensGrowthCard');

/** The site's picture in the side column (namespace 'screensSitePreview'): the whole picture is a link to the live site. */
export const SITE_PREVIEW_COPY_EN = {
  /** Shown over the site's picture on hover or keyboard focus. */
  visit: 'Visit your site',
  /** A small label in the picture's corner on a phone (no hover there). */
  visitShort: 'Visit site',
  /** The link's name for screen readers; {0} the business's name. */
  linkLabel: (name: string) => `Visit your site, ${name}. Opens the live site in a new tab`,
  /** The picture's description; {0} the business's name. */
  alt: (name: string) => `Your site, ${name}`,
};

export const SITE_PREVIEW_COPY = localized(SITE_PREVIEW_COPY_EN, 'screensSitePreview');

/** Your website, a side card (namespace 'screensYourWebsite'). */
export const YOUR_WEBSITE_COPY_EN = {
  /** The card's title (small capitals), above the site's address and its Share link. */
  title: 'Your website',
};

export const YOUR_WEBSITE_COPY = localized(YOUR_WEBSITE_COPY_EN, 'screensYourWebsite');

/** A Home section that failed to load (namespace 'screensSectionState'). */
export const SECTION_STATE_COPY_EN = {
  /** The button under what went wrong: loads the section again. */
  retry: 'Retry',
};

export const SECTION_STATE_COPY = localized(SECTION_STATE_COPY_EN, 'screensSectionState');
