import type { OpenState } from "./types";

/**
 * A deliberately conservative `opening_hours` reader.
 *
 * The full OSM opening_hours grammar supports things like "Sa[-1] 10:00-14:00"
 * and "Mar-Oct Su 09:00+". Implementing all of it correctly is a library-sized
 * job, and getting it subtly wrong means telling somebody a market is open when
 * it isn't. So we handle the common subset and return "unknown" for everything
 * else — the raw string is always shown in the UI as the source of truth.
 */

const DAY_INDEX: Record<string, number> = {
  su: 0, sun: 0, sunday: 0,
  mo: 1, mon: 1, monday: 1,
  tu: 2, tue: 2, tues: 2, tuesday: 2,
  we: 3, wed: 3, wednesday: 3,
  th: 4, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fr: 5, fri: 5, friday: 5,
  sa: 6, sat: 6, saturday: 6,
};

/** Anything we knowingly can't evaluate. */
const UNSUPPORTED =
  /\b(ph|sh|easter|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|week|sunrise|sunset|dusk|dawn)\b|\[|\||"/i;

interface Interval {
  /** Minutes from midnight. */
  start: number;
  end: number;
}

function parseTime(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 48 || min > 59) return null;
  return h * 60 + min;
}

function parseDaySelector(text: string): number[] | null {
  const days = new Set<number>();
  for (const part of text.split(",")) {
    const chunk = part.trim().toLowerCase();
    if (!chunk) continue;
    const range = /^([a-z]+)\s*-\s*([a-z]+)$/.exec(chunk);
    if (range) {
      const from = DAY_INDEX[range[1]];
      const to = DAY_INDEX[range[2]];
      if (from === undefined || to === undefined) return null;
      // Ranges wrap, e.g. Sa-Su.
      for (let i = from; ; i = (i + 1) % 7) {
        days.add(i);
        if (i === to) break;
      }
      continue;
    }
    const single = DAY_INDEX[chunk];
    if (single === undefined) return null;
    days.add(single);
  }
  return days.size ? [...days] : null;
}

/**
 * Evaluate an opening_hours string at a given local time.
 *
 * @param value the raw `opening_hours` tag
 * @param now   the moment to test, in the *place's* local time
 */
export function evaluateHours(
  value: string | undefined,
  now: Date = new Date(),
): OpenState {
  if (!value) return "unknown";
  const raw = value.trim();
  if (!raw) return "unknown";

  if (/^24\/7$/i.test(raw)) return "open";
  if (UNSUPPORTED.test(raw)) return "unknown";

  const today = now.getDay();
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  // Rules are applied in order; a later rule overrides an earlier one for the
  // days it mentions, which is how "Mo-Sa 09:00-18:00; We off" works.
  let todaysIntervals: Interval[] | null = null;
  let matchedAnyRule = false;

  for (const ruleText of raw.split(";")) {
    const rule = ruleText.trim();
    if (!rule) continue;

    // Split "Mo-Fr 08:00-17:00" into day selector and time selector.
    const m = /^([A-Za-z,\s-]*?)\s*((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*,?\s*)+|off|closed)$/i.exec(
      rule,
    );
    if (!m) return "unknown";

    const daysText = m[1].trim();
    const timesText = m[2].trim();

    let days: number[];
    if (!daysText) {
      days = [0, 1, 2, 3, 4, 5, 6];
    } else {
      const parsed = parseDaySelector(daysText);
      if (!parsed) return "unknown";
      days = parsed;
    }

    matchedAnyRule = true;
    if (!days.includes(today)) continue;

    if (/^(off|closed)$/i.test(timesText)) {
      todaysIntervals = [];
      continue;
    }

    const intervals: Interval[] = [];
    for (const span of timesText.split(",")) {
      const [fromText, toText] = span.split("-");
      const start = parseTime(fromText ?? "");
      const end = parseTime(toText ?? "");
      if (start === null || end === null) return "unknown";
      intervals.push({ start, end });
    }
    todaysIntervals = intervals;
  }

  if (!matchedAnyRule) return "unknown";
  if (todaysIntervals === null) return "closed"; // No rule covers today.
  if (todaysIntervals.length === 0) return "closed"; // Explicitly off.

  for (const { start, end } of todaysIntervals) {
    if (end <= start) {
      // Overnight span, e.g. 22:00-02:00.
      if (minutesNow >= start || minutesNow < end) return "open";
    } else if (minutesNow >= start && minutesNow < end) {
      return "open";
    }
  }
  return "closed";
}

/** Turn "Tu,Sa 08:00-14:00" into something a person wants to read. */
export function humanizeHours(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^24\/7$/i.test(value.trim())) return "Open 24/7";
  return value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" · ");
}
