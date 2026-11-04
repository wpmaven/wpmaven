import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceDot, ResponsiveContainer,
} from 'recharts';
import { FORECAST_MONTHS, computeForecast, formatMoneyShort, type ForecastScenario } from '@yotako/wpmaven-onboarding/shared';
import type { BusinessPlanAssumptions } from '@yotako/wpmaven-onboarding/shared';
import type { ProgressSnapshot } from '../team/progress';
import type { WeekCount } from './reads';
import { SectionHelpTip } from './HelpTip';
import { VISUALLY_HIDDEN, useHomeSectionStyles } from './styles';

export type { WeekCount } from './reads';

/**
 * The plan and the reality on one axis (reframed 2026-08-31), on the
 * dashboard's Home and the plugin's Overview (2026-10-17).
 *
 * The plan curve is the SAME forecast the owner accepted at the end of
 * onboarding, recomputed from the assumptions the API froze at activation.
 * Their verified sales are drawn on top of it.
 *
 * The window is ADAPTIVE, and that is the load-bearing decision. A fixed
 * 12-month axis puts "now" at the far left and pins every real number flat
 * against the baseline: a geometric ramp spends its first five months under
 * 9% of the month-12 value, so the owner's actual work reads as nothing.
 * Goal-gradient says motivation rises with PROXIMITY to the goal, so the
 * window instead keeps now at ~2/3 of the width and the next step just ahead:
 * weeks while the business is young (the API's own weekly targets are real
 * numbers), months once there is enough history. The full plan, all two
 * years the forecast covers (2026-10-11), is one click away, both ways.
 *
 * Money is the only thing on the line. Non-financial milestones (launched,
 * first post, first order) are flags on the baseline: same time axis,
 * different register, so nothing implies "a website is worth €0 of sales".
 * Under the plot, on the same axis, the work the team published in each
 * week or month (2026-10-11), as on the landing. No price of ours is drawn:
 * the break-even line left the chart that day.
 */

/** "We're here": a pill with an arrow that points down at the marker line.
 *  Rendered as a recharts label so it tracks the line's own x position. */
const NowFlag: React.FC<{ viewBox?: { x?: number; y?: number }; align?: 'start' | 'middle' | 'end' }> = ({ viewBox, align = 'middle' }) => {
  const x = viewBox?.x ?? 0;
  const w = 82;
  const h = 19;
  // The pill lives in the chart's TOP MARGIN, above the plotting area, so a
  // line that runs high can never cover it (it used to sit just inside the
  // plot top, where the sales curve near the axis maximum ran straight
  // through the words). viewBox.y is the plot's top edge; the reserved
  // margin is above it, and nothing is ever drawn there.
  const top = (viewBox?.y ?? 0) - (h + 7);
  // Keep the pill on-canvas when the marker sits against either edge: day 1
  // puts "now" on the very first bucket.
  const px = align === 'start' ? x - 10 : align === 'end' ? x - w + 10 : x - w / 2;
  const tx = px + w / 2;
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={px} y={top} width={w} height={h} rx={9.5} fill="var(--danger)" />
      <text x={tx} y={top + 13} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--bg-raised, #fff)">
        We&#8217;re here
      </text>
      {/* Stem down to the plot edge, where the dashed marker line takes over. */}
      <polygon points={`${x - 4.5},${top + h} ${x + 4.5},${top + h} ${x},${top + h + 7}`} fill="var(--danger)" />
    </g>
  );
};

export type FlagAlign = 'start' | 'middle' | 'end';

/** A rectangle on the chart, in the SVG's own pixels. */
export interface Box { left: number; top: number; right: number; bottom: number }

/** Where a milestone chip is drawn, from the viewBox recharts gives its label. */
export function flagChipBox(x: number, y: number, text: string, align: FlagAlign = 'middle', row = 0): Box {
  const w = Math.max(28, text.length * 5.4 + 12);
  const h = 15;
  const left = align === 'start' ? x - 6 : align === 'end' ? x - w + 6 : x - w / 2;
  const top = y - h - 7 - row * (h + 3);
  return { left, top, right: left + w, bottom: top + h };
}

/** Milestone flag on the baseline. The label carries a paper chip because on
 *  day 1 "Launched" shares its bucket with the "We're here" marker and the
 *  dashed line ran straight through the word. */
