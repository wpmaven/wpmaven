/**
 * The plan and the reality on one chart, a Home section (GrowthGraph.tsx,
 * the dashboard's Home and the WordPress plugin's Overview): the sales
 * forecast the owner accepted at the start (an estimate, never a promise),
 * the business's real sales on top of it, a "We're here" marker, and under
 * the chart the work the AI team planned and did each week or month.
 *
 * English is the source; the French is written by hand (src/i18n/fr.json,
 * namespace screensGrowthGraph), the other languages by the dashboard's
 * translation script. Amounts come
 * formatted in the page's language.
 */
import { localized } from '@yotako/webmaven-ui';

export const GROWTH_GRAPH_COPY_EN = {
  /** The section's title (small capitals). */
  title: 'Your plan, and where you are',
  /** The help tip's name for screen readers, beside the title. */
  helpLabel: 'What does this graph mean?',
  /** The help tip's first sentence. */
  helpForecast: 'The forecast is the plan you accepted when you started, not a promise.',
  /** The help tip's second sentence; it names the series yourSales exactly as yourSales says it (drawn in bold there). */
  helpSales: 'Only Your sales is money that actually arrived.',
  /** A series of the chart, in the legend and the tooltip: the forecast the owner accepted. */
  salesForecast: 'Sales forecast',
  /** A series: the money that actually came in. */
  yourSales: 'Your sales',
  /** The same in the legend when the last part is a dashed line carried to pace. */
  yourSalesPaced: 'Your sales, dashed = on pace',
  /** A series (tooltip): this week's sales carried to the pace it runs at. */
  thisWeekOnPace: 'This week, on pace',
  /** A series (tooltip): this month's sales carried to the pace it runs at. */
  thisMonthOnPace: 'This month, on pace',
  /** A series (tooltip): this week's sales so far. */
  thisWeekSoFar: 'This week so far',
  /** A series (tooltip): this month's sales so far. */
  thisMonthSoFar: 'This month so far',
  /** The pill over the marker of today (very short: it sits in a small pill above the chart). */
  nowFlag: 'We’re here',
  /** The latest amount beside its point, carried to pace; {0} the amount ("$1.2K"). */
  amountOnPace: (amount: string) => `${amount} on pace`,
  /** The latest amount beside its point, so far; {0} the amount. */
  amountSoFar: (amount: string) => `${amount} so far`,
  /** The link back from the whole plan to the weeks around now. */
  backToWeek: 'Back to this week',
  /** The link back from the whole plan to the months around now. */
  backToMonth: 'Back to this month',
  /** The link from the whole plan to the weeks around now, before any sale. */
  seeWeek: 'See this week',
  /** The link from the whole plan to the months around now, before any sale. */
  seeMonth: 'See this month',
  /** The link to the whole plan, all two years of it. */
  seeFullPlan: 'See the full 2-year plan',
  /** An axis tick: a week of the plan, very short; {0} its number ("W3"). */
  weekTick: (n: number) => `W${n}`,
  /** An axis tick: a month of the plan, very short; {0} its number ("M3"). */
  monthTick: (n: number) => `M${n}`,
  /** A week of the plan, in the tooltip and the table; {0} its number. */
  weekN: (n: number) => `Week ${n}`,
  /** A month of the plan, in the tooltip and the table; {0} its number. */
  monthN: (n: number) => `Month ${n}`,
  /** A bar's tooltip under the chart; {0} the week or month ("Week 3"), {1} its work ("3 done of 5 planned"). */
  periodWork: (period: string, work: string) => `${period}: ${work}`,
  /** The table's first column: the weeks. */
  week: 'Week',
  /** The table's first column: the months. */
  month: 'Month',
  /** The strip under the chart, with the plan's work: its title. */
  plannedEachWeek: 'Planned each week',
  /** The same for months. */
  plannedEachMonth: 'Planned each month',
  /** The strip without the plan's work: what was published. */
  publishedEachWeek: 'Published each week',
  /** The same for months. */
  publishedEachMonth: 'Published each month',
  /** The strip's legend and the table's column: the work the plan has the team do. */
  planned: 'Planned',
  /** The strip's legend and the table's column: the planned work done. */
  done: 'Done',
  /** The table's column: what was published. */
  published: 'Published',
  /** A week's or month's work (tooltip, table): what went out; {0} how many (a count). */
  workPublished: (done: number) => `${done} published`,
  /** A week's work: what is planned; {0} how many (a count). */
  workPlanned: (planned: number) => `${planned} planned`,
  /** A week's work: done against planned; {0} how many were done (a count), {1} how many were planned. */
  workDoneOf: (done: number, planned: number) => `${done} done of ${planned} planned`,
  /** A week's work: done with none planned; {0} how many were done (a count). */
  workDoneNone: (done: number) => `${done} done, none planned`,
  /** Under the chart once there are sales. */
  footSales: 'The forecast is the plan you set when you started, not a promise. Your own sales are drawn on top of it.',
  /** The same while this week is carried to its pace. */
  footPacedWeek: 'The forecast is the plan you set when you started, not a promise. Your own sales are drawn on top of it; the dashed end is the pace this week is running at, from what has come in so far.',
  /** The same while this month is carried to its pace. */
  footPacedMonth: 'The forecast is the plan you set when you started, not a promise. Your own sales are drawn on top of it; the dashed end is the pace this month is running at, from what has come in so far.',
  /** The same while this week is still running. */
  footLiveWeek: 'The forecast is the plan you set when you started, not a promise. Your own sales are drawn on top of it; the dashed end is this week, still running.',
  /** The same while this month is still running. */
  footLiveMonth: 'The forecast is the plan you set when you started, not a promise. Your own sales are drawn on top of it; the dashed end is this month, still running.',
  /** Under the chart before any sale. */
  footNoSales: 'This is the forecast you set when you started, not a promise. Your own sales will be drawn on top of it as they come in.',
};

export const GROWTH_GRAPH_COPY = localized(GROWTH_GRAPH_COPY_EN, 'screensGrowthGraph');
