/**
 * @fileoverview Pascal product layer (0043 Phase 2) — studies + variant creation.
 *
 * Studies are a Core-Remodel-only grouping ("Upstairs island placement"); variants
 * are scenes created through the product/MCP surface (vs the raw editor wire). Both
 * sit on top of the scene store in store.ts.
 */
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { pascalStudies, pascalVariants } from "@backend/db";

import { sanitizeNoteHtml } from "@backend/services/notes/markdown";

import type { SceneGraph, SceneRenderingMetadata } from "./shapes";
import { PascalStoreError, saveScene, slugify } from "./store";

type StudyRow = typeof pascalStudies.$inferSelect;
type VariantRow = typeof pascalVariants.$inferSelect;

export async function createStudy(
  env: Env,
  input: {
    projectId: string;
    title: string;
    descriptionMarkdown?: string | null;
    descriptionHtml?: string | null;
  },
): Promise<StudyRow> {
  const db = drizzle(env.DB);
  const id = slugify(input.title, "study");
  await db
    .insert(pascalStudies)
    .values({
      id,
      projectId: input.projectId,
      title: input.title,
      descriptionMarkdown: input.descriptionMarkdown ?? null,
      // Sanitize any caller-supplied HTML before it is stored + later rendered.
      descriptionHtml: input.descriptionHtml
        ? sanitizeNoteHtml(input.descriptionHtml)
        : null,
    })
    .run();
  const row = await db.select().from(pascalStudies).where(eq(pascalStudies.id, id)).get();
  if (!row) throw new PascalStoreError("invalid", "Study insert failed");
  return row;
}

export async function listStudies(env: Env, projectId: string): Promise<StudyRow[]> {
  const db = drizzle(env.DB);
  return db
    .select()
    .from(pascalStudies)
    .where(eq(pascalStudies.projectId, projectId))
    .orderBy(desc(pascalStudies.datetimeCreated))
    .all();
}

export async function getStudy(env: Env, id: string): Promise<StudyRow | null> {
  const db = drizzle(env.DB);
  return (
    (await db.select().from(pascalStudies).where(eq(pascalStudies.id, id)).get()) ?? null
  );
}

export async function listVariants(
  env: Env,
  opts: { projectId?: string; studyId?: string },
): Promise<VariantRow[]> {
  const db = drizzle(env.DB);
  const where = opts.studyId
    ? eq(pascalVariants.studyId, opts.studyId)
    : opts.projectId
      ? eq(pascalVariants.projectId, opts.projectId)
      : undefined;
  return db
    .select()
    .from(pascalVariants)
    .where(where)
    .orderBy(desc(pascalVariants.datetimeLastModified))
    .all();
}

/**
 * Create a variant (a scene) through the product surface — sets the study grouping
 * and stamps the rendering provenance with the new variant's identity/lineage.
 */
export async function createVariant(
  env: Env,
  input: {
    studyId: string;
    projectId: string;
    name: string;
    graph: SceneGraph;
    rendering: SceneRenderingMetadata;
    parentSceneId?: string | null;
  },
): Promise<VariantRow> {
  const sceneId = slugify(input.name, "scene");
  const rendering: SceneRenderingMetadata = {
    ...input.rendering,
    variant: {
      id: sceneId,
      label: input.name,
      parentSceneId: input.parentSceneId ?? null,
    },
  };
  // Lineage is set atomically in the insert (saveScene takes parentSceneId), so a
  // failed follow-up write can't leave a variant with lost branch lineage.
  return saveScene(env, sceneId, {
    name: input.name,
    projectId: input.projectId,
    studyId: input.studyId,
    parentSceneId: input.parentSceneId ?? null,
    graph: input.graph,
    rendering,
    saveMode: "checkpoint",
    publish: true,
  });
}
