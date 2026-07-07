/**
 * @fileoverview Shared showroom-hours conversion helpers.
 *
 * Converts the structured intake `hoursJson` shape (7 day-keys, each
 * `{ open, close } | null`) into normalized `showroom_hours` insert rows — one
 * row per OPEN day. This is the canonical source used by both the intake create
 * handler and the bulk-backfill submit endpoint so the two stay in lockstep.
 *
 * NOTE: `src/backend/api/routes/showroom-stores.ts` currently carries its own
 * private copy of this logic (predating this util). New code should import from
 * here; that copy can be consolidated onto this util in a follow-up.
 */

import { z } from "@hono/zod-openapi";

import { showroomHours, showroomStores } from "@backend/db/schema/showroom/index";

/** Zod schema for a single day's window (24-hour "HH:MM"), or null when closed. */
const dayWindowSchema = z
  .object({
    open: z.string(),
    close: z.string(),
  })
  .nullable();

/**
 * Zod schema for the structured `hoursJson` payload. All seven keys are optional
 * on input (absent === closed) but a present value must be `{open,close}|null`.
 */
export const hoursJsonSchema = z
  .object({
    mon: dayWindowSchema.optional(),
    tue: dayWindowSchema.optional(),
    wed: dayWindowSchema.optional(),
    thu: dayWindowSchema.optional(),
    fri: dayWindowSchema.optional(),
    sat: dayWindowSchema.optional(),
    sun: dayWindowSchema.optional(),
  })
  .nullable();

export type HoursJson = z.infer<typeof hoursJsonSchema>;

/** hoursJson day-key ("mon"…"sun") → `showroom_hours.day` enum. */
const DAY_KEY_TO_ENUM = {
  mon: "MONDAY",
  tue: "TUESDAY",
  wed: "WEDNESDAY",
  thu: "THURSDAY",
  fri: "FRIDAY",
  sat: "SATURDAY",
  sun: "SUNDAY",
} as const;

/** Parse a 24-hour "HH:MM" string into integer hour/minute (clamped, safe). */
function parseHhmm(hhmm: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return { hour: 0, minute: 0 };
  const hour = Math.min(Math.max(parseInt(m[1], 10) || 0, 0), 23);
  const minute = Math.min(Math.max(parseInt(m[2], 10) || 0, 0), 59);
  return { hour, minute };
}

/**
 * Convert a structured `hoursJson` into normalized `showroom_hours` insert rows —
 * ONE ROW PER OPEN DAY (closed / null / absent days are omitted).
 */
export function hoursJsonToRows(
  showroomId: number,
  hoursJson: NonNullable<HoursJson>,
): Array<typeof showroomHours.$inferInsert> {
  const rows: Array<typeof showroomHours.$inferInsert> = [];
  for (const [key, day] of Object.entries(DAY_KEY_TO_ENUM)) {
    const slot = hoursJson[key as keyof typeof hoursJson];
    if (!slot) continue; // null / absent → closed that day
    const open = parseHhmm(slot.open);
    const close = parseHhmm(slot.close);
    rows.push({
      showroomId,
      day,
      openHour: open.hour,
      openMinute: open.minute,
      closeHour: close.hour,
      closeMinute: close.minute,
    });
  }
  return rows;
}

/** The full 7-key hours shape stored on `showroom_stores.hours_json`. */
export type HoursJsonColumn = NonNullable<
  typeof showroomStores.$inferSelect["hoursJson"]
>;

/**
 * Normalize a permissive `hoursJson` payload (absent key === closed) into the
 * full 7-key shape the `showroom_stores.hours_json` column is typed as.
 */
export function normalizeHoursJson(hoursJson: NonNullable<HoursJson>): HoursJsonColumn {
  return {
    mon: hoursJson.mon ?? null,
    tue: hoursJson.tue ?? null,
    wed: hoursJson.wed ?? null,
    thu: hoursJson.thu ?? null,
    fri: hoursJson.fri ?? null,
    sat: hoursJson.sat ?? null,
    sun: hoursJson.sun ?? null,
  };
}

// ─── Display-summary derivation ───────────────────────────────────────────────

/** Day abbreviation labels used for human-readable summary strings. */
const DAY_LABELS: Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/** Convert a 24-hour "HH:MM" string to a 12-hour "h:MM AM/PM" display string. */
function to12h(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr ?? "00";
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

/**
 * Collapse a list of same-hours consecutive days into range strings — e.g.
 * Mon–Fri sharing "9:00 AM–5:00 PM" collapses to one "Mon–Fri 9:00 AM–5:00 PM"
 * entry. Closed (null) days are omitted.
 */
function collapseHoursGroups(
  days: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">,
  hoursJson: NonNullable<HoursJson>,
): string[] {
  const openDays = days.filter((d) => hoursJson[d] != null);
  if (openDays.length === 0) return [];

  const groups: Array<{
    open: string;
    close: string;
    startDay: string;
    endDay: string;
  }> = [];

  for (const day of openDays) {
    const slot = hoursJson[day]!;
    const last = groups[groups.length - 1];
    if (last && last.open === slot.open && last.close === slot.close) {
      last.endDay = DAY_LABELS[day];
    } else {
      groups.push({
        open: slot.open,
        close: slot.close,
        startDay: DAY_LABELS[day],
        endDay: DAY_LABELS[day],
      });
    }
  }

  return groups.map((g) => {
    const dayRange = g.startDay === g.endDay ? g.startDay : `${g.startDay}–${g.endDay}`;
    return `${dayRange} ${to12h(g.open)}–${to12h(g.close)}`;
  });
}

/**
 * Derive the three back-compat / filter fields from a structured `hoursJson`:
 * `weekdayHours` (Mon–Fri summary), `weekendHours` (Sat/Sun summary, "Closed"
 * when both closed), and `isOpenWeekends`. Mirrors the private copy in
 * `showroom-stores.ts` so backfill writes stay in lockstep with intake writes.
 */
export function deriveHoursSummary(hoursJson: NonNullable<HoursJson>): {
  weekdayHours: string;
  weekendHours: string;
  isOpenWeekends: boolean;
} {
  const weekdayGroups = collapseHoursGroups(["mon", "tue", "wed", "thu", "fri"], hoursJson);
  const weekendGroups = collapseHoursGroups(["sat", "sun"], hoursJson);
  return {
    weekdayHours: weekdayGroups.length > 0 ? weekdayGroups.join(", ") : "Closed",
    weekendHours: weekendGroups.length > 0 ? weekendGroups.join(", ") : "Closed",
    isOpenWeekends: Boolean(hoursJson.sat || hoursJson.sun),
  };
}
