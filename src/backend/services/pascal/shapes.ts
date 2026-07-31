/**
 * @fileoverview Pascal wire contract shapes (0043).
 *
 * Zod schemas + serializers that make this worker's JSON satisfy the editor's
 * TypeScript interfaces BYTE-FOR-BYTE (jmbish04/editor#1, branch
 * `feat/core-remodel-pascal-integration`):
 *   - packages/mcp/src/storage/types.ts  → SceneMeta / SceneWithGraph / ProjectStatus / SceneEvent
 *   - apps/editor/lib/rendering-metadata-schema.ts → SceneRenderingMetadata
 *
 * The Pascal `SceneGraph` (@pascal-app/core) is stored/passed through with full
 * fidelity; we validate it only structurally here.
 */
import { z } from "@hono/zod-openapi";

import type {
  pascalProjects,
  pascalSceneEvents,
  pascalVariants,
} from "@backend/db";

// ─── SceneRenderingMetadata (mirror rendering-metadata-schema.ts exactly) ─────
const nullableText = z.string().min(1).max(500).nullable();

export const sceneRenderingMetadataSchema = z.object({
  coreRemodelProjectId: z.string().min(1).max(200),
  variant: z
    .object({
      id: z.string().min(1).max(200),
      label: z.string().min(1).max(200),
      parentSceneId: z.string().min(1).max(200).nullable(),
    })
    .nullable(),
  measurements: z
    .array(
      z.object({
        measurementId: z.string().min(1).max(200),
        kind: z.string().min(1).max(100),
        value: z.number().finite(),
        unit: z.string().min(1).max(50),
        confidence: z.number().min(0).max(1),
        sourceRevision: nullableText,
      }),
    )
    .max(10_000),
  confidence: z.number().min(0).max(1).nullable(),
  provenance: z.object({
    source: z.enum(["core-remodel", "pascal", "import"]),
    generatedAt: z.string(),
    sourceRevision: nullableText,
    requestId: nullableText,
  }),
});
export type SceneRenderingMetadata = z.infer<typeof sceneRenderingMetadataSchema>;

// ─── SceneGraph — full Pascal node graph, permissive object ───────────────────
export const sceneGraphSchema = z
  .object({
    nodes: z.record(z.string(), z.unknown()).optional(),
    rootNodeIds: z.array(z.string()).optional(),
  })
  .passthrough();
export type SceneGraph = z.infer<typeof sceneGraphSchema>;

// ─── SceneMeta ────────────────────────────────────────────────────────────────
export const sceneMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ownerId: z.string().nullable(),
  sizeBytes: z.number(),
  nodeCount: z.number(),
  editorUrl: z.string().optional(),
  url: z.string().optional(),
  published: z.boolean().optional(),
  isDraft: z.boolean().optional(),
  saveMode: z.enum(["draft", "checkpoint"]).optional(),
  graphHash: z.string().optional(),
  rendering: sceneRenderingMetadataSchema.nullable().optional(),
});
export type SceneMeta = z.infer<typeof sceneMetaSchema>;

export const sceneWithGraphSchema = sceneMetaSchema.extend({
  graph: sceneGraphSchema,
});

export const projectStatusSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  editorUrl: z.string(),
  url: z.string(),
  ownerId: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  publishedVersion: z.number().nullable(),
  latestVersion: z.number().nullable(),
  draftVersion: z.number().nullable(),
  browserVisibleVersion: z.number().nullable(),
  version: z.number(),
  isEmpty: z.boolean(),
  sizeBytes: z.number(),
  nodeCount: z.number(),
  graphHash: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const sceneEventSchema = z.object({
  eventId: z.number(),
  sceneId: z.string(),
  version: z.number(),
  kind: z.string(),
  createdAt: z.string(),
  graph: sceneGraphSchema,
});

// ─── Request bodies ───────────────────────────────────────────────────────────
export const saveSceneBodySchema = z.object({
  name: z.string().min(1).max(200),
  projectId: z.string().min(1).max(64).optional(),
  ownerId: z.string().max(200).nullable().optional(),
  graph: sceneGraphSchema,
  thumbnailUrl: z.string().url().nullable().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  saveMode: z.enum(["draft", "checkpoint"]).optional(),
  publish: z.boolean().optional(),
  rendering: sceneRenderingMetadataSchema.nullable().optional(),
});

