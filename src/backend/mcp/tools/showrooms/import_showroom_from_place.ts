import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";

import { intakeOnePlace } from "./_shared";

export const importShowroomFromPlace = defineTool({
  name: "import_showroom_from_place",
  category: "showrooms",
  title: "Import a showroom from a Google Place",
  description:
    "One-step FULL onboarding of a showroom from a Google `placeId` (typically one returned by search_showrooms) — " +
    "the same flow the front-end intake form runs. Fetches Places Details WITH the Gemini review analysis to " +
    "populate name, description, address, coordinates, phone, website, structured hours, Google rating/review " +
    "count, an AI review summary, the inferred price tier, and the appointment/flagship/large-selection/bespoke/" +
    "trade-rep flags, and captures the Bay Area region hub — then KICKS the rest of enrichment in the background: " +
    "Google photos → Cloudflare Images (+ hero), detected-brand create/map, favicon + full website scrape, AI " +
    "renovation-fit research, and category inference. Returns IMMEDIATELY with `status:\"processing\"` and the " +
    "freshly-created row (do NOT wait on it, and do NOT retry on a timeout — the work is durable); poll " +
    "`check_showroom_intake_status` by showroomId or placeId to see enrichment finish. Idempotent by `placeId`: an " +
    "existing store is returned unchanged (`created:false`, `status:\"exists\"`); otherwise a new row is inserted " +
    "(`created:true`). Prefer this over create_showroom whenever you have a placeId. Quota-metered (Places + " +
    "Gemini) — surfaces MAPS_QUOTA_EXCEEDED clearly.",
  inputShape: {
    placeId: z
      .string()
      .min(1)
      .describe("Google Place ID from search_showrooms (e.g. 'ChIJ...')"),
  },
  annotations: WRITE_IDEMPOTENT,
  outputShape: {
    created: z.boolean(),
    status: z.string(),
    showroomId: z.number().int(),
    url: urlField,
    region: z.string().nullable(),
    store: looseObject({ id: z.number().int(), name: z.string().nullable() }),
  },
  examples: [{ title: "Import a candidate", args: { placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" } }],
  handler: async ({ env, db }, input) => {
    const r = await intakeOnePlace(env, db, input.placeId);
    return {
      created: r.created,
      status: r.status,
      showroomId: r.showroomId,
      url: showroomUrl(env, r.showroomId),
      region: r.store.hubName ?? null,
      store: r.store,
    };
  },
});
