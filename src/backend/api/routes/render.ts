/**
 * Render pipeline API — staged virtual-staging renderer.
 * See docs/0004_ai_image_editing/IMPLEMENTATION_PLAN.md.
 */
import { zValidator } from "@hono/zod-validator";
import {
  canvasInspirationReferences,
  images,
  listingPhotos,
  renderCanvases,
  renderSessions,
  showroomImageGroups,
  showroomImages,
  showroomStores,
} from "@backend/db";
import { desc, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

import { mergeRefs, referenceSchema, resolveShowroomImageRefs } from "../../services/render/references";
import { runStage } from "../../services/render/stage-runner";
import type { StageType } from "../../services/render/types";

const renderRouter = new Hono<{ Bindings: Env }>();

/** Build a delivery URL from a stored Cloudflare Images token/id (or pass through a URL). */
function deliveryUrlFromToken(token: string): string {
  if (token.startsWith("http")) return token;
  return `https://imagedelivery.net/${token}/public`;
}

/** Prefer the exact variant URL we stored in metadata; else reconstruct from the id. */
function metaDeliveryUrl(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { deliveryUrl?: unknown };
    return typeof parsed.deliveryUrl === "string" ? parsed.deliveryUrl : null;
  } catch {
    return null;
  }
}

const ACTION_TO_STAGE: Record<string, StageType> = {
  INITIAL_BASE: "stage_1_LP_base",
  STRUCTURAL_MOVE: "stage_2_LP_rough_in",
  MATERIAL_TWEAK: "stage_3_LP_finish",
  FINISH: "stage_3_LP_finish",
};

// POST /api/render/sessions
renderRouter.post(
  "/sessions",
  zValidator(
    "json",
    z.object({
      roomId: z.number().nullable().optional(),
      name: z.string().min(1),
      designConfig: z.any().optional(),
    }),
  ),
  async (c) => {
    const db = drizzle(c.env.DB);
    const body = c.req.valid("json");
    const id = crypto.randomUUID();
    await db
      .insert(renderSessions)
      .values({
        id,
        roomId: body.roomId ?? null,
        name: body.name,
        designConfig: body.designConfig ? JSON.stringify(body.designConfig) : null,
      })
      .run();
    return c.json({ id });
  },
);

/**
 * POST /api/render/sessions/from-images — create a session seeded with a set of
 * images' Cloudflare URLs as inspiration references (0041 P2).
 *
 * Accepts `showroomImageIds` (resolved to their `deliveryUrl`) and/or explicit
 * `references` ({url,label}). The seeds are stored on the session and surfaced in
 * the studio inspiration rail. Bridges showroom photos (numeric ids, CF URLs) into
 * the render pipeline without forcing them into the UUID `images` table.
 */
renderRouter.post(
  "/sessions/from-images",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1),
      roomId: z.number().nullable().optional(),
      showroomImageIds: z.array(z.number().int().positive()).max(500).optional(),
      references: z.array(referenceSchema).max(500).optional(),
    }),
  ),
  async (c) => {
    const db = drizzle(c.env.DB);
    const body = c.req.valid("json");

    const refs = await resolveShowroomImageRefs(db, {
      showroomImageIds: body.showroomImageIds,
      references: body.references,
    });

    if (refs.length === 0) {
      return c.json({ error: "No images resolved — pass showroomImageIds or references." }, 400);
    }

    const id = crypto.randomUUID();
    await db
      .insert(renderSessions)
      .values({
        id,
        roomId: body.roomId ?? null,
        name: body.name,
        seedReferenceUrlsJson: JSON.stringify(refs),
      })
      .run();
    return c.json({ id, seedReferences: refs }, 201);
  },
);

/** Parse a session's seed-reference JSON into [{url,label}] (never throws). */
function parseSeedReferences(json: string | null): { url: string; label?: string }[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((r): r is { url: string; label?: string } => Boolean(r && typeof r.url === "string"))
      : [];
  } catch {
    return [];
  }
}

// GET /api/render/sessions/:id
renderRouter.get("/sessions/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const session = await db
    .select()
    .from(renderSessions)
    .where(eq(renderSessions.id, id))
    .get();
  if (!session) return c.json({ error: "Session not found" }, 404);
  const canvases = await db
    .select()
    .from(renderCanvases)
    .where(eq(renderCanvases.sessionId, id))
    .all();
  return c.json({ session, canvases, seedReferences: parseSeedReferences(session.seedReferenceUrlsJson) });
});

