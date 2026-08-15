import type { Occurrence } from "./types";

/**
 * Human phrasing for popup dates.
 *
 * A pop-up's dates are the whole point of the listing — "Saturday 12 September,
 * 8am" is the answer someone came for — so they get the same prominence that
 * opening hours have for a permanent shop.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** True when the occurrence has not finished yet. */
export function isUpcoming(occurrence: Occurrence, now = new Date()): boolean {
  const end = Date.parse(occurrence.end ?? occurrence.start);
  if (Number.isNaN(end)) return false;
  // A date-only value parses to midnight; keep it listed for the whole day.
  return end >= startOfDay(now);
}

export function upcomingOccurrences(
  occurrences: Occurrence[] | undefined,
  now = new Date(),
): Occurrence[] {
  if (!occurrences?.length) return [];
  return occurrences
    .filter((o) => isUpcoming(o, now))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** True when the value carried a time of day rather than just a date. */
function hasTime(value: string): boolean {
  return /\d{2}:\d{2}/.test(value);
}

export function formatOccurrence(occurrence: Occurrence, now = new Date()): string {
  const start = new Date(occurrence.start);
  if (Number.isNaN(start.getTime())) return occurrence.note ?? "Date unknown";

  const days = Math.round((startOfDay(start) - startOfDay(now)) / DAY_MS);

  let label: string;
  if (days === 0) label = "Today";
  else if (days === 1) label = "Tomorrow";
  else if (days > 1 && days < 7) {
    label = start.toLocaleDateString(undefined, { weekday: "long" });
  } else {
    label = start.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      // Only mention the year when it isn't the current one.
      ...(start.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    });
  }

  if (hasTime(occurrence.start)) {
    const time = start.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: start.getMinutes() ? "2-digit" : undefined,
    });
    label += `, ${time}`;
  }

  return label;
}

/** A one-line summary for a card: the next date, plus how many more there are. */
export function summariseOccurrences(
  occurrences: Occurrence[] | undefined,
  now = new Date(),
): string | undefined {
  const upcoming = upcomingOccurrences(occurrences, now);
  if (!upcoming.length) {
    // Every listed date has passed — say so rather than showing nothing.
    return occurrences?.length ? "No upcoming dates listed" : undefined;
  }

  const first = formatOccurrence(upcoming[0], now);
  const more = upcoming.length - 1;
  return more > 0 ? `${first} · +${more} more` : first;
}
