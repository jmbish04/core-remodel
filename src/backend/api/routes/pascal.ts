/**
 * @fileoverview Pascal scene store API — `/api/pascal/v1/*` (0043).
 *
 * The durable backing the Vercel Pascal editor's remote storage adapter talks to.
 * Core-Remodel is the system of record; this router persists scene graphs, versions,
 * provenance, and events. Mounted behind `requireAccessAuth` (WORKER_API_KEY) in
 * api/index.ts — the editor's SERVER calls it with a bearer token; browsers never do.
 *
 * Shapes + status codes mirror jmbish04/editor#1 byte-for-byte (see services/pascal/shapes.ts
 * and scene-api-errors.ts): version_conflict→409, not_found→404, too_large→413, invalid→400.
 */
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import {
  appendEventBodySchema,
  createProjectBodySchema,
  projectStatusSchema,
  renameSceneBodySchema,
  saveSceneBodySchema,
  sceneEventSchema,
  sceneMetaSchema,
  serializeProjectStatus,
  serializeSceneEvent,
  serializeSceneMeta,
  serializeSceneWithGraph,
  sceneWithGraphSchema,
} from "../../services/pascal/shapes";
import { storeSnapshotBytes } from "../../services/pascal/capture";
import {
  appendSceneEvent,
  createProject,
  deleteScene,
  getProject,
  getProjectHead,
  listSceneEvents,
  listScenes,
  loadScene,
  PascalStoreError,
  recordSnapshot,
  renameScene,
  saveScene,
} from "../../services/pascal/store";

export const pascalRouter = new OpenAPIHono<{ Bindings: Env }>();

const DEFAULT_EDITOR_URL = "https://3d-remodel.vercel.app";
const editorBase = (env: Env): string =>
  (env as { PASCAL_EDITOR_URL?: string }).PASCAL_EDITOR_URL ?? DEFAULT_EDITOR_URL;

const errorSchema = z.object({ error: z.string(), message: z.string().optional() });

/** Map a store error to its HTTP status; rethrow non-store errors. */
const STATUS: Record<PascalStoreError["code"], 400 | 404 | 409 | 413> = {
  invalid: 400,
  not_found: 404,
  version_conflict: 409,
  too_large: 413,
};
function toHttp(err: unknown): { status: 400 | 404 | 409 | 413; body: { error: string; message?: string } } {
  if (err instanceof PascalStoreError) {
    return { status: STATUS[err.code], body: { error: err.code } };
  }
  throw err;
}

const errorResponses = {
  400: { description: "invalid", content: { "application/json": { schema: errorSchema } } },
  404: { description: "not_found", content: { "application/json": { schema: errorSchema } } },
  409: { description: "version_conflict", content: { "application/json": { schema: errorSchema } } },
  413: { description: "too_large", content: { "application/json": { schema: errorSchema } } },
};

// ─── POST /projects ─────────────────────────────────────────────────────────
pascalRouter.openapi(
  createRoute({
    method: "post",
    path: "/projects",
    request: {
      body: { content: { "application/json": { schema: createProjectBodySchema } } },
    },
    responses: {
      200: {
        description: "Project mapping",
        content: { "application/json": { schema: projectStatusSchema } },
      },
      ...errorResponses,
    },
    summary: "Create a Pascal project mapping",
    operationId: "pascalCreateProject",
  }),
  async (c) => {
    const body = c.req.valid("json");
    try {
      const project = await createProject(c.env, body);
      const head = await getProjectHead(c.env, project.id);
      return c.json(serializeProjectStatus(project, head, editorBase(c.env)), 200);
    } catch (err) {
      const { status, body: b } = toHttp(err);
      return c.json(b, status);
    }
  },
);

