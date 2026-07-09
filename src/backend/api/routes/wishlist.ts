/**
 * @fileoverview Wishlist API
 *
 * CRUD + convenience endpoints for the homeowner's "wants" layer over the
 * products/materials catalog (see `src/backend/db/schema/wishlist/*`).
 *
 * A wishlist item is a lightweight "save for later" record — it can be a
 * pure freeform idea, or it can be tied to a showroom product
 * (`showroom_store_products`) and/or an existing material schedule line
 * (`material_schedule_items`). When tied to a product, key display fields
 * (`title`, `price`, `imageUrl`) are denormalized onto the item at add-time
 * so the wishlist survives the underlying product/material being edited or
 * removed (both FKs are nullable + set-null on delete).
 *
 * Room scoping: `roomId` NULL means the item lives in the "All rooms"
 * bucket (paint colors, drywall texture, lighting styles — anything that
 * isn't scoped to a single space). `GET /grouped` surfaces this split
 * directly for the UI (per-room groups + an `allRooms` bucket).
 *
 * Collections are a separate, cross-room curation layer: a named bucket
 * (`wishlist_collections`) with M:N membership via
 * `wishlist_collection_items`. A single item can belong to many
 * collections regardless of its room.
 *
 * Mounts at /api/wishlist (see `src/backend/api/index.ts`). Plain Hono,
 * mirroring the style of `worker-emails.ts` / `materials.ts` — not
 * zod-openapi.
 */

import { Hono } from "hono";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { wishlistItems } from "@backend/db/schema/wishlist/wishlist_items";
import { wishlistCollections } from "@backend/db/schema/wishlist/wishlist_collections";
import { wishlistCollectionItems } from "@backend/db/schema/wishlist/wishlist_collection_items";
import { showroomStoreProducts } from "@backend/db/schema/showroom/store_products";
import { productImages } from "@backend/db/schema/showroom/product_images";
import { materialScheduleItems } from "@backend/db/schema/materials/schedule_item";
import { rooms } from "@backend/db/schema/home/rooms";

export const wishlistRouter = new Hono<{ Bindings: Env }>();

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse a route/query param as a positive integer id, or null if invalid. */
function parseId(raw: string | undefined | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Resolve a product's thumbnail: prefer the earliest-added *approved* image,
 * degrade to the earliest-added image of any review status, degrade to null
 * if the product has no images at all.
 */
async function resolveProductThumbnail(
  db: ReturnType<typeof drizzle>,
  storeProductId: number,
): Promise<string | null> {
  const [approved] = await db
    .select({ deliveryUrl: productImages.deliveryUrl })
    .from(productImages)
    .where(
      and(
        eq(productImages.storeProductId, storeProductId),
        eq(productImages.reviewStatus, "approved"),
      ),
    )
    .orderBy(productImages.id)
    .limit(1);
  if (approved) return approved.deliveryUrl;

  const [any] = await db
    .select({ deliveryUrl: productImages.deliveryUrl })
    .from(productImages)
    .where(eq(productImages.storeProductId, storeProductId))
    .orderBy(productImages.id)
    .limit(1);
  return any?.deliveryUrl ?? null;
}

/** Look up a room's display name (or null). */
async function resolveRoomName(
  db: ReturnType<typeof drizzle>,
  roomId: number | null | undefined,
): Promise<string | null> {
  if (!roomId) return null;
  const [room] = await db
    .select({ roomName: rooms.roomName })
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .limit(1);
  return room?.roomName ?? null;
}

const createItemSchema = z.object({
  title: z.string().min(1).optional(),
  roomId: z.number().int().positive().optional().nullable(),
  showroomStoreProductId: z.number().int().positive().optional().nullable(),
  materialScheduleItemId: z.number().int().positive().optional().nullable(),
  imageUrl: z.string().min(1).optional().nullable(),
  price: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.string().min(1).optional(),
});

const updateItemSchema = z.object({
  title: z.string().min(1).optional(),
  roomId: z.number().int().positive().optional().nullable(),
  status: z.string().min(1).optional(),
  notes: z.string().optional().nullable(),
  priority: z.number().int().optional().nullable(),
  materialScheduleItemId: z.number().int().positive().optional().nullable(),
  showroomStoreProductId: z.number().int().positive().optional().nullable(),
  imageUrl: z.string().min(1).optional().nullable(),
  price: z.number().optional().nullable(),
});

const fromProductSchema = z.object({
  roomId: z.number().int().positive().optional().nullable(),
});

const createCollectionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  coverImageUrl: z.string().min(1).optional().nullable(),
});

const updateCollectionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  coverImageUrl: z.string().min(1).optional().nullable(),
  isShared: z.boolean().optional(),
});

const addCollectionItemSchema = z.object({
  wishlistItemId: z.number().int().positive(),
});

// ═══════════════════════════════════════════════════════════════════════════
// Items
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET / — List wishlist items.
 *
 * Query params (all optional):
 *   roomId       — filter to a single room (integer)
 *   status       — filter to a lifecycle status (exact match)
 *   collectionId — filter to items that belong to a collection (integer)
 *   unroomed     — "true" → only items with roomId IS NULL (the "All rooms" bucket)
 *
 * Ordered by priority ascending (nulls last), then createdAt descending.
 * Each row is annotated with `roomName` when it has a roomId.
 */
wishlistRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);

  const roomIdRaw = c.req.query("roomId");
  const status = c.req.query("status");
  const collectionIdRaw = c.req.query("collectionId");
  const unroomed = c.req.query("unroomed") === "true";

  let roomId: number | null = null;
  if (roomIdRaw !== undefined) {
    roomId = parseId(roomIdRaw);
    if (roomId === null) return c.json({ error: "Invalid roomId" }, 400);
  }

  let collectionId: number | null = null;
  if (collectionIdRaw !== undefined) {
    collectionId = parseId(collectionIdRaw);
    if (collectionId === null) return c.json({ error: "Invalid collectionId" }, 400);
  }

  let itemIdsInCollection: number[] | null = null;
  if (collectionId !== null) {
    const rows = await db
      .select({ wishlistItemId: wishlistCollectionItems.wishlistItemId })
      .from(wishlistCollectionItems)
      .where(eq(wishlistCollectionItems.collectionId, collectionId));
    itemIdsInCollection = rows.map((r) => r.wishlistItemId);
    if (itemIdsInCollection.length === 0) {
      return c.json({ items: [] });
    }
  }

  const conditions = [];
  if (unroomed) {
    conditions.push(isNull(wishlistItems.roomId));
  } else if (roomId !== null) {
    conditions.push(eq(wishlistItems.roomId, roomId));
  }
  if (status) conditions.push(eq(wishlistItems.status, status));

  let query = db
    .select()
    .from(wishlistItems)
    .orderBy(
      sql`CASE WHEN ${wishlistItems.priority} IS NULL THEN 1 ELSE 0 END`,
      wishlistItems.priority,
      desc(wishlistItems.createdAt),
    )
    .$dynamic();

  if (conditions.length > 0) query = query.where(and(...conditions));

  let rowsResult = await query;

  if (itemIdsInCollection !== null) {
    const idSet = new Set(itemIdsInCollection);
    rowsResult = rowsResult.filter((item) => idSet.has(item.id));
  }

  // Annotate roomName for items that have a roomId.
  const roomIds = [...new Set(rowsResult.map((i) => i.roomId).filter((id): id is number => id != null))];
  const roomNameById = new Map<number, string>();
  if (roomIds.length > 0) {
    const roomRows = await db
      .select({ id: rooms.id, roomName: rooms.roomName })
      .from(rooms);
    for (const r of roomRows) {
      if (roomIds.includes(r.id)) roomNameById.set(r.id, r.roomName);
    }
  }

  const items = rowsResult.map((item) => ({
    ...item,
    roomName: item.roomId != null ? roomNameById.get(item.roomId) ?? null : null,
  }));

  return c.json({ items });
});

/**
 * GET /grouped — Items grouped by room for the wishlist board UI.
 *
 * Returns:
 *   { rooms: [{ roomId, roomName, items }], allRooms: [...] }
 * `allRooms` holds items with roomId NULL (paint/drywall/lighting/etc.).
 * `rooms` only includes rooms that currently have at least one item.
 */
