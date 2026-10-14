const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Yoda's compact sidebar time (src/renderer/lib/ui/relative-time.tsx): date-fns
 * formatDistanceToNowStrict with floor rounding, units cut to s/m/h/d/mo/y, under a minute 'now'.
 * Same thresholds as date-fns: a month is 30 days, a year 365.
 */
export function compactRelativeTime(at: number, now: number): string {
  const diff = Math.max(0, now - at);
  if (diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  const days = Math.floor(diff / DAY);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
