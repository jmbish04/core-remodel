/**
 * @fileoverview hours-types — canonical structured-hours model + pure helpers.
 *
 * This is the single source of truth for the STRUCTURED weekly-hours shape used
 * by the showroom intake editors (`HoursEditor`) and any code that needs to
 * read/write per-day hours. Everything here is PURE — no React, no DOM, no
 * fetch — so it can be unit-tested and imported from mappers, islands, or a
 * future server path alike.
 *
 * Model:
 *   HoursJson = Record<DayKey, DayHours | null>
 *     - DayKey        one of "mon"…"sun" (see DAY_KEYS)
 *     - DayHours      { open: "HH:MM", close: "HH:MM" } in 24-hour time
 *     - null          the store is CLOSED that day
 *
 * The free-text `weekdayHours`/`weekendHours` legacy fields (parsed elsewhere in
 * ShowroomsDirectoryApp) are a SEPARATE representation; this module does not
 * touch them.
 */

// ─── Day keys & labels ────────────────────────────────────────────────────────

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export type DayKey = (typeof DAY_KEYS)[number];

/** A single day's open/close window, both in 24-hour "HH:MM" form. */
export interface DayHours {
  open: string;
  close: string;
}

/**
 * The canonical structured weekly-hours object: exactly seven keys, each either
 * an open/close window or `null` (closed that day).
 */
export type HoursJson = Record<DayKey, DayHours | null>;

/**
 * Display labels per day. `short` is the single-letter chip label (note Tue/Thu
 * and Sat/Sun collide as "T"/"S" — the chip order disambiguates); `full` is the
 * spelled-out weekday name.
 */
export const DAY_LABELS: Record<DayKey, { short: string; full: string }> = {
  mon: { short: "M", full: "Monday" },
  tue: { short: "T", full: "Tuesday" },
  wed: { short: "W", full: "Wednesday" },
  thu: { short: "T", full: "Thursday" },
  fri: { short: "F", full: "Friday" },
  sat: { short: "S", full: "Saturday" },
  sun: { short: "S", full: "Sunday" },
};

/** Standard business default: Mon–Fri 9–5, closed weekends. */
export const DEFAULT_HOURS: HoursJson = {
  mon: { open: "09:00", close: "17:00" },
  tue: { open: "09:00", close: "17:00" },
  wed: { open: "09:00", close: "17:00" },
  thu: { open: "09:00", close: "17:00" },
  fri: { open: "09:00", close: "17:00" },
  sat: null,
  sun: null,
};

/** The window a day is seeded with when toggled open with nothing to copy. */
export const DEFAULT_DAY_HOURS: DayHours = { open: "09:00", close: "17:00" };

// ─── 12h ⇄ 24h conversion ─────────────────────────────────────────────────────

/**
 * Convert a 24-hour "HH:MM" string to a 12-hour clock time + AM/PM period.
 * Returns e.g. `{ time: "9:00", period: "AM" }` for "09:00", `{ time: "5:30",
 * period: "PM" }` for "17:30". Malformed input falls back to `{ "12:00", "AM" }`.
 */
export function to12h(hhmm: string): { time: string; period: "AM" | "PM" } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return { time: "12:00", period: "AM" };
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const safeMin = Number.isFinite(min) ? Math.min(Math.max(min, 0), 59) : 0;
  const period: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return { time: `${h}:${safeMin.toString().padStart(2, "0")}`, period };
}

/**
 * Convert a 12-hour clock time (e.g. "9:00", "9", "12:30") + AM/PM period back
 * to a 24-hour "HH:MM" string. Tolerates a bare hour ("9"), missing minutes, and
 * extra whitespace; clamps out-of-range values. Malformed input → "00:00".
 */
export function from12h(time: string, period: "AM" | "PM"): string {
  const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec((time ?? "").trim());
  if (!m) return "00:00";
  let h = parseInt(m[1], 10);
  let min = m[2] ? parseInt(m[2], 10) : 0;
  if (!Number.isFinite(h)) h = 12;
  if (!Number.isFinite(min)) min = 0;
  h = Math.min(Math.max(h, 1), 12) % 12; // 12 → 0, then re-add for PM below
  if (period === "PM") h += 12;
  min = Math.min(Math.max(min, 0), 59);
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

// ─── Summary formatting ───────────────────────────────────────────────────────

/**
 * Render a short human summary of a `HoursJson`, collapsing consecutive days
 * that share the exact same window into ranges. Examples:
 *   - "Mon–Fri 9:00 AM–5:00 PM · Closed weekends"
 *   - "Every day 8:00 AM–8:00 PM"
 *   - "Closed"
 *
 * Purely cosmetic; safe to call on any (possibly partial) object.
 */
export function formatHoursSummary(h: HoursJson): string {
  const segments: string[] = [];
  let i = 0;
  while (i < DAY_KEYS.length) {
    const key = DAY_KEYS[i];
    const day = h?.[key] ?? null;
    // Group the run of following days that share the identical window (or that
    // are all closed).
    let j = i;
    const sameWindow = (a: DayHours | null, b: DayHours | null): boolean => {
      if (a === null || b === null) return a === b;
      return a.open === b.open && a.close === b.close;
    };
    while (j + 1 < DAY_KEYS.length && sameWindow(h?.[DAY_KEYS[j + 1]] ?? null, day)) {
      j++;
    }
    const startLabel = DAY_LABELS[DAY_KEYS[i]].full.slice(0, 3);
    const endLabel = DAY_LABELS[DAY_KEYS[j]].full.slice(0, 3);
    const rangeLabel = i === j ? startLabel : `${startLabel}–${endLabel}`;
    if (day === null) {
      segments.push(`${rangeLabel} Closed`);
    } else {
      const o = to12h(day.open);
      const c = to12h(day.close);
      segments.push(`${rangeLabel} ${o.time} ${o.period}–${c.time} ${c.period}`);
    }
    i = j + 1;
  }
  if (segments.length === 0) return "Closed";
  return segments.join(" · ");
}

// ─── Curated option lists (for the standard-hours Selects) ────────────────────

/** A selectable time option: 24h value + a 12h display label. */
export interface TimeOption {
  value: string; // "HH:MM"
  label: string; // "9:00 AM"
}

function buildTimeOptions(startHHMM: string, endHHMM: string, stepMin = 30): TimeOption[] {
  const toMin = (s: string): number => {
    const p = s.split(":");
    return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
  };
  const start = toMin(startHHMM);
  const end = toMin(endHHMM);
  const out: TimeOption[] = [];
  for (let mins = start; mins <= end; mins += stepMin) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const value = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    const disp = to12h(value);
    out.push({ value, label: `${disp.time} ${disp.period}` });
  }
  return out;
}

/** Curated OPEN times: 7:00 AM → 11:00 AM in 30-minute steps. */
export const OPEN_TIME_OPTIONS: TimeOption[] = buildTimeOptions("07:00", "11:00");

/** Curated CLOSE times: 2:30 PM → 7:00 PM in 30-minute steps. */
export const CLOSE_TIME_OPTIONS: TimeOption[] = buildTimeOptions("14:30", "19:00");
