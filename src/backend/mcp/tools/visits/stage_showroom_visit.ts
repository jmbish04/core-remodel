/**
 * @fileoverview MCP tool — stage_showroom_visit (Visit Logs domain, 0032 V2b).
 *
 * Convenience: stage an AI_STAGED draft from a voice/chat note ("I just stopped at
 * X"). Thin wrapper over create_visit_log that forces status=AI_STAGED so it lands
 * in the pending queue for the human to finish.
 */
import { createVisitLog } from "@backend/services/showroom/visit-log";
import { z } from "zod";

import { urlField } from "../../schemas";
import { defineTool, WRITE } from "../../types";
import { toWrite, visitLogUrl, writeShape } from "./_shared";

export const stageShowroomVisitTool = defineTool({
  name: "stage_showroom_visit",
  category: "visits",
  title: "Stage an AI showroom visit draft",
  description:
    "Stage a visit as AI_STAGED from a conversational note — e.g. 'I just stopped at the stone yard on " +
    "Fourth St.' It appears in the pending Visit Logs queue for the human to finish (rating, engagement, " +
    "notes). Same fields as create_visit_log but status is forced to AI_STAGED. Returns { ok, id, url }.",
  inputShape: writeShape,
  annotations: WRITE,
  outputShape: { ok: z.boolean(), id: z.number().int().optional(), url: urlField.optional() },
  examples: [{ title: "Stage from a voice note", args: { storeId: 71, notesMarkdown: "Quick peek, closed — come back." } }],
  handler: async ({ env, db }, input) => {
    const id = await createVisitLog(db, { ...toWrite(input), status: "AI_STAGED", gpsSource: "ai" });
    return { ok: true, id, url: visitLogUrl(env, id) };
  },
});
