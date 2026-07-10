/**
 * @fileoverview MCP tools — Materials domain.
 *
 * Read + write access to the home's material schedule (`material_schedule_items`) —
 * the master list of materials/components to source for the renovation (e.g.
 * "Induction cooktop", "Primary closet system"). This is the seed that feeds
 * downstream showroom discovery, product sourcing, gap analysis, and research.
 *
 * A material carries a required-spec sheet (`material_required_specs`), a
 * REQUIRED canonical room (`material_schedule_items.roomId` → `rooms.id`, hard
 * FK; the display name is derived by joining `rooms`), budget-line attributions
 * (`budget_item_material_mappings`, keyed by the STABLE budget `trackId`), and
 * mapped showroom products (`product_material_mappings`).
 *
 * These tools never delete materials; they only list, inspect, create, patch,
 * spec, and link. Deletion happens through the material-schedule admin UI.
 */
import {
  budgetItemMaterialMappings,
  budgetTrackerItems,
  materialRequiredSpecs,
  materialScheduleItems,
  productMaterialMappings,
  rooms,
} from "@backend/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { matchesQuery, paginate, toolError } from "../format";
import { looseObject, pageOutput, urlField } from "../schemas";
import { defineTool, READ_ONLY, WRITE, WRITE_IDEMPOTENT, type RemodelTool } from "../types";
import { materialUrl } from "../urls";

/** Shape a material row for tool output. `roomName` is derived (joined from `rooms`). */
function materialDto(m: typeof materialScheduleItems.$inferSelect, roomName: string | null) {
  return {
    id: m.id,
    title: m.title,
    roomId: m.roomId,
    roomName,
    brand: m.brand,
    model: m.model,
    notes: m.notes,
    isPurchased: m.isPurchased ?? false,
    purchasedShowroomProductId: m.purchasedShowroomProductId,
  };
}

/** Output schema mirroring `materialDto` — used by every tool that returns one. */
const materialDtoSchema = looseObject({
  id: z.number().int(),
  title: z.string().nullable(),
  roomId: z.number().int(),
  roomName: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  notes: z.string().nullable(),
  isPurchased: z.boolean(),
  purchasedShowroomProductId: z.number().int().nullable(),
});

/** Resolve room ids to display names in one query (for the derived `roomName`). */
async function roomNameMap(
  db: Parameters<RemodelTool["handler"]>[0]["db"],
  roomIds: number[],
): Promise<Map<number, string>> {
  const ids = [...new Set(roomIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: rooms.id, roomName: rooms.roomName })
    .from(rooms)
    .where(inArray(rooms.id, ids))
    .all();
  return new Map(rows.map((r) => [r.id, r.roomName]));
}