const FlagLabel: React.FC<{
  viewBox?: { x?: number; y?: number };
  text?: string;
  align?: FlagAlign;
  row?: number;
}> = ({ viewBox, text = '', align = 'middle', row = 0 }) => {
  const b = flagChipBox(viewBox?.x ?? 0, viewBox?.y ?? 0, text, align, row);
  const w = b.right - b.left;
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={b.left} y={b.top} width={w} height={b.bottom - b.top} rx={7.5}
            fill="var(--bg-raised, #fff)" stroke="var(--glass-border)" strokeWidth={1} />
      <text x={b.left + w / 2} y={b.top + 10.5} textAnchor="middle" fontSize={10}
            fontWeight={600} fill="var(--text-dim)">{text}</text>
    </g>
  );
};

/** A milestone chip on the axis: its bucket key, its words, where it sits. */
export interface Flag { k: string; label: string; row: number; align: FlagAlign }

const WEEK_MS = 7 * 86400_000;
const WEEKS_PER_MONTH = 4.345;

const SCENARIOS: ForecastScenario[] = ['cautious', 'expected', 'ambitious'];

/**
 * The scenario the owner accepted, as it comes back on the frozen plan
 * (`OperatorPlan.forecast.scenario`), or undefined when the payload predates
 * the field. Undefined means the graph keeps its own default: drawing the
 * middle line for someone who chose the cautious one would quietly move their
 * goalposts, so an unrecognized value is refused rather than coerced.
 */
export function asScenario(value: unknown): ForecastScenario | undefined {
  return typeof value === 'string' && (SCENARIOS as string[]).includes(value)
    ? (value as ForecastScenario)
    : undefined;
}

export interface GrowthEvent {
  /** Short label; keep it to two words so the flags stay readable. */
  label: string;
  at: string;
}

/** A week of published work (the strip's first form, kept by that name). */
export type PublishedWeek = WeekCount;

export interface GrowthGraphProps {
  assumptions: BusinessPlanAssumptions | null;
  currency: string;
  scenario?: ForecastScenario;
  snapshots: ProgressSnapshot[];
  /** Business start: the origin for both axes. */
  activatedAt: string | null;
  events?: GrowthEvent[];
  /**
   * Sales so far in the CURRENT period (week-to-date, from the finance
   * summary). Weekly snapshots only cover COMPLETED weeks, so without this
   * the sales line stops short of "now" and reads as missing data.
   */
  currentPeriodCents?: number | null;
  /** The team's published work per week. Absent (an API that does not send
   *  it yet) or null: nothing done is drawn, never a number made up. */
  published?: WeekCount[] | null;
  /** The team's planned work per week (task runs), the whole plan long.
   *  Absent or null: the strip shows the published work alone, and with
   *  neither, no strip. */
  planned?: WeekCount[] | null;
  /** The plan's task runs that completed per week: the "done" inside the
   *  planned bars, in their unit. Absent: the planned bars alone. */
  ran?: WeekCount[] | null;
}

interface Point {
  key: string;
  plan: number;
  /** Completed periods: solid. */
  actual?: number | null;
  /** The period still running: dashed, and it starts at the last completed
   *  point so the two read as one line. */
  live?: number | null;
}

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

/** The chart's size before its container is measured: 1px wide, its own 240px tall. */
export const CHART_INITIAL_SIZE = { width: 1, height: 240 } as const;

/** The y axis's width and the plot's right margin: the strip under the chart
 *  is inset by the same two, so its bars stand under the chart's own points. */
export const Y_AXIS_WIDTH = 54;
export const PLOT_RIGHT = 12;

/** 1-based index of `when` on the axis that starts at `start`. */
export function bucketOf(when: number, start: number, unit: 'week' | 'month'): number {
  const span = unit === 'week' ? WEEK_MS : WEEKS_PER_MONTH * WEEK_MS;
  return Math.max(1, Math.floor((when - start) / span) + 1);
}

/**
 * The published work on the chart's buckets: each week folded onto the week
 * or month it starts in. A bucket no week reached is null (not measured, or
 * still ahead), never 0: only a week the API counted can say nothing went out.
 */
export function publishedBuckets(
  weeks: ReadonlyArray<PublishedWeek>,
  start: number,
  unit: 'week' | 'month',
  span: number,
): Array<number | null> {
  const out: Array<number | null> = Array.from({ length: span }, () => null);
  for (const w of weeks) {
    const t = ms(w.weekStart);
    if (t == null || !Number.isFinite(w.count) || w.count < 0) continue;
    const b = bucketOf(t, start, unit);
    if (b > span) continue;
    out[b - 1] = (out[b - 1] ?? 0) + Math.round(w.count);
  }
  return out;
}

