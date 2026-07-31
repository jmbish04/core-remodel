import { showroomBulkIntakeItems, showroomStores } from "@backend/db";
import { inArray } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";

/** D1 caps a statement at 100 bound params — chunk multi-row inserts. */
function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

export const bulkImportShowroomsFromPlaces = defineTool({
  name: "bulk_import_showrooms_from_places",
  category: "showrooms",
  title: "Bulk-import showrooms from Google place_ids (set-and-forget)",
  description:
    "SUBMIT an ARRAY of Google `placeId`s for showroom intake and return IMMEDIATELY — the worker then runs the " +
    "EXACT same full onboarding as import_showroom_from_place for each id, in a durable background loop (Places " +
    "Details → dedupe/adopt onto a matching bare stub → insert → photos/brands/website-scrape/AI research). This " +
    "is the tool to use whenever you have MORE THAN ONE placeId (e.g. after a wide showroom-research sweep): ONE " +
    "call queues the whole set, so you do NOT spend tokens calling import_showroom_from_place once per store. " +
    "Duplicates and blanks are dropped; ids already present as a located store are recorded as `done`/exists by " +
    "the loop (never re-imported). Returns a `batchId` — poll `check_bulk_intake_status` with it to watch progress " +
    "and catch any id that got stuck. Quota-metered per id (Places + Gemini).",
  inputShape: {
    placeIds: z
      .array(z.string().min(1))
      .min(1)
      .max(200)
      .describe("Google Place IDs to intake (e.g. ['ChIJ...','ChIJ...']). 1–200; dupes/blanks dropped."),
  },
  annotations: WRITE,
  outputShape: {
    batchId: z.string(),
    queued: z.number().int(),
    duplicatesDropped: z.number().int(),
    alreadyImported: z.number().int(),
    message: z.string(),
  },
  examples: [
    {
      title: "Queue a research sweep",
      args: { placeIds: ["ChIJN1t_tDeuEmsRUsoyG83frY4", "ChIJZ9WevTeahYAR-qg3Q4Uurus"] },
    },
  ],
  handler: async ({ env, db }, input) => {
    // Normalize: trim, drop blanks, dedupe (preserve order).
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const raw of input.placeIds) {
      const p = raw?.trim();
      if (p && !seen.has(p)) {
        seen.add(p);
        cleaned.push(p);
      }
    }
    const duplicatesDropped = input.placeIds.length - cleaned.length;
    if (cleaned.length === 0) {
      toolError("No usable placeIds after dropping blanks/duplicates.");
    }

    // Informational only — how many are already located stores. The loop still
    // processes them (recording exists), so we do NOT filter them out here; this
    // just tells the caller what to expect.
    const existingRows = await db
      .select({ placeId: showroomStores.placeId })
      .from(showroomStores)
      .where(inArray(showroomStores.placeId, cleaned))
      .all();
    const alreadyImported = existingRows.filter((r) => r.placeId).length;

    const batchId = crypto.randomUUID();

    // Seed queue rows (chunked under D1's 100-bound-param cap; 2 cols/row).
    for (const part of chunk(cleaned, 40)) {
      await db
        .insert(showroomBulkIntakeItems)
        .values(part.map((placeId) => ({ batchId, placeId })))
        .onConflictDoNothing();
    }

    // Kick the durable loop; return immediately. id = batchId so the instance is
    // addressable for stuck-detection in check_bulk_intake_status.
    await env.SHOWROOM_BULK_INTAKE_WORKFLOW.create({
      id: batchId,
      params: { batchId, placeIds: cleaned },
    });

    return {
      batchId,
      queued: cleaned.length,
      duplicatesDropped,
      alreadyImported,
      message:
        `Queued ${cleaned.length} place_id(s) for background intake` +
        (alreadyImported ? ` (${alreadyImported} already imported — will be recorded as exists)` : "") +
        `. Poll check_bulk_intake_status with batchId "${batchId}".`,
    };
  },
});
