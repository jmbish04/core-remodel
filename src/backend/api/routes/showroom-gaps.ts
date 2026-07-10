/**
 * @fileoverview Showroom Gap-Intelligence API
 *
 * AI-assisted gap detection across three contexts (material / product /
 * showroom), persisted in showroom_gaps with a never-resurface lifecycle.
 * Mounts at /api/showroom-stores (alongside showroom-stores + showroom-seed).
 *
 *   POST /meta/gaps/analyze?context=   — detect + upsert gaps
 *   GET  /meta/gaps/list?context=      — list active gaps (open + researching)
 *   POST /meta/gaps/dismiss            — bulk mark non-gap (never resurface)
 *   POST /meta/gaps/research           — bulk hand-off: create materials + queue
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  showroomGaps,
  storeProductAreaDef,
  storePaMapping,
  showroomStoreProducts,
} from "@backend/db/schema/showroom/index";
import { materialScheduleItems } from "@backend/db/schema/materials/index";
import { rooms } from "@backend/db/schema/home/rooms";
import { floors } from "@backend/db/schema/home/floors";
import { generateStructuredOutput } from "@backend/ai/providers/index";

export const showroomGapsRouter = new Hono<{ Bindings: Env }>();

type GapContext = "material" | "product" | "showroom";

interface GapCandidate {
  context: GapContext;
  gapKey: string;
  roomId: number | null;
  roomName: string | null;
  name: string;
  description: string | null;
  suggestedAction: string | null;
  sourceSignal: unknown;
}

const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Max items per D1 query/batch — D1 caps bound parameters at 100 per query. */
const CHUNK = 50;

/**
 * Upsert candidates by (context, gapKey). Never re-opens a key that is already
 * dismissed or closed; refreshes description/suggestion for still-open keys.
 * Returns the count newly inserted.
 */
async function upsertGaps(
  db: ReturnType<typeof drizzle>,
  context: GapContext,
  candidates: GapCandidate[],
): Promise<number> {
  if (candidates.length === 0) return 0;

  const keys = candidates.map((c) => c.gapKey);
  // Chunk the lookup: inArray binds one parameter per key and D1 caps a query
  // at 100 bound parameters, so stay well under that.
  const existing: { gapKey: string; status: string }[] = [];
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const rows = await db
      .select({ gapKey: showroomGaps.gapKey, status: showroomGaps.status })
      .from(showroomGaps)
      .where(and(eq(showroomGaps.context, context), inArray(showroomGaps.gapKey, chunk)));
    existing.push(...rows);
  }

  const existingStatus = new Map(existing.map((e) => [e.gapKey, e.status]));
  const inserts = [];

  for (const c of candidates) {
    const prior = existingStatus.get(c.gapKey);
    // Never resurface a dismissed/closed gap; skip already-tracked open ones.
    if (prior === "dismissed" || prior === "closed" || prior === "open" || prior === "researching") {
      continue;
    }
    inserts.push(
      db.insert(showroomGaps).values({
        context,
        gapKey: c.gapKey,
        roomId: c.roomId,
        roomName: c.roomName,
        name: c.name,
        description: c.description,
        suggestedAction: c.suggestedAction,
        sourceSignalJson: JSON.stringify(c.sourceSignal ?? null),
        status: "open",
      }),
    );
  }

  // Batch the inserts: one roundtrip per chunk instead of one per row.
  for (let i = 0; i < inserts.length; i += CHUNK) {
    await db.batch(inserts.slice(i, i + CHUNK) as [typeof inserts[number], ...typeof inserts]);
  }
  return inserts.length;
}

// ─── Detection ──────────────────────────────────────────────────────────────────

const MaterialGapSchema = z.object({
  gaps: z.array(
    z.object({
      name: z.string(),
      // The AI picks the exact canonical room by id from the supplied catalog —
      // never a free-text name (room names repeat across floors).
      roomId: z.number().int().nullable().optional(),
      description: z.string(),
      suggestedAction: z.string(),
    }),
  ),
});