/**
 * GET /api/render/reference-folders — list active showroom photo folders
 * (showroom_image_groups) for the "add reference from folder" picker (0041 P3).
 * Each carries its store name, member count, and a cover delivery URL.
 */
renderRouter.get("/reference-folders", async (c) => {
  const db = drizzle(c.env.DB);
  const groups = await db
    .select({
      id: showroomImageGroups.id,
      name: showroomImageGroups.name,
      storeId: showroomImageGroups.storeId,
      storeName: showroomStores.name,
      coverImageId: showroomImageGroups.coverImageId,
    })
    .from(showroomImageGroups)
    .innerJoin(showroomStores, eq(showroomImageGroups.storeId, showroomStores.id))
    .where(eq(showroomImageGroups.isActive, true))
    .orderBy(desc(showroomImageGroups.createdAt))
    .all();

  // Bucket grouped photos to derive count + cover per folder. Only rows that
  // actually belong to a folder — never scan the whole images table.
  const grouped = await db
    .select({ id: showroomImages.id, groupId: showroomImages.groupId, url: showroomImages.deliveryUrl })
    .from(showroomImages)
    .where(isNotNull(showroomImages.groupId))
    .all();
  const byGroup = new Map<number, { id: number; url: string }[]>();
  for (const m of grouped) {
    if (m.groupId == null) continue;
    const list = byGroup.get(m.groupId) ?? [];
    list.push({ id: m.id, url: m.url });
    byGroup.set(m.groupId, list);
  }

  const folders = groups.map((g) => {
    const mem = byGroup.get(g.id) ?? [];
    const cover =
      (g.coverImageId != null ? mem.find((m) => m.id === g.coverImageId)?.url : null) ?? mem[0]?.url ?? null;
    return { id: g.id, name: g.name, storeId: g.storeId, storeName: g.storeName, memberCount: mem.length, coverUrl: cover };
  });
  return c.json({ folders });
});

/**
 * POST /api/render/sessions/:id/references — add inspiration references to an
 * existing session (0041 P3). Accepts `imageGroupId` (all photos in a folder),
 * `showroomImageIds`, and/or explicit `references`. Merges into the seed list
 * (deduped by url) and returns the updated set.
 */
renderRouter.post(
  "/sessions/:id/references",
  zValidator(
    "json",
    z.object({
      imageGroupId: z.number().int().positive().optional(),
      showroomImageIds: z.array(z.number().int().positive()).max(500).optional(),
      references: z.array(referenceSchema).max(500).optional(),
    }),
  ),
  async (c) => {
    const db = drizzle(c.env.DB);
    const id = c.req.param("id");
    const session = await db.select().from(renderSessions).where(eq(renderSessions.id, id)).get();
    if (!session) return c.json({ error: "Session not found" }, 404);

    const added = await resolveShowroomImageRefs(db, c.req.valid("json"));
    if (added.length === 0) {
      return c.json({ error: "No images resolved — pass imageGroupId, showroomImageIds, or references." }, 400);
    }
    const merged = mergeRefs(parseSeedReferences(session.seedReferenceUrlsJson), added);
    await db
      .update(renderSessions)
      .set({ seedReferenceUrlsJson: JSON.stringify(merged), datetimeLastModified: new Date() })
      .where(eq(renderSessions.id, id))
      .run();
    return c.json({ seedReferences: merged });
  },
);

