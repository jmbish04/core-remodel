/**
 * @fileoverview MCP tool — list_price_observations.
 */
import { productPriceObservations } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { defineTool, READ_ONLY } from "../../types";

export const listPriceObservations = defineTool({
  name: "list_price_observations",
  category: "products",
  title: "List price observations",
  description:
    "List all price observations for a product (the different prices found across showrooms, online retailers, and the manufacturer).",
  annotations: READ_ONLY,
  inputShape: { productId: z.number().int().positive() },
  examples: [{ title: "By product", args: { productId: 12 } }],
  handler: async ({ db }, input) => {
    const rows = await db
      .select()
      .from(productPriceObservations)
      .where(eq(productPriceObservations.productId, input.productId))
      .all();
    return { observations: rows };
  },
});