/** Which view: the near window around now, or the whole plan. */
export type GrowthWindow = 'near' | 'full';

export interface GrowthView {
  data: Point[];
  unit: 'week' | 'month';
  nowKey: string | null;
  nowAlign: 'start' | 'middle' | 'end';
  flags: Flag[];
  measured: boolean;
  hasLive: boolean;
  rawLiveCents: number | null;
  livePaced: boolean;
  hasSales: boolean;
  /** The whole plan: the forecast's two years, month by month. */
  fullPlan: boolean;
  naturalUnit: 'week' | 'month';
  /** The published work per point of `data`, up to now only; null when the
   *  API did not send it. */
  published: Array<number | null> | null;
  /** The planned work per point of `data`, the whole window; null when the
   *  API did not send it. */
  planned: Array<number | null> | null;
  /** The plan's task runs done per point of `data`, up to now only; null
   *  when the API did not send it. */
  ran: Array<number | null> | null;
  /** Only one point of sales on the chart: it is drawn bigger, so it reads on its own. */
  lonePoint: boolean;
  /** The latest sales point and how to say it: carried to pace, so far, or a finished period. */
  latest: { key: string; value: number; kind: 'pace' | 'so far' | 'done'; align: 'start' | 'end' } | null;
}

/**
 * Everything the chart draws, from the plan, the sales and the clock. The
 * owner's choice of window is `window`; null is the default: the near window
 * once there are sales, the whole plan before.
 */