wishlistRouter.get("/grouped", async (c) => {
  const db = drizzle(c.env.DB);

  const allItems = await db
    .select()
    .from(wishlistItems)
    .orderBy(
      sql`CASE WHEN ${wishlistItems.priority} IS NULL THEN 1 ELSE 0 END`,
      wishlistItems.priority,
      desc(wishlistItems.createdAt),
    );

  const allRooms = allItems.filter((i) => i.roomId == null);
  const roomedItems = allItems.filter((i) => i.roomId != null);

  const roomIds = [...new Set(roomedItems.map((i) => i.roomId as number))];
  const roomNameById = new Map<number, string>();
  if (roomIds.length > 0) {
    const roomRows = await db
      .select({ id: rooms.id, roomName: rooms.roomName })
      .from(rooms);
    for (const r of roomRows) {
      if (roomIds.includes(r.id)) roomNameById.set(r.id, r.roomName);
    }
  }

  const byRoom = new Map<number, (typeof roomedItems)[number][]>();
  for (const item of roomedItems) {
    const rid = item.roomId as number;
    const bucket = byRoom.get(rid) ?? [];
    bucket.push(item);
    byRoom.set(rid, bucket);
  }

  const roomsGrouped = [...byRoom.entries()].map(([roomId, items]) => ({
    roomId,
    roomName: roomNameById.get(roomId) ?? null,
    items,
  }));

  return c.json({ rooms: roomsGrouped, allRooms });
});

/**
 * POST / — Create a wishlist item.
 *
 * Body: { title?, roomId?, showroomStoreProductId?, materialScheduleItemId?,
 *         imageUrl?, price?, notes?, status? }
 *
 * Denormalization:
 *   - showroomStoreProductId set → look up the product; fill missing
 *     title (item_name), price, and imageUrl (earliest product image).
 *   - materialScheduleItemId set and roomId omitted → inherit the
 *     material's roomId.
 *   - `title` must end up non-empty (400 if it can't be derived).
 *   - status defaults to "wishlist".
 */
wishlistRouter.post("/", async (c) => {
  const db = drizzle(c.env.DB);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = createItemSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }
  const data = parsed.data;

  let title = data.title ?? null;
  let price = data.price ?? null;
  let imageUrl = data.imageUrl ?? null;
  let roomId = data.roomId ?? null;

  if (data.showroomStoreProductId) {
    const [product] = await db
      .select()
      .from(showroomStoreProducts)
      .where(eq(showroomStoreProducts.id, data.showroomStoreProductId))
      .limit(1);
    if (!product) return c.json({ error: "Showroom product not found" }, 404);

    if (!title) title = product.itemName;
    if (price == null && product.price != null) {
      const parsedPrice = Number(product.price);
      price = Number.isNaN(parsedPrice) ? null : parsedPrice;
    }
    if (!imageUrl) {
      imageUrl = await resolveProductThumbnail(db, data.showroomStoreProductId);
    }
  }

  if (data.materialScheduleItemId) {
    const [material] = await db
      .select()
      .from(materialScheduleItems)
      .where(eq(materialScheduleItems.id, data.materialScheduleItemId))
      .limit(1);
    if (!material) return c.json({ error: "Material schedule item not found" }, 404);

    if (!title) title = material.title;
    if (roomId == null && material.roomId != null) roomId = material.roomId;
  }

  if (!title || !title.trim()) {
    return c.json(
      { error: "title is required (or must be derivable from the linked product/material)" },
      400,
    );
  }

  const [item] = await db
    .insert(wishlistItems)
    .values({
      title,
      roomId: roomId ?? null,
      showroomStoreProductId: data.showroomStoreProductId ?? null,
      materialScheduleItemId: data.materialScheduleItemId ?? null,
      imageUrl,
      price,
      notes: data.notes ?? null,
      status: data.status ?? "wishlist",
    })
    .returning();

  return c.json({ item }, 201);
});

/**
 * POST /from-product/:productId — convenience add-from-catalog.
 *
 * Body: { roomId? }
 *
 * Creates an item from a showroom product in one call:
 *   title = item_name, price = product.price, imageUrl = earliest product
 *   image, showroomStoreProductId = productId,
 *   materialScheduleItemId = product.materialId (if set),
 *   roomId = body.roomId ?? (the linked material's roomId, if any) ?? null.
 */