/** AI detection: implied-but-missing sibling materials from the current list. */
async function detectMaterialGaps(env: Env, db: ReturnType<typeof drizzle>): Promise<GapCandidate[]> {
  const materials = await db
    .select({
      title: materialScheduleItems.title,
      roomId: materialScheduleItems.roomId,
      roomName: rooms.roomName,
    })
    .from(materialScheduleItems)
    .leftJoin(rooms, eq(materialScheduleItems.roomId, rooms.id));

  if (materials.length === 0) return [];
  const existingNames = new Set(materials.map((m) => slug(m.title)));

  // Room catalog with floor labels so the AI disambiguates same-named rooms
  // (e.g. two "Bathroom"s on different floors) by picking a specific roomId.
  const catalog = await db
    .select({ id: rooms.id, roomName: rooms.roomName, floor: floors.name })
    .from(rooms)
    .innerJoin(floors, eq(rooms.floorId, floors.id))
    .where(eq(rooms.isActive, true))
    .all();
  const roomById = new Map(catalog.map((r) => [r.id, r.roomName]));

  const result = await generateStructuredOutput(env, {
    schemaName: "MaterialGapAnalysis",
    schema: MaterialGapSchema,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "You are a home-renovation sourcing assistant. Given the homeowner's CURRENT materials list and the ROOM CATALOG, identify IMPLIED but MISSING sibling materials/components they likely need but have not logged. Example: if they logged 'closet', suggest 'closet system', 'closet lighting', 'closet island'. Only suggest genuinely missing, concrete, sourceable items — never duplicate something already in the list. For each, set `roomId` to the EXACT room from the catalog it belongs to (rooms repeat across floors — use the floor label to pick the right one); use null only if truly room-agnostic. Give a one-sentence rationale plus a concrete suggested action. Return at most 12.",
      },
      {
        role: "user",
        content: `Room catalog (JSON):\n${JSON.stringify(catalog)}\n\nCurrent materials (JSON):\n${JSON.stringify(materials)}`,
      },
    ],
  });

  return result.gaps
    .filter((g) => !existingNames.has(slug(g.name)))
    .map((g) => {
      // Trust only a roomId that exists in the catalog; otherwise room-agnostic.
      const roomId = g.roomId != null && roomById.has(g.roomId) ? g.roomId : null;
      const room = roomId != null ? roomById.get(roomId) ?? null : null;
      return {
        context: "material" as const,
        gapKey: `material:${slug(room ?? "general")}:${slug(g.name)}`,
        roomId,
        roomName: room,
        name: g.name.trim(),
        description: g.description,
        suggestedAction: g.suggestedAction,
        sourceSignal: { kind: "ai-implied-sibling", basedOnCount: materials.length },
      };
    });
}

/** Deterministic: materials with no sourced showroom products. */
async function detectProductGaps(db: ReturnType<typeof drizzle>): Promise<GapCandidate[]> {
  const materials = await db
    .select({
      id: materialScheduleItems.id,
      title: materialScheduleItems.title,
      roomId: materialScheduleItems.roomId,
      roomName: rooms.roomName,
    })
    .from(materialScheduleItems)
    .leftJoin(rooms, eq(materialScheduleItems.roomId, rooms.id));
  if (materials.length === 0) return [];

  const linked = await db
    .select({ materialId: showroomStoreProducts.materialId })
    .from(showroomStoreProducts);
  const withProducts = new Set(linked.map((l) => l.materialId).filter((x): x is number => x != null));

  return materials
    .filter((m) => !withProducts.has(m.id))
    .map((m) => ({
      context: "product" as const,
      gapKey: `product:material:${m.id}`,
      roomId: m.roomId,
      roomName: m.roomName,
      name: `No products sourced for "${m.title}"`,
      description: `The material "${m.title}" has no showroom products linked yet.`,
      suggestedAction: `Run deep research to source products for ${m.title}.`,
      sourceSignal: { kind: "material-without-products", materialId: m.id },
    }));
}

/** Deterministic: product areas with no store coverage. */
async function detectShowroomGaps(db: ReturnType<typeof drizzle>): Promise<GapCandidate[]> {
  const areas = await db
    .select()
    .from(storeProductAreaDef)
    .where(eq(storeProductAreaDef.isActive, true));
  const covered = await db.select({ productAreaId: storePaMapping.productAreaId }).from(storePaMapping);
  const coveredIds = new Set(covered.map((r) => r.productAreaId));

  return areas
    .filter((a) => !coveredIds.has(a.id))
    .map((a) => ({
      context: "showroom" as const,
      gapKey: `showroom:area:${a.id}`,
      roomId: null,
      roomName: a.roomName,
      name: a.name,
      description: a.description ?? `No showroom covers ${a.name}.`,
      suggestedAction: `Discover Bay Area showrooms covering ${a.name}.`,
      sourceSignal: { kind: "product-area-uncovered", productAreaId: a.id },
    }));
}

/** POST /meta/gaps/analyze?context= — run detection + upsert. */
showroomGapsRouter.post("/meta/gaps/analyze", async (c) => {
  const context = c.req.query("context") as GapContext | undefined;
  if (!context || !["material", "product", "showroom"].includes(context)) {
    return c.json({ error: "context must be material | product | showroom" }, 400);
  }
  const db = drizzle(c.env.DB);

  let candidates: GapCandidate[];
  try {
    if (context === "material") candidates = await detectMaterialGaps(c.env, db);
    else if (context === "product") candidates = await detectProductGaps(db);
    else candidates = await detectShowroomGaps(db);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Gap detection failed" }, 500);
  }

  const inserted = await upsertGaps(db, context, candidates);

  const active = await db
    .select()
    .from(showroomGaps)
    .where(and(eq(showroomGaps.context, context), inArray(showroomGaps.status, ["open", "researching"])))
    .orderBy(sql`${showroomGaps.identifiedAt} desc`);

  return c.json({ context, detected: candidates.length, inserted, gaps: active });
});

