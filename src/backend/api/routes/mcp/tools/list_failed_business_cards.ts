import { showroomStoreContactBusinessCards } from "@backend/db/schema/showroom/index";
import { eq } from "drizzle-orm";

import type { ToolDef } from "../types";

export const listFailedBusinessCards: ToolDef = {
  name: "list_failed_business_cards",
  description:
    "List business-card uploads whose vision extraction failed (status=failed) so an external model can re-read the image and resolve them. Returns id, cf_image_url, and draft_notes per card.",
  inputSchema: { type: "object", properties: {} },
  handler: async ({ db }) => {
    const rows = await db
      .select({
        id: showroomStoreContactBusinessCards.id,
        cfImageUrl: showroomStoreContactBusinessCards.cfImageUrl,
        draftNotes: showroomStoreContactBusinessCards.draftNotes,
        storeId: showroomStoreContactBusinessCards.storeId,
      })
      .from(showroomStoreContactBusinessCards)
      .where(eq(showroomStoreContactBusinessCards.status, "failed"));
    return JSON.stringify(rows);
  },
};
