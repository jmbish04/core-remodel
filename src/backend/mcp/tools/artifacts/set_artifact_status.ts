import { artifacts } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";

export const setArtifactStatus = defineTool({
  name: "set_artifact_status",
  category: "artifacts",
  title: "Set artifact status",
  description:
    "Publish, archive, or draft an artifact (by `id` or `slug`). `archived` soft-hides it from the gallery; " +
    "`published` shows it; `draft` marks it a work-in-progress. Returns the new status.",
  inputShape: {
    id: z.number().int().positive().optional().describe("Artifact id"),
    slug: z.string().optional().describe("Artifact slug (alternative to id)"),
    status: z.enum(["draft", "published", "archived"]).describe("New status"),
  },
  annotations: WRITE,
  outputShape: {
    updated: z.boolean(),
    id: z.number().int(),
    slug: z.string(),
    status: z.string(),
  },
  examples: [{ title: "Archive", args: { slug: "closet-budget-summary", status: "archived" } }],
  handler: async ({ db }, input) => {
    if (input.id == null && !input.slug) toolError("Pass either `id` or `slug`.");
    const [artifact] = await db
      .select({ id: artifacts.id, slug: artifacts.slug })
      .from(artifacts)
      .where(input.id != null ? eq(artifacts.id, input.id) : eq(artifacts.slug, input.slug!))
      .limit(1);
    if (!artifact) {
      toolError("Artifact not found. Call list_artifacts for valid ids/slugs.");
    }
    await db
      .update(artifacts)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(artifacts.id, artifact.id))
      .run();
    return { updated: true, id: artifact.id, slug: artifact.slug, status: input.status };
  },
});