/** GET /meta/gaps/list?context= — active gaps (open + researching). */
showroomGapsRouter.get("/meta/gaps/list", async (c) => {
  const context = c.req.query("context") as GapContext | undefined;
  const db = drizzle(c.env.DB);

  const conditions = [inArray(showroomGaps.status, ["open", "researching"])];
  if (context && ["material", "product", "showroom"].includes(context)) {
    conditions.push(eq(showroomGaps.context, context));
  }

  const gaps = await db
    .select()
    .from(showroomGaps)
    .where(and(...conditions))
    .orderBy(sql`${showroomGaps.identifiedAt} desc`);
  return c.json({ gaps });
});

/** POST /meta/gaps/dismiss — bulk mark non-gap (never resurface). */
showroomGapsRouter.post("/meta/gaps/dismiss", async (c) => {
  const db = drizzle(c.env.DB);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }).safeParse(body);
  if (!parsed.success) return c.json({ error: "ids must be a non-empty array of max 100 items" }, 400);

  await db
    .update(showroomGaps)
    .set({ status: "dismissed", dismissedAt: sql`(unixepoch())`, updatedAt: sql`(unixepoch())` })
    .where(inArray(showroomGaps.id, parsed.data.ids));
  return c.json({ success: true, dismissed: parsed.data.ids.length });
});

/**
 * POST /meta/gaps/research — bulk hand-off.
 * For material gaps, creates the material_schedule_items record we're researching
 * for, links it, marks the gap "researching", and stores a composed research
 * prompt. The actual sweep execution + auto-close lands with the Phase 6/7
 * deep-research engines (well-lit-path trigger).
 */
showroomGapsRouter.post("/meta/gaps/research", async (c) => {
  const db = drizzle(c.env.DB);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }).safeParse(body);
  if (!parsed.success) return c.json({ error: "ids must be a non-empty array of max 100 items" }, 400);

  const gaps = await db.select().from(showroomGaps).where(inArray(showroomGaps.id, parsed.data.ids));
  const queued: { gapId: number; materialId: number | null; prompt: string }[] = [];

  // Materialize the thing we're researching for (material-context gaps) in one
  // batched roundtrip instead of a sequential insert per gap.
  // Hard FK: a material must belong to a real room. The gap already carries the
  // AI-disambiguated `roomId` (persisted at detection) — only gaps with a room
  // get an auto-created material (others stay material-less, materialId null).
  const gapsNeedingMaterial = gaps.filter((g) => g.context === "material" && !g.materialId);
  const creatable = gapsNeedingMaterial.filter((g) => g.roomId != null);

  const insertedMaterials: { id: number }[] = [];
  if (creatable.length > 0) {
    const insertQueries = creatable.map((gap) =>
      db
        .insert(materialScheduleItems)
        .values({
          title: gap.name,
          roomId: gap.roomId as number,
          notes: `Auto-created from gap research. ${gap.description ?? ""}`.trim(),
        })
        .returning({ id: materialScheduleItems.id }),
    );
    for (let i = 0; i < insertQueries.length; i += CHUNK) {
      const chunk = await db.batch(
        insertQueries.slice(i, i + CHUNK) as [typeof insertQueries[number], ...typeof insertQueries],
      );
      for (const rows of chunk) insertedMaterials.push(...rows);
    }
  }

  // Map each creatable gap to its freshly-created material id (1:1, same order).
  const gapToMaterialId = new Map<number, number>();
  let insertIdx = 0;
  for (const gap of creatable) {
    const material = insertedMaterials[insertIdx++];
    if (material) gapToMaterialId.set(gap.id, material.id);
  }

  const updateQueries = [];
  for (const gap of gaps) {
    const materialId = gap.materialId ?? gapToMaterialId.get(gap.id) ?? null;
    const prompt = composeResearchPrompt(gap);
    queued.push({ gapId: gap.id, materialId, prompt });

    updateQueries.push(
      db
        .update(showroomGaps)
        .set({
          status: "researching",
          materialId,
          sourceSignalJson: JSON.stringify({
            ...(safeParseJson(gap.sourceSignalJson) ?? {}),
            researchPrompt: prompt,
          }),
          updatedAt: sql`(unixepoch())`,
        })
        .where(eq(showroomGaps.id, gap.id)),
    );
  }

  for (let i = 0; i < updateQueries.length; i += CHUNK) {
    await db.batch(updateQueries.slice(i, i + CHUNK) as [typeof updateQueries[number], ...typeof updateQueries]);
  }

  return c.json({ success: true, queued });
});

function composeResearchPrompt(gap: { context: string; name: string; roomName: string | null; description: string | null }): string {
  const room = gap.roomName ? ` for the ${gap.roomName}` : "";
  if (gap.context === "showroom") {
    return `Discover Bay Area showrooms that carry "${gap.name}"${room} for a high-end home renovation. Capture address, specialties, price tier, reviews, and trade-discount availability.`;
  }
  if (gap.context === "product") {
    return `Research specific products to satisfy "${gap.name}"${room}: best options for our specs/budget, reviews, gotchas, lead times, and Bay Area showrooms that stock them.`;
  }
  return `Research "${gap.name}"${room} for our renovation: typical specs to require, budget ranges, top products, compatibility gotchas, and Bay Area showrooms. ${gap.description ?? ""}`.trim();
}

function safeParseJson(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}
