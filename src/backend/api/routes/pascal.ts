import { floors, rooms } from "@backend/db";
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
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { captureSceneScreenshot, storeSnapshotBytes } from "../../services/pascal/capture";
import { createStudy, listStudies, listVariants } from "../../services/pascal/product";
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
import {
  appendSceneEvent,
  createProject,
  deleteScene,
  getProject,
  getProjectHead,
  listProjects,
  listSceneEvents,
  listScenes,
  loadScene,
  PascalStoreError,
  recordSnapshot,
  renameScene,
  saveScene,
  updateSceneStatus,
} from "../../services/pascal/store";
import { compareProductVariants, generateProductVariant } from "../../services/pascal/workflow";

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
function toHttp(err: unknown): {
  status: 400 | 404 | 409 | 413;
  body: { error: string; message?: string };
} {
  if (err instanceof PascalStoreError) {
    return { status: STATUS[err.code], body: { error: err.code } };
  }
  throw err;
}

const errorResponses = {
  400: { description: "invalid", content: { "application/json": { schema: errorSchema } } },
  404: { description: "not_found", content: { "application/json": { schema: errorSchema } } },
  409: {
    description: "version_conflict",
    content: { "application/json": { schema: errorSchema } },
  },
  413: { description: "too_large", content: { "application/json": { schema: errorSchema } } },
};

const projectSummarySchema = z.object({
  id: z.string(),
  coreRemodelProjectId: z.string(),
  name: z.string(),
  scopeType: z.enum(["floor", "room", "whole_home"]),
  floorId: z.number().int().nullable(),
  roomId: z.number().int().nullable(),
  scopeName: z.string().nullable(),
  studyCount: z.number().int(),
  variantCount: z.number().int(),
  latestThumbnailUrl: z.string().url().nullable(),
  updatedAt: z.string(),
});

const studyDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  descriptionMarkdown: z.string().nullable(),
  descriptionHtml: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const comparisonVariantSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int(),
  nodeCount: z.number().int(),
  status: z.enum(["draft", "active", "archived"]),
  parentSceneId: z.string().nullable(),
  confidence: z.number().nullable(),
  measurements: z.array(z.record(z.string(), z.unknown())),
  thumbnailUrl: z.string().nullable(),
  editorUrl: z.string().url(),
});

const variantDashboardSchema = comparisonVariantSchema.extend({
  projectId: z.string(),
  studyId: z.string().nullable(),
  descriptionMarkdown: z.string().nullable(),
  descriptionHtml: z.string().nullable(),
  updatedAt: z.string(),
});

function dateIso(value: Date): string {
  return value.toISOString();
}

async function projectSummary(env: Env, project: Awaited<ReturnType<typeof listProjects>>[number]) {
  const [studies, variants] = await Promise.all([
    listStudies(env, project.id),
    listVariants(env, { projectId: project.id }),
  ]);
  const db = drizzle(env.DB);
  const scopeName = project.roomId
    ? ((
        await db
          .select({ name: rooms.roomName })
          .from(rooms)
          .where(eq(rooms.id, project.roomId))
          .get()
      )?.name ?? null)
    : project.floorId
      ? ((
          await db
            .select({ name: floors.name })
            .from(floors)
            .where(eq(floors.id, project.floorId))
            .get()
        )?.name ?? null)
      : "Whole home";
  return {
    id: project.id,
    coreRemodelProjectId: project.coreRemodelProjectId,
    name: project.name,
    scopeType: project.scopeType,
    floorId: project.floorId,
    roomId: project.roomId,
    scopeName,
    studyCount: studies.length,
    variantCount: variants.length,
    latestThumbnailUrl: variants[0]?.thumbnailUrl ?? null,
    updatedAt: dateIso(project.datetimeLastModified),
  };
}

