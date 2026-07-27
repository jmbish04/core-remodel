/**
 * @fileoverview MCP tool — create_visit_log (Visit Logs domain, 0032 V2b).
 */
import { createVisitLog } from "@backend/services/showroom/visit-log";
import { z } from "zod";

import { urlField } from "../../schemas";
import { defineTool, WRITE } from "../../types";
import { toWrite, visitLogUrl, writeShape } from "./_shared";

export const createVisitLogTool = defineTool({
  name: "create_visit_log",
  category: "visits",
  title: "Create a showroom visit log",
  description:
    "Record a showroom visit — cold ('just log a visit to X') or in drive context (pass `driveListId`/" +
    "`stopId`). Defaults to `status=DRAFT` and `visit_type=SOFT_ARRIVAL` so it lands in the pending queue " +
    "for finishing; set `status=SUBMITTED` to log a complete visit in one call. `visit_type` grades the " +
    "engagement (BROWSED_NO_CONTACT / BRIEF_NO_HELP / FULL_SESSION / APPOINTMENT). Notes are PlateJS " +
    "(markdown + html). Returns { ok, id, url }.",
  inputShape: writeShape,
  annotations: WRITE,
  outputShape: { ok: z.boolean(), id: z.number().int().optional(), url: urlField.optional() },
  examples: [
    {
      title: "A full session, submitted",
      args: {
        storeId: 71,
        status: "SUBMITTED",
        visitType: "FULL_SESSION",
        rating: 5,
        notesMarkdown: "Pulled Calacatta Viola slabs with Rosie; great color help.",
      },
    },
  ],
  handler: async ({ env, db }, input) => {
    const id = await createVisitLog(db, toWrite(input));
    return { ok: true, id, url: visitLogUrl(env, id) };
  },
});
