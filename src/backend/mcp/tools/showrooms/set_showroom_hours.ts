import { showroomStoreHours, showroomStores } from "@backend/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";

/** Day-of-week enum shared by the hours tools — matches the `showroom_hours.day` column. */
const DAY_ENUM = z.enum([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

export const setShowroomHours = defineTool({
  name: "set_showroom_hours",
  category: "showrooms",
  title: "Set a day's opening hours",
  description:
    "Upsert the opening-hours window for ONE day of the week (24-hour clock). If a window already exists for this (showroom, day) it is replaced; otherwise a new one is inserted — so this is safe to retry. To mark a day CLOSED, do not set a window for it (a day with no row is closed). Validates the showroom exists first.",
  inputShape: {
    showroomId: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
    day: DAY_ENUM.describe("Day of week this window applies to"),
    openHour: z.number().int().min(0).max(23).describe("Opening hour, 24-hour clock (0-23)"),
    openMinute: z.number().int().min(0).max(59).optional().describe("Opening minute (0-59), default 0"),
    closeHour: z.number().int().min(0).max(23).describe("Closing hour, 24-hour clock (0-23)"),
    closeMinute: z.number().int().min(0).max(59).optional().describe("Closing minute (0-59), default 0"),
  },
  annotations: WRITE_IDEMPOTENT,
  examples: [
    {
      title: "Mon 9-5",
      args: { showroomId: 4, day: "MONDAY", openHour: 9, closeHour: 17 },
    },
    {
      title: "Sat 10:30-15:00",
      args: {
        showroomId: 4,
        day: "SATURDAY",
        openHour: 10,
        openMinute: 30,
        closeHour: 15,
      },
    },
  ],
  outputShape: {
    upserted: z.boolean(),
    hours: looseObject({ id: z.number().int(), day: z.string() }),
    url: urlField,
  },
  handler: async ({ env, db }, input) => {
    const [store] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(eq(showroomStores.id, input.showroomId))
      .limit(1);
    if (!store) {
      toolError(`Showroom ${input.showroomId} not found. Call list_showrooms for valid ids.`);
    }
    // Replace-if-present: delete any existing (showroom, day) window, then insert.
    await db
      .delete(showroomStoreHours)
      .where(
        and(
          eq(showroomStoreHours.showroomId, input.showroomId),
          eq(showroomStoreHours.day, input.day),
        ),
      )
      .run();
    const [created] = await db
      .insert(showroomStoreHours)
      .values({
        showroomId: input.showroomId,
        day: input.day,
        openHour: input.openHour,
        openMinute: input.openMinute ?? 0,
        closeHour: input.closeHour,
        closeMinute: input.closeMinute ?? 0,
      })
      .returning();
    return { upserted: true, hours: created, url: showroomUrl(env, input.showroomId) };
  },
});
