import { artifactRevisions, artifacts } from "@backend/db";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { studioUrl } from "../../urls";
import { defineTool, READ_ONLY } from "../../types";

export const getArtifact = defineTool({
  name: "get_artifact",
  category: "artifacts",
  title: "Get an artifact",
  description:
    "Full metadata + the current `sourceTsx` for one artifact (by `id` OR `slug`) so you can revise it. Pass an " +
    "optional `revision` number to fetch a specific historical version instead of the current one.",
  inputShape: {
    id: z.number().int().positive().optional().describe("Artifact id"),
    slug: z.string().optional().describe("Artifact slug (alternative to id)"),
    revision: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Specific revisionNumber to fetch (defaults to current)"),
  },
  annotations: READ_ONLY,
  outputShape: {
    id: z.number().int(),
    slug: z.string(),
    title: z.string(),
    kind: z.string(),
    status: z.string(),
    url: urlField,
    revisionNumber: z.number().int(),
    sourceTsx: z.string(),
    imports: z.array(z.string()),
    revisions: z.array(
      looseObject({
        n: z.number().int(),
        changeNote: z.string().nullable(),
      }),
    ),
  },
  examples: [
    { title: "By slug", args: { slug: "closet-budget-summary" } },
    { title: "Old revision", args: { id: 3, revision: 1 } },
  ],
  handler: async ({ env, db }, input) => {
    if (input.id == null && !input.slug) {
      toolError("Pass either `id` or `slug`.");
    }
    const [artifact] = await db
      .select()
      .from(artifacts)
      .where(input.id != null ? eq(artifacts.id, input.id) : eq(artifacts.slug, input.slug!))
      .limit(1);
    if (!artifact) {
      toolError("Artifact not found. Call list_artifacts for valid ids/slugs.");
    }

    const [revision] = await db
      .select()
      .from(artifactRevisions)
      .where(
        input.revision != null
          ? sql`${artifactRevisions.artifactId} = ${artifact.id} AND ${artifactRevisions.revisionNumber} = ${input.revision}`
          : eq(artifactRevisions.id, artifact.currentRevisionId ?? -1),
      )
      .limit(1);
    if (!revision) {
      toolError(
        input.revision != null
          ? `Revision ${input.revision} not found for this artifact.`
          : "Artifact has no current revision.",
      );
    }

    const allRevs = await db
      .select({ n: artifactRevisions.revisionNumber, changeNote: artifactRevisions.changeNote, createdAt: artifactRevisions.createdAt })
      .from(artifactRevisions)
      .where(eq(artifactRevisions.artifactId, artifact.id))
      .orderBy(desc(artifactRevisions.revisionNumber))
      .all();

    return {
      id: artifact.id,
      slug: artifact.slug,
      title: artifact.title,
      description: artifact.description,
      kind: artifact.kind,
      status: artifact.status,
      url: studioUrl(env, artifact.slug),
      revisionNumber: revision.revisionNumber,
      sourceTsx: revision.sourceTsx,
      entryExport: revision.entryExport,
      imports: revision.importsJson ? (JSON.parse(revision.importsJson) as string[]) : [],
      revisions: allRevs,
    };
  },
});
