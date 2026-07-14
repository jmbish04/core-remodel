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

import { showroomStoreHours, showroomStores } from "@backend/db/schema/showroom/index";

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
): Array<typeof showroomStoreHours.$inferInsert> {
  const rows: Array<typeof showroomStoreHours.$inferInsert> = [];
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

/**
 * The full 7-key hours shape. Formerly stored on `showroom_stores.hours_json`;
 * that column has been removed — `showroom_store_hours` rows are now the sole
 * store of truth. This shape survives as the API/MCP write PAYLOAD and the
 * derived READ shape (`rowsToHoursJson`).
 */
export type HoursJsonColumn = {
  mon: { open: string; close: string } | null;
  tue: { open: string; close: string } | null;
  wed: { open: string; close: string } | null;
  thu: { open: string; close: string } | null;
  fri: { open: string; close: string } | null;
  sat: { open: string; close: string } | null;
  sun: { open: string; close: string } | null;
};

/** enum day → hoursJson key. */
const ENUM_TO_DAY_KEY: Record<string, keyof HoursJsonColumn> = {
  MONDAY: "mon", TUESDAY: "tue", WEDNESDAY: "wed", THURSDAY: "thu",
  FRIDAY: "fri", SATURDAY: "sat", SUNDAY: "sun",
};

/** Pad an integer to a 2-digit "HH"/"MM". */
function pad2(n: number): string {
  return String(Math.max(0, Math.min(59, n | 0))).padStart(2, "0");
}

/**
 * Convert normalized `showroom_store_hours` rows (one per open day) back into the
 * structured `hoursJson` shape for API responses — so the frontend keeps its
 * single hours model even though the blob column is gone. Days with no row are
 * null (closed).
 */
export function rowsToHoursJson(
  rows: Array<{
    day: string;
    openHour: number;
    openMinute: number;
    closeHour: number;
    closeMinute: number;
  }>,
): HoursJsonColumn {
  const out: HoursJsonColumn = {
    mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
  };
  for (const r of rows) {
    const key = ENUM_TO_DAY_KEY[r.day];
    if (!key) continue;
    out[key] = { open: `${pad2(r.openHour)}:${pad2(r.openMinute)}`, close: `${pad2(r.closeHour)}:${pad2(r.closeMinute)}` };
  }
  return out;
}

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

// ─── Derived flags ────────────────────────────────────────────────────────────

/** True when the store is open Saturday or Sunday. Derived from `hoursJson`. */
export function deriveIsOpenWeekends(hoursJson: NonNullable<HoursJson>): boolean {
  return Boolean(hoursJson.sat || hoursJson.sun);
}

// ─── Legacy free-text → structured hoursJson (one-time backfill) ───────────────

/** Full day-name (lowercased) → hoursJson day-key. */
const DAY_NAME_TO_KEY: Record<string, keyof HoursJsonColumn> = {
  monday: "mon",
  tuesday: "tue",
  wednesday: "wed",
  thursday: "thu",
  friday: "fri",
  saturday: "sat",
  sunday: "sun",
};

/**
 * Parse a single "8:00 AM" / "8 AM" / "12:30 PM" token into 24-hour "HH:MM".
 * Returns null when the token can't be parsed.
 */
function parse12hToHhmm(token: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?$/.exec(token.trim());
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const isPm = m[3].toLowerCase() === "p";
  if (hour === 12) hour = 0;
  if (isPm) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Parse the legacy free-text `weekday_hours` column — a full-week block like:
 *
 *   Monday: 8:00 AM – 4:30 PM
 *   Tuesday: 8:00 AM – 4:30 PM
 *   ...
 *   Saturday: 8:30 AM – 3:30 PM
 *   Sunday: Closed
 *
 * into the structured `hoursJson` shape. Days that are absent or "Closed" map
 * to null. Returns null when NO day line could be parsed (nothing to migrate).
 *
 * One-time use for the weekday/weekend → hoursJson backfill; new writes never
 * touch free-text hours.
 */
export function parseLegacyHoursText(text: string | null | undefined): HoursJsonColumn | null {
  if (!text) return null;
  const out: HoursJsonColumn = {
    mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
  };
  let parsedAny = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const dm = /^([A-Za-z]+)\s*:\s*(.+)$/.exec(line);
    if (!dm) continue;
    const key = DAY_NAME_TO_KEY[dm[1].toLowerCase()];
    if (!key) continue;
    const value = dm[2].trim();
    if (/^closed$/i.test(value)) {
      out[key] = null;
      parsedAny = true;
      continue;
    }
    // Split on any dash variant (-, –, —) with optional surrounding spaces.
    const parts = value.split(/\s*[–—-]\s*/);
    if (parts.length < 2) continue;
    const open = parse12hToHhmm(parts[0]);
    const close = parse12hToHhmm(parts[1]);
    if (!open || !close) continue;
    out[key] = { open, close };
    parsedAny = true;
  }

  return parsedAny ? out : null;
}
