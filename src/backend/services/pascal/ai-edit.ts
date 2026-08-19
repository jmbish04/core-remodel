/**
 * @fileoverview AI intent → node-graph edits (0043 Phase 3).
 *
 * Given the current graph, a natural-language intent, and the measured bounds,
 * asks the model (structured output — never "reply with JSON") for a list of node
 * ops. The ops are validated + applied by `applyNodeOps`, so a bad id is rejected
 * downstream; if the model call fails we degrade to an empty edit + a note rather
 * than failing the whole variant creation.
 */
import { z } from "zod";

import type { SceneGraph } from "./shapes";

import { generateStructuredOutput } from "../../ai/providers";
import { SpendBlockedError } from "../usage/metered-ai";
import { nodeOpSchema } from "./edit";

const editPlanSchema = z.object({
  ops: z.array(nodeOpSchema).max(50),
  rationale: z.string(),
});
export type EditPlan = z.infer<typeof editPlanSchema>;

/** A compact, model-friendly view of the graph: id → {type, parentId, name}. */
function summarizeGraph(graph: SceneGraph): string {
  const nodes = (graph?.nodes as Record<string, Record<string, unknown>>) ?? {};
  const lines = Object.entries(nodes)
    .slice(0, 400)
    .map(
      ([id, n]) =>
        `${id}: type=${n.type ?? "?"} parent=${n.parentId ?? "none"} name=${n.name ?? ""}`,
    );
  return lines.join("\n");
}

export async function proposeEdits(
  env: Env,
  input: { graph: SceneGraph; intent: string; boundsNote: string },
): Promise<EditPlan> {
  try {
    const plan = await generateStructuredOutput(env, {
      schema: editPlanSchema,
      schemaName: "pascal_edit_plan",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You edit a Pascal floorplan scene graph. Return node ops (add/update/delete/move). " +
            "Only reference node ids that exist in the provided graph (except ids you add). " +
            "Respect the measured room bounds; do not invent dimensions beyond them. " +
            "Nodes are a flat dictionary; each has id, type, parentId, and type-specific props.",
        },
        {
          role: "user",
          content: `INTENT: ${input.intent}\n\nBOUNDS: ${input.boundsNote}\n\nCURRENT NODES:\n${summarizeGraph(input.graph)}`,
        },
      ],
    });
    return editPlanSchema.parse(plan);
  } catch (err) {
    // A budget stop is a POLICY state, not a model failure, and the two must not
    // collapse into the same answer. Degrading here returns a structurally valid
    // EditPlan with zero ops — the caller reads that as success and creates a
    // variant with no edits. For a genuine AI failure that is the intended
    // graceful path; for "you are over your spend ceiling" it is a wrong answer
    // dressed as a right one, and the user has no way to tell that the fix is to
    // raise a budget rather than to retry.
    //
    // So let it propagate. The error message names the provider, the spend and
    // the ceiling, which is exactly what the operator needs to see.
    if (err instanceof SpendBlockedError) throw err;
    return {
      ops: [],
      rationale: `AI edit unavailable (${err instanceof Error ? err.message : "error"}); variant created without intent edits.`,
    };
  }
}
