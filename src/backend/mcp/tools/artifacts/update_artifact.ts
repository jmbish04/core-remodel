import { artifactRevisions, artifacts } from "@backend/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { validateArtifactSource } from "../../artifacts/validate";
import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { studioUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";

export const updateArtifact = defineTool({
  name: "update_artifact",
  category: "artifacts",
  title: "Update an artifact",
  description:
    "Store a NEW revision of an existing artifact (by `id` or `slug`) with revised `sourceTsx` and a `changeNote`. " +
    "Re-validates against the shadcn allow-list + style rules; on PASS it appends the revision, bumps the current " +
    "pointer, and returns { ok:true, revisionNumber, url }. On FAIL returns { ok:false, errors }. Old revisions " +
    "are retained (see get_artifact `revision`).",
  inputShape: {
    id: z.number().int().positive().optional().describe("Artifact id"),
    slug: z.string().optional().describe("Artifact slug (alternative to id)"),
    sourceTsx: z.string().min(1).describe("Revised TSX module (required)"),
    changeNote: z.string().optional().describe("What changed in this revision"),
  },
  annotations: WRITE,
  outputShape: {
    ok: z.boolean(),
    id: z.number().int().optional().describe("The artifact id (present when ok=true)"),
    slug: z.string().optional().describe("The artifact slug (present when ok=true)"),
    revisionNumber: z.number().int().optional().describe("The newly stored revision number (present when ok=true)"),
    url: urlField.optional(),
    errors: z.array(z.string()).optional().describe("Validation failures (present when ok=false)"),
  },
  examples: [
    {
      title: "Revise",
      args: {
        slug: "closet-budget-summary",
        sourceTsx: "…revised source…",
        changeNote: "Added a second closet row.",
      },
    },
  ],
  handler: async ({ env, db }, input) => {
    if (input.id == null && !input.slug) toolError("Pass either `id` or `slug`.");
    if (!input.sourceTsx?.trim()) toolError("`sourceTsx` is required and cannot be empty.");

    const [artifact] = await db
      .select()
      .from(artifacts)
      .where(input.id != null ? eq(artifacts.id, input.id) : eq(artifacts.slug, input.slug!))
      .limit(1);
    if (!artifact) {
      toolError("Artifact not found. Call list_artifacts for valid ids/slugs.");
    }

    const validation = validateArtifactSource(input.sourceTsx);
    if (!validation.ok) {
      return { ok: false, errors: validation.errors };
    }

    const [{ maxRev = 0 } = {}] = await db
      .select({ maxRev: sql<number>`max(${artifactRevisions.revisionNumber})` })
      .from(artifactRevisions)
      .where(eq(artifactRevisions.artifactId, artifact.id))
      .all();
    const revisionNumber = Number(maxRev) + 1;

    const [rev] = await db
      .insert(artifactRevisions)
      .values({
        artifactId: artifact.id,
        revisionNumber,
        sourceTsx: input.sourceTsx,
        importsJson: JSON.stringify(validation.imports),
        changeNote: input.changeNote ?? `Revision ${revisionNumber}`,
      })
      .returning({ id: artifactRevisions.id });

    await db
      .update(artifacts)
      .set({ currentRevisionId: rev.id, updatedAt: new Date() })
      .where(eq(artifacts.id, artifact.id))
      .run();

    return { ok: true, id: artifact.id, slug: artifact.slug, revisionNumber, url: studioUrl(env, artifact.slug) };
  },
});
