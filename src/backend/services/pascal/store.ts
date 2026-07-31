/**
 * @fileoverview Pascal scene store (0043) — the durable backing for the Vercel editor.
 *
 * Implements the operations behind `/api/pascal/v1/*`, mirroring the editor's
 * `SceneStore` (jmbish04/editor#1). Version model: `draft` saves update the
 * browser-visible working model in place (same version); `checkpoint` saves bump
 * the version and record a scene event. Errors carry a `code` the route maps to the
 * exact HTTP status the editor's `scene-api-errors.ts` expects.
 */
import { and, desc, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  pascalProjects,
  pascalSceneEvents,
  pascalVariants,
} from "@backend/db";

import type {
  SceneGraph,
  SceneRenderingMetadata,
} from "./shapes";

/** Max serialized graph size before we reject with `too_large` (413). */
const MAX_SCENE_BYTES = 512 * 1024;

export type PascalErrorCode =
  | "not_found"
  | "version_conflict"
  | "too_large"
  | "invalid";

export class PascalStoreError extends Error {
  constructor(
    readonly code: PascalErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PascalStoreError";
  }
}

type Db = ReturnType<typeof drizzle>;
type VariantRow = typeof pascalVariants.$inferSelect;
type ProjectRow = typeof pascalProjects.$inferSelect;

const enc = new TextEncoder();

