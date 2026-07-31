import { fieldOutContacts } from "@backend/api/routes/showroom-contacts";
import { showroomStoreContactBusinessCards } from "@backend/db/schema/showroom/index";
import { eq } from "drizzle-orm";

import type { ToolDef } from "../types";

export const resolveBusinessCard: ToolDef = {
  name: "resolve_business_card",
  description:
    "Close the loop on a failed business card: given a cardId and a contact payload (same shape as create_showroom_contact), field it out into a contact and link it back to the card.",
  inputSchema: {
    type: "object",
    properties: {
      cardId: { type: "number" },
      storeId: { type: "number" },
      match: { type: "object" },
      people: { type: "array", items: { type: "object" } },
      general: { type: "object" },
      urls: { type: "array", items: { type: "object" } },
      address: { type: "string" },
    },
    required: ["cardId"],
  },
  handler: async ({ db, env, args }) => {
    const cardId = Number(args.cardId);
    const res = await fieldOutContacts(db, args as any, env);
    await db
      .update(showroomStoreContactBusinessCards)
      .set({
        status: "done",
        storeId: res.storeId,
        contactId: res.contactIds[0] ?? null,
        isDraft: res.isDraft,
        updatedAt: new Date(),
      })
      .where(eq(showroomStoreContactBusinessCards.id, cardId));
    return JSON.stringify({ cardId, ...res });
  },
};
