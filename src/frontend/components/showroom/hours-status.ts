/**
 * @fileoverview hours-status — pure PST-aware open/closed logic over the
 * normalized `showroom_hours` rows the API now returns.
 *
 * The API serves `hours: HourRow[]` — ONE ROW PER OPEN DAY (a day with no row
 * is closed). Everything here is PURE (no React/DOM/fetch) so it can be unit
 * tested and reused by any card. Times are 24-hour integers; we format to
 * 12-hour on display.
 *
 * The "clever" label follows these rules (matching the product spec):
 *   - Open now                          → "Closes 5:00 PM"
 *   - Closed now, opens later today     → "Opens 10:00 AM"
 *   - Weekend, closed both Sat & Sun    → "Not open on weekends"
 *   - Saturday, Sat closed, Sun open    → "Not open Saturdays, opens tomorrow 10:00 AM"
 *   - Otherwise closed today            → "Opens tomorrow 10:00 AM" / "Opens Monday 10:00 AM"
 */

export type ShowroomDay =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

export interface HourRow {
  day: ShowroomDay;
  openHour: number;
  openMinute: number;
  closeHour: number;
  closeMinute: number;
}

/** Current PST snapshot (0 = Sun … 6 = Sat, minutes since midnight). */
export interface PstNow {
  day: number;
  minutes: number;
  label: string;
}

export type ShowroomStatus = "open" | "closed" | "closing-soon";

/** Enum day → JS getDay() index (Sun = 0 … Sat = 6). */
const DAY_ENUM_TO_INDEX: Record<ShowroomDay, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

/** JS day index → spelled-out weekday name. */
const INDEX_TO_DAY_NAME = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Format 24-hour integers as a 12-hour clock label, e.g. (17, 0) → "5:00 PM". */
export function fmtHm(hour: number, minute: number): string {
  const mer = hour >= 12 ? "PM" : "AM";
  let h = hour % 12;
  if (h === 0) h = 12;
  return `${h}:${String(minute).padStart(2, "0")} ${mer}`;
}

const openMinutes = (r: HourRow) => r.openHour * 60 + r.openMinute;
const closeMinutes = (r: HourRow) => r.closeHour * 60 + r.closeMinute;

/** The window for a given JS day index, or null if the store is closed then. */
function rowForDay(hours: HourRow[], dayIndex: number): HourRow | null {
  return hours.find((h) => DAY_ENUM_TO_INDEX[h.day] === dayIndex) ?? null;
}

/** True when the store has at least one Saturday or Sunday window. */
export function isOpenWeekends(hours: HourRow[]): boolean {
  return hours.some(
    (h) => h.day === "SATURDAY" || h.day === "SUNDAY",
  );
}

/**
 * True when the store is open at the given PST moment. Daytime-business hours:
 * `close` is assumed later than `open` on the same day (no midnight wrapping —
 * see the showroom_hours schema note), so a simple in-window check is correct.
 */
export function isOpenNow(hours: HourRow[], now: PstNow): boolean {
  const row = rowForDay(hours, now.day);
  if (!row) return false;
  return now.minutes >= openMinutes(row) && now.minutes < closeMinutes(row);
}

/**
 * The card's status chip + clever hours label for the current PST moment.
 * Returns `null` when the store has no hours at all (caller can hide the row).
 */
export function computeShowroomStatus(
  hours: HourRow[],
  now: PstNow,
): { status: ShowroomStatus; label: string } | null {
  if (!hours || hours.length === 0) return null;

  const todayRow = rowForDay(hours, now.day);

  // ── Open right now ─────────────────────────────────────────────────────────
  if (
    todayRow &&
    now.minutes >= openMinutes(todayRow) &&
    now.minutes < closeMinutes(todayRow)
  ) {
    const closingSoon = closeMinutes(todayRow) - now.minutes <= 60;
    return {
      status: closingSoon ? "closing-soon" : "open",
      label: `Closes ${fmtHm(todayRow.closeHour, todayRow.closeMinute)}`,
    };
  }

  // ── Closed now, but opens later today ───────────────────────────────────────
  if (todayRow && now.minutes < openMinutes(todayRow)) {
    return {
      status: "closed",
      label: `Opens ${fmtHm(todayRow.openHour, todayRow.openMinute)}`,
    };
  }

  // ── Closed for the rest of today — find the next open day ───────────────────
  const isWeekendToday = now.day === 0 || now.day === 6;
  const satRow = rowForDay(hours, 6);
  const sunRow = rowForDay(hours, 0);

  // Weekend with neither weekend day open → the clean "not open on weekends".
  if (isWeekendToday && !satRow && !sunRow) {
    return { status: "closed", label: "Not open on weekends" };
  }

  // Scan forward for the next day that has a window (offset 1..7).
  let next: { offset: number; dayIndex: number; row: HourRow } | null = null;
  for (let offset = 1; offset <= 7; offset++) {
    const dayIndex = (now.day + offset) % 7;
    const row = rowForDay(hours, dayIndex);
    if (row) {
      next = { offset, dayIndex, row };
      break;
    }
  }
  if (!next) return { status: "closed", label: "Closed" };

  const openStr = fmtHm(next.row.openHour, next.row.openMinute);
  const whenStr =
    next.offset === 1 ? "tomorrow" : INDEX_TO_DAY_NAME[next.dayIndex];

  // Weekend-day-specific phrasing (e.g. "Not open Saturdays, opens tomorrow …").
  if (now.day === 6 && !todayRow) {
    return { status: "closed", label: `Not open Saturdays, opens ${whenStr} ${openStr}` };
  }
  if (now.day === 0 && !todayRow) {
    return { status: "closed", label: `Not open Sundays, opens ${whenStr} ${openStr}` };
  }

  return { status: "closed", label: `Opens ${whenStr} ${openStr}` };
}
