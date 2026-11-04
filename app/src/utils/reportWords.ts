/**
 * A report's type and period in the owner's words, as the dashboard says
 * them. The kit's report prints the stored type through a capitalize
 * ("Plan_progress") and the stored period as a code ("2026-W42"); Home's
 * latest report badges the type the same way. Pure.
 *
 *   weekly         '2026-W42'   -> "Weekly report, week of Oct 12"
 *   daily          '2026-10-10' -> "Daily report, Oct 10"
 *   monthly        '2026-10'    -> "Monthly report, October 2026"
 *   plan_progress  '2026-W42'   -> "Plan progress report, week of Oct 12"
 *
 * A day carries its year only when it is not the current one. A period in
 * another shape is shown as stored, after the words.
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** A report type in words: "weekly" -> "Weekly", "plan_progress" -> "Plan progress". */
export function reportTypeLabel(type: string | undefined | null): string {
  const t = String(type ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : '';
}

/** The Monday (UTC) that starts ISO week `week` of ISO year `year`. */
function isoWeekMonday(year: number, week: number): Date {
  // January 4 is always in week 1; its week's Monday starts week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  return new Date(Date.UTC(year, 0, 4 - day + 1 + (week - 1) * 7));
}

/** "Oct 12", with ", 2025" when the day is not in `now`'s year. */
function shortDay(d: Date, now: Date): string {
  const text = `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === now.getUTCFullYear() ? text : `${text}, ${d.getUTCFullYear()}`;
}

/** The period in words, or null when it has no shape we know. */
function periodWords(period: string, now: Date): string | null {
  const week = /^(\d{4})-W(\d{1,2})$/.exec(period);
  if (week) {
    const monday = isoWeekMonday(Number(week[1]), Number(week[2]));
    return Number.isNaN(monday.getTime()) ? null : `week of ${shortDay(monday, now)}`;
  }
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (day) {
    const d = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
    return Number.isNaN(d.getTime()) ? null : shortDay(d, now);
  }
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) {
    const m = Number(month[2]);
    return m >= 1 && m <= 12 ? `${MONTHS_LONG[m - 1]} ${month[1]}` : null;
  }
  if (/^\d{4}$/.test(period)) return period;
  return null;
}

/** The heading over an open report: "Weekly report, week of Oct 12". */
export function reportHeading(report: { type?: string | null; period?: string | null }, now: Date = new Date()): string {
  const label = reportTypeLabel(report.type);
  const kind = label ? `${label} report` : 'Report';
  const period = String(report.period ?? '').trim();
  if (!period) return kind;
  return `${kind}, ${periodWords(period, now) ?? period}`;
}
