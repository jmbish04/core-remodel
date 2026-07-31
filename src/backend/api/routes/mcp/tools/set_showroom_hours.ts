import { showroomStoreHours, showroomStores } from "@backend/db/schema/showroom/index";
import { deriveIsOpenWeekends, hoursJsonToRows, rowsToHoursJson } from "@backend/utils/showroom-hours";
import { eq } from "drizzle-orm";

import type { ToolDef } from "../types";

export const setShowroomHours: ToolDef = {
  name: "set_showroom_hours",
  description:
    "Set a showroom's opening hours. Send a structured hoursJson object (7 keys mon..sun, each { open, close } in 24h 'HH:MM' or null when closed). The worker writes the normalized showroom_store_hours rows + derives is_open_weekends — there is no hours blob to manage. Replaces all existing hours for the store.",
  inputSchema: {
    type: "object",
    properties: {
      storeId: { type: "number" },
      hoursJson: {
        type: "object",
        description: "7 day keys mon..sun; each { open: 'HH:MM', close: 'HH:MM' } or null (closed).",
        properties: {
          mon: { type: ["object", "null"] },
          tue: { type: ["object", "null"] },
          wed: { type: ["object", "null"] },
          thu: { type: ["object", "null"] },
          fri: { type: ["object", "null"] },
          sat: { type: ["object", "null"] },
          sun: { type: ["object", "null"] },
        },
      },
    },
    required: ["storeId", "hoursJson"],
  },
  handler: async ({ db, args }) => {
    const storeId = Number(args.storeId);
    const hoursJson = args.hoursJson as any;
    await db.delete(showroomStoreHours).where(eq(showroomStoreHours.showroomId, storeId));
    const rows = hoursJsonToRows(storeId, hoursJson);
    if (rows.length > 0) {
      await db.insert(showroomStoreHours).values(rows as [(typeof rows)[number], ...(typeof rows)[number][]]);
    }
    await db
      .update(showroomStores)
      .set({ isOpenWeekends: deriveIsOpenWeekends(hoursJson), updatedAt: new Date() })
      .where(eq(showroomStores.id, storeId));
    const written = await db
      .select({
        day: showroomStoreHours.day,
        openHour: showroomStoreHours.openHour,
        openMinute: showroomStoreHours.openMinute,
        closeHour: showroomStoreHours.closeHour,
        closeMinute: showroomStoreHours.closeMinute,
      })
      .from(showroomStoreHours)
      .where(eq(showroomStoreHours.showroomId, storeId));
    return JSON.stringify({ storeId, hoursJson: rowsToHoursJson(written), dayCount: written.length });
  },
};
