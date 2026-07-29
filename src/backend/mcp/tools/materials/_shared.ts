/**
 * @fileoverview Shared helpers for the Materials MCP tools.
 */
import {
  categories,
  materialCategories,
  materialScheduleItems,
  materialSubcategories,
  rooms,
  subcategories,
} from "@backend/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { type RemodelTool } from "../../types";

type Db = Parameters<RemodelTool["handler"]>[0]["db"];

/** Shape a material row for tool output. `roomName` is derived (joined from `rooms`). */
export function materialDto(m: typeof materialScheduleItems.$inferSelect, roomName: string | null) {
  return {
    id: m.id,
    title: m.title,
    roomId: m.roomId,
    roomName,
    notes: m.notes,
    isPurchased: m.isPurchased ?? false,
    isReturned: m.isReturned ?? false,
    isActive: m.isActive ?? true,
    productId: m.productId,
  };
}

/** Output schema mirroring `materialDto` — used by every tool that returns one. */
export const materialDtoSchema = looseObject({
  id: z.number().int(),
  title: z.string().nullable(),
  roomId: z.number().int(),
  roomName: z.string().nullable(),
  notes: z.string().nullable(),
  isPurchased: z.boolean(),
  isReturned: z.boolean(),
  isActive: z.boolean(),
  productId: z.number().int().nullable(),
});

/** A category/subcategory reference as returned on a material (name JOINED, never stored). */
export const taxonomyRefSchema = looseObject({ id: z.number().int(), name: z.string() });

/** Material DTO plus its joined category/subcategory mappings — used by the read tools. */
export const materialWithTaxonomySchema = materialDtoSchema.extend({
  categories: z.array(taxonomyRefSchema),
  subcategories: z.array(taxonomyRefSchema),
});

/**
 * Validate that every supplied category/subcategory id EXISTS and is ACTIVE.
 * Throws a tool error naming the bad ids — a hallucinated id must never reach a
 * FK column (AGENTS.md "AI calls: return primary keys, not display names").
 */
export async function assertActiveTaxonomyIds(
  db: Db,
  categoryIds?: number[],
  subcategoryIds?: number[],
): Promise<void> {
  const catIds = [...new Set(categoryIds ?? [])];
  if (catIds.length > 0) {
    const rows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(inArray(categories.id, catIds), eq(categories.isActive, true)))
      .all();
    const ok = new Set(rows.map((r) => r.id));
    const bad = catIds.filter((id) => !ok.has(id));
    if (bad.length > 0) {
      toolError(
        `Unknown or inactive category id(s): ${bad.join(", ")}. Call list_material_categories for valid ids.`,
      );
    }
  }

  const subIds = [...new Set(subcategoryIds ?? [])];
  if (subIds.length > 0) {
    const rows = await db
      .select({ id: subcategories.id })
      .from(subcategories)
      .where(and(inArray(subcategories.id, subIds), eq(subcategories.isActive, true)))
      .all();
    const ok = new Set(rows.map((r) => r.id));
    const bad = subIds.filter((id) => !ok.has(id));
    if (bad.length > 0) {
      toolError(
        `Unknown or inactive subcategory id(s): ${bad.join(", ")}. Call list_material_categories for valid ids.`,
      );
    }
  }
}

/**
 * Replace a material's category/subcategory mappings (delete-then-insert, never
 * append). Pass `undefined` for a dimension to leave it untouched. Ids MUST have
 * been validated with `assertActiveTaxonomyIds` first.
 *
 * ponytail: the delete and the insert are separate batches — D1 has no
 * transactions and a batch cannot be built conditionally mid-flight. A failed
 * insert therefore leaves the mappings cleared rather than half-written, which
 * is the recoverable direction (re-call with the same ids).
 */
export async function replaceTaxonomyMappings(
  db: Db,
  materialId: number,
  categoryIds?: number[],
  subcategoryIds?: number[],
): Promise<void> {
  if (categoryIds) {
    await db.delete(materialCategories).where(eq(materialCategories.materialId, materialId)).run();
    const stmts = [...new Set(categoryIds)].map((categoryId) =>
      db.insert(materialCategories).values({ materialId, categoryId }),
    );
    if (stmts.length > 0) {
      await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
    }
  }
  if (subcategoryIds) {
    await db
      .delete(materialSubcategories)
      .where(eq(materialSubcategories.materialId, materialId))
      .run();
    const stmts = [...new Set(subcategoryIds)].map((subcategoryId) =>
      db.insert(materialSubcategories).values({ materialId, subcategoryId }),
    );
    if (stmts.length > 0) {
      await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
    }
  }
}

/**
 * D1 caps a statement at 100 bound parameters, and `inArray` binds one per id.
 * `list_materials` allows a limit of 200, so an unchunked lookup over a full
 * page raises a runtime error the moment this project has >100 materials —
 * invisible today with a handful of rows, a 500 later.
 *
 * Runs `fetchChunk` over slices of at most 90 ids and concatenates the rows.
 */
async function inChunks<T>(
  ids: number[],
  fetchChunk: (chunk: number[]) => Promise<T[]>,
): Promise<T[]> {
  const CHUNK = 90;
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    out.push(...(await fetchChunk(ids.slice(i, i + CHUNK))));
  }
  return out;
}

/** Joined category/subcategory names per material id — two queries, no N+1. */
export async function taxonomyMap(
  db: Db,
  materialIds: number[],
): Promise<Map<number, { categories: { id: number; name: string }[]; subcategories: { id: number; name: string }[] }>> {
  const out = new Map<
    number,
    { categories: { id: number; name: string }[]; subcategories: { id: number; name: string }[] }
  >();
  const ids = [...new Set(materialIds)];
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, { categories: [], subcategories: [] });

  const catRows = await inChunks(ids, (chunk) =>
    db
      .select({
        materialId: materialCategories.materialId,
        id: categories.id,
        name: categories.name,
      })
      .from(materialCategories)
      .innerJoin(categories, eq(materialCategories.categoryId, categories.id))
      .where(inArray(materialCategories.materialId, chunk))
      .all(),
  );
  for (const r of catRows) out.get(r.materialId)?.categories.push({ id: r.id, name: r.name });

  const subRows = await inChunks(ids, (chunk) =>
    db
      .select({
        materialId: materialSubcategories.materialId,
        id: subcategories.id,
        name: subcategories.name,
      })
      .from(materialSubcategories)
      .innerJoin(subcategories, eq(materialSubcategories.subcategoryId, subcategories.id))
      .where(inArray(materialSubcategories.materialId, chunk))
      .all(),
  );
  for (const r of subRows) out.get(r.materialId)?.subcategories.push({ id: r.id, name: r.name });

  return out;
}

/** Resolve room ids to display names in one query (for the derived `roomName`). */
export async function roomNameMap(
  db: Db,
  roomIds: number[],
): Promise<Map<number, string>> {
  const ids = [...new Set(roomIds)];
  if (ids.length === 0) return new Map();
  const rows = await inChunks(ids, (chunk) =>
    db
      .select({ id: rooms.id, roomName: rooms.roomName })
      .from(rooms)
      .where(inArray(rooms.id, chunk))
      .all(),
  );
  return new Map(rows.map((r) => [r.id, r.roomName]));
}