// POST /api/render/stage
renderRouter.post(
  "/stage",
  zValidator(
    "json",
    z.object({
      sessionId: z.string(),
      canvasId: z.string().optional(),
      listingPhotoId: z.number().optional(),
      actionType: z.enum(["INITIAL_BASE", "STRUCTURAL_MOVE", "MATERIAL_TWEAK", "FINISH"]),
      prompt: z.string().min(1),
      branchLabel: z.string().optional(),
      lightingProfile: z.enum(["default", "day", "night"]).optional(),
      references: z.array(z.object({ url: z.string(), label: z.string() })).optional(),
      maskUrl: z.string().optional(),
      inspirationRefs: z
        .array(
          z.object({
            inspirationImageId: z.string(),
            referenceIndex: z.number(),
            referencedRegionBoundingBox: z.string().optional(),
            extractionNotes: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
  async (c) => {
    const db = drizzle(c.env.DB);
    const body = c.req.valid("json");
    const type = ACTION_TO_STAGE[body.actionType];

    let inputImageUrl: string | null = null;
    let parentCanvasId: string | null = null;
    let listingPhotoId: number | null = body.listingPhotoId ?? null;
    let roomId: number | null = null;

    if (body.canvasId) {
      const parent = await db
        .select()
        .from(renderCanvases)
        .where(eq(renderCanvases.id, body.canvasId))
        .get();
      if (!parent) return c.json({ error: "Parent canvas not found" }, 404);
      inputImageUrl =
        metaDeliveryUrl(parent.metadata) ??
        (parent.outputCfImageId ? deliveryUrlFromToken(parent.outputCfImageId) : null);
      parentCanvasId = parent.id;
      listingPhotoId = parent.listingPhotoId ?? listingPhotoId;
      roomId = parent.roomId ?? null;
    } else if (listingPhotoId != null) {
      const lp = await db
        .select()
        .from(listingPhotos)
        .where(eq(listingPhotos.id, listingPhotoId))
        .get();
      if (!lp) return c.json({ error: "Listing photo not found" }, 404);
      const token = lp.blankCanvasCfImageId ?? lp.cfImageId;
      if (!token) return c.json({ error: "No blank canvas for this listing photo" }, 400);
      inputImageUrl = deliveryUrlFromToken(token);
      roomId = lp.roomId ?? null;
    }

    if (!inputImageUrl) {
      return c.json(
        { error: "Could not resolve an input image (provide canvasId or listingPhotoId)" },
        400,
      );
    }

    const result = await runStage({
      env: c.env,
      sessionId: body.sessionId,
      type,
      inputImageUrl,
      prompt: body.prompt,
      parentCanvasId,
      listingPhotoId,
      roomId,
      branchLabel: body.branchLabel,
      lightingProfile: body.lightingProfile,
      references: body.references,
      maskUrl: body.maskUrl,
      inspirationRefs: body.inspirationRefs,
    });
    return c.json({ canvas: result });
  },
);

// GET /api/render/canvases/:id  (canvas + lineage + inspiration refs)
renderRouter.get("/canvases/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const canvas = await db
    .select()
    .from(renderCanvases)
    .where(eq(renderCanvases.id, id))
    .get();
  if (!canvas) return c.json({ error: "Canvas not found" }, 404);

  const lineage: (typeof canvas)[] = [];
  let cursor = canvas.parentCanvasId;
  let guard = 0;
  while (cursor && guard++ < 50) {
    const node = await db
      .select()
      .from(renderCanvases)
      .where(eq(renderCanvases.id, cursor))
      .get();
    if (!node) break;
    lineage.unshift(node);
    cursor = node.parentCanvasId;
  }

  const inspirationRefs = await db
    .select()
    .from(canvasInspirationReferences)
    .where(eq(canvasInspirationReferences.canvasId, id))
    .all();
  return c.json({ canvas, lineage, inspirationRefs });
});

// POST /api/render/extract — record an inspiration region (bbox + junction).
// No pixel crop needed: synthesis sends full images; the gallery overlays the bbox.
renderRouter.post(
  "/extract",
  zValidator(
    "json",
    z.object({
      canvasId: z.string().optional(),
      inspirationImageId: z.string(),
      referencedRegionBoundingBox: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      }),
      extractionNotes: z.string().optional(),
      referenceIndex: z.number().optional(),
    }),
  ),
  async (c) => {
    const db = drizzle(c.env.DB);
    const body = c.req.valid("json");
    if (body.canvasId) {
      await db
        .insert(canvasInspirationReferences)
        .values({
          canvasId: body.canvasId,
          inspirationImageId: body.inspirationImageId,
          referenceIndex: body.referenceIndex ?? 1,
          extractionNotes: body.extractionNotes ?? null,
          referencedRegionBoundingBox: JSON.stringify(body.referencedRegionBoundingBox),
        })
        .run();
    }
    return c.json({ ok: true, referencedRegionBoundingBox: body.referencedRegionBoundingBox });
  },
);

// POST /api/render/synthesize — multi-image inspo synthesis (Stage 5, @image ordering)
renderRouter.post(
  "/synthesize",
  zValidator(
    "json",
    z.object({
      sessionId: z.string(),
      baseCanvasId: z.string(),
      prompt: z.string().min(1),
      inspirationReferences: z
        .array(z.object({ inspirationImageId: z.string(), referenceIndex: z.number() }))
        .default([]),
    }),
  ),
  async (c) => {
    const db = drizzle(c.env.DB);
    const body = c.req.valid("json");
    const base = await db
      .select()
      .from(renderCanvases)
      .where(eq(renderCanvases.id, body.baseCanvasId))
      .get();
    if (!base) return c.json({ error: "Base canvas not found" }, 404);
    const baseUrl =
      metaDeliveryUrl(base.metadata) ??
      (base.outputCfImageId ? deliveryUrlFromToken(base.outputCfImageId) : null);
    if (!baseUrl) return c.json({ error: "Base canvas has no image" }, 400);

    const refs = [...body.inspirationReferences].sort(
      (a, b) => a.referenceIndex - b.referenceIndex,
    );
    const imageUrls = [baseUrl];
    for (const r of refs) {
      const img = await db.select().from(images).where(eq(images.id, r.inspirationImageId)).get();
      const token = img?.cfImageIdOptimized ?? img?.cfImageIdOriginal ?? null;
      if (token) imageUrls.push(deliveryUrlFromToken(token));
    }

    const result = await runStage({
      env: c.env,
      sessionId: body.sessionId,
      type: "stage_5_LP_synthesis",
      inputImageUrl: baseUrl,
      prompt: body.prompt,
      parentCanvasId: base.id,
      listingPhotoId: base.listingPhotoId ?? null,
      roomId: base.roomId ?? null,
      imageUrls,
      inspirationRefs: refs.map((r) => ({
        inspirationImageId: r.inspirationImageId,
        referenceIndex: r.referenceIndex,
      })),
    });
    return c.json({ canvas: result });
  },
);

// POST /api/render/looks — apply a design across a room's angles (hero + reference).
// Builds the hero angle first, then renders each other angle with the hero's finish
// attached as a consistency reference. NOTE: sequential for v1; move to a Cloudflare
// Workflow (T2.1) when a room has many angles to avoid request time limits.
renderRouter.post(
  "/looks",
  zValidator(
    "json",
    z.object({
      sessionId: z.string(),
      prompt: z.string().min(1),
      angles: z.array(z.object({ listingPhotoId: z.number() })).min(1),
      heroIndex: z.number().optional(),
      lightingProfile: z.enum(["default", "day", "night"]).optional(),
    }),
  ),
  async (c) => {
    const db = drizzle(c.env.DB);
    const body = c.req.valid("json");

    const resolved: { listingPhotoId: number; url: string; roomId: number | null }[] = [];
    for (const a of body.angles) {
      const lp = await db
        .select()
        .from(listingPhotos)
        .where(eq(listingPhotos.id, a.listingPhotoId))
        .get();
      if (!lp) continue;
      const token = lp.blankCanvasCfImageId ?? lp.cfImageId;
      if (!token) continue;
      resolved.push({
        listingPhotoId: a.listingPhotoId,
        url: deliveryUrlFromToken(token),
        roomId: lp.roomId ?? null,
      });
    }
    if (resolved.length === 0) return c.json({ error: "No resolvable angles" }, 400);

    const hero = resolved[Math.min(body.heroIndex ?? 0, resolved.length - 1)];
    const heroResult = await runStage({
      env: c.env,
      sessionId: body.sessionId,
      type: "stage_3_LP_finish",
      inputImageUrl: hero.url,
      prompt: body.prompt,
      listingPhotoId: hero.listingPhotoId,
      roomId: hero.roomId,
      lightingProfile: body.lightingProfile,
    });

    const canvases = [heroResult];
    for (const ang of resolved) {
      if (ang.listingPhotoId === hero.listingPhotoId) continue;
      const r = await runStage({
        env: c.env,
        sessionId: body.sessionId,
        type: "stage_3_LP_finish",
        inputImageUrl: ang.url,
        prompt: `${body.prompt}\n\nThis is the SAME kitchen shown in the reference image — render it from THIS camera angle, matching the reference's materials, layout, cabinetry, and fixtures exactly. Keep this room's real walls, windows, and openings unchanged.`,
        listingPhotoId: ang.listingPhotoId,
        roomId: ang.roomId,
        lightingProfile: body.lightingProfile,
        references: heroResult.outputDeliveryUrl
          ? [{ url: heroResult.outputDeliveryUrl, label: "the same kitchen (hero render) — match it exactly" }]
          : undefined,
      });
      canvases.push(r);
    }

    await db
      .update(renderSessions)
      .set({ heroCanvasId: heroResult.id })
      .where(eq(renderSessions.id, body.sessionId))
      .run();

    return c.json({ heroCanvasId: heroResult.id, canvases });
  },
);

// GET /api/render/realtime?session=<id> — WebSocket proxy to the shared DO channel.
renderRouter.get("/realtime", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 400);
  }
  const session = new URL(c.req.url).searchParams.get("session") || "global";
  const stub = c.env.ESTIMATE_COLLAB.getByName(`render:${session}`);
  return stub.fetch(c.req.raw);
});

export default renderRouter;