wishlistRouter.post("/from-product/:productId", async (c) => {
  const productId = parseId(c.req.param("productId"));
  if (productId === null) return c.json({ error: "Invalid productId" }, 400);

  const db = drizzle(c.env.DB);

  let body: unknown = {};
  try {
    const raw = await c.req.text();
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = fromProductSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const [product] = await db
    .select()
    .from(showroomStoreProducts)
    .where(eq(showroomStoreProducts.id, productId))
    .limit(1);
  if (!product) return c.json({ error: "Showroom product not found" }, 404);

  const imageUrl = await resolveProductThumbnail(db, productId);

  let price: number | null = null;
  if (product.price != null) {
    const parsedPrice = Number(product.price);
    price = Number.isNaN(parsedPrice) ? null : parsedPrice;
  }

  let roomId = parsed.data.roomId ?? null;
  if (roomId == null && product.materialId != null) {
    const [material] = await db
      .select({ roomId: materialScheduleItems.roomId })
      .from(materialScheduleItems)
      .where(eq(materialScheduleItems.id, product.materialId))
      .limit(1);
    roomId = material?.roomId ?? null;
  }

  const [item] = await db
    .insert(wishlistItems)
    .values({
      title: product.itemName,
      price,
      imageUrl,
      showroomStoreProductId: productId,
      materialScheduleItemId: product.materialId ?? null,
      roomId,
      status: "wishlist",
    })
    .returning();

  return c.json({ item }, 201);
});

/**
 * PATCH /:id — Update editable fields on a wishlist item.
 */
wishlistRouter.patch("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid item id" }, 400);

  const db = drizzle(c.env.DB);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = updateItemSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const [item] = await db
    .update(wishlistItems)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(wishlistItems.id, id))
    .returning();
  if (!item) return c.json({ error: "Wishlist item not found" }, 404);

  return c.json({ item });
});

/**
 * DELETE /:id — Delete a wishlist item.
 */
wishlistRouter.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid item id" }, 400);

  const db = drizzle(c.env.DB);

  const [deleted] = await db
    .delete(wishlistItems)
    .where(eq(wishlistItems.id, id))
    .returning();
  if (!deleted) return c.json({ error: "Wishlist item not found" }, 404);

  return c.json({ success: true });
});

/**
 * POST /:id/promote-to-material — Promote a wishlist item to a real
 * material_schedule_items row.
 *
 * Creates { title: item.title, roomName: <room's name if roomId set>,
 * isPurchased: false }, then links the item back via materialScheduleItemId
 * and sets status="chosen". Idempotent: if the item already has a
 * materialScheduleItemId, the existing material is returned instead of
 * creating a duplicate.
 */
wishlistRouter.post("/:id/promote-to-material", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid item id" }, 400);

  const db = drizzle(c.env.DB);

  const [item] = await db
    .select()
    .from(wishlistItems)
    .where(eq(wishlistItems.id, id))
    .limit(1);
  if (!item) return c.json({ error: "Wishlist item not found" }, 404);

  if (item.materialScheduleItemId) {
    const [existingMaterial] = await db
      .select()
      .from(materialScheduleItems)
      .where(eq(materialScheduleItems.id, item.materialScheduleItemId))
      .limit(1);
    return c.json({ material: existingMaterial ?? null, item });
  }

  const roomName = await resolveRoomName(db, item.roomId);

  const [material] = await db
    .insert(materialScheduleItems)
    .values({
      title: item.title,
      roomName,
      roomId: item.roomId ?? null,
      isPurchased: false,
    })
    .returning();

  const [updatedItem] = await db
    .update(wishlistItems)
    .set({
      materialScheduleItemId: material.id,
      status: "chosen",
      updatedAt: new Date(),
    })
    .where(eq(wishlistItems.id, id))
    .returning();

  return c.json({ material, item: updatedItem });
});

// ═══════════════════════════════════════════════════════════════════════════
// Collections
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /collections — List collections, each annotated with an `itemCount`.
 */
wishlistRouter.get("/collections", async (c) => {
  const db = drizzle(c.env.DB);

  const collections = await db
    .select()
    .from(wishlistCollections)
    .orderBy(desc(wishlistCollections.createdAt));

  const counts = await db
    .select({
      collectionId: wishlistCollectionItems.collectionId,
      count: sql<number>`count(*)`,
    })
    .from(wishlistCollectionItems)
    .groupBy(wishlistCollectionItems.collectionId);

  const countById = new Map(counts.map((row) => [row.collectionId, Number(row.count)]));

  const result = collections.map((collection) => ({
    ...collection,
    itemCount: countById.get(collection.id) ?? 0,
  }));

  return c.json({ collections: result });
});

/**
 * POST /collections — Create a collection. `name` is required.
 */
wishlistRouter.post("/collections", async (c) => {
  const db = drizzle(c.env.DB);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = createCollectionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const [collection] = await db
    .insert(wishlistCollections)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      coverImageUrl: parsed.data.coverImageUrl ?? null,
    })
    .returning();

  return c.json({ collection }, 201);
});