/** Slug: lowercase alphanumeric + hyphen, <= 64, with a short uniqueness suffix. */
export function slugify(name: string, prefix?: string): string {
  const base = (prefix ? `${prefix}-${name}` : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52) || "scene";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`.slice(0, 64);
}

async function hashGraph(json: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(json));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function graphStats(graph: SceneGraph): { json: string; bytes: number; nodes: number } {
  const json = JSON.stringify(graph ?? {});
  const bytes = enc.encode(json).length;
  const nodes =
    graph && typeof graph === "object" && graph.nodes
      ? Object.keys(graph.nodes).length
      : 0;
  return { json, bytes, nodes };
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  id?: string;
  name: string;
  ownerId?: string | null;
  coreRemodelProjectId: string;
  scopeType: "floor" | "room" | "whole_home";
  floorId?: number | null;
  roomId?: number | null;
}

export async function createProject(
  env: Env,
  input: CreateProjectInput,
): Promise<ProjectRow> {
  const db = drizzle(env.DB);
  const id = input.id ?? slugify(input.name, "proj");
  const existing = await db
    .select()
    .from(pascalProjects)
    .where(eq(pascalProjects.id, id))
    .get();
  if (existing) return existing; // idempotent create

  await db
    .insert(pascalProjects)
    .values({
      id,
      coreRemodelProjectId: input.coreRemodelProjectId,
      name: input.name,
      scopeType: input.scopeType,
      floorId: input.floorId ?? null,
      roomId: input.roomId ?? null,
      ownerId: input.ownerId ?? null,
    })
    .run();
  const row = await db
    .select()
    .from(pascalProjects)
    .where(eq(pascalProjects.id, id))
    .get();
  if (!row) throw new PascalStoreError("invalid", "Project insert failed");
  return row;
}

export async function getProject(env: Env, id: string): Promise<ProjectRow | null> {
  const db = drizzle(env.DB);
  return (
    (await db.select().from(pascalProjects).where(eq(pascalProjects.id, id)).get()) ??
    null
  );
}

/** The project's browser-visible head scene (most-recently-updated variant). */
export async function getProjectHead(
  env: Env,
  projectId: string,
): Promise<VariantRow | null> {
  const db = drizzle(env.DB);
  return (
    (await db
      .select()
      .from(pascalVariants)
      .where(eq(pascalVariants.projectId, projectId))
      .orderBy(desc(pascalVariants.datetimeLastModified))
      .limit(1)
      .get()) ?? null
  );
}

// ─── Scenes (variants) ──────────────────────────────────────────────────────

export async function listScenes(
  env: Env,
  opts: { projectId?: string; ownerId?: string; limit?: number },
): Promise<VariantRow[]> {
  const db = drizzle(env.DB);
  const filters = [];
  if (opts.projectId) filters.push(eq(pascalVariants.projectId, opts.projectId));
  if (opts.ownerId) filters.push(eq(pascalVariants.ownerId, opts.ownerId));
  const where = filters.length ? and(...filters) : undefined;
  return db
    .select()
    .from(pascalVariants)
    .where(where)
    .orderBy(desc(pascalVariants.datetimeLastModified))
    .limit(Math.min(opts.limit ?? 100, 500))
    .all();
}

export async function loadScene(env: Env, id: string): Promise<VariantRow | null> {
  const db = drizzle(env.DB);
  return (
    (await db.select().from(pascalVariants).where(eq(pascalVariants.id, id)).get()) ??
    null
  );
}

export interface SaveSceneInput {
  name: string;
  projectId?: string;
  ownerId?: string | null;
  graph: SceneGraph;
  thumbnailUrl?: string | null;
  expectedVersion?: number;
  saveMode?: "draft" | "checkpoint";
  publish?: boolean;
  rendering?: SceneRenderingMetadata | null;
  studyId?: string | null;
}

/** Create or version-update a scene. Throws PascalStoreError on conflict/too-large/invalid. */
export async function saveScene(
  env: Env,
  sceneId: string,
  input: SaveSceneInput,
): Promise<VariantRow> {
  const db = drizzle(env.DB);
  const { json, bytes, nodes } = graphStats(input.graph);
  if (bytes > MAX_SCENE_BYTES) {
    throw new PascalStoreError("too_large", `Scene ${bytes}B exceeds ${MAX_SCENE_BYTES}B`);
  }
  const graphHash = await hashGraph(json);
  const now = new Date();
  const saveMode = input.saveMode ?? "draft";
  const renderingJson =
    input.rendering !== undefined ? JSON.stringify(input.rendering) : undefined;

  const existing = await loadScene(env, sceneId);

  if (!existing) {
    if (!input.projectId) {
      throw new PascalStoreError("invalid", "projectId required to create a scene");
    }
    const project = await getProject(env, input.projectId);
    if (!project) throw new PascalStoreError("invalid", "Unknown projectId");

    const isDraft = saveMode === "draft";
    const published = saveMode === "checkpoint" && !!input.publish;
    const insertVariant = db.insert(pascalVariants).values({
      id: sceneId,
      studyId: input.studyId ?? null,
      projectId: input.projectId,
      name: input.name,
      graphJson: json,
      graphHash,
      sizeBytes: bytes,
      nodeCount: nodes,
      version: 1,
      publishedVersion: published ? 1 : null,
      draftVersion: isDraft ? 1 : null,
      latestVersion: 1,
      browserVisibleVersion: 1,
      saveMode,
      isDraft,
      published,
      renderingJson: renderingJson ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      ownerId: input.ownerId ?? null,
      datetimeCreated: now,
      datetimeLastModified: now,
    });
    if (saveMode === "checkpoint") {
      await db.batch([
        insertVariant,
        db.insert(pascalSceneEvents).values({
          sceneId,
          version: 1,
          kind: "checkpoint",
          graphJson: json,
          datetimeCreated: now,
        }),
      ]);
    } else {
      await insertVariant.run();
    }
    const row = await loadScene(env, sceneId);
    if (!row) throw new PascalStoreError("invalid", "Scene insert failed");
    return row;
  }

  // Update path — optimistic concurrency on the browser-visible version.
  if (input.expectedVersion != null && input.expectedVersion !== existing.version) {
    throw new PascalStoreError("version_conflict");
  }

  let version = existing.version;
  let isDraft = existing.isDraft;
  let published = existing.published;
  let publishedVersion = existing.publishedVersion;
  let browserVisibleVersion = existing.browserVisibleVersion ?? existing.version;

  if (saveMode === "checkpoint") {
    version = existing.version + 1;
    isDraft = false;
    if (input.publish) {
      published = true;
      publishedVersion = version;
      browserVisibleVersion = version;
    } else {
      browserVisibleVersion = existing.publishedVersion ?? version;
    }
  } else {
    // ponytail: draft saves keep the same version in place ("same version repeatedly"),
    // so two concurrent drafts can clobber; tighten with a monotonic draft counter if it bites.
    isDraft = true;
    browserVisibleVersion = version;
  }
  const latestVersion = Math.max(existing.latestVersion ?? 0, version);

  // Atomic optimistic concurrency: the version guard lives in the WHERE clause, so
  // D1 (which serializes writes) lets exactly one of two racing saves win. A
  // checkpoint from a stale reader matches 0 rows → conflict; the top-of-function
  // expectedVersion check just gives a fast, clear error before we compute anything.
  const res = await db
    .update(pascalVariants)
    .set({
      name: input.name,
      graphJson: json,
      graphHash,
      sizeBytes: bytes,
      nodeCount: nodes,
      version,
      latestVersion,
      publishedVersion,
      draftVersion: isDraft ? version : existing.draftVersion,
      browserVisibleVersion,
      saveMode,
      isDraft,
      published,
      ...(renderingJson !== undefined ? { renderingJson } : {}),
      ...(input.thumbnailUrl !== undefined ? { thumbnailUrl: input.thumbnailUrl } : {}),
      datetimeLastModified: now,
    })
    .where(and(eq(pascalVariants.id, sceneId), eq(pascalVariants.version, existing.version)))
    .run();

  const changed =
    (res as { meta?: { changes?: number }; rowsAffected?: number }).meta?.changes ??
    (res as { rowsAffected?: number }).rowsAffected ??
    0;
  if (changed === 0) throw new PascalStoreError("version_conflict");

  // Event is an append-only log written after the guarded update commits. Not in the
  // same atomic unit as the update (a crash between them just drops one log row).
  if (saveMode === "checkpoint") {
    await db
      .insert(pascalSceneEvents)
      .values({ sceneId, version, kind: "checkpoint", graphJson: json, datetimeCreated: now })
      .run();
  }
  const row = await loadScene(env, sceneId);
  if (!row) throw new PascalStoreError("not_found");
  return row;
}

export async function renameScene(
  env: Env,
  sceneId: string,
  name: string,
  expectedVersion?: number,
): Promise<VariantRow> {
  const db = drizzle(env.DB);
  const existing = await loadScene(env, sceneId);
  if (!existing) throw new PascalStoreError("not_found");
  if (expectedVersion != null && expectedVersion !== existing.version) {
    throw new PascalStoreError("version_conflict");
  }
  const res = await db
    .update(pascalVariants)
    .set({ name, datetimeLastModified: new Date() })
    .where(and(eq(pascalVariants.id, sceneId), eq(pascalVariants.version, existing.version)))
    .run();
  const changed =
    (res as { meta?: { changes?: number } }).meta?.changes ??
    (res as { rowsAffected?: number }).rowsAffected ??
    0;
  if (changed === 0) throw new PascalStoreError("version_conflict");
  const row = await loadScene(env, sceneId);
  if (!row) throw new PascalStoreError("not_found");
  return row;
}

export async function deleteScene(env: Env, sceneId: string): Promise<boolean> {
  const db = drizzle(env.DB);
  const existing = await loadScene(env, sceneId);
  if (!existing) return false;
  // Cascades to pascal_snapshots + pascal_scene_events via FK ON DELETE cascade.
  await db.delete(pascalVariants).where(eq(pascalVariants.id, sceneId)).run();
  return true;
}

// ─── Scene events ─────────────────────────────────────────────────────────────

export async function appendSceneEvent(
  env: Env,
  sceneId: string,
  input: { version: number; kind: string; graph: SceneGraph },
): Promise<typeof pascalSceneEvents.$inferSelect> {
  const db = drizzle(env.DB);
  const scene = await loadScene(env, sceneId);
  if (!scene) throw new PascalStoreError("not_found");
  const { json } = graphStats(input.graph);
  const inserted = await db
    .insert(pascalSceneEvents)
    .values({
      sceneId,
      version: input.version,
      kind: input.kind,
      graphJson: json,
      datetimeCreated: new Date(),
    })
    .returning()
    .get();
  return inserted;
}

export async function listSceneEvents(
  env: Env,
  sceneId: string,
  opts: { afterEventId?: number; limit?: number },
): Promise<Array<typeof pascalSceneEvents.$inferSelect>> {
  const db = drizzle(env.DB);
  const filters = [eq(pascalSceneEvents.sceneId, sceneId)];
  if (opts.afterEventId != null) {
    filters.push(gt(pascalSceneEvents.eventId, opts.afterEventId));
  }
  return db
    .select()
    .from(pascalSceneEvents)
    .where(and(...filters))
    .orderBy(pascalSceneEvents.eventId)
    .limit(Math.min(opts.limit ?? 200, 1000))
    .all();
}
