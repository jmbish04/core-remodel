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

import { showroomHours } from "@backend/db/schema/showroom/index";

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
