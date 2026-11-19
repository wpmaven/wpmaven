/**
 * Report / Your team's plan / Goals, a rolling card of the WordPress plugin's
 * Overview (HomeInsights.tsx): the business's newest report with View full
 * report and Download PDF, what the AI team runs next and what it is working
 * on now, and the business's goals (website analytics targets: a visit to a
 * page or an event on the site) with a short form to add one.
 *
 * English is the source; the French is written by hand (src/i18n/fr.json,
 * namespace screensInsights), the other languages by the dashboard's
 * translation script.
 */
import { localized } from '@yotako/webmaven-ui';

export const INSIGHTS_COPY_EN = {
  /** A face's tab: the newest report. */
  report: 'Report',
  /** A face's tab: what the team runs next and now. */
  plan: "Your team's plan",
  /** A face's tab: the business's goals. */
  goals: 'Goals',
  /** The report face's label (small capitals). */
  latestReport: 'Latest report',
  /** The report face's link: downloads the report as a PDF. */
  downloadPdf: 'Download PDF',
  /** The report face's link: opens the whole report. */
  viewReport: 'View full report',
  /** The PDF could not be downloaded. */
  pdfFailed: 'The PDF could not be downloaded. Try again in a minute.',
  /** The report face could not load. */
  reportFailed: 'Your latest report could not be loaded. Try again in a minute.',
  /** The plan face's label: the tasks that run next. */
  upNext: 'Up next',
  /** The plan face's label: the work running now. */
  workingNow: 'Working on it now',
  /** The plan face when nothing is scheduled. */
  nothingScheduled: 'Nothing is scheduled yet.',
  /** Beside a task the team added itself, where a member's face would be. */
  byTeam: 'by your team',
  /** The plan face's link to Your team's plan. */
  seePlan: "See your team's plan",
  /** Read by screen readers while the plan face loads. */
  planLoading: "Loading your team's plan",
  /** The plan face could not load. */
  planFailed: "Your team's plan could not be loaded. Try again in a minute.",
  /** Read by screen readers while the goals load. */
  goalsLoading: 'Loading your goals',
  /** The goals could not load. */
  goalsFailed: 'Your goals could not be loaded. Try again in a minute.',
  /** The goals face with no goal. */
  noGoals: 'No goals yet.',
  /** The same in the WordPress plugin, for someone who may not add one. */
  noGoalsSite: 'No goals yet. An administrator of this site can add one.',
  /** The button that opens the goal form. */
  addGoal: 'Add a goal',
  /** The form's field: the goal's name. */
  goalName: 'Goal name',
  /** That field's example. */
  goalNamePlaceholder: '100 sales this month',
  /** The form's field: what counts toward the goal. */
  goalCounts: 'What counts',
  /** A choice of that field: a visit to a page of the site. */
  goalUrl: 'A visit to a page',
  /** A choice of that field: an event the site records (a purchase, a sign-up). */
  goalEvent: 'An event on the site',
  /** The field for a page visit goal: the page's address. */
  goalPage: 'The page address',
  /** The field for an event goal: the event's name. */
  goalEventName: 'The event name',
  /** The form's field: how many (it may stay empty). */
  goalTarget: 'Target (optional)',
  /** The form's field: the period the target is counted over. */
  goalEvery: 'Every',
  /** A period choice. */
  goalDay: 'Day',
  /** A period choice. */
  goalWeek: 'Week',
  /** A period choice. */
  goalMonth: 'Month',
  /** The form's button. */
  saveGoal: 'Save goal',
  /** The same button while it saves. */
  saving: 'Saving',
  /** The form's button that closes it. */
  cancel: 'Cancel',
  /** The goal could not be saved. */
  goalFailed: 'The goal could not be saved. Try again in a minute.',
  /** The button that loads a face again. */
  retry: 'Retry',
  /** A background run's chip: about to start. */
  queued: 'Queued',
  /** A task's or a run's chip: running now. */
  running: 'Running',
  /** A task's chip: its next run, minutes late; {0} the minutes (very short: "overdue 5m"). */
  overdueMinutes: (minutes: number) => `overdue ${minutes}m`,
  /** A task's chip: it runs now. */
  now: 'now',
  /** A task's chip: in so many minutes; {0} the minutes (very short: "in 5m"). */
  inMinutes: (minutes: number) => `in ${minutes}m`,
  /** A task's chip: in so many hours; {0} the hours (very short: "in 3h"). */
  inHours: (hours: number) => `in ${hours}h`,
  /** A task's chip: tomorrow; {0} the time ("9:00 AM"). */
  tomorrowAt: (time: string) => `Tomorrow at ${time}`,
  /** A task's chip: later this week; {0} the day ("Monday"), {1} the time. */
  dayAt: (day: string, time: string) => `${day} at ${time}`,
};

export const INSIGHTS_COPY = localized(INSIGHTS_COPY_EN, 'screensInsights');