// ─── GET /projects/:projectId ─────────────────────────────────────────────────
pascalRouter.openapi(
  createRoute({
    method: "get",
    path: "/projects/{projectId}",
    request: { params: z.object({ projectId: z.string() }) },
    responses: {
      200: {
        description: "Project status",
        content: { "application/json": { schema: projectStatusSchema } },
      },
      ...errorResponses,
    },
    summary: "Read a Pascal project's status",
    operationId: "pascalGetProject",
  }),
  async (c) => {
    const { projectId } = c.req.valid("param");
    const project = await getProject(c.env, projectId);
    if (!project) return c.json({ error: "not_found" }, 404);
    const head = await getProjectHead(c.env, project.id);
    return c.json(serializeProjectStatus(project, head, editorBase(c.env)), 200);
  },
);

// ─── GET /scenes?projectId=... ───────────────────────────────────────────────
pascalRouter.openapi(
  createRoute({
    method: "get",
    path: "/scenes",
    request: {
      query: z.object({
        projectId: z.string().optional(),
        ownerId: z.string().optional(),
        limit: z.coerce.number().int().positive().max(500).optional(),
      }),
    },
    responses: {
      200: {
        description: "Scenes for a project",
        content: { "application/json": { schema: z.array(sceneMetaSchema) } },
      },
    },
    summary: "List scenes mapped to a project",
    operationId: "pascalListScenes",
  }),
  async (c) => {
    const q = c.req.valid("query");
    const rows = await listScenes(c.env, q);
    return c.json(rows.map((r) => serializeSceneMeta(r, editorBase(c.env))), 200);
  },
);

// ─── PUT /scenes/:sceneId ─────────────────────────────────────────────────────
pascalRouter.openapi(
  createRoute({
    method: "put",
    path: "/scenes/{sceneId}",
    request: {
      params: z.object({ sceneId: z.string() }),
      body: { content: { "application/json": { schema: saveSceneBodySchema } } },
    },
    responses: {
      200: {
        description: "Saved scene",
        content: { "application/json": { schema: sceneMetaSchema } },
      },
      ...errorResponses,
    },
    summary: "Create or version-update a scene",
    operationId: "pascalSaveScene",
  }),
  async (c) => {
    const { sceneId } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const row = await saveScene(c.env, sceneId, body);
      return c.json(serializeSceneMeta(row, editorBase(c.env)), 200);
    } catch (err) {
      const { status, body: b } = toHttp(err);
      return c.json(b, status);
    }
  },
);

// ─── GET /scenes/:sceneId ─────────────────────────────────────────────────────
pascalRouter.openapi(
  createRoute({
    method: "get",
    path: "/scenes/{sceneId}",
    request: { params: z.object({ sceneId: z.string() }) },
    responses: {
      200: {
        description: "Scene graph + metadata",
        content: { "application/json": { schema: sceneWithGraphSchema } },
      },
      ...errorResponses,
    },
    summary: "Load a scene graph + metadata",
    operationId: "pascalGetScene",
  }),
  async (c) => {
    const { sceneId } = c.req.valid("param");
    const row = await loadScene(c.env, sceneId);
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(serializeSceneWithGraph(row, editorBase(c.env)), 200);
  },
);

// ─── PATCH /scenes/:sceneId (rename) ──────────────────────────────────────────
pascalRouter.openapi(
  createRoute({
    method: "patch",
    path: "/scenes/{sceneId}",
    request: {
      params: z.object({ sceneId: z.string() }),
      body: { content: { "application/json": { schema: renameSceneBodySchema } } },
    },
    responses: {
      200: {
        description: "Renamed scene",
        content: { "application/json": { schema: sceneMetaSchema } },
      },
      ...errorResponses,
    },
    summary: "Rename a scene",
    operationId: "pascalRenameScene",
  }),
  async (c) => {
    const { sceneId } = c.req.valid("param");
    const { name, expectedVersion } = c.req.valid("json");
    try {
      const row = await renameScene(c.env, sceneId, name, expectedVersion);
      return c.json(serializeSceneMeta(row, editorBase(c.env)), 200);
    } catch (err) {
      const { status, body: b } = toHttp(err);
      return c.json(b, status);
    }
  },
);