/**
 * GET /collections/:id — A collection plus its member items (joined through
 * wishlist_collection_items).
 */
wishlistRouter.get("/collections/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid collection id" }, 400);

  const db = drizzle(c.env.DB);

  const [collection] = await db
    .select()
    .from(wishlistCollections)
    .where(eq(wishlistCollections.id, id))
    .limit(1);
  if (!collection) return c.json({ error: "Collection not found" }, 404);

  const items = await db
    .select({ item: wishlistItems })
    .from(wishlistCollectionItems)
    .innerJoin(wishlistItems, eq(wishlistCollectionItems.wishlistItemId, wishlistItems.id))
    .where(eq(wishlistCollectionItems.collectionId, id))
    .orderBy(desc(wishlistCollectionItems.createdAt));

  return c.json({ collection, items: items.map((row) => row.item) });
});

/**
 * PATCH /collections/:id — Update name/description/coverImageUrl/isShared.
 */
wishlistRouter.patch("/collections/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid collection id" }, 400);

  const db = drizzle(c.env.DB);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = updateCollectionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const [collection] = await db
    .update(wishlistCollections)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(wishlistCollections.id, id))
    .returning();
  if (!collection) return c.json({ error: "Collection not found" }, 404);

  return c.json({ collection });
});

/**
 * DELETE /collections/:id — Delete a collection (cascades its join rows).
 */
wishlistRouter.delete("/collections/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid collection id" }, 400);

  const db = drizzle(c.env.DB);

  const [deleted] = await db
    .delete(wishlistCollections)
    .where(eq(wishlistCollections.id, id))
    .returning();
  if (!deleted) return c.json({ error: "Collection not found" }, 404);

  return c.json({ success: true });
});

/**
 * POST /collections/:id/items — Add a wishlist item to a collection.
 *
 * Body: { wishlistItemId }. Idempotent: the (collectionId, wishlistItemId)
 * pair is unique-indexed at the schema level, so if the membership already
 * exists this returns the existing row rather than erroring.
 */
wishlistRouter.post("/collections/:id/items", async (c) => {
  const collectionId = parseId(c.req.param("id"));
  if (collectionId === null) return c.json({ error: "Invalid collection id" }, 400);

  const db = drizzle(c.env.DB);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = addCollectionItemSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.issues }, 400);
  }

  const [collection] = await db
    .select()
    .from(wishlistCollections)
    .where(eq(wishlistCollections.id, collectionId))
    .limit(1);
  if (!collection) return c.json({ error: "Collection not found" }, 404);

  const [item] = await db
    .select()
    .from(wishlistItems)
    .where(eq(wishlistItems.id, parsed.data.wishlistItemId))
    .limit(1);
  if (!item) return c.json({ error: "Wishlist item not found" }, 404);

  const [existing] = await db
    .select()
    .from(wishlistCollectionItems)
    .where(
      and(
        eq(wishlistCollectionItems.collectionId, collectionId),
        eq(wishlistCollectionItems.wishlistItemId, parsed.data.wishlistItemId),
      ),
    )
    .limit(1);
  if (existing) {
    return c.json({ collectionItem: existing, alreadyExists: true });
  }

  const [collectionItem] = await db
    .insert(wishlistCollectionItems)
    .values({
      collectionId,
      wishlistItemId: parsed.data.wishlistItemId,
    })
    .returning();

  return c.json({ collectionItem, alreadyExists: false }, 201);
});

/**
 * DELETE /collections/:id/items/:wishlistItemId — Remove a wishlist item
 * from a collection (leaves the item itself untouched).
 */
wishlistRouter.delete("/collections/:id/items/:wishlistItemId", async (c) => {
  const collectionId = parseId(c.req.param("id"));
  const wishlistItemId = parseId(c.req.param("wishlistItemId"));
  if (collectionId === null || wishlistItemId === null) {
    return c.json({ error: "Invalid collection id or wishlist item id" }, 400);
  }

  const db = drizzle(c.env.DB);

  const [deleted] = await db
    .delete(wishlistCollectionItems)
    .where(
      and(
        eq(wishlistCollectionItems.collectionId, collectionId),
        eq(wishlistCollectionItems.wishlistItemId, wishlistItemId),
      ),
    )
    .returning();
  if (!deleted) return c.json({ error: "Collection membership not found" }, 404);

  return c.json({ success: true });
});