export const materialTools: RemodelTool[] = [
  defineTool({
    name: "list_materials",
    category: "materials",
    title: "List materials",
    description:
      "List material schedule items (id, title, room, brand, model, purchased flag). Optional filters: `roomId` (canonical room FK), `isPurchased` (bool), `brand` (exact, case-insensitive), and free-text `q` over title/brand/model/notes. Use a material's `id` as the target for get_material, spec, and link tools.",
    inputShape: {
      roomId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Only materials linked to this canonical room id (from list_rooms)"),
      isPurchased: z
        .boolean()
        .optional()
        .describe("Filter by purchased status; omit to include both"),
      brand: z.string().optional().describe("Exact brand match (case-insensitive)"),
      q: z.string().optional().describe("Free-text filter over title / brand / model / notes"),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      ...pageOutput(materialDtoSchema),
    },
    examples: [
      { title: "All materials", args: {} },
      { title: "Unpurchased items in a room", args: { roomId: 3, isPurchased: false } },
      { title: "Search by keyword", args: { q: "cooktop" } },
    ],
    handler: async ({ db }, input) => {
      const all = await db.select().from(materialScheduleItems).all();
      const brandNeedle = input.brand?.trim().toLowerCase();
      const filtered = all.filter((m) => {
        if (input.roomId != null && m.roomId !== input.roomId) return false;
        if (input.isPurchased != null && (m.isPurchased ?? false) !== input.isPurchased) return false;
        if (brandNeedle && (m.brand ?? "").toLowerCase() !== brandNeedle) return false;
        if (input.q && !matchesQuery([m.title, m.brand, m.model, m.notes], input.q)) return false;
        return true;
      });
      const roomName = await roomNameMap(db, filtered.map((m) => m.roomId));
      return paginate(
        filtered.map((m) => materialDto(m, roomName.get(m.roomId) ?? null)),
        input.limit ?? 50,
        input.offset ?? 0,
      );
    },
  }),

  defineTool({
    name: "get_material",
    category: "materials",
    title: "Get material detail",
    description:
      "Full detail for one material by `id`: its required spec sheet, the canonical room it is linked to (roomId → room name), the ACTIVE budget line items it rolls up to (via budget_item_material_mappings → the stable budget trackId), and the showroom products mapped to it.",
    inputShape: {
      id: z.number().int().positive().describe("Material id (from list_materials)"),
    },
    annotations: READ_ONLY,
    outputShape: {
      ...materialDtoSchema.shape,
      room: looseObject({ id: z.number().int(), roomName: z.string() }).nullable(),
      requiredSpecs: z.array(looseObject({ id: z.number().int(), key: z.string(), value: z.string() })),
      budgetItems: z.array(
        looseObject({
          id: z.number().int(),
          trackId: z.string(),
          title: z.string(),
          status: z.string(),
        }),
      ),
      products: z.array(
        looseObject({ productId: z.number().int(), isPrimary: z.boolean().nullable() }),
      ),
    },
    examples: [{ title: "By id", args: { id: 1 } }],
    handler: async ({ db }, input) => {
      const [material] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, input.id))
        .limit(1);
      if (!material) {
        toolError(`Material ${input.id} not found. Call list_materials for valid ids.`);
      }

      // Required specs.
      const specs = await db
        .select()
        .from(materialRequiredSpecs)
        .where(eq(materialRequiredSpecs.materialId, material.id))
        .all();

      // Linked canonical room (name derived by joining rooms).
      let room: { id: number; roomName: string } | null = null;
      const [r] = await db.select().from(rooms).where(eq(rooms.id, material.roomId)).limit(1);
      if (r) room = { id: r.id, roomName: r.roomName };

      // Budget lines: mappings carry the stable trackId; resolve to ACTIVE rows.
      const budgetLinks = await db
        .select()
        .from(budgetItemMaterialMappings)
        .where(eq(budgetItemMaterialMappings.materialId, material.id))
        .all();
      const trackIds = budgetLinks.map((l) => l.budgetItemTrackId);
      let budgetItems: { id: number; trackId: string; title: string; status: string }[] = [];
      if (trackIds.length > 0) {
        const activeRows = await db
          .select()
          .from(budgetTrackerItems)
          .where(
            and(
              inArray(budgetTrackerItems.trackId, trackIds),
              eq(budgetTrackerItems.isActive, true),
            ),
          )
          .all();
        budgetItems = activeRows.map((b) => ({
          id: b.id,
          trackId: b.trackId,
          title: b.title,
          status: b.status,
        }));
      }

      // Mapped showroom products.
      const productLinks = await db
        .select()
        .from(productMaterialMappings)
        .where(eq(productMaterialMappings.materialId, material.id))
        .all();

      return {
        ...materialDto(material, room?.roomName ?? null),
        room,
        requiredSpecs: specs.map((s) => ({ id: s.id, key: s.key, value: s.value })),
        budgetItems,
        products: productLinks.map((p) => ({
          productId: p.productId,
          isPrimary: p.isPrimary,
        })),
      };
    },
  }),

  defineTool({
    name: "create_material",
    category: "materials",
    title: "Create material",
    description:
      "Add a new material schedule item. `title` and `roomId` are required — every material belongs to a canonical room (hard FK, validated). Optionally set `brand`, `model`, `notes`. The room's display name is derived on read; there is no freeform room label.",
    inputShape: {
      title: z.string().min(1).describe("Material name, e.g. \"Induction cooktop\""),
      roomId: z
        .number()
        .int()
        .positive()
        .describe("Canonical room id this material belongs to (from list_rooms) — required"),
      brand: z.string().optional(),
      model: z.string().optional(),
      notes: z.string().optional(),
    },
    annotations: WRITE,
    outputShape: {
      created: z.boolean(),
      material: materialDtoSchema,
      url: urlField,
    },
    examples: [
      { title: "Roomed + branded", args: { title: "Toilet", roomId: 3, brand: "Kohler", model: "K-3999" } },
    ],
    handler: async ({ env, db }, input) => {
      const [r] = await db.select().from(rooms).where(eq(rooms.id, input.roomId)).limit(1);
      if (!r) toolError(`Room ${input.roomId} not found. Call list_rooms for valid ids.`);
      const [created] = await db
        .insert(materialScheduleItems)
        .values({
          title: input.title,
          roomId: input.roomId,
          brand: input.brand ?? null,
          model: input.model ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      return { created: true, material: materialDto(created, r.roomName), url: materialUrl(env, created.id) };
    },
  }),

  defineTool({
    name: "update_material",
    category: "materials",
    title: "Update material",
    description:
      "Patch a material's fields. Only the fields you pass are changed. Editable: title, roomId (canonical room FK, validated), brand, model, notes, isPurchased. To record a purchase with its product, prefer mark_material_purchased.",
    inputShape: {
      id: z.number().int().positive().describe("Material id (from list_materials)"),
      title: z.string().min(1).optional(),
      roomId: z.number().int().positive().optional().describe("Canonical room id (validated if passed)"),
      brand: z.string().optional(),
      model: z.string().optional(),
      notes: z.string().optional(),
      isPurchased: z.boolean().optional(),
    },
    annotations: WRITE,
    outputShape: {
      updated: z.boolean(),
      material: materialDtoSchema,
      url: urlField,
    },
    examples: [
      { title: "Set brand + model", args: { id: 5, brand: "Bosch", model: "NIT8069UC" } },
      { title: "Append a note", args: { id: 5, notes: "Confirm 240V rough-in exists." } },
    ],
    handler: async ({ env, db }, input) => {
      const { id, ...rest } = input;
      const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(patch).length === 0) toolError("No fields to update — pass at least one field.");
      const [existing] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, id))
        .limit(1);
      if (!existing) toolError(`Material ${id} not found. Call list_materials for valid ids.`);
      if (patch.roomId != null) {
        const [r] = await db.select().from(rooms).where(eq(rooms.id, patch.roomId as number)).limit(1);
        if (!r) toolError(`Room ${patch.roomId} not found. Call list_rooms for valid ids.`);
      }
      await db.update(materialScheduleItems).set(patch).where(eq(materialScheduleItems.id, id)).run();
      const [updated] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, id))
        .limit(1);
      const roomName = await roomNameMap(db, [updated.roomId]);
      return {
        updated: true,
        material: materialDto(updated, roomName.get(updated.roomId) ?? null),
        url: materialUrl(env, id),
      };
    },
  }),

  defineTool({
    name: "set_material_specs",
    category: "materials",
    title: "Set material required specs",
    description:
      "Upsert the required-spec sheet for a material. Given `materialId` and an array of `{ key, value }`, each key is replaced if it already exists or inserted otherwise. Keys NOT included are left untouched (this does not clear the sheet). Validates the material exists.",
    inputShape: {
      materialId: z.number().int().positive().describe("Material id (from list_materials)"),
      specs: z
        .array(
          z.object({
            key: z.string().min(1).describe("Spec name, e.g. \"Burner Zones\""),
            value: z.string().min(1).describe("Required value, e.g. \"4\""),
          }),
        )
        .min(1)
        .describe("Spec rows to upsert (replace-by-key or insert)"),
    },
    annotations: WRITE,
    outputShape: {
      ok: z.boolean(),
      inserted: z.number().int(),
      replaced: z.number().int(),
      requiredSpecs: z.array(looseObject({ id: z.number().int(), key: z.string(), value: z.string() })),
      url: urlField,
    },
    examples: [
      {
        title: "Set two specs",
        args: {
          materialId: 5,
          specs: [
            { key: "Burner Zones", value: "4" },
            { key: "Width", value: '30"' },
          ],
        },
      },
    ],
    handler: async ({ env, db }, input) => {
      const [material] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, input.materialId))
        .limit(1);
      if (!material) {
        toolError(`Material ${input.materialId} not found. Call list_materials for valid ids.`);
      }

      const existing = await db
        .select()
        .from(materialRequiredSpecs)
        .where(eq(materialRequiredSpecs.materialId, input.materialId))
        .all();
      const byKey = new Map(existing.map((s) => [s.key, s]));

      let inserted = 0;
      let replaced = 0;
      for (const spec of input.specs) {
        const prior = byKey.get(spec.key);
        if (prior) {
          await db
            .update(materialRequiredSpecs)
            .set({ value: spec.value })
            .where(eq(materialRequiredSpecs.id, prior.id))
            .run();
          replaced += 1;
        } else {
          await db
            .insert(materialRequiredSpecs)
            .values({ materialId: input.materialId, key: spec.key, value: spec.value })
            .run();
          inserted += 1;
        }
      }

      const specs = await db
        .select()
        .from(materialRequiredSpecs)
        .where(eq(materialRequiredSpecs.materialId, input.materialId))
        .all();
      return {
        ok: true,
        inserted,
        replaced,
        requiredSpecs: specs.map((s) => ({ id: s.id, key: s.key, value: s.value })),
        url: materialUrl(env, input.materialId),
      };
    },
  }),

  defineTool({
    name: "link_material_to_room",
    category: "materials",
    title: "Link material to room",
    description:
      "Set a material's canonical room (`roomId` FK). Idempotent — safe to retry; re-linking to the same room is a no-op. Validates that both the material and the room exist.",
    inputShape: {
      materialId: z.number().int().positive().describe("Material id (from list_materials)"),
      roomId: z.number().int().positive().describe("Canonical room id (from list_rooms)"),
    },
    annotations: WRITE_IDEMPOTENT,
    outputShape: {
      linked: z.boolean(),
      material: materialDtoSchema,
      url: urlField,
    },
    examples: [{ title: "Link", args: { materialId: 5, roomId: 3 } }],
    handler: async ({ env, db }, input) => {
      const [material] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, input.materialId))
        .limit(1);
      if (!material) {
        toolError(`Material ${input.materialId} not found. Call list_materials for valid ids.`);
      }
      const [room] = await db.select().from(rooms).where(eq(rooms.id, input.roomId)).limit(1);
      if (!room) toolError(`Room ${input.roomId} not found. Call list_rooms for valid ids.`);

      await db
        .update(materialScheduleItems)
        .set({ roomId: room.id })
        .where(eq(materialScheduleItems.id, input.materialId))
        .run();
      const [updated] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, input.materialId))
        .limit(1);
      return {
        linked: true,
        material: materialDto(updated, room.roomName),
        url: materialUrl(env, input.materialId),
      };
    },
  }),

  defineTool({
    name: "link_material_to_budget_item",
    category: "materials",
    title: "Link material to budget item",
    description:
      "Attribute a material to a budget line so spend rolls up to it. The mapping is keyed by the budget item's STABLE `trackId` (budget rows revise in place — a new row id every edit — so the row id would dangle). Pass `budgetItemTrackId` directly, or pass a `budgetItemId` row id and its trackId is looked up. Idempotent — if the (trackId, material) pair already exists it is skipped. Validates the material and budget item exist.",
    inputShape: {
      materialId: z.number().int().positive().describe("Material id (from list_materials)"),
      budgetItemTrackId: z
        .string()
        .min(1)
        .optional()
        .describe("Stable budget item trackId (preferred)"),
      budgetItemId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("A budget item row id; its trackId is resolved automatically"),
    },
    annotations: WRITE_IDEMPOTENT,
    outputShape: {
      linked: z.boolean(),
      created: z.boolean(),
      mappingId: z.number().int(),
      budgetItemTrackId: z.string(),
      materialId: z.number().int(),
      url: urlField,
    },
    examples: [
      { title: "By trackId", args: { materialId: 5, budgetItemTrackId: "bud_kitchen_appliances" } },
      { title: "By row id", args: { materialId: 5, budgetItemId: 42 } },
    ],
    handler: async ({ env, db }, input) => {
      if (!input.budgetItemTrackId && input.budgetItemId == null) {
        toolError("Provide either `budgetItemTrackId` or `budgetItemId`.");
      }
      const [material] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, input.materialId))
        .limit(1);
      if (!material) {
        toolError(`Material ${input.materialId} not found. Call list_materials for valid ids.`);
      }

      // Resolve the stable trackId + confirm the budget item exists.
      let trackId = input.budgetItemTrackId;
      if (trackId == null) {
        const [row] = await db
          .select()
          .from(budgetTrackerItems)
          .where(eq(budgetTrackerItems.id, input.budgetItemId as number))
          .limit(1);
        if (!row) {
          toolError(`Budget item ${input.budgetItemId} not found. Call list_budget for valid ids.`);
        }
        trackId = row.trackId;
      } else {
        const [row] = await db
          .select()
          .from(budgetTrackerItems)
          .where(eq(budgetTrackerItems.trackId, trackId))
          .limit(1);
        if (!row) {
          toolError(`Budget item trackId "${trackId}" not found. Call list_budget for valid trackIds.`);
        }
      }

      // Idempotent upsert on (trackId, materialId).
      const [existing] = await db
        .select()
        .from(budgetItemMaterialMappings)
        .where(
          and(
            eq(budgetItemMaterialMappings.budgetItemTrackId, trackId),
            eq(budgetItemMaterialMappings.materialId, input.materialId),
          ),
        )
        .limit(1);
      if (existing) {
        return {
          linked: true,
          created: false,
          mappingId: existing.id,
          budgetItemTrackId: trackId,
          materialId: input.materialId,
          url: materialUrl(env, input.materialId),
        };
      }
      const [created] = await db
        .insert(budgetItemMaterialMappings)
        .values({ budgetItemTrackId: trackId, materialId: input.materialId })
        .returning();
      return {
        linked: true,
        created: true,
        mappingId: created.id,
        budgetItemTrackId: trackId,
        materialId: input.materialId,
        url: materialUrl(env, input.materialId),
      };
    },
  }),

  defineTool({
    name: "mark_material_purchased",
    category: "materials",
    title: "Mark material purchased",
    description:
      "Flag a material as purchased (sets isPurchased=true) and optionally record the showroom product it was bought as (purchasedShowroomProductId). This only flips the purchase flag — it does NOT record the actual dollar amount; log real spend with the budget expense tool separately. Validates the material exists.",
    inputShape: {
      materialId: z.number().int().positive().describe("Material id (from list_materials)"),
      purchasedShowroomProductId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Showroom product id this material was purchased as (optional)"),
    },
    annotations: WRITE,
    outputShape: {
      purchased: z.boolean(),
      material: materialDtoSchema,
      url: urlField,
    },
    examples: [
      { title: "Just mark purchased", args: { materialId: 5 } },
      { title: "With product", args: { materialId: 5, purchasedShowroomProductId: 88 } },
    ],
    handler: async ({ env, db }, input) => {
      const [material] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, input.materialId))
        .limit(1);
      if (!material) {
        toolError(`Material ${input.materialId} not found. Call list_materials for valid ids.`);
      }
      const patch: { isPurchased: boolean; purchasedShowroomProductId?: number } = {
        isPurchased: true,
      };
      if (input.purchasedShowroomProductId != null) {
        patch.purchasedShowroomProductId = input.purchasedShowroomProductId;
      }
      await db
        .update(materialScheduleItems)
        .set(patch)
        .where(eq(materialScheduleItems.id, input.materialId))
        .run();
      const [updated] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, input.materialId))
        .limit(1);
      const roomName = await roomNameMap(db, [updated.roomId]);
      return {
        purchased: true,
        material: materialDto(updated, roomName.get(updated.roomId) ?? null),
        url: materialUrl(env, input.materialId),
      };
    },
  }),
];