export const renameSceneBodySchema = z.object({
  name: z.string().min(1).max(200),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export const createProjectBodySchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  ownerId: z.string().max(200).nullable().optional(),
  coreRemodelProjectId: z.string().min(1).max(200),
  scopeType: z.enum(["floor", "room", "whole_home"]).default("whole_home"),
  floorId: z.number().int().positive().nullable().optional(),
  roomId: z.number().int().positive().nullable().optional(),
});

export const appendEventBodySchema = z.object({
  version: z.number().int().nonnegative(),
  kind: z.string().min(1).max(100),
  graph: sceneGraphSchema,
});

// ─── Serializers (row → wire) ─────────────────────────────────────────────────
type VariantRow = typeof pascalVariants.$inferSelect;
type ProjectRow = typeof pascalProjects.$inferSelect;
type EventRow = typeof pascalSceneEvents.$inferSelect;

const iso = (d: Date | number): string =>
  (d instanceof Date ? d : new Date(d * 1000)).toISOString();

function parseGraph(raw: string): SceneGraph {
  try {
    return sceneGraphSchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Public parser for a stored graph_json blob (permissive; {} on garbage). */
export function parseGraphJson(raw: string): SceneGraph {
  return parseGraph(raw);
}

function parseRendering(raw: string | null): SceneRenderingMetadata | null {
  if (!raw) return null;
  try {
    const parsed = sceneRenderingMetadataSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Malformed JSON — treat like invalid schema data (don't crash the response).
    return null;
  }
}

export function serializeSceneMeta(
  row: VariantRow,
  editorBaseUrl: string,
): SceneMeta {
  const editorUrl = `${editorBaseUrl}/scene/${row.id}`;
  return {
    id: row.id,
    name: row.name,
    projectId: row.projectId,
    thumbnailUrl: row.thumbnailUrl ?? null,
    version: row.version,
    createdAt: iso(row.datetimeCreated),
    updatedAt: iso(row.datetimeLastModified),
    ownerId: row.ownerId ?? null,
    sizeBytes: row.sizeBytes,
    nodeCount: row.nodeCount,
    editorUrl,
    url: editorUrl,
    published: row.published,
    isDraft: row.isDraft,
    saveMode: row.saveMode,
    graphHash: row.graphHash ?? undefined,
    rendering: parseRendering(row.renderingJson),
  };
}

export function serializeSceneWithGraph(
  row: VariantRow,
  editorBaseUrl: string,
): SceneMeta & { graph: SceneGraph } {
  return { ...serializeSceneMeta(row, editorBaseUrl), graph: parseGraph(row.graphJson) };
}

export function serializeSceneEvent(row: EventRow): z.infer<typeof sceneEventSchema> {
  return {
    eventId: row.eventId,
    sceneId: row.sceneId,
    version: row.version,
    kind: row.kind,
    createdAt: iso(row.datetimeCreated),
    graph: parseGraph(row.graphJson),
  };
}

/**
 * Roll a project's variants up into the editor's ProjectStatus. The version fields
 * describe the project's most-recently-updated scene (the browser-visible head);
 * empty projects report nulls.
 * ponytail: single-head rollup — good enough until multi-scene projects need per-scene status.
 */
export function serializeProjectStatus(
  project: ProjectRow,
  head: VariantRow | null,
  editorBaseUrl: string,
): z.infer<typeof projectStatusSchema> {
  const editorUrl = `${editorBaseUrl}/editor/${project.id}`;
  return {
    id: project.id,
    projectId: project.coreRemodelProjectId,
    name: project.name,
    editorUrl,
    url: editorUrl,
    ownerId: project.ownerId ?? null,
    thumbnailUrl: head?.thumbnailUrl ?? null,
    publishedVersion: head?.publishedVersion ?? null,
    latestVersion: head?.latestVersion ?? null,
    draftVersion: head?.draftVersion ?? null,
    browserVisibleVersion: head?.browserVisibleVersion ?? null,
    version: head?.version ?? 0,
    isEmpty: head == null,
    sizeBytes: head?.sizeBytes ?? 0,
    nodeCount: head?.nodeCount ?? 0,
    graphHash: head?.graphHash ?? null,
    createdAt: iso(project.datetimeCreated),
    updatedAt: iso(project.datetimeLastModified),
  };
}
