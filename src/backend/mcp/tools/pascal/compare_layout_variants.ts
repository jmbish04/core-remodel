import { z } from "zod";

import { getLatestSnapshot, loadScene } from "../../../services/pascal/store";
import { listVariants } from "../../../services/pascal/product";
import { toolError } from "../../format";
import { defineTool, READ_ONLY } from "../../types";
import { sceneLink } from "./_shared";

export const compareLayoutVariants = defineTool({
  name: "compare_layout_variants",
  category: "render",
  title: "Compare layout variants",
  description:
    "Compare variants side-by-side — pass a `studyId` (all its variants) or explicit `variantIds`. Returns each variant's version, node count, latest snapshot, and measurement provenance so you can weigh the options in one call.",
  inputShape: {
    studyId: z.string().optional(),
    variantIds: z.array(z.string()).max(20).optional(),
  },
  annotations: READ_ONLY,
  examples: [{ title: "Compare a study's variants", args: { studyId: "study-abc12345" } }],
  handler: async ({ env }, input) => {
    let rows;
    if (input.variantIds?.length) {
      rows = (await Promise.all(input.variantIds.map((id) => loadScene(env, id)))).filter(
        (r): r is NonNullable<typeof r> => r != null,
      );
    } else if (input.studyId) {
      rows = await listVariants(env, { studyId: input.studyId });
    } else {
      return toolError("Pass a studyId or variantIds.");
    }
    if (rows.length === 0) return { variants: [], note: "No variants to compare." };

    const variants = await Promise.all(
      rows.map(async (r) => {
        const snap = await getLatestSnapshot(env, r.id);
        let confidence: number | null = null;
        try {
          confidence = r.renderingJson ? JSON.parse(r.renderingJson).confidence ?? null : null;
        } catch {
          confidence = null;
        }
        return {
          id: r.id,
          name: r.name,
          version: r.version,
          nodeCount: r.nodeCount,
          status: r.status,
          parentSceneId: r.parentSceneId,
          confidence,
          thumbnailUrl: snap?.imageUrl ?? r.thumbnailUrl ?? null,
          editorUrl: sceneLink(env, r.id),
        };
      }),
    );
    return { count: variants.length, variants };
  },
});
