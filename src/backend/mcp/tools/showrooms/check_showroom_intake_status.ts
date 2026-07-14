import { showroomStores } from "@backend/db";
import { showroomBrandMappings } from "@backend/db/schema/brands/index";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, READ_ONLY } from "../../types";

/** Map the internal scrape lifecycle to a coarse, agent-facing intake status. */
const STATUS_MAP: Record<string, string> = {
  idle: "not_started",
  pending: "processing",
  running: "processing",
  complete: "complete",
  failed: "error",
};

export const checkShowroomIntakeStatus = defineTool({
  name: "check_showroom_intake_status",
  category: "showrooms",
  title: "Check showroom intake status",
  description:
    "Poll the BACKGROUND onboarding status of a showroom created via create_showroom or import_showroom_from_place " +
    "(both return immediately and enrich asynchronously). Pass `showroomId` OR `placeId`. Returns `status` " +
    "(processing | complete | error | not_started) derived from the durable onboarding/scrape lifecycle, plus " +
    "progress signals (hero image, favicon, brand count, homeowner access level, AI review summary). Use THIS " +
    "instead of retrying create_showroom/import_showroom_from_place after a timeout — the intake is durable and " +
    "keeps running in the background.",
  inputShape: {
    showroomId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Showroom store id returned by create_showroom / import_showroom_from_place"),
    placeId: z.string().optional().describe("Google Place ID the showroom was imported from"),
  },
  annotations: READ_ONLY,
  outputShape: {
    showroomId: z.number().int(),
    status: z.string(),
    scrapeStatus: z.string(),
    signals: looseObject({ hasHeroImage: z.boolean(), brandCount: z.number().int() }),
    url: urlField,
  },
  examples: [
    { title: "By showroom id", args: { showroomId: 121 } },
    { title: "By place id", args: { placeId: "ChIJ4QjfO6DLj4ARyJKI9JE6pFk" } },
  ],
  handler: async ({ env, db }, input) => {
    const showroomId = input.showroomId;
    const placeId = input.placeId?.trim();
    if (!showroomId && !placeId) {
      toolError("Pass either `showroomId` or `placeId`.");
    }

    const [store] = await db
      .select()
      .from(showroomStores)
      .where(
        showroomId
          ? eq(showroomStores.id, showroomId)
          : eq(showroomStores.placeId, placeId as string),
      )
      .limit(1);
    if (!store) {
      toolError(
        `No showroom found for ${showroomId ? `id ${showroomId}` : `placeId "${placeId}"`}. ` +
          "It may not have been created yet.",
      );
    }

    const brandRows = await db
      .select({ id: showroomBrandMappings.id })
      .from(showroomBrandMappings)
      .where(eq(showroomBrandMappings.showroomId, store.id))
      .all();

    return {
      showroomId: store.id,
      status: STATUS_MAP[store.scrapeStatus] ?? "processing",
      scrapeStatus: store.scrapeStatus,
      signals: {
        hasHeroImage: !!store.heroImageCfImagesUrl,
        hasIcon: !!store.iconCfImagesUrl,
        brandCount: brandRows.length,
        accessLevel: store.accessLevel ?? null,
        hasReviewSummary: !!store.reviewSummary,
      },
      url: showroomUrl(env, store.id),
    };
  },
});