export function growthView(o: {
  assumptions: BusinessPlanAssumptions;
  scenario: ForecastScenario;
  snapshots: ReadonlyArray<ProgressSnapshot>;
  start: number;
  events: ReadonlyArray<GrowthEvent>;
  window: GrowthWindow | null;
  currentPeriodCents: number | null;
  published: ReadonlyArray<WeekCount> | null;
  planned?: ReadonlyArray<WeekCount> | null;
  ran?: ReadonlyArray<WeekCount> | null;
  now: number;
}): GrowthView {
  const { start, snapshots, currentPeriodCents, now } = o;
  const f = computeForecast(o.assumptions, o.scenario);

  // Verified sales are what the near window exists to protect.
  const hasSales = snapshots.some((s) => (s.actuals?.revenueCents ?? 0) > 0)
    || (currentPeriodCents ?? 0) > 0;

  const weeksIn = bucketOf(now, start, 'week');
  // Weeks while the history is short enough to read; months after that.
  const naturalUnit: 'week' | 'month' = weeksIn <= 12 ? 'week' : 'month';
  // No sales yet => open on the whole plan. There is no earned progress to
  // give room to, and a near window would shrink the promise to a flat $30
  // line at the exact moment the owner needs to see where this is going.
  // Once real money arrives, the near window takes over. Either way the
  // owner can switch.
  const fullPlan = o.window ? o.window === 'full' : !hasSales;
  const unit: 'week' | 'month' = fullPlan ? 'month' : naturalUnit;
  const nowBucket = bucketOf(now, start, unit);

  // Keep "now" at ~2/3 of the width so earned progress owns the majority of
  // the ink and the next step is visible just ahead of it.
  const span = fullPlan
    ? Math.min(FORECAST_MONTHS, f.months.length)
    : unit === 'week'
      ? Math.min(16, Math.max(6, Math.ceil(nowBucket * 1.5)))
      : Math.min(12, Math.max(4, Math.ceil(nowBucket * 1.5)));

  /** Plan money for one bucket, from the forecast and nothing else. The API
   *  stores its own weekly target per snapshot, but blending the two sources
   *  puts a cliff in the curve wherever they disagree; one source keeps the
   *  line continuous and keeps it the curve the owner actually accepted. */
  const planFor = (bucket: number): number => {
    if (unit === 'month') return f.months[bucket - 1]?.revenueCents ?? 0;
    const monthIdx = Math.floor((bucket - 1) / WEEKS_PER_MONTH);
    return Math.round((f.months[monthIdx]?.revenueCents ?? 0) / WEEKS_PER_MONTH);
  };

  // Verified sales, folded onto the same buckets.
  const actualBy = new Map<number, number>();
  for (const s of snapshots) {
    const t = ms(s.periodStart);
    if (t == null) continue;
    const b = bucketOf(t, start, unit);
    actualBy.set(b, (actualBy.get(b) ?? 0) + (s.actuals?.revenueCents ?? 0));
  }
  const lastMeasured = actualBy.size ? Math.max(...actualBy.keys()) : 0;

  // The period in progress: known from the finance summary, but never from a
  // snapshot (those are written for completed weeks only).
  const rawLiveCents = currentPeriodCents != null && nowBucket > lastMeasured
    ? currentPeriodCents + (unit === 'month' ? (actualBy.get(nowBucket) ?? 0) : 0)
    : null;

  // Every other point on this line is a FINISHED period. Dropping a
  // half-finished one next to them compares half a week against whole weeks,
  // so the line sagged at the right-hand end no matter how well the week was
  // going, and read as "sales are dying" when they were not. Put the
  // in-progress period on the same footing by carrying it to full-period
  // pace. Below a quarter elapsed there is too little to divide by, so it is
  // not carried to pace: the money that came in is shown as it is, "so far"
  // (2026-10-11; it was withheld, and a first month showed no sales at all).
  const bucketMs = unit === 'week' ? WEEK_MS : WEEKS_PER_MONTH * WEEK_MS;
  const elapsed = Math.min(1, Math.max(0, (now - (start + (nowBucket - 1) * bucketMs)) / bucketMs));
  const paced = elapsed >= 0.25;
  // With no sale at all there is no sales point, and a period too young to
  // pace shows its sales as they are only when there are some: a "€0 so far"
  // dot on a new business read as a sale (2026-10-11).
  const liveCents = rawLiveCents == null || !hasSales
    ? null
    : paced ? Math.round(rawLiveCents / elapsed) : rawLiveCents > 0 ? rawLiveCents : null;
  const livePaced = liveCents != null && paced && elapsed < 0.995;

  const prefix = unit === 'week' ? 'W' : 'M';
  const data: Point[] = [];
  for (let b = 1; b <= span; b++) {
    const complete = b <= lastMeasured ? Math.round((actualBy.get(b) ?? 0) / 100) : null;
    // The dashed segment needs BOTH ends: the last completed point and the
    // one in progress, or recharts has nothing to draw a line between.
    const live = liveCents == null
      ? null
      : b === nowBucket
        ? Math.round(liveCents / 100)
        : b === lastMeasured ? complete : null;
    data.push({ key: `${prefix}${b}`, plan: Math.round(planFor(b) / 100), actual: complete, live });
  }

  // Event flags, deduped per bucket and clamped to the visible window.
  const flagBy = new Map<string, string[]>();
  for (const e of o.events) {
    const t = ms(e.at);
    if (t == null) continue;
    const b = bucketOf(t, start, unit);
    if (b > span) continue;
    const k = `${prefix}${b}`;
    flagBy.set(k, [...(flagBy.get(k) ?? []), e.label]);
  }

  const nowKey = nowBucket <= span ? `${prefix}${nowBucket}` : null;
  const at = (k: string) => data.findIndex((d) => d.key === k);
  // The latest sales point: this period when it shows, else the last finished one.
  const latestKey = liveCents != null && nowKey ? nowKey : lastMeasured >= 1 && lastMeasured <= span ? `${prefix}${lastMeasured}` : null;
  const latestPoint = latestKey ? data[at(latestKey)] : null;
  const latestValue = latestPoint ? (latestKey === nowKey && liveCents != null ? latestPoint.live : latestPoint.actual) : null;
  // The last point that is now or behind it: every one when now is past the window.
  const nowIndex = nowKey ? at(nowKey) : nowBucket > span ? data.length - 1 : -1;
  const upToNow = (counts: Array<number | null>) => counts.map((c, i) => (i <= nowIndex ? c : null));

  return {
    data,
    unit,
    nowKey,
    nowAlign: (nowKey == null ? 'middle' : at(nowKey) === 0 ? 'start' : at(nowKey) === data.length - 1 ? 'end' : 'middle') as 'start' | 'middle' | 'end',
    // Two milestones a week apart produced two chips at nearly the same x,
    // and the wider one was clipped by its neighbour. Stack them instead:
    // a chip is roughly two buckets wide, so anything that close moves up.
    flags: (() => {
      const sorted = [...flagBy.entries()]
        .map(([k, labels]) => ({ k, label: labels.join(' · '), b: Number(k.slice(prefix.length)) }))
        .sort((a, z) => a.b - z.b);
      let prevB = -99;
      let prevRow = 0;
      return sorted.map(({ k, label, b }): Flag => {
        const row = b - prevB <= 2 ? 1 - prevRow : 0;
        prevB = b;
        prevRow = row;
        // A centered chip on the first or last bucket runs off the plot and
        // collides with the axis numbers.
        const align: FlagAlign = b === 1 ? 'start' : b === span ? 'end' : 'middle';
        return { k, label, row, align };
      });
    })(),
    measured: lastMeasured > 0 || liveCents != null,
    hasLive: liveCents != null,
    rawLiveCents,
    livePaced,
    hasSales,
    fullPlan,
    naturalUnit,
    // Done is done up to now: a count for a period still ahead is not drawn.
    published: o.published ? upToNow(publishedBuckets(o.published, start, unit, span)) : null,
    planned: o.planned ? publishedBuckets(o.planned, start, unit, span) : null,
    ran: o.ran ? upToNow(publishedBuckets(o.ran, start, unit, span)) : null,
    // The first week alone, a finished one or the one still running: the
    // line has a single point, and a small dot on the "We're here" line read
    // as no sales at all (2026-10-11).
    lonePoint: data.filter((d) => d.actual != null || d.live != null).length === 1,
    latest: latestKey && latestValue != null
      ? {
        key: latestKey,
        value: latestValue,
        kind: latestKey === nowKey && liveCents != null ? (livePaced ? 'pace' : 'so far') : 'done',
        // The words go right of the point, away from the dashed marker; left of it on the last one.
        align: at(latestKey) === data.length - 1 ? 'end' : 'start',
      }
      : null,
  };
}

