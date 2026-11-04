/**
 * Times in short English words (2026-10-16), for the activity list and the
 * health card: "just now", "5 min ago", "3 h ago", "Yesterday", "4 days ago",
 * then the date ("Oct 3", "Oct 3, 2025" for another year). A host with its
 * own words passes its own formatter. Pure: the same time and the same "now"
 * always read the same.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A Date from an ISO string or a Date; null when it is not a time. */
export function toDate(time: string | number | Date | null | undefined): Date | null {
  if (time == null || time === '') return null;
  const d = time instanceof Date ? time : new Date(time);
  return Number.isNaN(d.getTime()) ? null : d;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Oct 3", or "Oct 3, 2025" in another year than `now`'s. */
export function dayText(time: Date, now: Date = new Date()): string {
  const opts: Intl.DateTimeFormatOptions = time.getFullYear() === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return time.toLocaleDateString('en-US', opts);
}

/** "Oct 3, 2026": the date with its year, whatever the year. */
export function dateText(time: Date): string {
  return time.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "14:02" today, "Oct 3, 14:02" another day. */
export function whenText(time: Date, now: Date = new Date()): string {
  const clock = time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return sameDay(time, now) ? clock : `${dayText(time, now)}, ${clock}`;
}

/** "just now", "5 min ago", "3 h ago", "Yesterday", "4 days ago", else the date. */
export function formatRelativeTime(time: Date, now: Date = new Date()): string {
  const ms = now.getTime() - time.getTime();
  // A clock a little ahead of ours is still "just now"; further ahead, the date.
  if (ms < -MINUTE) return dayText(time, now);
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  // Past a day, calendar days: rounded, so a daylight saving change does not shift them.
  const days = Math.round((startOfDay(now) - startOfDay(time)) / DAY);
  if (days <= 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return dayText(time, now);
}
