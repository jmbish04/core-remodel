import { showroomPocs, showroomStores } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

export const addShowroomPoc = defineTool({
  name: "add_showroom_poc",
  category: "showrooms",
  title: "Add a showroom contact",
  description:
    "Add a point of contact (sales rep, design consultant, manager) to a showroom — typically captured from a business card during a visit. `showroomId` and `fullName` are required; all other contact fields are optional. Validates the showroom exists first.",
  inputShape: {
    showroomId: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
    fullName: z.string().describe("Contact's full name (required)"),
    title: z.string().optional().describe("Job title as printed on the card"),
    company: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    website: z.string().optional(),
    address: z.string().optional(),
  },
  annotations: WRITE,
  examples: [
    {
      title: "Business-card contact",
      args: {
        showroomId: 4,
        fullName: "Jane Smith",
        title: "Senior Design Consultant",
        phone: "(415) 555-0187",
        email: "jane@studiobelmont.com",
      },
    },
  ],
  outputShape: {
    created: z.boolean(),
    poc: looseObject({ id: z.number().int(), fullName: z.string().nullable() }),
    url: urlField,
  },
  handler: async ({ env, db }, input) => {
    const fullName = input.fullName?.trim();
    if (!fullName) toolError("`fullName` is required and cannot be empty.");
    const [store] = await db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(eq(showroomStores.id, input.showroomId))
      .limit(1);
    if (!store) {
      toolError(`Showroom ${input.showroomId} not found. Call list_showrooms for valid ids.`);
    }
    const [created] = await db
      .insert(showroomPocs)
      .values({
        showroomId: input.showroomId,
        fullName,
        title: input.title,
        company: input.company,
        phone: input.phone,
        email: input.email,
        website: input.website,
        address: input.address,
      })
      .returning();
    return { created: true, poc: created, url: showroomUrl(env, input.showroomId) };
  },
});
