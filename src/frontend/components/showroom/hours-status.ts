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

/** `HoursJson` day key → the `showroom_store_hours` day enum. */
const JSON_KEY_TO_DAY: Record<string, ShowroomDay> = {
  mon: "MONDAY",
  tue: "TUESDAY",
  wed: "WEDNESDAY",
  thu: "THURSDAY",
  fri: "FRIDAY",
  sat: "SATURDAY",
  sun: "SUNDAY",
};

/**
 * Convert the structured `HoursJson` the store detail carries into the
 * `HourRow[]` shape the status math takes — one row per OPEN day, closed days
 * dropped (which is exactly the `showroom_store_hours` convention). Lets a
 * caller holding only `hoursJson` reuse `computeShowroomStatus` rather than
 * reimplementing open/closed logic.
 *
 * Typed loosely (`Record<string, {open,close} | null>`) to avoid importing the
 * intake's `HoursJson` type here and coupling this pure module to that folder.
 */
export function hoursJsonToRows(
  json: Record<string, { open: string; close: string } | null> | null | undefined,
): HourRow[] {
  if (!json) return [];
  const rows: HourRow[] = [];
  for (const [key, day] of Object.entries(JSON_KEY_TO_DAY)) {
    const w = json[key];
    if (!w) continue;
    const [oh, om] = w.open.split(":").map((n) => parseInt(n, 10));
    const [ch, cm] = w.close.split(":").map((n) => parseInt(n, 10));
    if (![oh, om, ch, cm].every(Number.isFinite)) continue;
    rows.push({ day, openHour: oh, openMinute: om, closeHour: ch, closeMinute: cm });
  }
  return rows;
}

/** Current PST snapshot (0 = Sun … 6 = Sat, minutes since midnight). */
export interface PstNow {
  day: number;
  minutes: number;
  /** The moment rendered as a 12-hour label, e.g. "2:45 PM". */
  label: string;
}

/** Three-letter lowercase weekday → JS day index. */
const WEEKDAY_ABBREV_TO_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/** Minutes-since-midnight → "2:45 PM". */
function fmtMinutes(min: number): string {
  let h = Math.floor(min / 60);
  const m = min % 60;
  const mer = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, "0")} ${mer}`;
}

/**
 * The current moment in America/Los_Angeles — every showroom hour in D1 is
 * stored as local showroom (PST) wall-clock time, so open/closed math must be
 * done in that zone regardless of where the browser is.
 */
export function pstNow(): PstNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday").toLowerCase().slice(0, 3);
  // Intl can emit hour "24" for midnight under hour12:false.
  let hour = parseInt(get("hour"), 10);
  if (hour === 24 || Number.isNaN(hour)) hour = 0;
  const minute = parseInt(get("minute"), 10) || 0;
  const minutes = hour * 60 + minute;
  return { day: WEEKDAY_ABBREV_TO_INDEX[wd] ?? 0, minutes, label: fmtMinutes(minutes) };
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