// ─── GET /projects — Layout Studio index + canonical scope choices ──────────
pascalRouter.openapi(
  createRoute({
    method: "get",
    path: "/projects",
    responses: {
      200: {
        description: "Pascal projects and available Core-Remodel scopes",
        content: {
          "application/json": {
            schema: z.object({
              projects: z.array(projectSummarySchema),
              scopes: z.object({
                floors: z.array(z.object({ id: z.number().int(), name: z.string() })),
                rooms: z.array(
                  z.object({ id: z.number().int(), floorId: z.number().int(), name: z.string() }),
                ),
              }),
            }),
          },
        },
      },
    },
    summary: "List Pascal layout projects for the admin studio",
    operationId: "pascalListProjects",
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const [projects, floorRows, roomRows] = await Promise.all([
      listProjects(c.env),
      db
        .select({ id: floors.id, name: floors.name })
        .from(floors)
        .orderBy(asc(floors.levelOrder))
        .all(),
      db
        .select({ id: rooms.id, floorId: rooms.floorId, name: rooms.roomName })
        .from(rooms)
        .where(eq(rooms.isActive, true))
        .orderBy(asc(rooms.roomName))
        .all(),
    ]);
    return c.json(
      {
        projects: await Promise.all(projects.map((project) => projectSummary(c.env, project))),
        scopes: { floors: floorRows, rooms: roomRows },
      },
      200,
    );
  },
);

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

// ─── GET /projects/:projectId/studies — admin product view ─────────────────
pascalRouter.openapi(
  createRoute({
    method: "get",
    path: "/projects/{projectId}/studies",
    request: { params: z.object({ projectId: z.string() }) },
    responses: {
      200: {
        description: "Project, studies, and enriched variants",
        content: {
          "application/json": {
            schema: z.object({
              project: projectSummarySchema,
              studies: z.array(studyDtoSchema),
              variants: z.array(variantDashboardSchema),
            }),
          },
        },
      },
      404: errorResponses[404],
    },
    summary: "List a Pascal project's studies and variants",
    operationId: "pascalListProjectStudies",
  }),
  async (c) => {
    const { projectId } = c.req.valid("param");
    const project = await getProject(c.env, projectId);
    if (!project) return c.json({ error: "not_found" }, 404);
    const [studies, variants] = await Promise.all([
      listStudies(c.env, projectId),
      listVariants(c.env, { projectId }),
    ]);
    const comparison = await compareProductVariants(c.env, {
      variantIds: variants.map((variant) => variant.id),
    });
    const enriched = new Map(comparison.map((variant) => [variant.id, variant]));
    return c.json(
      {
        project: await projectSummary(c.env, project),
        studies: studies.map((study) => ({
          id: study.id,
          projectId: study.projectId,
          title: study.title,
          descriptionMarkdown: study.descriptionMarkdown,
          descriptionHtml: study.descriptionHtml,
          createdAt: dateIso(study.datetimeCreated),
          updatedAt: dateIso(study.datetimeLastModified),
        })),
        variants: variants.map((variant) => ({
          ...(enriched.get(variant.id) ?? {
            id: variant.id,
            name: variant.name,
            version: variant.version,
            nodeCount: variant.nodeCount,
            status: variant.status,
            parentSceneId: variant.parentSceneId,
            confidence: null,
            measurements: [],
            thumbnailUrl: variant.thumbnailUrl,
            editorUrl: `${editorBase(c.env).replace(/\/$/, "")}/scene/${encodeURIComponent(variant.id)}`,
          }),
          projectId: variant.projectId,
          studyId: variant.studyId,
          descriptionMarkdown: variant.descriptionMarkdown,
          descriptionHtml: variant.descriptionHtml,
          updatedAt: dateIso(variant.datetimeLastModified),
        })),
      },
      200,
    );
  },
);

// ─── POST /projects/:projectId/studies ─────────────────────────────────────
pascalRouter.openapi(
  createRoute({
    method: "post",
    path: "/projects/{projectId}/studies",
    request: {
      params: z.object({ projectId: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              title: z.string().trim().min(1).max(160),
              descriptionMarkdown: z.string().max(20_000).nullable().optional(),
              descriptionHtml: z.string().max(50_000).nullable().optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: "Created study",
        content: { "application/json": { schema: studyDtoSchema } },
      },
      ...errorResponses,
    },
    summary: "Create a Pascal layout study",
    operationId: "pascalCreateProjectStudy",
  }),
  async (c) => {
    const { projectId } = c.req.valid("param");
    if (!(await getProject(c.env, projectId))) return c.json({ error: "not_found" }, 404);
    const body = c.req.valid("json");
    try {
      const study = await createStudy(c.env, { projectId, ...body });
      return c.json(
        {
          id: study.id,
          projectId: study.projectId,
          title: study.title,
          descriptionMarkdown: study.descriptionMarkdown,
          descriptionHtml: study.descriptionHtml,
          createdAt: dateIso(study.datetimeCreated),
          updatedAt: dateIso(study.datetimeLastModified),
        },
        201,
      );
    } catch (error) {
      const { status, body: response } = toHttp(error);
      return c.json(response, status);
    }
  },
);

// ─── POST /studies/:studyId/variants ───────────────────────────────────────
pascalRouter.openapi(
  createRoute({
    method: "post",
    path: "/studies/{studyId}/variants",
    request: {
      params: z.object({ studyId: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().trim().min(1).max(160),
              fromVariantId: z.string().optional(),
              intent: z.string().trim().max(4_000).optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: "Generated variant",
        content: {
          "application/json": {
            schema: z.object({
              variant: variantDashboardSchema,
              generation: z.record(z.string(), z.unknown()),
            }),
          },
        },
      },
      ...errorResponses,
    },
    summary: "Generate a measured or branched Pascal variant",
    operationId: "pascalGenerateStudyVariant",
  }),
  async (c) => {
    const { studyId } = c.req.valid("param");
    try {
      const { row, ...generation } = await generateProductVariant(c.env, {
        studyId,
        ...c.req.valid("json"),
      });
      const [variant] = await compareProductVariants(c.env, { variantIds: [row.id] });
      return c.json(
        {
          variant: {
            ...variant,
            projectId: row.projectId,
            studyId: row.studyId,
            descriptionMarkdown: row.descriptionMarkdown,
            descriptionHtml: row.descriptionHtml,
            updatedAt: dateIso(row.datetimeLastModified),
          },
          generation,
        },
        201,
      );
    } catch (error) {
      const { status, body: response } = toHttp(error);
      return c.json(response, status);
    }
  },
);

// ─── POST /variants/compare ────────────────────────────────────────────────
pascalRouter.openapi(
  createRoute({
    method: "post",
    path: "/variants/compare",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              studyId: z.string().optional(),
              variantIds: z.array(z.string()).min(2).max(20).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Variant comparison",
        content: {
          "application/json": {
            schema: z.object({ variants: z.array(comparisonVariantSchema) }),
          },
        },
      },
      400: errorResponses[400],
    },
    summary: "Compare Pascal layout variants",
    operationId: "pascalCompareVariants",
  }),
  async (c) => {
    const input = c.req.valid("json");
    if (!input.studyId && !input.variantIds?.length) return c.json({ error: "invalid" }, 400);
    return c.json({ variants: await compareProductVariants(c.env, input) }, 200);
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
    return c.json(
      rows.map((r) => serializeSceneMeta(r, editorBase(c.env))),
      200,
    );
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

// ─── POST /scenes/:sceneId/capture — worker Browser Rendering path ─────────
pascalRouter.openapi(
  createRoute({
    method: "post",
    path: "/scenes/{sceneId}/capture",
    request: {
      params: z.object({ sceneId: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              width: z.number().int().min(320).max(3840).optional(),
              height: z.number().int().min(240).max(2160).optional(),
              fullPage: z.boolean().optional(),
              setAsThumbnail: z.boolean().default(true),
              caption: z.string().max(300).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Stored scene screenshot",
        content: {
          "application/json": {
            schema: z.object({
              sceneId: z.string(),
              imageId: z.string(),
              deliveryUrl: z.string().url(),
              sceneVersion: z.number().int(),
            }),
          },
        },
      },
      ...errorResponses,
      500: {
        description: "Capture failed",
        content: { "application/json": { schema: errorSchema } },
      },
    },
    summary: "Capture a Pascal scene screenshot",
    operationId: "pascalCaptureSceneScreenshot",
  }),
  async (c) => {
    const { sceneId } = c.req.valid("param");
    const scene = await loadScene(c.env, sceneId);
    if (!scene) return c.json({ error: "not_found" }, 404);
    const input = c.req.valid("json");
    try {
      const url = `${editorBase(c.env).replace(/\/$/, "")}/scene/${encodeURIComponent(sceneId)}`;
      const shot = await captureSceneScreenshot(c.env, url, input);
      await recordSnapshot(c.env, {
        variantId: sceneId,
        cfImageId: shot.imageId,
        imageUrl: shot.deliveryUrl,
        caption: input.caption ?? null,
        setAsThumbnail: input.setAsThumbnail,
      });
      return c.json(
        {
          sceneId,
          imageId: shot.imageId,
          deliveryUrl: shot.deliveryUrl,
          sceneVersion: scene.version,
        },
        200,
      );
    } catch (error) {
      return c.json(
        {
          error: "capture_failed",
          message:
            `${error instanceof Error ? error.message : "Capture failed"}. ` +
            "Use the editor canvas-capture fallback if headless WebGPU is blank.",
        },
        500,
      );
    }
  },
);

// ─── PATCH /scenes/:sceneId/status — product lifecycle ─────────────────────
pascalRouter.openapi(
  createRoute({
    method: "patch",
    path: "/scenes/{sceneId}/status",
    request: {
      params: z.object({ sceneId: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ status: z.enum(["draft", "active", "archived"]) }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Updated scene lifecycle",
        content: { "application/json": { schema: variantDashboardSchema } },
      },
      ...errorResponses,
    },
    summary: "Update a Pascal scene's product lifecycle",
    operationId: "pascalUpdateSceneStatus",
  }),
  async (c) => {
    try {
      const row = await updateSceneStatus(
        c.env,
        c.req.valid("param").sceneId,
        c.req.valid("json").status,
      );
      const [variant] = await compareProductVariants(c.env, { variantIds: [row.id] });
      return c.json(
        {
          ...variant,
          projectId: row.projectId,
          studyId: row.studyId,
          descriptionMarkdown: row.descriptionMarkdown,
          descriptionHtml: row.descriptionHtml,
          updatedAt: dateIso(row.datetimeLastModified),
        },
        200,
      );
    } catch (error) {
      const { status, body } = toHttp(error);
      return c.json(body, status);
    }
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
  if (!(c.req.header("content-type") ?? "").includes("image/png")) {
    return c.json({ error: "invalid" }, 400); // expect a raw PNG body
  }
  const bytes = await c.req.arrayBuffer();
  const thumb = c.req.query("thumbnail");
  try {
    const shot = await storeSnapshotBytes(c.env, bytes);
    await recordSnapshot(c.env, {
      variantId: sceneId,
      cfImageId: shot.imageId,
      imageUrl: shot.deliveryUrl,
      caption: c.req.query("caption") ?? null,
      setAsThumbnail: thumb !== "false" && thumb !== "0",
    });
    return c.json({ sceneId, imageId: shot.imageId, deliveryUrl: shot.deliveryUrl }, 200);
  } catch (err) {
    // Bad payload (empty / oversize / non-PNG) is a client error; anything else is ours.
    const msg = err instanceof Error ? err.message : "";
    const clientError = /PNG|Empty|10MB/i.test(msg);
    return clientError
      ? c.json({ error: "invalid" }, 400)
      : c.json({ error: "internal_error" }, 500);
  }
});

export default pascalRouter;