/** The tallest bar of the strip, and the room its count takes above it. */
const STRIP_BAR_MAX = 28;
const STRIP_COUNT_H = 14;
const STRIP_BAR_W = 10;

/** Planned work: the violet as a tint with an outline, so the solid "done" reads inside it, in both themes. */
const PLANNED_FILL = 'color-mix(in srgb, var(--purple) 16%, transparent)';
const PLANNED_EDGE = 'color-mix(in srgb, var(--purple) 55%, transparent)';

const PlannedKey: React.FC = () => (
  <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 10, borderRadius: '2px 2px 0 0', background: PLANNED_FILL, boxShadow: `inset 0 0 0 1px ${PLANNED_EDGE}`, verticalAlign: 'middle', marginRight: 5 }} />
);
const DoneKey: React.FC = () => (
  <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 10, borderRadius: '2px 2px 0 0', background: 'var(--purple)', verticalAlign: 'middle', marginRight: 5 }} />
);

/** "3 done of 5 planned", "5 planned": a bucket's words, for the tooltip and the table. */
export function workWords(planned: number | null, done: number | null): string {
  if (planned == null) return done == null ? '' : `${done} published`;
  if (done == null) return `${planned} planned`;
  return planned > 0 ? `${done} done of ${planned} planned` : `${done} done, none planned`;
}

/**
 * The team's work under the chart's own points, one bar per week (per month
 * in a month view).
 *
 * With the plan's work (2026-10-11, "it is supposed to be previsional"): the
 * runs the plan has the team do, as a tinted bar the whole window long with
 * its number above it, and for each period now or behind it, the runs that
 * were done as a solid bar inside it from the bottom (taller than the
 * outline when the team did more than planned). Without the plan's work, as
 * before: what was published, one solid bar per period. A period with
 * nothing has no bar; one not counted has nothing at all.
 */
