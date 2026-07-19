/**
 * @fileoverview Showroom Scout — California time reasoning.
 *
 * Every temporal phrase the user types ("today", "this morning", "Saturday")
 * MUST be resolved in `America/Los_Angeles`, not in the Worker's UTC clock. A
 * sweep started at 02:00 UTC Sunday is still *Saturday evening* in California,
 * and getting that wrong silently recommends closed showrooms.
 *
 * Everything here is pure + deterministic given a `now` — the caller passes
 * `new Date()` so this stays unit-testable.
 */

export const CA_TZ = "America/Los_Angeles";

/** Day keys as stored in `showroom_store_hours.day`. */
export const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type DayKey = (typeof DAY_KEYS)[number];

/** A resolved shopping window, in California wall-clock terms. */
export interface CaWindow {
  /** ISO date `YYYY-MM-DD` in California. */
  date: string;
  day: DayKey;
  /**
   * Minutes from midnight, California wall clock.
   * INVARIANT: `startMinute < endMinute`, always. See {@link resolveWindow}.
   */
  startMinute: number;
  endMinute: number;
  /** Human label echoed back to the user so the interpretation is auditable. */
  label: string;
  /**
   * True when the requested window had already passed and was rolled forward to
   * the next occurrence. The agent must say so — otherwise the user asks for
   * "Saturday morning" on Saturday night and silently gets next week.
   */
  rolledForward: boolean;
}

/**
 * California wall-clock parts for an instant. Uses `Intl` rather than manual
 * offset math so DST is handled by the runtime.
 */
export function caParts(now: Date): {
  date: string;
  day: DayKey;
  hour: number;
  minute: number;
  minuteOfDay: number;
} {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: CA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "long",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  // `hour` can come back as "24" at midnight in some ICU builds; normalize.
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    day: String(parts.weekday).toLowerCase() as DayKey,
    hour,
    minute,
    minuteOfDay: hour * 60 + minute,
  };
}

/** Shift an ISO `YYYY-MM-DD` by whole days without tripping over timezones. */
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Time-of-day phrases → [startMinute, endMinute) in California wall clock. */
const PART_OF_DAY: Record<string, [number, number]> = {
  morning: [8 * 60, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 20 * 60],
  "all day": [8 * 60, 18 * 60],
};

/**
 * Resolve a natural-language temporal phrase against California time.
 *
 * Deliberately narrow: it handles the phrases this product actually sees
 * ("today", "tomorrow", a weekday name, a part-of-day) and otherwise falls back
 * to "rest of today". The agent restates the resolved `label` to the user, so a
 * fallback is visible rather than silent.
 *
 * ponytail: no full NLP date parser. Add one when users type real dates.
 */
export function resolveWindow(phrase: string | undefined, now: Date): CaWindow {
  const nowParts = caParts(now);
  const text = (phrase ?? "").toLowerCase().trim();

  // --- Which day? ---
  let date = nowParts.date;
  let label = "today";

  const named = text.includes("tomorrow") ? null : DAY_KEYS.find((d) => text.includes(d));

  if (text.includes("tomorrow")) {
    date = addDays(nowParts.date, 1);
    label = "tomorrow";
  } else if (named) {
    // A named weekday means the NEXT occurrence, and "saturday" said on a
    // Saturday means today — not a week out.
    const delta = (DAY_KEYS.indexOf(named) - DAY_KEYS.indexOf(nowParts.day) + 7) % 7;
    date = addDays(nowParts.date, delta);
    label = delta === 0 ? `today (${named})` : named;
  }

  // --- Which part of that day? ---
  const partKey = Object.keys(PART_OF_DAY).find((k) => text.includes(k));
  const [baseStart, endMinute] = partKey ? PART_OF_DAY[partKey] : PART_OF_DAY["all day"];
  if (partKey) label = `${label} ${partKey}`;

  let startMinute = baseStart;
  let rolledForward = false;

  // On the current day we can only shop from now forward — otherwise the agent
  // proposes a 9am ETA at 2pm and routes to already-closed showrooms.
  if (date === nowParts.date) {
    startMinute = Math.max(startMinute, nowParts.minuteOfDay);
    if (!partKey) label = "rest of today";
  }

  // The clamp above can push start past end ("saturday morning" asked at 7pm on
  // Saturday), which would produce an inverted, nonsensical window. A model
  // handed one will quietly invent a plausible time instead of complaining, so
  // the invariant is enforced here: roll to the next real occurrence.
  if (startMinute >= endMinute) {
    // A named weekday rolls a full week; anything else rolls to tomorrow.
    date = addDays(date, named ? 7 : 1);
    startMinute = baseStart;
    rolledForward = true;
    label = `${partKey ? `${named ?? "tomorrow"} ${partKey}` : (named ?? "tomorrow")} (next occurrence — the requested window has already passed)`;
  }

  const day = DAY_KEYS[(DAY_KEYS.indexOf(nowParts.day) + daysBetween(nowParts.date, date)) % 7];

  return { date, day, startMinute, endMinute, label, rolledForward };
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}

/** `540` → `"9:00 AM"`, for prompts and user-facing route output. */
export function formatMinute(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
}

/**
 * Is a showroom open across `[from, to)` on `day`, given its hour rows?
 *
 * Returns `unknown` when we simply have no hour data — the agent must present
 * that as "hours unverified, call ahead" rather than quietly assuming open.
 * This is the verified-fact / inferred-judgment split the spec requires.
 */
export function openDuring(
  rows: Array<{ day: string; openHour: number; openMinute: number; closeHour: number; closeMinute: number }>,
  day: DayKey,
  from: number,
  to: number,
): { status: "open" | "closed" | "unknown"; opensAt?: number; closesAt?: number } {
  const today = rows.filter((r) => String(r.day).toLowerCase() === day);
  if (rows.length === 0) return { status: "unknown" };
  if (today.length === 0) return { status: "closed" };

  for (const r of today) {
    const open = r.openHour * 60 + r.openMinute;
    const close = r.closeHour * 60 + r.closeMinute;
    // Overlap, not containment: a 4pm close still leaves a usable 3–4pm visit.
    if (open < to && close > from) return { status: "open", opensAt: open, closesAt: close };
  }
  const first = today[0];
  return {
    status: "closed",
    opensAt: first.openHour * 60 + first.openMinute,
    closesAt: first.closeHour * 60 + first.closeMinute,
  };
}
