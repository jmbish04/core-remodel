import { artifactRevisions, artifacts } from "@backend/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { looseObject, urlField } from "../../schemas";
import { studioUrl } from "../../urls";
import { defineTool, READ_ONLY } from "../../types";

export const listArtifacts = defineTool({
  name: "list_artifacts",
  category: "artifacts",
  title: "List artifacts",
  description:
    "List exported artifacts (id, slug, title, kind, status, revisionCount, updatedAt) so you can see prior work " +
    "before revising it. Optional `kind` and `status` filters. Newest-updated first.",
  inputShape: {
    kind: z.enum(["report", "app", "dashboard"]).optional(),
    status: z.enum(["draft", "published", "archived"]).optional(),
    limit: z.number().int().positive().max(200).optional(),
  },
  annotations: READ_ONLY,
  outputShape: {
    count: z.number().int(),
    artifacts: z.array(
      looseObject({
        id: z.number().int(),
        slug: z.string(),
        title: z.string(),
        kind: z.string(),
        status: z.string(),
        revisionCount: z.number().int(),
        url: urlField,
      }),
    ),
  },
  examples: [
    { title: "All", args: {} },
    { title: "Published dashboards", args: { kind: "dashboard", status: "published" } },
  ],
  handler: async ({ env, db }, input) => {
    // Filter + count + order + limit in SQL (single query, left-join keeps
    // 0-revision artifacts).
    const conditions = [];
    if (input.kind) conditions.push(eq(artifacts.kind, input.kind));
    if (input.status) conditions.push(eq(artifacts.status, input.status));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        id: artifacts.id,
        slug: artifacts.slug,
        title: artifacts.title,
        description: artifacts.description,
        kind: artifacts.kind,
        status: artifacts.status,
        updatedAt: artifacts.updatedAt,
        revisionCount: sql<number>`count(${artifactRevisions.id})`,
      })
      .from(artifacts)
      .leftJoin(artifactRevisions, eq(artifacts.id, artifactRevisions.artifactId))
      .where(whereClause)
      .groupBy(artifacts.id)
      .orderBy(desc(artifacts.updatedAt))
      .limit(input.limit ?? 100)
      .all();

    return {
      count: rows.length,
      artifacts: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        description: r.description,
        kind: r.kind,
        status: r.status,
        revisionCount: Number(r.revisionCount),
        updatedAt: r.updatedAt,
        url: studioUrl(env, r.slug),
      })),
    };
  },
});
