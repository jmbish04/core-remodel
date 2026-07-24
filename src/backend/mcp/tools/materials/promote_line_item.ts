import { z } from "zod";

import { promoteLineItem } from "@backend/services/materials/deduction";

import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";

export const promoteLineItemTool = defineTool({
  name: "promote_line_item",
  category: "materials",
  title: "Promote a receipt line item to a material",
  description:
    "Directly promote a receipt/invoice line item into a typed material in a KNOWN room (0030), bypassing room deduction — the manual path for when you already know where it goes. Mints the material, links the line item back (match_status=\"created\"), and tags its category/subcategory if given. For the ambiguous case, prefer list_room_proposals + resolve_room_proposal instead.",
  inputShape: {
    lineItemId: z.number().int().positive().describe("Invoice/receipt line item id"),
    roomId: z.number().int().positive().describe("Room to place the material into (from list_rooms)"),
    subcategoryId: z.number().int().positive().optional().describe("Optional material type to tag (from list_material_categories)"),
    categoryId: z.number().int().positive().optional().describe("Optional material category to tag (from list_material_categories)"),
  },
  annotations: WRITE,
  outputShape: {
    materialId: z.number().int(),
    title: z.string(),
  },
  examples: [{ title: "Promote to a room", args: { lineItemId: 42, roomId: 3, subcategoryId: 7 } }],
  handler: async ({ db }, input) => {
    try {
      return await promoteLineItem(db, input.lineItemId, {
        roomId: input.roomId,
        subcategoryId: input.subcategoryId ?? null,
        categoryId: input.categoryId ?? null,
      });
    } catch (err) {
      toolError((err as Error).message);
    }
  },
});