// ─── DELETE /scenes/:sceneId ──────────────────────────────────────────────────
pascalRouter.openapi(
  createRoute({
    method: "delete",
    path: "/scenes/{sceneId}",
    request: { params: z.object({ sceneId: z.string() }) },
    responses: {
      204: { description: "Deleted" },
      404: errorResponses[404],
    },
    summary: "Delete rendering state for a scene",
    operationId: "pascalDeleteScene",
  }),
  async (c) => {
    const { sceneId } = c.req.valid("param");
    const ok = await deleteScene(c.env, sceneId);
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.body(null, 204);
  },
);

// ─── POST /scenes/:sceneId/events ─────────────────────────────────────────────
pascalRouter.openapi(
  createRoute({
    method: "post",
    path: "/scenes/{sceneId}/events",
    request: {
      params: z.object({ sceneId: z.string() }),
      body: { content: { "application/json": { schema: appendEventBodySchema } } },
    },
    responses: {
      200: {
        description: "Appended event",
        content: { "application/json": { schema: sceneEventSchema } },
      },
      ...errorResponses,
    },
    summary: "Append a browser-visible scene event",
    operationId: "pascalAppendSceneEvent",
  }),
  async (c) => {
    const { sceneId } = c.req.valid("param");
    const body = c.req.valid("json");
    try {
      const row = await appendSceneEvent(c.env, sceneId, body);
      return c.json(serializeSceneEvent(row), 200);
    } catch (err) {
      const { status, body: b } = toHttp(err);
      return c.json(b, status);
    }
  },
);

// ─── GET /scenes/:sceneId/events?after=... ────────────────────────────────────
pascalRouter.openapi(
  createRoute({
    method: "get",
    path: "/scenes/{sceneId}/events",
    request: {
      params: z.object({ sceneId: z.string() }),
      query: z.object({
        after: z.coerce.number().int().nonnegative().optional(),
        limit: z.coerce.number().int().positive().max(1000).optional(),
      }),
    },
    responses: {
      200: {
        description: "Scene events after the cursor",
        content: { "application/json": { schema: z.array(sceneEventSchema) } },
      },
    },
    summary: "Read scene events after a cursor",
    operationId: "pascalListSceneEvents",
  }),
  async (c) => {
    const { sceneId } = c.req.valid("param");
    const { after, limit } = c.req.valid("query");
    const rows = await listSceneEvents(c.env, sceneId, { afterEventId: after, limit });
    return c.json(rows.map(serializeSceneEvent), 200);
  },
);

// ─── POST /scenes/:sceneId/snapshot — editor canvas-capture fallback ──────────
// Not part of the frozen editor storage contract: the fallback for when worker-side
// Browser Rendering can't paint a client-side WebGPU scene. The editor grabs its own
// canvas and POSTs the raw PNG bytes here; we upload to CF Images + record a snapshot.
pascalRouter.post("/scenes/:sceneId/snapshot", async (c) => {
  const sceneId = c.req.param("sceneId");
  const scene = await loadScene(c.env, sceneId);
  if (!scene) return c.json({ error: "not_found" }, 404);
  const bytes = await c.req.arrayBuffer();
  try {
    const shot = await storeSnapshotBytes(c.env, bytes);
    await recordSnapshot(c.env, {
      variantId: sceneId,
      cfImageId: shot.imageId,
      imageUrl: shot.deliveryUrl,
      caption: c.req.query("caption") ?? null,
      setAsThumbnail: c.req.query("thumbnail") !== "false",
    });
    return c.json({ sceneId, imageId: shot.imageId, deliveryUrl: shot.deliveryUrl }, 200);
  } catch (err) {
    return c.json({ error: "invalid", message: err instanceof Error ? err.message : "error" }, 400);
  }
});

export default pascalRouter;