const WorkStrip: React.FC<{
  keys: string[];
  planned: Array<number | null> | null;
  done: Array<number | null> | null;
  unit: 'week' | 'month';
}> = ({ keys, planned, done, unit }) => {
  const plan = !!planned && planned.some((c) => c != null);
  const max = Math.max(1, ...[...(planned ?? []), ...(done ?? [])].map((c) => c ?? 0));
  const last = Math.max(1, keys.length - 1);
  const per = unit === 'week' ? 'week' : 'month';
  const title = plan ? `Planned each ${per}` : `Published each ${per}`;
  const period = unit === 'week' ? 'Week' : 'Month';
  const height = (c: number) => Math.max(3, Math.round((c / max) * STRIP_BAR_MAX));
  return (
    <div data-testid="growth-published" data-strip={plan ? 'planned' : 'published'} style={{ marginTop: 2 }}>
      {/* The title and the bars share one inset, the plot's own (the y axis's
          width, the right margin), so they can never drift apart. The title
          then starts where the first bar starts: that bar is centred on the
          axis's first point, half its width to the left of it. */}
      <div data-testid="growth-work-inset" style={{ margin: `0 ${PLOT_RIGHT}px 0 ${Y_AXIS_WIDTH}px` }}>
        <div data-testid="growth-work-title" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 12px', margin: `0 0 2px ${-STRIP_BAR_W / 2}px`, fontSize: 11, color: 'var(--text-dim)' }}>
          <span style={{ fontWeight: 600 }}>{title}</span>
          {plan && (
            <span data-testid="growth-work-legend" style={{ display: 'inline-flex', gap: 10 }}>
              <span><PlannedKey />Planned</span>
              <span><DoneKey />Done</span>
            </span>
          )}
        </div>
        <div
          aria-hidden="true"
          // More than 16 periods (the 2-year view's 24 months): the numbers
          // above the bars only where the strip is wide enough to keep them
          // apart (HOME_SECTIONS_CSS, .wms-work-strip--dense); the tooltip and
          // the table still say each one.
          className={keys.length > 16 ? 'wms-work-strip wms-work-strip--dense' : 'wms-work-strip'}
          style={{ position: 'relative', height: STRIP_BAR_MAX + STRIP_COUNT_H, borderBottom: '1px solid var(--glass-border)' }}
        >
          {keys.map((key, i) => {
            const p = planned?.[i] ?? null;
            const d = done?.[i] ?? null;
            const top = plan ? Math.max(p ?? 0, d ?? 0) : d ?? 0;
            if (top <= 0) return null;
            const label = plan ? p : d;
            return (
              <div
                key={key}
                data-bucket={key}
                title={`${period} ${key.slice(1)}: ${workWords(plan ? p : null, d)}`}
                style={{
                  position: 'absolute', bottom: 0, left: `${(i / last) * 100}%`, transform: 'translateX(-50%)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                }}
              >
                <span className="wms-work-count" style={{ fontSize: 10.5, fontWeight: 600, lineHeight: 1, marginBottom: 3, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', minHeight: 10.5 }}>
                  {label != null && label > 0 ? label : ''}
                </span>
                <span style={{ position: 'relative', display: 'block', width: STRIP_BAR_W, height: height(top) }}>
                  {plan && p != null && p > 0 && (
                    <span data-part="planned" style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: height(p), borderRadius: '2px 2px 0 0', background: PLANNED_FILL, boxShadow: `inset 0 0 0 1px ${PLANNED_EDGE}` }} />
                  )}
                  {d != null && d > 0 && (
                    <span data-part="done" style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: height(d), borderRadius: '2px 2px 0 0', background: 'var(--purple)' }} />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {/* The same counts for a screen reader. Hidden by its wrapper: a table
          ignores a 1px width of its own and widens the page on a phone. */}
      <div style={VISUALLY_HIDDEN}>
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{period}</th>
              {plan ? (<><th scope="col">Planned</th><th scope="col">Done</th></>) : <th scope="col">Published</th>}
            </tr>
          </thead>
          <tbody>
            {keys.map((key, i) => {
              const p = planned?.[i] ?? null;
              const d = done?.[i] ?? null;
              if (plan ? p == null && d == null : d == null) return null;
              return (
                <tr key={key}>
                  <th scope="row">{period} {key.slice(1)}</th>
                  {plan
                    ? (<><td>{p ?? ''}</td><td>{d == null ? '' : workWords(p, d)}</td></>)
                    : <td>{d}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** "We're here" draws under the sales line (recharts' line layer is 400). */
export const NOW_LINE_Z = 350;

/** The latest sales point's words. */
export function amountText(amount: string, kind: 'pace' | 'so far' | 'done'): string {
  return kind === 'pace' ? `${amount} on pace` : kind === 'so far' ? `${amount} so far` : amount;
}

/** The latest point's amount, beside it, away from the "We're here" line
 *  that runs through it; a halo in the card's color keeps it legible. */
const AmountLabel: React.FC<{ viewBox?: { x?: number; y?: number }; text: string; align: 'start' | 'end' }> = ({ viewBox, text, align }) => (
  <text
    x={(viewBox?.x ?? 0) + (align === 'start' ? 8 : -8)} y={(viewBox?.y ?? 0) + 4}
    textAnchor={align} fontSize={11.5} fontWeight={650} fill="var(--text)"
    stroke="var(--bg-raised, #fff)" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke"
    style={{ pointerEvents: 'none' }}
  >
    {text}
  </text>
);

/** The sales' only point: solid and bigger, ringed in the card's color, so it
 *  reads on its own and on the "We're here" line that runs through it. */
export const LONE_DOT_R = 5;
const LoneDot: React.FC<{ cx: number; cy: number }> = ({ cx, cy }) => (
  <circle cx={cx} cy={cy} r={LONE_DOT_R} fill="var(--cyan)" stroke="var(--bg-raised, #fff)" strokeWidth={2} data-lone="true" />
);

/** A legend key: a short line in the series' color. */
const LineKey: React.FC<{ color: string }> = ({ color }) => (
  <span aria-hidden="true" style={{ display: 'inline-block', width: 14, height: 2, borderRadius: 1, background: color, verticalAlign: 'middle', marginRight: 6 }} />
);

export const GrowthGraph: React.FC<GrowthGraphProps> = ({
  assumptions, currency, scenario = 'expected', snapshots, activatedAt, events = [],
  currentPeriodCents = null, published = null, planned = null, ran = null,
}) => {
  useHomeSectionStyles();
  const [chosen, setChosen] = useState<GrowthWindow | null>(null);
  const start = ms(activatedAt);

  const view = useMemo(() => {
    if (!assumptions || start == null) return null;
    return growthView({
      assumptions, scenario, snapshots, start, events, window: chosen, currentPeriodCents,
      published: Array.isArray(published) ? published : null,
      planned: Array.isArray(planned) ? planned : null,
      ran: Array.isArray(ran) ? ran : null,
      now: Date.now(),
    });
  }, [assumptions, scenario, snapshots, start, events, chosen, currentPeriodCents, published, planned, ran]);

  if (!view || view.data.length === 0) return null;
  const money = (v: number) => formatMoneyShort(v * 100, currency);
  const cadence = view.naturalUnit === 'week' ? 'week' : 'month';
  const cadenceUnit = view.unit === 'week' ? 'week' : 'month';
  // The default window is the near one once there are sales: going back to it
  // is "back". Before any sale the chart opens on the whole plan, and the near
  // window is something to look at, not to return to.
  const toggleLabel = view.fullPlan
    ? (view.hasSales ? `Back to this ${cadence}` : `See this ${cadence}`)
    : 'See the full 2-year plan';
  // The strip: the plan's work (planned runs, the runs done inside) when the
  // API sends it, else what was published; nothing without either. The two
  // are different units, so the published count never fills a planned bar.
  const hasAny = (a: Array<number | null> | null) => !!a && a.some((c) => c != null);
  const strip = hasAny(view.planned)
    ? { planned: view.planned, done: view.ran }
    : hasAny(view.published) ? { planned: null, done: view.published } : null;

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
          Your plan, and where you are
          <SectionHelpTip
            id="forecast"
            topic="forecast"
            label="What does this graph mean?"
          >
            The forecast is the plan you accepted when you started, not a promise.
            Only <strong>Your sales</strong> is money that actually arrived.
          </SectionHelpTip>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 11.5, color: 'var(--text-dim)', alignItems: 'center' }}>
          <span><LineKey color="var(--purple)" />Sales forecast</span>
          {view.hasSales && (
            <span><LineKey color="var(--cyan)" />{view.livePaced ? 'Your sales, dashed = on pace' : 'Your sales'}</span>
          )}
          <button
            type="button"
            data-testid="growth-window"
            onClick={() => setChosen(view.fullPlan ? 'near' : 'full')}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11.5, color: 'var(--text-dim)', textDecoration: 'underline' }}
          >
            {toggleLabel}
          </button>
        </div>
      </div>

      <div style={{ width: '100%', height: 240 }}>
        {/* initialDimension: before the first measure the container is -1 x -1,
            and recharts logs a width(-1) warning on every Home load; minHeight
            alone does not stop it (prod check 2026-09-27, L12). */}
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240} initialDimension={CHART_INITIAL_SIZE}>
          <ComposedChart data={view.data} margin={{ top: 34, right: PLOT_RIGHT, bottom: 4, left: 0 }}>
            <defs>
              <linearGradient id="wmPlanFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--purple)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--purple)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--glass-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="key" tick={{ fill: 'var(--text-dim)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={money} tick={{ fill: 'var(--text-dim)', fontSize: 11 }} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} />
            <Tooltip
              contentStyle={{ background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 10, fontSize: 12 }}
              formatter={(v: unknown, name: unknown) => [typeof v === 'number' ? money(v) : '', String(name ?? '')]}
              labelFormatter={(l) => (view.unit === 'week' ? `Week ${String(l).slice(1)}` : `Month ${String(l).slice(1)}`)}
            />
            <Area type="monotone" dataKey="plan" name="Sales forecast" stroke="var(--purple)" strokeWidth={2} fill="url(#wmPlanFill)" />
            {/* "We're here" under the sales (2026-10-11): its dashed line sat
                over a young business's only sales point, at the same x, and
                hid it. Lines draw at recharts' zIndex 400 and their dots at
                600; this one at 350, above the plan's area (100). Its pill is
                a label, in the top margin, above everything. */}
            {view.nowKey && (
              <ReferenceLine
                x={view.nowKey}
                stroke="var(--danger)"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                zIndex={NOW_LINE_Z}
                label={<NowFlag align={view.nowAlign} />}
              />
            )}
            {view.hasSales && (
              <Line
                type="monotone" dataKey="actual" name="Your sales"
                stroke="var(--cyan)" strokeWidth={2.5}
                dot={(p: { cx?: number; cy?: number; index?: number }) => (
                  p.cx == null || p.cy == null
                    ? <g key={`a-${p.index}`} />
                    : view.lonePoint
                      ? <LoneDot key={`a-${p.index}`} cx={p.cx} cy={p.cy} />
                      : <circle key={`a-${p.index}`} cx={p.cx} cy={p.cy} r={3} fill="var(--cyan)" stroke="var(--cyan)" />
                )}
                connectNulls={false} isAnimationActive={false}
              />
            )}
            {view.hasLive && (
              <Line
                type="monotone" dataKey="live"
                name={view.livePaced ? `This ${cadenceUnit}, on pace` : `This ${cadenceUnit} so far`}
                stroke="var(--cyan)" strokeWidth={2.5} strokeDasharray="4 3"
                // One open dot, on this period: the segment's other end has its own.
                dot={(p: { cx?: number; cy?: number; index?: number; payload?: { key?: string } }) => (
                  p.payload?.key !== view.nowKey || p.cx == null || p.cy == null
                    ? <g key={`l-${p.index}`} />
                    : view.lonePoint
                      ? <LoneDot key={`l-${p.index}`} cx={p.cx} cy={p.cy} />
                      : <circle key={`l-${p.index}`} cx={p.cx} cy={p.cy} r={3} fill="var(--bg-raised, #fff)" stroke="var(--cyan)" strokeWidth={2} />
                )}
                connectNulls={false} isAnimationActive={false}
              />
            )}
            {/* The latest point says its amount: "on pace" only when it is. */}
            {view.latest && (
              <ReferenceDot
                x={view.latest.key}
                y={view.latest.value}
                r={0}
                stroke="none"
                fill="none"
                label={<AmountLabel text={amountText(money(view.latest.value), view.latest.kind)} align={view.latest.align} />}
              />
            )}
            {/* Milestones live on the baseline: same time axis, not money. */}
            {view.flags.map((f) => (
              <ReferenceDot
                key={f.k}
                x={f.k}
                y={0}
                r={3.5}
                fill="var(--text-dim)"
                stroke="none"
                label={<FlagLabel text={f.label} row={f.row} align={f.align} />}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {strip && (
        <WorkStrip keys={view.data.map((d) => d.key)} planned={strip.planned} done={strip.done} unit={view.unit} />
      )}

      <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-dim)' }}>
        {view.hasSales ? (
          <>
            The forecast is the plan you set when you started, not a promise. Your own sales are
            drawn on top of it
            {view.hasLive
              ? view.livePaced
                ? `; the dashed end is the pace this ${cadenceUnit} is running at, from what has come in so far`
                : `; the dashed end is this ${cadenceUnit}, still running`
              : ''}.
          </>
        ) : (
          <>
            This is the forecast you set when you started, not a promise. Your own sales will be drawn
            on top of it as they come in.
          </>
        )}
      </p>
    </div>
  );
};

export default GrowthGraph;
