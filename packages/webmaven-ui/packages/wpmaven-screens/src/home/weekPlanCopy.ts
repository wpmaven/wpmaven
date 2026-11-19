/**
 * "Your team is on it", this week's plan on Home (WeekPlan.tsx, the
 * dashboard's Home and the WordPress plugin's Overview): one row per piece
 * of the AI team's work this week, its state beside it, and on a row that
 * waits for the owner's yes, what it is and the buttons to decide (Approve,
 * Reject, Refine, or the way to its card). "Your team" is the page where
 * the AI team's plan and approvals are; "actions" are the plan's monthly
 * allowance of work.
 *
 * English is the source; the French is written by hand (src/i18n/fr.json,
 * namespace screensWeekPlan), the other languages by the dashboard's
 * translation script. Day names come
 * from the browser, in the page's language.
 */
import { localized } from '@yotako/webmaven-ui';

export const WEEK_PLAN_COPY_EN = {
  /** The section's title (small capitals). */
  heading: 'Your team is on it',
  /** The help tip's name for screen readers, beside the title. */
  helpLabel: 'How does approving work?',
  /** The help tip's words. "Refine" is a row's button; the Co-CEO is the AI team's lead, in the chat. */
  helpText: 'Nothing is published and nothing on your site changes until you approve it. Reject it and your team does something else. To change the words of a post, refine it and say what to change. For a change to your site, reject it and tell your Co-CEO what you want instead.',
  /** In a site's scope (the WordPress plugin), where Approve was: a site decides in Waiting for you. */
  openWaiting: 'Decide in Waiting for you',
  /** An advice item (nothing to approve): its steps are on its card in Waiting for you. */
  openAdvice: 'See the steps in Waiting for you',
  /** A decision did not save. */
  decideFailed: 'That did not save. Your team page has the full inbox.',
  /** The link beside the title when some rows are left out; {0} how many there are in all (a count). */
  seeAll: (total: number) => `See all ${total} in Your team`,
  /** The same link when every row shows. */
  seeEverything: 'See everything in Your team',
  /** A held row with no task: a page or article waits for this month's room. */
  heldLongForm: 'A page or article is waiting for room this month',
  /** A held row with no task: a page or article written in the first week publishes when the plan starts. */
  heldFirstWeek: 'A page or article publishes when your plan starts',
  /** A held row with no task: a change to the owner's site waits for actions. */
  heldSiteChange: 'A change to your site is waiting for actions',
  /** A held row with no task: a post waits for actions. */
  heldPost: 'A post is waiting for actions',
  /** A row waiting for a yes, with no task: a change to the owner's site. */
  siteChange: 'A change to your site',
  /** A row waiting for a yes, with no task: a post. */
  postReady: 'A post is ready for your approval',
  /** A row: a change to the owner's site failed this week. */
  siteChangeFailed: 'A change to your site failed',
  /** A row: a publication failed this week. */
  publishFailed: 'A publish failed',
  /** Typed into the Co-CEO's chat box by Refine, for the owner to finish and send; {0} the task's title. Ends with a space. */
  refinePrefill: (title: string) => `About "${title}": `,
  /** The link to the rest of a task's approvals; {0} how many more (a count). */
  moreWaiting: (n: number) => (n === 1 ? `${n} more is waiting for your yes` : `${n} more are waiting for your yes`),
  /** Under a held change to the owner's site (the 72 hours line may follow). */
  heldLineChange: 'You approved this. It is not lost: your team makes this change by itself as soon as actions come back.',
  /** Under a held post (the 72 hours line may follow). */
  heldLinePost: 'You approved this. It is not lost: it publishes by itself as soon as actions come back.',
  /** A row's state, beside it (small, colored; a day may follow after " · "). */
  status: {
    /** Done this week. */
    done: '✓ done',
    /** Running now. */
    running: 'running',
    /** Waiting for the owner's approval. */
    awaiting: 'awaiting your approval',
    /** Planned for later this week. */
    scheduled: 'scheduled',
    /** Failed; the details are on the Your team page. */
    failed: 'failed · details in Your team',
    /** Approved, waiting because the plan's actions are used up. */
    deferred: 'Paused, out of actions',
    /** Paused after failing. */
    paused: 'paused, not scheduled',
  },
  /** The button that shortens a long post's text again. */
  less: 'less',
  /** The button that shows the rest of a long post's text. */
  more: 'more',
  /** The button to the screen where the owner picks a video. */
  chooseVideo: 'Choose your video',
  /** A row's button: approve it. */
  approve: 'Approve',
  /** A row's button: reject it. */
  reject: 'Reject',
  /** A row's button: ask the Co-CEO for different words. */
  refine: 'Refine',
};

export const WEEK_PLAN_COPY = localized(WEEK_PLAN_COPY_EN, 'screensWeekPlan');
